"use strict";

const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { FastRegressionStore } = require("../../tools/agentank/fast-regression/artifact-store");
const { actionCommand, inspectRootAtFrame } =
  require("../../tools/agentank/fast-regression/focused-diagnostic");
const { replayPolicyContinuationWindow } =
  require("../../tools/agentank/fast-regression/rehydrate");
const { loadFrozenCandidate, v2Options } = require("../../tools/agentank/candidate/imp8-g10a");

const workspaceRoot = path.resolve(__dirname, "../..");
const fixtures = [
  ["3cb7daf359d68dbf7728252d57b66b3ac7bf66281a67dea18108ebf4657e2e71", 120, "TURN_LEFT"],
  ["8bb15faade2e7dd8890a7b7a3a307ee980b571593c984665088499ae2b54ca41", 22, "TURN_LEFT"],
  ["03414b85edafd432dd07532f827b58b757b71324e38a1989cfa1b407173b462e", 38, "TURN_LEFT"],
  // These two roots were survival regressions when a partial boolean
  // ObservationSafetyFrontier result was mixed with coarse risk masses.
  ["0bca6b52888d4259c95823480616f6eebd4b6be5a530422028a743d808b75364", 21, "TURN_LEFT"],
  ["8bcf5a546ef62a8011db1326a0619dcd07de009b388ec208b4edc5fb4e98c5f1", 54, "GO"],
  // A future-FIRE path estimate must not publish while an unresolved possible
  // projectile is outside that path model.
  ["753a74e59c6fe245f82b184379b6aef10fac579e7f4d5809bd4403664d9d73bc", 110,
    "TURN_LEFT"],
  // Complete-input multi-frame upper-envelope gains from the persisted
  // focused cohort. Every old survivor above remains part of the same gate.
  ["00be00d72c05acd1a054ff7d6132d8845a6b991d97c8bface3aaf4626bf46204", 35, "GO"],
  ["06b536f7c61293c3caa8aa42360f7d15b2f7c215ffb49293ed1f780d58106fc6", 17, "GO"],
  ["6d1683217662f3e46e76cc12e50464f61370d6a6a5266139a672adfe9c98470c", 21, "GO"],
  ["11ef62c235b0fabbaff0cb573bddf19a80bf1f4766d7c2e5df6f6fbdd634b575", 22, "GO"],
  ["1940e9afc9e4c8d35a18934ae8b1489b16775bb7af9bf27a57f56619426fe05f", 109,
    "TURN_LEFT"],
  // Joint future-FIRE and tracked-possible-projectile path gains. These are
  // source-independent physical continuations and freeze the R7 improvement.
  ["8113db725f9602614356897402709e43ec2a58f13d5b36c021784fd9887d9d9a", 89,
    "CAST_POISON"],
  ["8113db725f9602614356897402709e43ec2a58f13d5b36c021784fd9887d9d9a", 90,
    "TURN_LEFT"],
  ["6f49c211952c699ae81d11b02821855ae911ee16ff4b26da73f92008c423f94f", 17,
    "FIRE"],
  ["c2a770486b2230a9e52db839c5264ee0bb74210eafd3dea5b714cf35095c3448", 105,
    "TURN_LEFT"],
  ["8bcf5a546ef62a8011db1326a0619dcd07de009b388ec208b4edc5fb4e98c5f1", 51,
    "GO"]
];

test("historical safety repairs preserve survival under the current shared continuation policy",
  async () => {
    const store = new FastRegressionStore(workspaceRoot);
    const frozen = loadFrozenCandidate(workspaceRoot);
    const settings = v2Options(frozen.manifest.parameters).engine;
    for (const [fingerprint, frame, expectedAction] of fixtures) {
      const { capsule } = store.readCapsule(fingerprint);
      const root = await inspectRootAtFrame(workspaceRoot, capsule, frame, settings);
      const selected = root.candidates.find(item => item.actionCode === root.returned);
      assert.ok(selected, `${capsule.matchId}:${frame}:selected-candidate`);
      const mapped = actionCommand(selected.actionCode, selected.argument, root.engine.adapter.state);
      assert.equal(mapped.supported, true, `${capsule.matchId}:${frame}:mapped`);
      const replay = await replayPolicyContinuationWindow(workspaceRoot, capsule, mapped.command,
        { branchFrame: frame, currentRootCommand: mapped.command, v2Options: settings });
      assert.equal(replay.rootActionVerified, 1,
        `${capsule.matchId}:${frame}:${expectedAction}->${root.selectedAction}:root`);
      assert.equal(replay.branch.v2Crashed, false, `${capsule.matchId}:${frame}:survival`);
    }
  });
