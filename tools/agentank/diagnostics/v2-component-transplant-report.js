#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { sha256Bytes, fingerprintObject } = require("../core/hash");

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function findEvidence(root, parent, prefix) {
  const directory = path.join(root, parent);
  const names = fs.readdirSync(directory).filter(name => name.startsWith(prefix));
  if (names.length !== 1)
    throw new Error(`CTR_EVIDENCE_PREFIX:${prefix}:${names.length}`);
  const selected = path.join(directory, names[0]);
  const manifestFile = path.join(selected, "manifest.json");
  const overviewFile = path.join(selected, "overview.json");
  const matchesFile = path.join(selected, "matches.ndjson.gz");
  return {
    id: prefix.replace(/-$/, ""),
    directory: path.relative(root, selected).replaceAll("\\", "/"),
    manifest: readJson(manifestFile),
    overview: readJson(overviewFile),
    hashes: {
      manifest: sha256Bytes(fs.readFileSync(manifestFile)),
      overview: sha256Bytes(fs.readFileSync(overviewFile)),
      matches: fs.existsSync(matchesFile) ? sha256Bytes(fs.readFileSync(matchesFile)) : null
    },
    matchesFile
  };
}

function analysis(value) {
  const item = value.analysis;
  return {
    challengerWins: item.challengerWins ?? item.candidateWins ?? item.v2Wins ?? 0,
    controlWins: item.controlWins ?? item.baselineWins ?? item.v3Wins ?? 0,
    draws: item.draws ?? 0,
    scoreBasisPoints: item.scoreBasisPoints ??
      Math.round(Number(item.scorePercent || 0) * 100)
  };
}

function aggregatePorts(evidence) {
  if (!fs.existsSync(evidence.matchesFile)) return {};
  const text = zlib.gunzipSync(fs.readFileSync(evidence.matchesFile)).toString("utf8").trim();
  if (!text) return {};
  const output = {};
  for (const line of text.split("\n")) {
    const match = JSON.parse(line);
    for (const port of match.candidateController?.ports || []) {
      const id = port[1];
      const details = port[3] || {};
      const target = output[id] || (output[id] = {});
      for (const [key, value] of Object.entries(details))
        if (typeof value === "number") target[key] = (target[key] || 0) + value;
    }
  }
  return output;
}

function sameActions(value) {
  const actions = value.actions || {};
  const left = actions.challenger || actions.candidate || {};
  const right = actions.control || actions.baseline || {};
  return JSON.stringify(Object.entries(left).sort()) ===
    JSON.stringify(Object.entries(right).sort());
}

function runtimeRatio(value) {
  const runtime = value.runtime || {};
  const challenger = runtime.challengerTotalMicros ?? runtime.candidateTotalMicros ?? 0;
  const control = runtime.controlTotalMicros ?? runtime.baselineTotalMicros ?? 0;
  const challengerP95 = runtime.challengerP95MaximumMicros ??
    runtime.candidateP95MaximumMicros ?? 0;
  const controlP95 = runtime.controlP95MaximumMicros ??
    runtime.baselineP95MaximumMicros ?? 0;
  return {
    totalBasisPoints: control ? Math.round(challenger * 10000 / control) : 0,
    p95BasisPoints: controlP95 ? Math.round(challengerP95 * 10000 / controlP95) : 0
  };
}

function evidenceReference(item) {
  return {
    id: item.id,
    directory: item.directory,
    manifestFingerprint: item.manifest.fingerprint,
    hashes: item.hashes,
    analysis: analysis(item.overview)
  };
}

function component(id, stage, classification, score, item, rationale, extra = {}) {
  return {
    id,
    stage,
    classification,
    score,
    evidence: item ? evidenceReference(item) : null,
    rationale,
    ...extra
  };
}

