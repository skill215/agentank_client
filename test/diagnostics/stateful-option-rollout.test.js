"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");
const { OPTION_KIND, ROLLOUT_INCOMPLETE_REASON, ROLLOUT_UNSUPPORTED_SITE,
  optionKind,
  StatefulOptionRollout } =
  require("../../tools/agentank/diagnostics/stateful-option-rollout");
const { optionBestRow } =
  require("../../tools/agentank/diagnostics/root-counterfactual-labels");

test("stateful option kinds separate movement, attack, zone and defense", () => {
  assert.equal(optionKind(fast.ACTION.GO), OPTION_KIND.POSITION);
  assert.equal(optionKind(fast.ACTION.FIRE), OPTION_KIND.ATTACK);
  assert.equal(optionKind(fast.ACTION.CAST_POISON), OPTION_KIND.ATTACK);
  assert.equal(optionKind(fast.ACTION.THROW_BOMB), OPTION_KIND.ZONE);
  assert.equal(optionKind(fast.ACTION.CAST_SHIELD), OPTION_KIND.DEFENSE);
  assert.equal(optionKind(fast.ACTION.NONE), OPTION_KIND.WAIT);
});

test("four-frame nominal option rollout restores the exact FastState root", () => {
  const built = fast.createFastPhysical(physical({
    map: { width: 7, height: 5, terrainColumnMajor: boxedMap(7, 5) },
    tanks: [tank(0, [1, 2], "right", { skillId: "poison" }),
      tank(1, [5, 2], "up", { skillId: "stun" })],
    star: { cell: [3, 1] }
  }));
  const signature = built.state.rootSignature();
  const actions = Uint8Array.from([fast.ACTION.GO,
    fast.ACTION.CAST_POISON, fast.ACTION.THROW_BOMB]);
  const arguments_ = new Uint16Array(actions.length); arguments_.fill(fast.NONE_CELL);
  const rollout = new StatefulOptionRollout();
  assert.equal(rollout.evaluate(built, actions, arguments_, actions.length), 3);
  assert.equal(built.state.rootSignature(), signature);
  assert.deepEqual(Array.from(rollout.rootRestored.slice(0, 3)), [1, 1, 1]);
  assert.equal(rollout.rootRestoreFailureCount, 0);
  assert.equal(rollout.kind[0], OPTION_KIND.POSITION);
  assert.equal(rollout.kind[1], OPTION_KIND.ATTACK);
  assert.equal(rollout.kind[2], OPTION_KIND.ZONE);
  assert.ok(rollout.transitionCount >= 3);
  assert.equal(rollout.snapshot(1).nominalOnly, true);
});

test("response-conditioned option policy restores the root after an explicit enemy first action", () => {
  const built = fast.createFastPhysical(physical({
    map: { width: 7, height: 5, terrainColumnMajor: boxedMap(7, 5) },
    tanks: [tank(0, [1, 2], "right", { skillId: "poison" }),
      tank(1, [5, 2], "left", { skillId: "stun" })],
    star: { cell: [3, 1] }
  }));
  const signature = built.state.rootSignature();
  const rollout = new StatefulOptionRollout(2);
  assert.equal(rollout.evaluatePolicy(built, fast.ACTION.FIRE, fast.NONE_CELL,
    OPTION_KIND.ATTACK, fast.ACTION.TURN_LEFT, fast.NONE_CELL, 1), 1);
  assert.equal(built.state.rootSignature(), signature);
  assert.equal(rollout.rootRestored[1], 1);
  assert.equal(rollout.kind[1], OPTION_KIND.ATTACK);
  assert.ok(rollout.frames[1] >= 1);
  assert.equal(rollout.rootRestoreFailureCount, 0);
});

test("option comparison can audit position and resource rows separately", () => {
  const rollout = new StatefulOptionRollout(4);
  rollout.kind.set([OPTION_KIND.POSITION, OPTION_KIND.ATTACK,
    OPTION_KIND.ZONE, OPTION_KIND.WAIT]);
  rollout.physicalComplete.fill(1, 0, 4); rollout.rootRestored.fill(1, 0, 4);
  rollout.objectiveProgress.set([3, 1, 0, 0]);
  rollout.ownProjectileCount[1] = 1; rollout.projectileThreat[1] = 1;
  rollout.ownBombCount[2] = 1;
  const candidates = [{ row: 0 }, { row: 1 }, { row: 2 }, { row: 3 }];
  assert.equal(optionBestRow(candidates, rollout, false, "POSITION"), 0);
  assert.equal(optionBestRow(candidates, rollout, true, "RESOURCE"), 1);
  assert.equal(optionBestRow(candidates, rollout, true), 1);
});

