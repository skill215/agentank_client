#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject } = require("../core/hash");
const { createHistoricalStarProvider } = require("../simulation/historical-scenarios");
const { loadSimulator } = require("../simulation/paired-arena");
const { V3DiagnosticBot, V3_COMPONENT_MODE } = require("../../../engine-v3/src");
const repairCohort = require("./v3-repair-cohort");
const componentCohort = require("./v3-component-cohort");
const { seedFor } = require("./v1-v3-arena");
const { buildNativeV1Module } = require("./v3-native-build");

function option(name, fallback) {
  const at = process.argv.indexOf(name); return at < 0 ? fallback : String(process.argv[at + 1]);
}

function load(root, file, role) {
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  return manifest.objectKind === repairCohort.KIND ? repairCohort.load(root, file, role) :
    componentCohort.loadCohort(root, file, role);
}

function stableAction(action) {
  if (!action) return "NONE";
  return action.type === "teleport" ? `${action.type}:${action.x}:${action.y}` :
    action.type === "turn" ? `${action.type}:${action.side}` : action.type;
}

class DualEquivalenceBot {
  constructor(root, nativeManifest) {
    this.reference = new V3DiagnosticBot({ enableV2Bridge: true,
      hardFinalMode: V3_COMPONENT_MODE.ACTIVE,
      contextName: "v3r8-reference" });
    this.native = new V3DiagnosticBot({ native: true, nativeManifest,
      workspaceRoot: root });
    this.decisions = 0; this.mismatches = 0; this.samples = [];
  }
  decide(context) {
    const reference = this.reference.decide(context); const native = this.native.decide(context);
    this.decisions += 1;
    const left = stableAction(reference.action); const right = stableAction(native.action);
    if (left !== right) {
      this.mismatches += 1;
      if (this.samples.length < 32) this.samples.push({ frame: context.game.frames,
        reference: left, native: right });
    }
    return reference;
  }
}

async function main() {
  const root = defaultWorkspaceRoot(); const role = option("--role", "ALL").toUpperCase();
  const cohortFile = path.resolve(option("--cohort",
    path.join(root, "config", "engine-v3", "v3-repair-cohort.json")));
  const cohort = load(root, cohortFile, role); const nativeManifest = buildNativeV1Module(root);
  const simulator = await loadSimulator(root); const matches = []; let mismatches = 0;
  let decisions = 0; const samples = []; const started = Date.now();
  for (let index = 0; index < cohort.scenarios.length; index += 1) {
    const scenario = cohort.scenarios[index];
    for (let seat = 0; seat < 2; seat += 1) {
      const star = createHistoricalStarProvider(scenario.stars);
      const field = new simulator.module.AgenTankSimulator({ map: scenario.map,
        tanks: scenario.starts.map((tank, at) => ({ ...tank, id: `v3r8-eq-${at}` })),
        skills: ["stun", "stun"], star: star.initialStar,
        starProvider: value => star.provider(value), seed: seedFor(scenario),
        maxFrames: 128, starLimit: false });
      const dual = new DualEquivalenceBot(root, nativeManifest);
      const opponent = new V3DiagnosticBot();
      const bots = seat === 0 ? [dual, opponent] : [opponent, dual];
      const replay = field.run(bots[0], bots[1]);
      mismatches += dual.mismatches; decisions += dual.decisions;
      for (const sample of dual.samples) if (samples.length < 32)
        samples.push({ scenarioFingerprint: scenario.fingerprint, seat, ...sample });
      matches.push({ matchUrlId: scenario.matchUrlId,
        scenarioFingerprint: scenario.fingerprint, seat, frames: dual.decisions,
        mismatches: dual.mismatches, winner: replay.result?.winner ?? null,
        reason: replay.result?.reason || "UNKNOWN" });
    }
    if ((index + 1) % 8 === 0 || index + 1 === cohort.scenarios.length)
      process.stderr.write(`[v3-native-equivalence] ${index + 1}/${cohort.scenarios.length}\n`);
  }
  const overview = { role, scenarios: cohort.scenarios.length, matches: matches.length,
    decisions, actionMismatchCount: mismatches, actionEquivalent: mismatches === 0,
    elapsedMs: Date.now() - started, nativeModuleSha256: nativeManifest.sourceSha256 };
  const output = path.resolve(option("--output", path.join(root, "artifacts", "v3-repair",
    `v3r8-equivalence-${role.toLowerCase()}-${cohort.manifest.fingerprint.slice(0, 12)}`)));
  fs.mkdirSync(output, { recursive: true });
  const manifest = { schemaVersion: 1, objectKind: "V3_NATIVE_EQUIVALENCE_V1",
    cohortFingerprint: cohort.manifest.fingerprint, role,
    nativeModuleSha256: nativeManifest.sourceSha256, fingerprint: "" };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(output, "overview.json"), `${JSON.stringify(overview, null, 2)}\n`);
  fs.writeFileSync(path.join(output, "matches.ndjson.gz"), zlib.gzipSync(Buffer.from(
    `${matches.map(item => JSON.stringify(item)).join("\n")}\n`), { level: 9 }));
  fs.writeFileSync(path.join(output, "diagnostic-samples.ndjson.gz"), zlib.gzipSync(Buffer.from(
    samples.map(item => JSON.stringify(item)).join("\n")), { level: 9 }));
  process.stdout.write(`${JSON.stringify({ output, overview }, null, 2)}\n`);
}

if (require.main === module)
  main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });

module.exports = { DualEquivalenceBot, stableAction };
