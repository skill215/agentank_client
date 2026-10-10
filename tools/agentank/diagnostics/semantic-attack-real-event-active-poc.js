#!/usr/bin/env node
"use strict";

// BP146 is a narrow causal POC for BP145's strict missed-FIRE certificates.
// Recorded commands reconstruct the exact prefix only.  At the certified root
// CONTROL returns ownership to current V2, ACTIVE emits FIRE, and both suffixes
// use the live current V2 plus deterministic V3 opponent.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { loadSimulator } = require("../simulation/paired-arena");
const { ProductionDiagnosticBot } = require(
  "../simulation/production-diagnostic-bot");
const { V3DiagnosticBot } = require("../../../engine-v3/src");
const { field, loadCohort } = require("./v2-native-initiative-arena");
const { scenarioIndex } = require("./semantic-attack-certificate-root-corpus");
const { readRoots } = require("./semantic-attack-chance-qualified-labels");
const { terminalLabel } = require("./root-counterfactual-labels");
const { ACTION, HARD_STATUS, NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { RecordedActionBot, actionObject, actionArgument,
  installRecordedSkillEmitter } = require(
  "./semantic-attack-real-opportunity-corpus");
const { exactPhysicalRoot } = require("./semantic-attack-real-event-proof");

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function selectCertifiedMissedFire(proofRoots, sourceRoots) {
  const source = new Map(sourceRoots.map(root => [root.key, root]));
  const selected = [];
  for (const proof of proofRoots) {
    if (proof.sourceClass !== "MISSED_FIRE" ||
        !proof.goals.some(goal => goal.executable)) continue;
    const root = source.get(proof.key);
    if (!root) throw new Error("BP146_SOURCE_ROOT_MISSING:" + proof.key);
    selected.push({ proof, root });
  }
  return selected;
}

class PrefixThenV3Bot {
  constructor(stream, arguments_, rootFrame) {
    this.actions = Buffer.from(stream || "", "base64");
    this.arguments = arguments_ || []; this.rootFrame = rootFrame;
    this.index = 0; this.delegate = new V3DiagnosticBot();
  }
  decide(context) {
    const index = this.index++; const decision = this.delegate.decide(context);
    if (context.game.frames >= this.rootFrame) return decision;
    return { ...decision, action: actionObject(
      this.actions[index] ?? ACTION.NONE, this.arguments, index) };
  }
}

function transition(control, active) {
  return control.outcome + "_TO_" + active.outcome;
}

function outcomePoints(outcome) {
  return outcome === "V2_WIN" ? 2 : outcome === "DRAW" ? 1 : 0;
}

function runArm(module, scenario, source, active) {
  const prefix = source.replayPrefix;
  const actions = Buffer.from(prefix.candidateActionStream, "base64");
  let decisionIndex = 0; let targetSeen = 0; let rootExact = 0;
  let preOverrideAction = ACTION.NONE; let fireHardAllowed = 0;
  const candidate = new ProductionDiagnosticBot({ captureExceptionalFrames: false,
    diagnosticFinalActionOverride(engine, action, argument) {
      const index = decisionIndex++;
      if (index < source.decisionIndex) {
        const code = actions[index] ?? ACTION.NONE;
        return { action: code, argument: actionArgument(engine, code,
          prefix.candidateArguments, index) };
      }
      if (index !== source.decisionIndex) return null;
      targetSeen = 1; rootExact = exactPhysicalRoot(engine, source) ? 1 : 0;
      preOverrideAction = action; let fireRow = -1;
      for (let row = 0; row < engine.ourCount; row += 1)
        if (engine.ourActions[row] === ACTION.FIRE) { fireRow = row; break; }
      fireHardAllowed = fireRow >= 0 &&
        engine.hardStatus[fireRow] === HARD_STATUS.ALLOW ? 1 : 0;
      return active ? { action: ACTION.FIRE, argument: NONE_CELL,
        row: fireRow } : null;
    } });
  installRecordedSkillEmitter(candidate.engine);
  const control = new PrefixThenV3Bot(prefix.controlActionStream,
    prefix.controlArguments, source.frame);
  const built = field(module, scenario, source.attackSeat, source.seatSkills);
  const bots = source.attackSeat === 0 ? [candidate, control] :
    [control, candidate];
  built.simulator.run(bots[0], bots[1]);
  return { active, targetSeen: Boolean(targetSeen), rootExact: Boolean(rootExact),
    preOverrideAction, fireHardAllowed: Boolean(fireHardAllowed),
    decisionCount: decisionIndex, terminal: terminalLabel(
      built.simulator, source.attackSeat),
    hardRejects: candidate.summary().avoidableHardRejectCount,
    rootRestoreFailures: candidate.summary().rootRestoreFailures };
}

function summarize(records) {
  const output = { rootCount: records.length, transitions: {},
    controlPoints: 0, activePoints: 0, positiveCount: 0, negativeCount: 0,
    equalCount: 0, exactArmCount: 0, targetSeenArmCount: 0,
    hardFailureCount: 0, restoreFailureCount: 0 };
  for (const record of records) {
    const key = transition(record.control.terminal, record.active.terminal);
    output.transitions[key] = (output.transitions[key] || 0) + 1;
    const control = outcomePoints(record.control.terminal.outcome);
    const active = outcomePoints(record.active.terminal.outcome);
    output.controlPoints += control; output.activePoints += active;
    if (active > control) output.positiveCount += 1;
    else if (active < control) output.negativeCount += 1;
    else output.equalCount += 1;
    for (const arm of [record.control, record.active]) {
      output.exactArmCount += arm.rootExact ? 1 : 0;
      output.targetSeenArmCount += arm.targetSeen ? 1 : 0;
      output.hardFailureCount += arm.hardRejects || 0;
      output.restoreFailureCount += arm.rootRestoreFailures || 0;
    }
  }
  output.pointDelta = output.activePoints - output.controlPoints;
  return output;
}

async function build(root = defaultWorkspaceRoot()) {
  const proofDirectory = path.resolve(option("--proof-source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp145-semantic-attack-real-event-proof-v2")));
  const sourceDirectory = path.resolve(option("--root-source", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp144-semantic-attack-real-opportunity-corpus-v4")));
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp146-semantic-attack-real-event-active-poc")));
  const expectedRoots = Number(option("--expected-roots", 4));
  const cohortFile = path.resolve(option("--cohort", path.join(root,
    "config", "engine-v2", "strategic-attack-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const proofs = readRoots(proofDirectory); const sources = readRoots(sourceDirectory);
  const selected = selectCertifiedMissedFire(proofs.roots, sources.roots);
  if (selected.length !== expectedRoots)
    throw new Error("BP146_ROOT_DENOMINATOR:" + selected.length + "/" +
      expectedRoots);
  const loaded = loadCohort(root, cohortFile, role);
  const scenarios = scenarioIndex(loaded.scenarios);
  const simulator = await loadSimulator(root); const records = [];
  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index]; const source = item.root;
    const scenario = scenarios.get(source.scenarioFingerprint) ||
      scenarios.get(source.matchUrlId);
    if (!scenario) throw new Error("BP146_SCENARIO_MISSING:" + source.key);
    const control = runArm(simulator.module, scenario, source, false);
    const active = runArm(simulator.module, scenario, source, true);
    records.push({ schemaVersion: 1,
      objectKind: "SEMANTIC_ATTACK_REAL_EVENT_ACTIVE_POC_ROOT_V1",
      key: source.key, matchUrlId: source.matchUrlId,
      scenarioFingerprint: source.scenarioFingerprint,
      attackSeat: source.attackSeat, seatSkills: source.seatSkills,
      frame: source.frame, decisionIndex: source.decisionIndex,
      proofGoals: item.proof.goals.filter(goal => goal.executable)
        .map(goal => goal.name), control, active,
      transition: transition(control.terminal, active.terminal) });
  }
  const summary = summarize(records); const expectedArms = records.length * 2;
  const accepted = records.length === expectedRoots &&
    summary.exactArmCount === expectedArms &&
    summary.targetSeenArmCount === expectedArms &&
    summary.hardFailureCount === 0 && summary.restoreFailureCount === 0;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_REAL_EVENT_ACTIVE_POC_OVERVIEW_V1",
    status: accepted ? "ACCEPT_ACTIVE_POC_MEASURED" : "REJECTED", role,
    cohortFingerprint: loaded.manifest.fingerprint,
    selectedRootCount: selected.length, ...summary,
    decisionBoundary: "Exact-signature diagnostic POC only. It does not enable a production owner or establish population-level significance." };
  const lines = records.map(record => JSON.stringify(record)).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_REAL_EVENT_ACTIVE_POC_MANIFEST_V1",
    status: overview.status, proofDirectory, sourceDirectory,
    proofRootsSha256: sha256Bytes(proofs.bytes),
    sourceRootsSha256: sha256Bytes(sources.bytes), cohortFile,
    cohortSha256: sha256Bytes(fs.readFileSync(cohortFile)),
    productionRootSha256: sha256Bytes(fs.readFileSync(productionFile)),
    recordsSha256: sha256Bytes(bytes), rootCount: records.length,
    arguments: process.argv.slice(2), fingerprint: "" };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "overview.json"),
    JSON.stringify(overview, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "roots.ndjson.gz"), bytes);
  process.stdout.write(JSON.stringify({ output: outputDirectory, overview,
    fingerprint: manifest.fingerprint }, null, 2) + "\n");
  if (!accepted) throw new Error("BP146_ACTIVE_POC_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(error => {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { selectCertifiedMissedFire, PrefixThenV3Bot, transition,
  outcomePoints, runArm, summarize, build };
