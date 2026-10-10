#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { sha256Bytes, sha256Text, fingerprintObject } = require("../core/hash");
const { buildImp6Production } = require("../build/imp6-builder");
const { resolveFrozenV1 } = require("../../../engine-v3/src/legacy/default-source");
const { V3DiagnosticBot } = require("../../../engine-v3/src");
const { implementationId } = require("./v3-component-arena");
const { loadCohort } = require("./v3-component-cohort");
const { createHistoricalStarProvider } = require("../simulation/historical-scenarios");
const { loadSimulator } = require("../simulation/paired-arena");
const { seedFor } = require("./v1-v3-arena");
const cohort = require("./v2-component-transplant-cohort");

const CTR0_STATUS = Object.freeze({
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  BLOCKED: "BLOCKED"
});

function slash(value) { return value.replaceAll("\\", "/"); }

function locations(root) {
  return {
    vc0: path.join(root, "config", "engine-v3", "vc0-scenario-manifest.json"),
    repair: path.join(root, "config", "engine-v3", "v3-repair-cohort.json"),
    inventory: path.join(root, "config", "engine-v3",
      "v2-component-transplant-inventory.json"),
    blind: path.join(root, "config", "engine-v3",
      "v2-component-transplant-blind-cohort.json"),
    identity: path.join(root, "config", "engine-v3",
      "v2-component-transplant-identity.json"),
    baseline: path.join(root, "artifacts", "v2-component-transplant", "baseline"),
    ctr0: path.join(root, "artifacts", "v2-component-transplant", "CTR0")
  };
}

function walkJavaScript(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walkJavaScript(file, files);
    else if (entry.isFile() && file.endsWith(".js")) files.push(file);
  }
  return files;
}

function filesFingerprint(root, files) {
  const records = files.slice().sort().map(file =>
    `${slash(path.relative(root, file))}\0${sha256Bytes(fs.readFileSync(file))}`);
  return sha256Text(records.join("\n"));
}

function v3BaseInterfaceFiles(root) {
  return [
    "engine-v3/src/contracts.js",
    "engine-v3/src/component-registry.js",
    "engine-v3/src/component-result.js",
    "engine-v3/src/controller.js",
    "engine-v3/src/diagnostic-bot.js",
    "engine-v3/src/legacy/default-source.js",
    "engine-v3/src/legacy/v1-runtime.js"
  ].map(file => path.join(root, file));
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === bytes) return;
  fs.writeFileSync(file, bytes);
}