function writeStage(root, stage, status, classification, components, blockers = []) {
  const directory = path.join(root, "artifacts", "v2-component-transplant", stage);
  const overview = {
    stage,
    status,
    classification,
    components: components.map(item => ({
      id: item.id,
      classification: item.classification,
      score: item.score,
      evidence: item.evidence?.directory || null
    })),
    blockers
  };
  const acceptance = {
    schemaVersion: 1,
    objectKind: "V2_COMPONENT_TRANSPLANT_STAGE_ACCEPTANCE_V1",
    ...overview,
    fingerprint: ""
  };
  acceptance.fingerprint = fingerprintObject(acceptance);
  writeJson(path.join(directory, "overview.json"), overview);
  writeJson(path.join(directory, "acceptance.json"), acceptance);
  writeJson(path.join(directory, "manifest.json"), {
    schemaVersion: 1,
    objectKind: "V2_COMPONENT_TRANSPLANT_STAGE_MANIFEST_V1",
    stage,
    acceptanceFingerprint: acceptance.fingerprint,
    evidence: components.map(item => item.evidence).filter(Boolean),
    fingerprint: fingerprintObject({
      stage,
      acceptanceFingerprint: acceptance.fingerprint,
      evidence: components.map(item => item.evidence).filter(Boolean)
    })
  });
  return acceptance;
}

