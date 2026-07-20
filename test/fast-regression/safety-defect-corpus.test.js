"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { fingerprintObject } = require("../../tools/agentank/core/hash");
const { FastRegressionStore } = require("../../tools/agentank/fast-regression/artifact-store");
const { actionCommand, sameCommand, inspectRootAtFrame } =
  require("../../tools/agentank/fast-regression/focused-diagnostic");
const { replayScriptedWindow } = require("../../tools/agentank/fast-regression/rehydrate");
const { loadFrozenCandidate, v2Options } = require("../../tools/agentank/candidate/imp8-g10a");
const { SAFETY_STATUS } = require("../../engine-v2/src/search/information-safety-closure");
const { HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");

const workspaceRoot = path.resolve(__dirname, "../..");
const corpusFile = path.join(workspaceRoot, "artifacts", "fast-regression", "defect-corpora",
  "safety-v1", "latest.json");

function loadCorpus() {
  const corpus = JSON.parse(fs.readFileSync(corpusFile, "utf8"));
  assert.equal(corpus.fingerprint, fingerprintObject(corpus)); return corpus;
}

test("Safety defect corpus keeps strict proof separate from continuation candidates", () => {
  const corpus = loadCorpus();
  assert.deepEqual(corpus.counts, { defects: 14, strict: 1, continuationCandidates: 13 });
  assert.equal(corpus.strict[0].distanceToTerminal, 0);
  assert.equal(corpus.strict[0].fixedContinuation.v2Crashed, true);
  assert.ok(corpus.continuationCandidates.every(item => item.distanceToTerminal > 0));
  assert.ok(corpus.continuationCandidates.every(item =>
    item.defectClass === "CONTINUATION_OBLIGATION_CANDIDATE"));
});

test("strict real battle fixture cannot publish PROVEN_SAFE across fatal stun support", async () => {
  const defect = loadCorpus().strict[0]; const store = new FastRegressionStore(workspaceRoot);
  const { capsule } = store.readCapsule(defect.capsuleFingerprint);
  const frozen = loadFrozenCandidate(workspaceRoot);
  const root = await inspectRootAtFrame(workspaceRoot, capsule, defect.frame,
    v2Options(frozen.manifest.parameters).engine);
  const selected = root.candidates.find(candidate => {
    const mapped = actionCommand(candidate.actionCode, candidate.argument, root.engine.adapter.state);
    return mapped.supported && sameCommand(mapped.command, defect.historicalCommand);
  });
  assert.ok(selected); assert.equal(selected.hardCode, HARD_STATUS.ALLOW);
  const replay = await replayScriptedWindow(workspaceRoot, capsule, defect.historicalCommand,
    { branchFrame: defect.frame, skipOriginalReplay: true });
  assert.equal(replay.exactReproductionFailure, 0);
  assert.equal(replay.branch.v2Crashed, true);
  assert.equal(root.engine.finalGate.chanceSupportCount[selected.index], 2);
  assert.equal(root.engine.finalGate.chanceFatalSupportCount[selected.index], 1);
  assert.equal(selected.safetyCode, SAFETY_STATUS.POSSIBLE_DEATH);
});