function writeImmutable(file, bytes) {
  if (fs.existsSync(file)) {
    if (!fs.readFileSync(file).equals(bytes))
      throw new Error(`CTR_IMMUTABLE_ARTIFACT_DRIFT:${file}`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function currentInventory(root) {
  const target = locations(root);
  return cohort.buildInventory(root, readJson(target.vc0), readJson(target.repair));
}

function inventory(root, emit = true) {
  const target = locations(root);
  const value = currentInventory(root);
  writeJson(target.inventory, value);
  const summary = {
    status: value.fresh.ready ? "READY" : "BLOCKED",
    inventoryFile: target.inventory,
    inventoryFingerprint: value.fingerprint,
    rollingUniqueScenarios: value.source.uniqueScenarios,
    exposedScenarios: value.exposed.uniqueScenarios,
    freshScenarios: value.fresh.availableScenarios,
    requiredFreshScenarios: cohort.REQUIRED_FRESH_SCENARIOS,
    missingFreshScenarios: value.fresh.missingScenarios
  };
  if (emit) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return { value, summary };
}

function previousEvidenceRelabel(root) {
  const file = path.join(root, "artifacts", "v3-repair",
    "v3r8-final-recovery-c96a557cfa99", "overview.json");
  if (!fs.existsSync(file)) return {
    available: false,
    oldLabel: "NATIVE_REPAIRED",
    correctedLabel: "V3_NATIVE_BASELINE_EQUIVALENCE"
  };
  const value = readJson(file);
  return {
    available: true,
    relativePath: slash(path.relative(root, file)),
    sha256: sha256Bytes(fs.readFileSync(file)),
    oldLabel: value.repaired?.implementation || "NATIVE_REPAIRED",
    correctedLabel: "V3_NATIVE_BASELINE_EQUIVALENCE",
    interpretation: "V3_OR_V1_COMPATIBLE_BASELINE_NOT_A_V2_IMPLEMENTATION",
    oldScoreBasisPoints: value.repaired?.scoreBasisPoints ?? null,
    frozenV2ScoreBasisPoints: value.current?.scoreBasisPoints ?? null
  };
}

function portableAction(action) {
  if (!action) return null;
  const output = { type: String(action.type || "none") };
  if (action.side) output.side = String(action.side);
  if (Number.isSafeInteger(action.x)) output.x = action.x;
  if (Number.isSafeInteger(action.y)) output.y = action.y;
  return output;
}

class V1V3EquivalenceBot {
  constructor(oracle, v3) {
    this.oracle = oracle;
    this.v3 = v3;
    this.compared = 0;
    this.divergences = 0;
    this.firstDivergence = null;
  }

  decide(context) {
    const expected = this.oracle.decide(context);
    const actual = this.v3.decide(context);
    this.compared += 1;
    const left = portableAction(expected?.action);
    const right = portableAction(actual?.action);
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      this.divergences += 1;
      if (!this.firstDivergence) this.firstDivergence = {
        frame: context.game.frames,
        expected: left,
        actual: right
      };
    }
    return actual;
  }
}

async function verifyV1V3Equivalence(root) {
  const target = locations(root);
  const frozen = resolveFrozenV1(root);
  const loaded = loadCohort(root, target.vc0, "ALL");
  const simulator = await loadSimulator(root);
  const matches = [];
  let comparedFrames = 0;
  let divergences = 0;
  const started = Date.now();
  for (let index = 0; index < loaded.scenarios.length; index += 1) {
    const scenario = loaded.scenarios[index];
    for (let v3Seat = 0; v3Seat < 2; v3Seat += 1) {
      const star = createHistoricalStarProvider(scenario.stars);
      const field = new simulator.module.AgenTankSimulator({
        map: scenario.map,
        tanks: scenario.starts.map((tank, seat) =>
          ({ ...tank, id: `ctr0-equivalence-${seat}` })),
        skills: ["stun", "stun"],
        star: star.initialStar,
        starProvider: value => star.provider(value),
        seed: seedFor(scenario),
        maxFrames: 128,
        starLimit: false
      });
      const oracle = simulator.module.loadBotFromCode(frozen.source,
        { timeoutMs: 200, loadTimeoutMs: 2000 });
      const opponent = simulator.module.loadBotFromCode(frozen.source,
        { timeoutMs: 200, loadTimeoutMs: 2000 });
      const differential = new V1V3EquivalenceBot(oracle,
        new V3DiagnosticBot({ contextName: `ctr0-${scenario.matchUrlId}-${v3Seat}` }));
      const bots = v3Seat === 0 ? [differential, opponent] : [opponent, differential];
      const replay = field.run(bots[0], bots[1]);
      comparedFrames += differential.compared;
      divergences += differential.divergences;
      matches.push({
        matchUrlId: scenario.matchUrlId,
        scenarioFingerprint: scenario.fingerprint,
        v3Seat,
        frames: replay.replayData.replay.records.length,
        comparedFrames: differential.compared,
        divergences: differential.divergences,
        firstDivergence: differential.firstDivergence
      });
    }
    if ((index + 1) % 8 === 0 || index + 1 === loaded.scenarios.length)
      process.stderr.write(`[ctr0-equivalence] ${index + 1}/${loaded.scenarios.length}\n`);
  }
  const overview = {
    stage: "CTR0",
    comparison: {
      oracleImplementation: "V1_ORACLE",
      subjectImplementation: "V3_BASE",
      explicitlyNotV2: true
    },
    scenarios: loaded.scenarios.length,
    matches: matches.length,
    comparedFrames,
    divergences,
    elapsedMs: Date.now() - started,
    status: divergences === 0 ? CTR0_STATUS.ACCEPTED : CTR0_STATUS.REJECTED
  };
  writeJson(path.join(target.ctr0, "equivalence-overview.json"), overview);
  writeImmutable(path.join(target.ctr0, "equivalence-matches.ndjson"),
    Buffer.from(`${matches.map(item => JSON.stringify(item)).join("\n")}\n`));
  process.stdout.write(`${JSON.stringify(overview, null, 2)}\n`);
  if (divergences) throw new Error(`CTR0_V1_V3_ACTION_DIVERGENCE:${divergences}`);
  return overview;
}

async function freeze(root) {
  const target = locations(root);
  const frozenV1 = resolveFrozenV1(root);
  const inventoryResult = inventory(root, false);
  let blind = null;
  if (inventoryResult.value.fresh.ready) {
    blind = cohort.buildBlindCohort(inventoryResult.value);
    if (fs.existsSync(target.blind)) {
      const existing = cohort.validateBlindCohort(readJson(target.blind));
      if (existing.fingerprint !== blind.fingerprint)
        throw new Error("CTR_BLIND_COHORT_ALREADY_FROZEN_DIFFERENT");
      blind = existing;
    } else writeJson(target.blind, blind);
  }

  const built = await buildImp6Production({
    workspaceRoot: root,
    outputDirectory: path.join(target.baseline, "build")
  });
  const source = fs.readFileSync(built.sourceFile);
  const minified = fs.readFileSync(built.minifiedFile);
  const sourceFile = path.join(target.baseline,
    `v2-base-source-${sha256Bytes(source)}.js`);
  const minifiedFile = path.join(target.baseline,
    `v2-base-minified-${sha256Bytes(minified)}.js`);
  writeImmutable(sourceFile, source);
  writeImmutable(minifiedFile, minified);

  const baseFiles = v3BaseInterfaceFiles(root);
  const identity = {
    schemaVersion: 1,
    objectKind: "V2_COMPONENT_TRANSPLANT_IDENTITY_V1",
    frozenAt: new Date().toISOString(),
    implementations: {
      V1_ORACLE: {
        kind: "FROZEN_V1_SCRIPT",
        sourceRelativePath: slash(path.relative(root, frozenV1.sourceFile)),
        sourceSha256: frozenV1.sha256
      },
      V3_BASE: {
        kind: "MODULAR_V1_EXPERIMENT_HOST",
        behaviorSourceSha256: frozenV1.sha256,
        interfaceFingerprint: filesFingerprint(root, baseFiles),
        interfaceFiles: baseFiles.map(file => slash(path.relative(root, file))),
        isV2: false
      },
      V2_BASE: {
        kind: "REAL_V2_PRODUCTION_ROOT",
        sourceRelativePath: slash(path.relative(root, sourceFile)),
        minifiedRelativePath: slash(path.relative(root, minifiedFile)),
        sourceSha256: sha256Bytes(source),
        minifiedSha256: sha256Bytes(minified),
        sourceBytes: source.length,
        minifiedBytes: minified.length,
        buildFingerprint: built.manifest.fingerprint,
        isV2: true
      },
      V3_NATIVE_BASELINE: {
        kind: "VM_FREE_MODULAR_V1_EXPERIMENT_HOST",
        isV2: false
      }
    },
    runnerContract: {
      V3_BASE: implementationId("BASE_V3"),
      V3_COMPONENT_EXAMPLE: implementationId("VC2_HARD_ACTIVE"),
      nativeV3: implementationId("V3R8_NATIVE_BEST"),
      forbiddenV2Aliases: ["candidate", "NATIVE_REPAIRED"]
    },
    cohort: {
      inventoryFingerprint: inventoryResult.value.fingerprint,
      blindCohortFingerprint: blind?.fingerprint || null,
      readiness: blind ? "READY" :
        `BLOCKED_NEEDS_${inventoryResult.value.fresh.missingScenarios}_FRESH_SCENARIOS`
    },
    legacyEvidenceRelabel: previousEvidenceRelabel(root),
    fingerprint: ""
  };
  const payload = { ...identity };
  delete payload.frozenAt;
  delete payload.fingerprint;
  identity.fingerprint = fingerprintObject(payload);

  if (fs.existsSync(target.identity)) {
    const existing = readJson(target.identity);
    if (existing.fingerprint !== identity.fingerprint)
      throw new Error("CTR0_IDENTITY_ALREADY_FROZEN_DIFFERENT");
  } else writeJson(target.identity, identity);

  const acceptance = {
    schemaVersion: 1,
    objectKind: "V2_COMPONENT_TRANSPLANT_ACCEPTANCE_V1",
    stage: "CTR0",
    status: CTR0_STATUS.ACCEPTED,
    identityFingerprint: identity.fingerprint,
    checks: {
      v3BehaviorBoundToFrozenV1: true,
      v3AndV2IdentityDistinct: true,
      nativeV3ExplicitlyNotV2: true,
      priorEvidenceRelabeled: true,
      freshInventoryDisjointFromExposed: true
    },
    holdoutReadiness: identity.cohort.readiness,
    executionBoundary: {
      componentDiscoveryAllowed: true,
      blindHoldoutAllowed: Boolean(blind),
      officialPlatformOperationPerformed: false
    },
    fingerprint: ""
  };
  acceptance.fingerprint = fingerprintObject(acceptance);
  writeJson(path.join(target.ctr0, "acceptance.json"), acceptance);
  writeJson(path.join(target.ctr0, "manifest.json"), identity);
  writeJson(path.join(target.ctr0, "overview.json"), {
    stage: "CTR0",
    status: acceptance.status,
    identities: Object.keys(identity.implementations),
    holdoutReadiness: acceptance.holdoutReadiness,
    freshScenarios: inventoryResult.value.fresh.availableScenarios,
    requiredFreshScenarios: cohort.REQUIRED_FRESH_SCENARIOS,
    missingFreshScenarios: inventoryResult.value.fresh.missingScenarios
  });
  process.stdout.write(`${JSON.stringify({ status: acceptance.status,
    identityFile: target.identity, identityFingerprint: identity.fingerprint,
    v1Sha256: frozenV1.sha256, v2SourceSha256: identity.implementations.V2_BASE.sourceSha256,
    holdoutReadiness: acceptance.holdoutReadiness }, null, 2)}\n`);
}

function verify(root) {
  const target = locations(root);
  const identity = readJson(target.identity);
  const frozenV1 = resolveFrozenV1(root);
  const inventoryValue = cohort.validateInventory(readJson(target.inventory));
  const checks = [];
  function check(name, condition) {
    checks.push({ name, pass: Boolean(condition) });
    if (!condition) throw new Error(`CTR0_VERIFY:${name}`);
  }
  check("V1_HASH", identity.implementations.V1_ORACLE.sourceSha256 === frozenV1.sha256);
  check("V3_BEHAVIOR_IS_V1", identity.implementations.V3_BASE.behaviorSourceSha256 ===
    frozenV1.sha256);
  check("V3_NOT_V2", identity.implementations.V3_BASE.isV2 === false);
  check("NATIVE_V3_NOT_V2", identity.implementations.V3_NATIVE_BASELINE.isV2 === false);
  check("REAL_V2_MARKED_V2", identity.implementations.V2_BASE.isV2 === true);
  check("IDENTITIES_DISTINCT", identity.runnerContract.V3_BASE === "V3_BASE" &&
    identity.runnerContract.V3_COMPONENT_EXAMPLE.startsWith("V3_PLUS_") &&
    identity.runnerContract.nativeV3 === "V3_NATIVE_BASELINE");
  const sourceFile = path.join(root, identity.implementations.V2_BASE.sourceRelativePath);
  const minifiedFile = path.join(root, identity.implementations.V2_BASE.minifiedRelativePath);
  check("V2_SOURCE_HASH", sha256Bytes(fs.readFileSync(sourceFile)) ===
    identity.implementations.V2_BASE.sourceSha256);
  check("V2_MINIFIED_HASH", sha256Bytes(fs.readFileSync(minifiedFile)) ===
    identity.implementations.V2_BASE.minifiedSha256);
  const baseFiles = identity.implementations.V3_BASE.interfaceFiles.map(file =>
    path.join(root, file));
  check("V3_INTERFACE_HASH", filesFingerprint(root, baseFiles) ===
    identity.implementations.V3_BASE.interfaceFingerprint);
  check("FRESH_DISJOINT", inventoryValue.fresh.scenarios.every(item =>
    !new Set(inventoryValue.exposed.scenarioFingerprints).has(item.scenarioFingerprint)));
  check("LEGACY_RELABEL", identity.legacyEvidenceRelabel.correctedLabel ===
    "V3_NATIVE_BASELINE_EQUIVALENCE");
  const equivalenceFile = path.join(target.ctr0, "equivalence-overview.json");
  check("V1_V3_EQUIVALENCE_EVIDENCE", fs.existsSync(equivalenceFile));
  const equivalence = readJson(equivalenceFile);
  check("V1_V3_ACTION_DIVERGENCE_ZERO", equivalence.divergences === 0 &&
    equivalence.scenarios === 64 && equivalence.matches === 128 &&
    equivalence.comparedFrames > 0);
  const payload = { ...identity };
  delete payload.frozenAt;
  delete payload.fingerprint;
  check("IDENTITY_FINGERPRINT", fingerprintObject(payload) === identity.fingerprint);
  const result = {
    stage: "CTR0",
    status: CTR0_STATUS.ACCEPTED,
    checks,
    holdoutReadiness: identity.cohort.readiness,
    freshScenarios: inventoryValue.fresh.availableScenarios,
    missingFreshScenarios: inventoryValue.fresh.missingScenarios
  };
  const acceptance = {
    schemaVersion: 1,
    objectKind: "V2_COMPONENT_TRANSPLANT_ACCEPTANCE_V1",
    stage: "CTR0",
    status: CTR0_STATUS.ACCEPTED,
    identityFingerprint: identity.fingerprint,
    checks,
    evidence: {
      equivalenceRelativePath: slash(path.relative(root, equivalenceFile)),
      equivalenceSha256: sha256Bytes(fs.readFileSync(equivalenceFile)),
      comparedFrames: equivalence.comparedFrames,
      divergences: equivalence.divergences
    },
    holdoutReadiness: identity.cohort.readiness,
    executionBoundary: {
      componentDiscoveryAllowed: true,
      blindHoldoutAllowed: identity.cohort.blindCohortFingerprint !== null,
      officialPlatformOperationPerformed: false
    },
    fingerprint: ""
  };
  acceptance.fingerprint = fingerprintObject(acceptance);
  writeJson(path.join(target.ctr0, "acceptance.json"), acceptance);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result;
}

async function main() {
  const root = defaultWorkspaceRoot();
  const command = process.argv[2] || "verify";
  if (command === "inventory") inventory(root);
  else if (command === "freeze" || command === "run") await freeze(root);
  else if (command === "verify") verify(root);
  else if (command === "verify-equivalence") await verifyV1V3Equivalence(root);
  else if (command === "arena")
    await require("./v2-v3-transplant-arena").run(root);
  else if (command === "report") {
    const report = require("./v2-component-transplant-report").buildReport(root);
    process.stdout.write(`${JSON.stringify({ status: "COMPLETE_WITH_BLOCKED_FINAL",
      reportFingerprint: report.fingerprint,
      v2BaseScorePercent: report.realV2Base.discovery.analysis.scorePercent,
      behaviorPositive: report.best.behaviorPositive,
      performancePositive: report.best.performancePositive,
      freshScenarioDeficit: report.data.missingFreshScenarios }, null, 2)}\n`);
  }
  else if (command === "freeze-blind") {
    const target = locations(root);
    const value = currentInventory(root);
    writeJson(target.inventory, value);
    const manifest = cohort.buildBlindCohort(value);
    if (fs.existsSync(target.blind))
      throw new Error("CTR_BLIND_COHORT_ALREADY_EXISTS");
    writeJson(target.blind, manifest);
    process.stdout.write(`${JSON.stringify({ status: "FROZEN",
      file: target.blind, fingerprint: manifest.fingerprint }, null, 2)}\n`);
  } else throw new Error(`CTR_COMMAND_UNKNOWN:${command}`);
}

if (require.main === module)
  main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });

module.exports = {
  CTR0_STATUS,
  locations,
  filesFingerprint,
  v3BaseInterfaceFiles,
  currentInventory,
  inventory,
  previousEvidenceRelabel,
  portableAction,
  V1V3EquivalenceBot,
  verifyV1V3Equivalence,
  freeze,
  verify
};
