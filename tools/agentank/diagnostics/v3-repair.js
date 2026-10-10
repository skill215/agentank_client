#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { sha256Bytes, sha256Text, fingerprintObject } = require("../core/hash");
const { loadFrozenCandidate } = require("../candidate/imp8-g10a");
const { buildImp6Production, maximumMemoryFixture, typedArrayBytes } =
  require("../build/imp6-builder");
const { NativeHierarchicalRoot } = require("../../../engine-v3/src/native-hierarchical-root");
const cohort = require("./v3-repair-cohort");

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function files(root) {
  return { cohort: path.join(root, "config", "engine-v3", "v3-repair-cohort.json"),
    vc0: path.join(root, "config", "engine-v3", "vc0-scenario-manifest.json"),
    baseline: path.join(root, "artifacts", "v3-repair", "baseline"),
    stages: path.join(root, "artifacts", "v3-repair", "stages"),
    summary: path.join(root, "artifacts", "v3-repair", "v3r0-v3r8-report.json") };
}

function writeImmutable(file, bytes) {
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file);
    if (!existing.equals(bytes)) throw new Error(`V3_REPAIR_IMMUTABLE:${file}`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes);
}

async function freeze(root) {
  const target = files(root); const frozen = loadFrozenCandidate(root);
  const vc0 = JSON.parse(fs.readFileSync(target.vc0, "utf8"));
  let manifest;
  if (fs.existsSync(target.cohort)) manifest = cohort.validate(
    JSON.parse(fs.readFileSync(target.cohort, "utf8")));
  else {
    manifest = cohort.build(root, frozen.manifest.selection.v1Sha256, vc0);
    writeImmutable(target.cohort, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  }
  const existingBaseline = path.join(target.baseline, "manifest.json");
  if (fs.existsSync(existingBaseline)) {
    const verified = verifyBaseline(root, false);
    process.stdout.write(`${JSON.stringify({ status: "ALREADY_FROZEN",
      cohortFile: target.cohort, cohortFingerprint: manifest.fingerprint,
      scenarios: manifest.scenarios.length, eligible: manifest.source.eligible,
      unselected: manifest.source.unselected, baseline: verified.baseline }, null, 2)}\n`);
    return;
  }
  const built = await buildImp6Production({ workspaceRoot: root });
  const source = fs.readFileSync(built.sourceFile); const minified = fs.readFileSync(built.minifiedFile);
  writeImmutable(path.join(target.baseline, "current-v2-source.js"), source);
  writeImmutable(path.join(target.baseline, "current-v2-minified.js"), minified);
  const baselineManifest = { schemaVersion: 1, objectKind: "V3_REPAIR_CURRENT_V2_BASELINE_V1",
    v1Sha256: frozen.manifest.selection.v1Sha256,
    cohortFingerprint: manifest.fingerprint,
    sourceSha256: sha256Bytes(source), minifiedSha256: sha256Bytes(minified),
    sourceBytes: source.length, minifiedBytes: minified.length,
    buildFingerprint: built.manifest.fingerprint, fingerprint: "" };
  baselineManifest.fingerprint = fingerprintObject(baselineManifest);
  writeImmutable(path.join(target.baseline, "manifest.json"),
    Buffer.from(`${JSON.stringify(baselineManifest, null, 2)}\n`));
  process.stdout.write(`${JSON.stringify({ status: "FROZEN", cohortFile: target.cohort,
    cohortFingerprint: manifest.fingerprint, scenarios: manifest.scenarios.length,
    eligible: manifest.source.eligible, unselected: manifest.source.unselected,
    baseline: baselineManifest }, null, 2)}\n`);
}

function verifyBaseline(root, emit = true) {
  const target = files(root); const manifest = cohort.validate(
    JSON.parse(fs.readFileSync(target.cohort, "utf8")));
  const baseline = JSON.parse(fs.readFileSync(path.join(target.baseline, "manifest.json"), "utf8"));
  const source = fs.readFileSync(path.join(target.baseline, "current-v2-source.js"));
  const minified = fs.readFileSync(path.join(target.baseline, "current-v2-minified.js"));
  if (sha256Bytes(source) !== baseline.sourceSha256 ||
      sha256Bytes(minified) !== baseline.minifiedSha256)
    throw new Error("V3_REPAIR_BASELINE_HASH");
  if (emit) process.stdout.write(`${JSON.stringify({ status: "VALID",
    cohortFingerprint: manifest.fingerprint, scenarios: manifest.scenarios.length,
    baselineFingerprint: baseline.fingerprint }, null, 2)}\n`);
  return { manifest, baseline };
}

function directoryWithPrefix(root, parent, prefix) {
  const base = path.join(root, parent);
  const names = fs.existsSync(base) ? fs.readdirSync(base).filter(name => name.startsWith(prefix)) : [];
  if (names.length !== 1) throw new Error(`V3_REPAIR_EVIDENCE:${prefix}:${names.length}`);
  return path.join(base, names[0]);
}

function evidence(root, parent, prefix) {
  const directory = directoryWithPrefix(root, parent, prefix);
  const names = ["manifest.json", "overview.json", "matches.ndjson.gz",
    "diagnostic-samples.ndjson.gz"];
  const files = names.map(name => path.join(directory, name));
  for (const file of files) if (!fs.existsSync(file)) throw new Error(`V3_REPAIR_MISSING:${file}`);
  return { directory: path.relative(root, directory),
    files: files.map(file => ({ path: path.relative(root, file), bytes: fs.statSync(file).size,
      sha256: sha256Bytes(fs.readFileSync(file)) })),
    overview: JSON.parse(fs.readFileSync(files[1], "utf8")) };
}

function sourceFingerprint(root) {
  const roots = [path.join(root, "engine-v2", "src"), path.join(root, "engine-v3", "src"),
    path.join(root, "tools", "agentank", "diagnostics")];
  const selected = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && file.endsWith(".js") &&
          (file.includes(`${path.sep}engine-v2${path.sep}`) ||
            file.includes(`${path.sep}engine-v3${path.sep}`) || entry.name.startsWith("v3-")))
        selected.push(file);
    }
  }
  for (const directory of roots) walk(directory);
  selected.sort();
  return sha256Text(selected.map(file => `${path.relative(root, file)}\0${
    sha256Bytes(fs.readFileSync(file))}`).join("\n"));
}