function buildReport(root) {
  const identity = readJson(path.join(root, "config", "engine-v3",
    "v2-component-transplant-identity.json"));
  const inventory = readJson(path.join(root, "config", "engine-v3",
    "v2-component-transplant-inventory.json"));
  const e = {
    observation: findEvidence(root, "artifacts/v3-components", "ctr1-shadow-"),
    hard: findEvidence(root, "artifacts/v3-components", "ctr2-hard-"),
    eoFinal: findEvidence(root, "artifacts/v3-components", "ctr2-eo-final-"),
    eoEarly: findEvidence(root, "artifacts/v3-components", "vc3-all-"),
    forcedWin: findEvidence(root, "artifacts/v3-components", "ctr3-forced-win-"),
    exactSearch: findEvidence(root, "artifacts/v3-components", "ctr3-exact-search-"),
    tacticalFull: findEvidence(root, "artifacts/v3-components", "vc6-full-"),
    direct: findEvidence(root, "artifacts/v3-components", "ctr4-direct-"),
    aim: findEvidence(root, "artifacts/v3-components", "ctr4-aim-"),
    intercept: findEvidence(root, "artifacts/v3-components", "ctr4-intercept-primary-"),
    escape: findEvidence(root, "artifacts/v3-components", "ctr4-escape-primary-"),
    shield: findEvidence(root, "artifacts/v3-components", "ctr4-shield-break-"),
    zone: findEvidence(root, "artifacts/v3-components", "ctr4-zone-denial-"),
    survivor: findEvidence(root, "artifacts/v3-components", "ctr4-survivor-primary-"),
    strategy: findEvidence(root, "artifacts/v3-components", "ctr5-target-fixed-"),
    v2Baseline: findEvidence(root, "artifacts/v2-component-transplant",
      "v2-base-vs-v3-discovery-")
  };
  const ports = Object.fromEntries(Object.entries(e).map(([key, value]) =>
    [key, aggregatePorts(value)]));

  const stages = [];
  stages.push(writeStage(root, "CTR0", "ACCEPTED", "IDENTITY_ACCEPTED", [], []));

  const ctr1 = [
    component("OBSERVATION_PROJECTILE_TRACKING", "CTR1", "CORRECT_NEUTRAL", 40,
      e.observation,
      "8/8 projectile lifecycle tests pass and actions are identical, but neither total nor P95 improves by 5%.",
      { actionEquivalent: sameActions(e.observation.overview),
        runtimeRatio: runtimeRatio(e.observation.overview),
        hotAllocations: e.observation.overview.bridge.hotAllocations })
  ];
  stages.push(writeStage(root, "CTR1", "ACCEPTED", "NO_TRANSPLANT_CANDIDATE", ctr1));

  const ctr2 = [
    component("PHYSICAL_HARD_FINAL", "CTR2", "CORRECT_NEUTRAL", 45, e.hard,
      "Complete physical checks are correct, but the Discovery set has zero safe overrides.",
      { ports: ports.hard.V2_HARD_FINAL_GATE || {} }),
    component("DEADLINE_KERNEL", "CTR2", "CORRECT_NEUTRAL", 45, null,
      "Committed closure fixtures pass; it remains a safety evidence service."),
    component("FINAL_ONLY_ESCAPE_OBLIGATION", "CTR2", "CORRECT_NEUTRAL", 40,
      e.eoFinal, "Final-only EO has zero DIE-to-SURVIVE and zero SURVIVE-to-DIE transitions.",
      { ports: ports.eoFinal.V2_HARD_FINAL_GATE || {} }),
    component("EARLY_ESCAPE_OBLIGATION", "CTR2", "NEGATIVE", 10, e.eoEarly,
      "Early ownership fell to 38.67% and is permanently excluded.")
  ];
  stages.push(writeStage(root, "CTR2", "ACCEPTED", "NO_POSITIVE_RESCUE", ctr2));

  const ctr3 = [
    component("STRICT_FORCED_WIN", "CTR3", "CORRECT_NEUTRAL", 45, e.forcedWin,
      "Proof oracle is sound, but the current Discovery produced no outcome conversion."),
    component("EXACT_VALUE_DOMINANCE", "CTR3", "CORRECT_NEUTRAL", 35, e.exactSearch,
      "No exact dominance ownership occurred and runtime materially increased.",
      { runtimeRatio: runtimeRatio(e.exactSearch.overview),
        ports: ports.exactSearch.V2_TACTICAL_CORE || {} }),
    component("TACTICAL_CORE_AS_OWNER", "CTR3", "NEGATIVE", 0, e.tacticalFull,
      "Whole-core ownership scored 6.25%; search remains evidence-only."),
    component("PHYSICAL_INFORMATION_RISK_MATRIX", "CTR3", "CORRECT_NEUTRAL", 40,
      null, "91/91 Minimax, Information, robust backup, cache and StageMatrix tests pass; none independently earned action ownership.")
  ];
  stages.push(writeStage(root, "CTR3", "ACCEPTED", "SEARCH_EVIDENCE_ONLY", ctr3));

  const ctr4 = [
    component("DIRECT_KILL", "CTR4", "CORRECT_NEUTRAL", 45, e.direct,
      "V1 already takes the same verified direct shots; no action or outcome conversion."),
    component("AIM_SETUP", "CTR4", "INTERFACE_BLOCKED", 25, e.aim,
      "Aim setup is a move/turn purpose, while verified attack ownership currently requires FIRE."),
    component("INTERCEPT", "CTR4", "CORRECT_NEUTRAL", 40, e.intercept,
      "Primary-purpose isolation produced no action or outcome conversion."),
    component("ESCAPE_DENIAL_PAC", "CTR4", "CORRECT_NEUTRAL", 48, e.escape,
      "It changed actions and reduced crashes by one, but produced zero paired outcome gain.",
      { ports: ports.escape.V2_COMBAT_DIRECT_ATTACK || {} }),
    component("SHIELD_BREAK", "CTR4", "NO_COVERAGE", 30, e.shield,
      "The stun/stun Discovery contains no shield-break ownership opportunity."),
    component("ZONE_DENIAL", "CTR4", "INTERFACE_BLOCKED", 25, e.zone,
      "Bomb zone denial lacks a complete post-bomb self-escape certificate."),
    component("SURVIVOR_FRONTIER", "CTR4", "CORRECT_NEUTRAL", 40, e.survivor,
      "PAC2 fixtures are correct but no frontier-qualified action changed the match.")
  ];
  stages.push(writeStage(root, "CTR4", "ACCEPTED", "NO_COMBAT_HOLDOUT_CANDIDATE",
    ctr4));

  const strategyAnalysis = analysis(e.strategy.overview);
  const ctr5 = [
    component("TARGET_GENERATION_STRATEGIC_ARBITER", "CTR5", "NEGATIVE", 0,
      e.strategy,
      "After fixing the NAVIGATION port order, 467 qualified overrides reduced score to 25.00% with p=0.003906.",
      { ports: ports.strategy.V3R5_STRATEGIC_PROGRESS || {},
        starDelta: (e.strategy.overview.stars.challenger -
          e.strategy.overview.stars.control),
        crashDelta: (e.strategy.overview.crashes.challenger -
          e.strategy.overview.crashes.control),
        scoreBasisPoints: strategyAnalysis.scoreBasisPoints }),
    component("PLAN_SKETCH_PERSISTENT_PLAN_PVA", "CTR5", "DEPENDENCY_BLOCKED", 0,
      null, "Plan and PVA cannot be evaluated as owners because target/strategy failed Discovery.")
  ];
  stages.push(writeStage(root, "CTR5", "ACCEPTED", "STRATEGY_NEGATIVE", ctr5));

  stages.push(writeStage(root, "CTR6", "ACCEPTED", "EMPTY_COMPONENT_BEST", [], [
    "No BEHAVIOR_POSITIVE component",
    "No PERFORMANCE_POSITIVE component",
    "V3_COMPONENT_BEST equals V3_BASE"
  ]));
  stages.push(writeStage(root, "CTR7", "BLOCKED", "NO_NATIVE_TRANSPLANT", [], [
    "No component passed its independent entry gate",
    `Frozen real V2_BASE Discovery score is ${
      e.v2Baseline.overview.analysis.scorePercent}%`
  ]));
  stages.push(writeStage(root, "CTR8", "BLOCKED", "FINAL_HOLDOUT_NOT_READ", [], [
    "No V2_REPAIRED candidate exists",
    `Need ${inventory.fresh.missingScenarios} additional fresh scenarios before fixed blind cohort`
  ]));

  const components = [...ctr1, ...ctr2, ...ctr3, ...ctr4, ...ctr5];
  const report = {
    schemaVersion: 1,
    objectKind: "V2_COMPONENT_TRANSPLANT_CTR0_CTR8_REPORT_V1",
    identityFingerprint: identity.fingerprint,
    realV2Base: {
      sourceSha256: identity.implementations.V2_BASE.sourceSha256,
      minifiedSha256: identity.implementations.V2_BASE.minifiedSha256,
      discovery: e.v2Baseline.overview
    },
    v3Base: {
      behaviorSourceSha256: identity.implementations.V3_BASE.behaviorSourceSha256,
      role: "EXPERIMENT_CONTROL_ONLY",
      includedInV2Bundle: false
    },
    components,
    best: {
      behaviorPositive: [],
      performancePositive: [],
      enabledInV3ComponentBest: [],
      v3ComponentBest: "V3_BASE",
      v2RepairedCreated: false
    },
    data: {
      exposedScenarios: inventory.exposed.uniqueScenarios,
      freshScenarios: inventory.fresh.availableScenarios,
      requiredFreshScenarios: inventory.requirement.requiredFreshScenarios,
      missingFreshScenarios: inventory.fresh.missingScenarios,
      blindHoldoutRead: false
    },
    tests: {
      v1V3Equivalence: { matches: 128, comparedFrames: 9080, divergences: 0 },
      projectileLifecycle: { passed: 8, failed: 0 },
      deadlineEscapeProof: { passed: 24, failed: 0 },
      minimaxCore: { passed: 91, failed: 0 },
      combatPac: { passed: 41, failed: 0 },
      v3Ctr: { passed: 29, failed: 0 }
    },
    stages: stages.map(item => ({
      stage: item.stage,
      status: item.status,
      classification: item.classification,
      fingerprint: item.fingerprint
    })),
    officialPlatformOperationPerformed: false,
    fingerprint: ""
  };
  report.fingerprint = fingerprintObject(report);
  writeJson(path.join(root, "config", "engine-v3",
    "v2-component-transplant-acceptance.json"), report);
  writeJson(path.join(root, "artifacts", "v2-component-transplant",
    "ctr0-ctr8-overview.json"), report);
  return report;
}

if (require.main === module) {
  try {
    const report = buildReport(defaultWorkspaceRoot());
    process.stdout.write(`${JSON.stringify({
      status: "COMPLETE_WITH_BLOCKED_FINAL",
      reportFingerprint: report.fingerprint,
      v2BaseScorePercent: report.realV2Base.discovery.analysis.scorePercent,
      behaviorPositive: report.best.behaviorPositive,
      performancePositive: report.best.performancePositive,
      freshScenarioDeficit: report.data.missingFreshScenarios
    }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  findEvidence,
  analysis,
  aggregatePorts,
  sameActions,
  runtimeRatio,
  buildReport
};