test("response rollout records the exact Fast failure and step without changing the root", () => {
  const built = fast.createFastPhysical(physical({
    map: { width: 7, height: 5, terrainColumnMajor: boxedMap(7, 5) },
    tanks: [tank(0, [1, 2], "right"), tank(1, [5, 2], "left")]
  }));
  const signature = built.state.rootSignature();
  const rollout = new StatefulOptionRollout(2); rollout.bind(built.state);
  rollout.kernel.applyFrame = () => fast.FAST_STATUS.INCOMPLETE_STATE;
  assert.equal(rollout.evaluatePolicy(built, fast.ACTION.GO, fast.NONE_CELL,
    OPTION_KIND.POSITION, fast.ACTION.NONE, fast.NONE_CELL, 0), 0);
  assert.equal(rollout.incompleteReason[0],
    ROLLOUT_INCOMPLETE_REASON.APPLY_INCOMPLETE_STATE);
  assert.equal(rollout.incompleteStep[0], 0);
  assert.equal(rollout.incompleteStatus[0], fast.FAST_STATUS.INCOMPLETE_STATE);
  assert.equal(rollout.incompleteOwnAction[0], fast.ACTION.GO);
  assert.equal(rollout.incompleteEnemyAction[0], fast.ACTION.NONE);
  assert.equal(rollout.incompleteReasonCount[
    ROLLOUT_INCOMPLETE_REASON.APPLY_INCOMPLETE_STATE], 1);
  assert.equal(built.state.rootSignature(), signature);
});

test("response rollout distinguishes Hard incomplete from transition failure", () => {
  const built = fast.createFastPhysical(physical({
    map: { width: 7, height: 5, terrainColumnMajor: boxedMap(7, 5) },
    tanks: [tank(0, [1, 2], "right"), tank(1, [5, 2], "left")]
  }));
  const rollout = new StatefulOptionRollout(2); rollout.bind(built.state);
  rollout.kernel.applyFrame = () => fast.FAST_STATUS.APPLIED;
  rollout.hard.classifyApplied = () => fast.HARD_STATUS.INCOMPLETE;
  assert.equal(rollout.evaluatePolicy(built, fast.ACTION.GO, fast.NONE_CELL,
    OPTION_KIND.POSITION, fast.ACTION.NONE, fast.NONE_CELL, 0), 0);
  assert.equal(rollout.incompleteReason[0],
    ROLLOUT_INCOMPLETE_REASON.HARD_INCOMPLETE);
  assert.equal(rollout.incompleteStep[0], 0);
  assert.equal(rollout.incompleteStatus[0], fast.HARD_STATUS.INCOMPLETE);
});

test("unsupported Fast call sites are classified without changing production kernel", () => {
  const rollout = new StatefulOptionRollout(2);
  assert.equal(rollout.classifyUnsupportedStack(
    "Error\n at FastKernel.move (/repo/engine-v2/src/fast/kernel.js:145:23)"),
  ROLLOUT_UNSUPPORTED_SITE.MOVE_CONTEST);
  assert.equal(rollout.classifyUnsupportedStack(
    "Error\n at FastKernel.collectStar (/repo/engine-v2/src/fast/kernel.js:300:39)"),
  ROLLOUT_UNSUPPORTED_SITE.STAR_CONTEST);
  assert.equal(rollout.classifyUnsupportedStack(
    "Error\n at FastKernel.resolveTerminal (/repo/engine-v2/src/fast/kernel.js:432:24)"),
  ROLLOUT_UNSUPPORTED_SITE.TERMINAL_RUNTIME_TIE);
});

test("rollout temporal slab preserves transient projectile pressure after endpoint expiry", () => {
  const built = fast.createFastPhysical(physical({
    map: { width: 9, height: 5, terrainColumnMajor: boxedMap(9, 5) },
    tanks: [tank(0, [1, 2], "right"), tank(1, [7, 2], "left")]
  }));
  const signature = built.state.rootSignature();
  const rollout = new StatefulOptionRollout(2, 4);
  assert.equal(rollout.evaluatePolicy(built, fast.ACTION.FIRE, fast.NONE_CELL,
    OPTION_KIND.ATTACK, fast.ACTION.TURN_LEFT, fast.NONE_CELL, 1), 1);
  assert.ok(rollout.projectileThreatFrames[1] > 0);
  assert.equal(rollout.ownProjectileCount[1], 0);
  assert.equal(rollout.projectileThreat[1], 0);
  assert.ok(rollout.enemyMobilityIntegral[1] > 0);
  assert.notEqual(rollout.minimumEnemyMobility[1], 0xff);
  assert.equal(built.state.rootSignature(), signature);
});