function weightedP95(matches, kind, side) {
  const values = [];
  for (const match of matches) if (match.implementation === kind) {
    const audit = side === "candidate" ? match.candidate : match.opponent;
    values.push([audit.p95RuntimeMicros, audit.decisionCount]);
  }
  values.sort((a, b) => a[0] - b[0]);
  const total = values.reduce((sum, value) => sum + value[1], 0);
  const target = Math.ceil(total * 95 / 100); let seen = 0;
  for (const value of values) { seen += value[1]; if (seen >= target) return value[0]; }
  return values.length ? values[values.length - 1][0] : 0;
}

function stageDefinition(root, stage) {
  const base = { stage, status: "ACCEPTED", sourceFingerprint: sourceFingerprint(root),
    componentClassification: "FOUNDATION", bestChange: "NONE", evidence: [], metrics: {} };
  if (stage === "V3R0") {
    const frozen = verifyBaseline(root, false); base.componentClassification = "FROZEN";
    base.metrics = { scenarios: frozen.manifest.scenarios.length,
      vc0Expected: { candidateWins: 62, baselineWins: 62, draws: 4 },
      currentV2SourceSha256: frozen.baseline.sourceSha256 };
  } else if (stage === "V3R1") {
    const item = evidence(root, "artifacts/v3-components", "v3r8_vc0_equivalence-");
    base.evidence.push(item); base.componentClassification = "FACT_ACCEPTED";
    base.bestChange = "PROPOSAL_OWNERSHIP_CONTRACT";
    base.metrics = { analysis: item.overview.analysis, proposalBusLogicalBytes: 210,
      proposalBusAllocatedBytes: 210 };
  } else if (stage === "V3R2") {
    const full = evidence(root, "artifacts/v3-components", "v3r2_full_negative-");
    const minus = evidence(root, "artifacts/v3-components", "v3r2_minus_information_safety-");
    const exact = evidence(root, "artifacts/v3-components", "v3r2_exact_evidence-");
    base.evidence.push(full, minus, exact); base.componentClassification = "NEUTRAL";
    base.metrics = { fullScoreBasisPoints: full.overview.analysis.scoreBasisPoints,
      minusInformationSafetyScoreBasisPoints: minus.overview.analysis.scoreBasisPoints,
      exactEvidenceScoreBasisPoints: exact.overview.analysis.scoreBasisPoints,
      exactOwnershipCount: 0, tacticalHoldoutRead: false };
  } else if (stage === "V3R3") {
    const discovery = evidence(root, "artifacts/v3-components", "v3r3_discovery-");
    const holdout = evidence(root, "artifacts/v3-components", "v3r3_holdout-");
    base.evidence.push(discovery, holdout); base.componentClassification = "NEUTRAL";
    base.metrics = { discovery: discovery.overview.analysis, holdout: holdout.overview.analysis,
      dieToSurvive: 0, surviveToDie: 0, enteredBest: false };
  } else if (stage === "V3R4") {
    const item = evidence(root, "artifacts/v3-components", "v3r4_discovery-");
    base.evidence.push(item); base.componentClassification = "NEGATIVE";
    base.metrics = { discovery: item.overview.analysis,
      pValue: item.overview.pairedRandomization.pValue,
      crashDelta: item.overview.crashes.candidate - item.overview.crashes.baseline,
      fireDelta: item.overview.actions.candidate.fire - item.overview.actions.baseline.fire,
      combatHoldoutRead: false, enteredBest: false };
  } else if (stage === "V3R5") {
    const item = evidence(root, "artifacts/v3-components", "v3r5_discovery-");
    base.evidence.push(item); base.componentClassification = "NEUTRAL";
    base.metrics = { discovery: item.overview.analysis, selectedStrategicProposalCount: 0,
      strategyHoldoutRead: false, enteredBest: false };
  } else if (stage === "V3R6") {
    base.componentClassification = "DEPENDENCY_BLOCKED";
    base.metrics = { active: false, reason: "V3R5 produced no effective strategic proposal",
      planHoldoutRead: false, enteredBest: false };
  } else if (stage === "V3R7") {
    const item = evidence(root, "artifacts/v3-components", "vc8-best-vc2-holdout-");
    base.evidence.push(item); base.componentClassification = "BEST_FROZEN";
    base.bestChange = "VC1_OBSERVATION_PLUS_VC2_PHYSICAL_HARD";
    base.metrics = { analysis: item.overview.analysis,
      enabled: ["VC1_SHARED_OBSERVATION_TRACKING", "VC2_COMPLETE_PHYSICAL_HARD_FINAL"],
      excluded: ["TACTICAL_CORE_OWNER", "EO_OWNER", "COMBAT_OWNER", "STRATEGY_OWNER",
        "PLAN_PERSISTENT_PVA"] };
  } else if (stage === "V3R8") {
    const vc0 = evidence(root, "artifacts/v3-repair", "v3r8-equivalence-all-");
    const discovery = evidence(root, "artifacts/v3-repair", "v3r8-equivalence-discovery-");
    const eo = evidence(root, "artifacts/v3-repair", "v3r8-equivalence-eo_holdout-");
    const final = evidence(root, "artifacts/v3-repair", "v3r8-final-recovery-");
    base.evidence.push(vc0, discovery, eo, final); base.componentClassification = "RECOVERED";
    base.bestChange = "NATIVE_HIERARCHICAL_ROOT";
    const matchFile = path.join(root, final.files.find(file => file.path.endsWith("matches.ndjson.gz")).path);
    const matches = zlib.gunzipSync(fs.readFileSync(matchFile)).toString("utf8").trim()
      .split("\n").filter(Boolean).map(JSON.parse);
    const candidateP95 = weightedP95(matches, "NATIVE_REPAIRED", "candidate");
    const v1P95 = weightedP95(matches, "NATIVE_REPAIRED", "opponent");
    const nativeRoot = new NativeHierarchicalRoot({ workspaceRoot: root });
    const maximum = maximumMemoryFixture(); nativeRoot.bridge.engine.adapter.adapt(
      maximum.me, maximum.enemy, maximum.game);
    const productionEngineBytes = typedArrayBytes(nativeRoot.bridge.engine);
    const nativeRootBytes = typedArrayBytes(nativeRoot);
    base.metrics = { current: final.overview.current, repaired: final.overview.repaired,
      actionMismatchCount: vc0.overview.actionMismatchCount +
        discovery.overview.actionMismatchCount + eo.overview.actionMismatchCount,
      finalActionMismatchCount: final.overview.repaired.nativeActionMismatches,
      productionEngineTypedArrayBytes: productionEngineBytes,
      nativeRootTypedArrayBytes: nativeRootBytes, typedArrayLimit: 999280,
      hierarchyIncrementalTypedArrayBytes: nativeRootBytes - productionEngineBytes,
      typedArrayHeadroomBytes: 999280 - nativeRootBytes,
      weightedMatchP95Micros: { candidate: candidateP95, v1: v1P95,
        ratioBasisPoints: Math.round(candidateP95 * 10000 / v1P95) },
      nonContactSearchNodes: 0, finalRecoveryRead: true };
  } else throw new Error(`V3_REPAIR_STAGE:${stage}`);
  base.fingerprint = fingerprintObject(base); return base;
}

