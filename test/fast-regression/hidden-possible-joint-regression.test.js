"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { FastRegressionStore } = require("../../tools/agentank/fast-regression/artifact-store");
const { inspectRootsAtFrames } =
  require("../../tools/agentank/fast-regression/focused-diagnostic");
const { loadFrozenCandidate, v2Options } =
  require("../../tools/agentank/candidate/imp8-g10a");
const { RISK_BOUNDS_STATUS } =
  require("../../engine-v2/src/search/multi-frame-risk-bounds");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");

const workspaceRoot = path.resolve(__dirname, "../..");
const sourceAnalysis = path.join(workspaceRoot, "artifacts", "fast-regression", "reports",
  "dominated-rescue-search-frontier-r11",
  "5eb0a5971d7d2ffd57909adb2f8e3717da8f6257bdf0ded8ff5778f2cce32dcc.json");
const JOINT_CAUSE = "PATH_SUPPORT_POSSIBLE_PROJECTILE_AND_HIDDEN_WORLD";

test("all 27 historical hidden-world plus possible-projectile roots close the joint Risk envelope",
  async () => {
    const baseline = JSON.parse(fs.readFileSync(sourceAnalysis, "utf8"));
    const cases = baseline.cases.filter(item => item.rootCause === JOINT_CAUSE);
    assert.equal(cases.length, 27, "the immutable source defect denominator changed");
    const byCapsule = new Map();
    for (const item of cases) {
      if (!byCapsule.has(item.capsuleFingerprint)) byCapsule.set(item.capsuleFingerprint, []);
      byCapsule.get(item.capsuleFingerprint).push(item);
    }
    const store = new FastRegressionStore(workspaceRoot);
    const settings = v2Options(loadFrozenCandidate(workspaceRoot).manifest.parameters).engine;
    let completed = 0; let selectedHistoricalRescues = 0;
    let valueOrderingRepair = null;
    for (const [fingerprint, entries] of byCapsule) {
      const { capsule } = store.readCapsule(fingerprint);
      const roots = await inspectRootsAtFrames(workspaceRoot, capsule,
        entries.map(item => item.frame), settings);
      for (const item of entries) {
        const root = roots.get(item.frame); const engine = root.engine;
        assert.equal(engine.adapter.enemyVisible, 0, `${fingerprint}:${item.frame}:hidden`);
        assert.equal(engine.hiddenSupportComplete, 0,
          `${fingerprint}:${item.frame}:strict-support-must-stay-incomplete`);
        assert.equal(engine.hiddenRiskSupportComplete, 1,
          `${fingerprint}:${item.frame}:risk-envelope`);
        assert.ok(engine.possibleProjectiles.count() > 0,
          `${fingerprint}:${item.frame}:possible-projectile`);
        assert.equal(engine.multiFrameRisk.status, RISK_BOUNDS_STATUS.APPLIED,
          `${fingerprint}:${item.frame}:joint-publication`);
        assert.ok(engine.multiFrameRisk.appliedActions > 0,
          `${fingerprint}:${item.frame}:applied-actions`);
        assert.equal(engine.multiFrameRisk.interrupted, 0,
          `${fingerprint}:${item.frame}:budget-interruption`);
        assert.notEqual(engine.lastProofStatus, PROOF_STATUS.PROVEN,
          `${fingerprint}:${item.frame}:risk-cannot-prove`);
        if (item.rescuingActions.includes(root.selectedAction)) selectedHistoricalRescues += 1;
        if (fingerprint ===
            "45a25cd39d4c2026edc6e535fc6d1523d7d100d616825ba8d74d33a1294d00ef" &&
            item.frame === 83) valueOrderingRepair = root;
        completed += 1;
      }
    }
    assert.equal(completed, 27);
    assert.ok(selectedHistoricalRescues >= 2,
      "fixed historical continuation remains a non-regression sample, not the policy oracle");
    assert.ok(valueOrderingRepair, "value-ordering repair sample must still be present");
    assert.notEqual(valueOrderingRepair.selectedAction, "GO",
      "the Safety epsilon-contamination backup must remove the fatal GO from the robust floor");
    assert.ok(["FIRE", "TURN_LEFT", "TURN_RIGHT"].includes(valueOrderingRepair.selectedAction),
      "value-ordering repair must keep a non-fatal combat/escape action");
  });
