"use strict";

const fs = require("node:fs");
const { fingerprintObject } = require("../core/hash");
const { FastRegressionStore } = require("./artifact-store");
const { logicalWindowFingerprint } = require("./capsule");

function features(capsule) {
  const values = new Set(); const add = (name, value) => values.add(`${name}:${value}`);
  add("map", capsule.scenario.mapHash || fingerprintObject({ map: capsule.scenario.map }));
  add("starts", fingerprintObject({ starts: capsule.scenario.starts }));
  add("skills", capsule.assignment.seatSkills.join("/"));
  add("variant", capsule.assignment.variantId); add("family", capsule.assignment.family);
  add("result", capsule.original.result.winnerImplementation || "draw");
  add("reason", capsule.original.result.reason || "UNKNOWN");
  for (const tag of capsule.window.tags) add("tag", tag);
  return [...values].sort();
}

function greedyCover(entries, maximum) {
  const uncovered = new Set(entries.flatMap(entry => entry.features)); const selected = [];
  const remaining = entries.slice();
  while (remaining.length && selected.length < maximum && uncovered.size > 0) {
    let bestIndex = 0; let bestGain = -1;
    for (let index = 0; index < remaining.length; index += 1) {
      const gain = remaining[index].features.filter(feature => uncovered.has(feature)).length;
      if (gain > bestGain || (gain === bestGain &&
          remaining[index].fingerprint < remaining[bestIndex].fingerprint)) {
        bestIndex = index; bestGain = gain;
      }
    }
    const [best] = remaining.splice(bestIndex, 1); selected.push(best);
    for (const feature of best.features) uncovered.delete(feature);
    if (bestGain === 0 && selected.length >= maximum) break;
  }
  return { selected, uncovered: [...uncovered].sort() };
}

function deduplicateLogical(entries) {
  const byLogical = new Map();
  for (const entry of entries) if (!byLogical.has(entry.logicalFingerprint))
    byLogical.set(entry.logicalFingerprint, entry);
  return [...byLogical.values()];
}

function buildCohort(workspaceRoot, options = {}) {
  const store = new FastRegressionStore(workspaceRoot); const physicalEntries = store.listCapsules().map(file => {
    const capsule = JSON.parse(fs.readFileSync(file, "utf8"));
    return { file, fingerprint: capsule.fingerprint, matchId: capsule.source.matchId,
      evaluationFrame: capsule.window.evaluationFrame, tags: capsule.window.tags,
      logicalFingerprint: logicalWindowFingerprint(capsule), features: features(capsule) };
  }).sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  const entries = deduplicateLogical(physicalEntries);
  const maximum = Math.max(1, Math.floor(Number(options.maximum) || 64));
  const smoke = greedyCover(entries, maximum); const minimaxTags = new Set([
    "INFORMATION_INCOMPLETE", "STRICT_PROOF", "NO_HARD_ALLOW", "FALLBACK",
    "PROJECTILE_CREATED", "PROJECTILE_ACTIVE", "BOMB_CREATED", "BOMB_EXPLODED",
    "TERMINAL_CRASH", "TERMINAL_FRAME_LIMIT"
  ]);
  const impacted = entries.filter(entry => entry.tags.some(tag => minimaxTags.has(tag)));
  const terminal = entries.filter(entry => entry.tags.some(tag =>
    tag.startsWith("TERMINAL") || tag.startsWith("OUTCOME_")));
  const lane = values => values.map(entry => ({ fingerprint: entry.fingerprint,
    relativePath: entry.file.slice(store.paths.root.length + 1).replaceAll("\\", "/"),
    matchId: entry.matchId, evaluationFrame: entry.evaluationFrame,
    tags: entry.tags, features: entry.features }));
  const manifest = {
    properties: ["DETERMINISTIC", "GREEDY_SET_COVER", "DYNAMIC_APPEND_ONLY_SOURCE"],
    source: { capsuleCount: physicalEntries.length, logicalCapsuleCount: entries.length,
      duplicateLogicalCapsules: physicalEntries.length - entries.length,
      capsuleRoot: fingerprintObject({ fingerprints: entries.map(entry => entry.fingerprint) }) },
    lanes: {
      smoke: lane(smoke.selected),
      minimaxImpacted: lane(impacted),
      terminalAll: lane(terminal),
      capsuleAll: lane(entries)
    },
    coverage: { smokeMaximum: maximum, smokeSelected: smoke.selected.length,
      uncoveredFeatures: smoke.uncovered, minimaxImpacted: impacted.length,
      terminalAll: terminal.length, capsuleAll: entries.length }
  };
  return store.writeCohort(manifest, options.name || "current");
}

module.exports = { features, greedyCover, deduplicateLogical, buildCohort };
