#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject } = require("../core/hash");
const { loadSimulator } = require("../simulation/paired-arena");
const { ProductionDiagnosticBot } =
  require("../simulation/production-diagnostic-bot");
const { V3DiagnosticBot } = require("../../../engine-v3/src");
const cohortTool = require("./v3-repair-cohort");
const arena = require("./v2-native-initiative-arena");
const { analysisOutcome, rootSearchEvidence, captureCandidates } =
  require("./root-counterfactual-labels");
const { profileOptions } = require("./runtime-schedule-poc");

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function frameActions(match) {
  const bytes = Buffer.from(match.frameActionStream || "", "base64");
  const output = [];
  for (let at = 0; at + 1 < bytes.length; at += 2)
    output.push({ frame: bytes[at], action: bytes[at + 1] });
  return output;
}

function firstDivergence(baseline, candidate) {
  const left = frameActions(baseline);
  const right = frameActions(candidate);
  let index = 0;
  while (index < left.length && index < right.length &&
      left[index].frame === right[index].frame &&
      left[index].action === right[index].action) index += 1;
  if (index >= left.length || index >= right.length) return null;
  return {
    decision: index,
    frame: left[index].frame,
    baselineAction: left[index].action,
    candidateAction: right[index].action
  };
}

function transitions(document, baselineProfile, candidateProfile) {
  const baseline = new Map((document.matches || []).filter(row =>
    row.profile === baselineProfile).map(row =>
    [`${row.matchUrlId}:${row.candidateSeat}`, row]));
  const output = [];
  for (const row of document.matches || []) {
    if (row.profile !== candidateProfile) continue;
    const before = baseline.get(`${row.matchUrlId}:${row.candidateSeat}`);
    if (!before) continue;
    const divergence = firstDivergence(before, row);
    if (!divergence) continue;
    output.push({
      matchUrlId: row.matchUrlId,
      candidateSeat: row.candidateSeat,
      beforeOutcome: before.outcome,
      afterOutcome: row.outcome,
      divergence
    });
  }
  return output;
}

function captureActivePlans(engine) {
  const plans = engine.policy.plans; const output = [];
  for (let slot = 0; slot < plans.status.length; slot += 1) {
    if (!plans.status[slot]) continue;
    output.push({
      slot,
      generation: plans.generation[slot],
      kind: plans.kind[slot],
      purpose: plans.purpose[slot],
      status: plans.status[slot],
      action: plans.action[slot],
      deadline: plans.deadline[slot],
      targetSignature: plans.targetSignature[slot],
      entityCount: plans.entityCount[slot],
      cachedScore: plans.cachedScore[slot]
    });
  }
  return output;
}

async function capture(module, scenario, transition, engineOptions = {}) {
  const built = arena.field(module, scenario, transition.candidateSeat);
  const candidate = new ProductionDiagnosticBot({
    engine: engineOptions,
    captureExceptionalFrames: false
  });
  let snapshot = null;
  const originalDecide = candidate.decide.bind(candidate);
  candidate.decide = context => {
    const result = originalDecide(context);
    if (context.game.frames === transition.divergence.frame) {
      const selectedRow = candidate.engine.finalGate.lastSelected;
      snapshot = {
        selectedRow,
        selectedAction: candidate.engine.lastAction,
        searchEvidence: rootSearchEvidence(candidate.engine),
        candidates: captureCandidates(candidate.engine),
        activePlans: captureActivePlans(candidate.engine),
        planLifecycle: {
          commits: candidate.engine.planCommitCount,
          activations: candidate.engine.planActivateCount,
          completions: candidate.engine.planCompleteCount,
          invalidations: candidate.engine.planInvalidateCount,
          navigationCommits: candidate.engine.navigationPlanCommitCount,
          navigationActivations: candidate.engine.navigationPlanActivateCount,
          navigationReuses: candidate.engine.navigationPlanReuseCount
        }
      };
    }
    return result;
  };
  const control = new V3DiagnosticBot();
  const bots = transition.candidateSeat === 0 ?
    [candidate, control] : [control, candidate];
  built.simulator.run(bots[0], bots[1]);
  return {
    ...transition,
    reproducedOutcome: analysisOutcome(built.simulator,
      transition.candidateSeat),
    snapshot
  };
}

async function run(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const inputFile = path.resolve(option("--input",
    "/tmp/agentank-band-once-current16.json"));
  const outputFile = path.resolve(option("--output",
    "/tmp/agentank-strategy-divergence-evidence.json"));
  const baselineProfile = option("--baseline", "CURRENT");
  const candidateProfile = option("--candidate", "BAND_OFF_ONCE");
  const input = JSON.parse(fs.readFileSync(inputFile, "utf8"));
  const cohortFile = path.resolve(option("--cohort",
    path.join(root, "config", "engine-v3", "v3-repair-cohort.json")));
  const role = String(input.role || "DISCOVERY").toUpperCase();
  const loaded = cohortTool.load(root, cohortFile, role);
  const scenarioById = new Map(loaded.scenarios.map(value =>
    [value.matchUrlId, value]));
  const requested = transitions(input, baselineProfile, candidateProfile);
  const simulator = await loadSimulator(root);
  const rows = [];
  for (const transition of requested) {
    const scenario = scenarioById.get(transition.matchUrlId);
    if (!scenario)
      throw new Error(`STRATEGY_DIVERGENCE_SCENARIO:${transition.matchUrlId}`);
    const baseline = await capture(simulator.module, scenario, transition, {});
    const candidate = await capture(simulator.module, scenario, transition,
      profileOptions(candidateProfile));
    if (baseline.reproducedOutcome !== transition.beforeOutcome)
      throw new Error(`STRATEGY_DIVERGENCE_REPRODUCTION:${
        transition.matchUrlId}:${transition.candidateSeat}`);
    if (candidate.reproducedOutcome !== transition.afterOutcome)
      throw new Error(`STRATEGY_DIVERGENCE_CANDIDATE_REPRODUCTION:${
        transition.matchUrlId}:${transition.candidateSeat}`);
    if (!baseline.snapshot || !candidate.snapshot)
      throw new Error(`STRATEGY_DIVERGENCE_FRAME:${
        transition.matchUrlId}:${transition.candidateSeat}:${transition.divergence.frame}`);
    rows.push({ ...transition, baseline, candidate });
  }
  const document = {
    schemaVersion: 1,
    objectKind: "STRATEGY_DIVERGENCE_EVIDENCE_V1",
    inputFile,
    inputFingerprint: input.fingerprint || "",
    baselineProfile,
    candidateProfile,
    transitions: rows.length,
    rows,
    fingerprint: ""
  };
  document.fingerprint = fingerprintObject({ ...document, fingerprint: "" });
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(document, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    outputFile,
    transitions: rows.length,
    fingerprint: document.fingerprint
  }, null, 2)}\n`);
  return document;
}

if (require.main === module)
  run().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });

module.exports = {
  frameActions,
  firstDivergence,
  transitions,
  run
};