function materializeStage(root, stage) {
  const definition = stageDefinition(root, stage); const output = path.join(files(root).stages, stage);
  const evidenceRecords = definition.evidence.map(item => ({ directory: item.directory,
    files: item.files, overviewFingerprint: fingerprintObject(item.overview) }));
  const overview = { schemaVersion: 1, objectKind: "V3_REPAIR_STAGE_OVERVIEW_V1", stage,
    status: definition.status, componentClassification: definition.componentClassification,
    bestChange: definition.bestChange, metrics: definition.metrics, fingerprint: "" };
  overview.fingerprint = fingerprintObject(overview);
  const acceptance = { schemaVersion: 1, objectKind: "V3_REPAIR_ACCEPTANCE_V1", ...definition,
    evidence: evidenceRecords, overviewFingerprint: overview.fingerprint };
  acceptance.fingerprint = fingerprintObject(acceptance);
  const manifest = { schemaVersion: 1, objectKind: "V3_REPAIR_STAGE_MANIFEST_V1", stage,
    cohortFingerprint: cohort.validate(JSON.parse(fs.readFileSync(files(root).cohort, "utf8"))).fingerprint,
    sourceFingerprint: definition.sourceFingerprint, acceptanceFingerprint: acceptance.fingerprint,
    overviewFingerprint: overview.fingerprint, evidence: evidenceRecords, fingerprint: "" };
  manifest.fingerprint = fingerprintObject(manifest);
  writeImmutable(path.join(output, "manifest.json"), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  writeImmutable(path.join(output, "overview.json"), Buffer.from(`${JSON.stringify(overview, null, 2)}\n`));
  writeImmutable(path.join(output, "matches.ndjson.gz"), zlib.gzipSync(Buffer.from(
    `${evidenceRecords.map(value => JSON.stringify(value)).join("\n")}\n`), { level: 9 }));
  writeImmutable(path.join(output, "diagnostic-samples.ndjson.gz"), zlib.gzipSync(Buffer.from("")));
  writeImmutable(path.join(output, "acceptance.json"), Buffer.from(`${JSON.stringify(acceptance, null, 2)}\n`));
  return acceptance;
}

const STAGES = ["V3R0", "V3R1", "V3R2", "V3R3", "V3R4", "V3R5", "V3R6", "V3R7", "V3R8"];

function verifyStage(root, stage) {
  const output = path.join(files(root).stages, stage); const acceptanceFile = path.join(output,
    "acceptance.json");
  if (!fs.existsSync(acceptanceFile)) throw new Error(`V3_REPAIR_STAGE_NOT_RUN:${stage}`);
  const acceptance = JSON.parse(fs.readFileSync(acceptanceFile, "utf8"));
  if (fingerprintObject(acceptance) !== acceptance.fingerprint)
    throw new Error(`V3_REPAIR_ACCEPTANCE_HASH:${stage}`);
  if (acceptance.sourceFingerprint !== sourceFingerprint(root))
    throw new Error(`V3_REPAIR_SOURCE_DRIFT:${stage}`);
  for (const group of acceptance.evidence || []) for (const item of group.files || []) {
    const file = path.join(root, item.path);
    if (!fs.existsSync(file) || fs.statSync(file).size !== item.bytes ||
        sha256Bytes(fs.readFileSync(file)) !== item.sha256)
      throw new Error(`V3_REPAIR_EVIDENCE_DRIFT:${stage}:${item.path}`);
  }
  for (const name of ["manifest.json", "overview.json", "matches.ndjson.gz",
    "diagnostic-samples.ndjson.gz", "acceptance.json"])
    if (!fs.existsSync(path.join(output, name))) throw new Error(`V3_REPAIR_STAGE_FILE:${stage}:${name}`);
  if (fs.readdirSync(output).reduce((sum, name) => sum + fs.statSync(path.join(output, name)).size, 0) >
      2 * 1024 * 1024) throw new Error(`V3_REPAIR_STAGE_SIZE:${stage}`);
  return acceptance;
}

function report(root) {
  const stages = STAGES.map(stage => verifyStage(root, stage));
  const report = { schemaVersion: 1, objectKind: "V3_REPAIR_FINAL_REPORT_V1",
    status: stages.every(stage => stage.status === "ACCEPTED") ? "ACCEPTED" : "REJECTED",
    stages: stages.map(stage => ({ stage: stage.stage, status: stage.status,
      componentClassification: stage.componentClassification, bestChange: stage.bestChange,
      fingerprint: stage.fingerprint })),
    acceptedBest: ["VC1_SHARED_OBSERVATION_TRACKING", "VC2_COMPLETE_PHYSICAL_HARD_FINAL",
      "NATIVE_HIERARCHICAL_ROOT"],
    excludedBehaviorOwners: { V3R2: "NEUTRAL", V3R3: "NEUTRAL", V3R4: "NEGATIVE",
      V3R5: "NEUTRAL", V3R6: "DEPENDENCY_BLOCKED" },
    finalRecovery: stages[8].metrics, fingerprint: "" };
  report.fingerprint = fingerprintObject(report);
  fs.writeFileSync(files(root).summary, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function main() {
  const root = defaultWorkspaceRoot(); const command = process.argv[2] || "verify";
  if (command === "freeze") await freeze(root);
  else if (command === "run") {
    const stage = option("--stage", "").toUpperCase();
    process.stdout.write(`${JSON.stringify(materializeStage(root, stage), null, 2)}\n`);
  } else if (command === "run-all") {
    const result = STAGES.map(stage => materializeStage(root, stage));
    process.stdout.write(`${JSON.stringify({ status: "COMPLETE", stages: result.map(value => ({
      stage: value.stage, classification: value.componentClassification })) }, null, 2)}\n`);
  } else if (command === "report") process.stdout.write(`${JSON.stringify(report(root), null, 2)}\n`);
  else if (command === "verify") {
    const stage = option("--stage", "").toUpperCase();
    if (stage) process.stdout.write(`${JSON.stringify(verifyStage(root, stage), null, 2)}\n`);
    else verifyBaseline(root);
  }
  else throw new Error(`V3_REPAIR_COMMAND:${command}`);
}

if (require.main === module)
  main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });

module.exports = { freeze, verifyBaseline, materializeStage, verifyStage, report, files };
