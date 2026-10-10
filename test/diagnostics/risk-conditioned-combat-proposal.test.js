"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { GLOBAL_MODE } = require("../../engine-v2/src/abi/policy-codes");
const { OPTION_KIND } = require("../../engine-v2/src/policy/option-portfolio");
const { SUPPORT_STATUS } = require("../../engine-v2/src/runtime/escape-obligation");
const { PAC_STATUS } = require(
  "../../engine-v2/src/search/projectile-attack-closure");
const { METRIC } = require(
  "../../tools/agentank/diagnostics/combat-utility-envelope-shadow");
const { RiskConditionedCombatProposal } = require(
  "../../tools/agentank/diagnostics/risk-conditioned-combat-proposal");

function fixture() {
  const combat = { count: 2,
    attackClosureStatus: Uint8Array.from([PAC_STATUS.NONE, PAC_STATUS.COMPLETE]),
    purposeCompleteness: Uint16Array.from([0, 8000]),
    postFireEscape: Uint8Array.from([1, 2]),
    ownCounterExposure: Uint16Array.from([1000, 500]),
    resourceOccupancy: Uint8Array.from([0, 1]),
    hitDeadline: Uint8Array.from([255, 2]) };
  const risk = { count: 2, acceptable: Uint8Array.from([1, 1]),
    dominated: new Uint8Array(2), robustLower: Int16Array.from([0, 0]),
    expectedValue: Int16Array.from([0, 100]),
    immediateFatalMass: new Uint16Array(2), horizonFatalMass: new Uint16Array(2),
    unknownMass: new Uint16Array(2), earliestFatalFrame: Uint8Array.from([255, 255]),
    escapeSlack: new Int8Array(2) };
  const pac = { status: Uint8Array.from([PAC_STATUS.NONE, PAC_STATUS.COMPLETE]),
    unknownEnemyColumns: new Uint8Array(2) };
  const engine = { ourCount: 2, enemyCount: 2,
    ourActions: Uint8Array.from([ACTION.GO, ACTION.FIRE]),
    ourArguments: new Uint16Array(2),
    hardStatus: Uint8Array.from([HARD_STATUS.ALLOW, HARD_STATUS.ALLOW]),
    optionPortfolio: { count: 2, primitiveRow: Uint8Array.from([0, 1]),
      supportComplete: Uint8Array.from([1, 1]),
      kind: Uint8Array.from([OPTION_KIND.STAR_CONTROL, OPTION_KIND.ATTACK_SETUP]) },
    escapeObligation: { supportStatus: SUPPORT_STATUS.NONE },
    rootGlobalMode: () => GLOBAL_MODE.NORMAL,
    riskController: { outcome: risk }, combat: { vector: combat },
    projectileAttack: pac, policy: { baseRisk: 65 },
    projectedCell: Uint16Array.from([4, 5]),
    projectedDirection: Uint8Array.from([0, 0]),
    starDistance: cell => cell === 4 ? 2 : 3,
    adapter: {} };
  const proposal = new RiskConditionedCombatProposal({ active: true });
  proposal.utility.backupAtRisk = (_engine, row, _risk, output, offset) => {
    assert.equal(row, 1); output.fill(0, offset, offset + METRIC.COUNT);
    output[offset + METRIC.PRESSURE] = 100; return 1;
  };
  proposal.utility.safetyNonRegressive = () => 1;
  proposal.rollout.evaluate = (_bundle, _actions, _arguments, count) => {
    proposal.rollout.physicalComplete.fill(1, 0, count);
    proposal.rollout.rootRestored.fill(1, 0, count);
    proposal.rollout.hardFatal.fill(0, 0, count);
    proposal.rollout.ownCrashed.fill(0, 0, count);
    proposal.rollout.starGain.fill(0, 0, count);
    return count;
  };
  return { engine, proposal };
}

test("deadline-balanced proposal admits only a complete non-regressive FIRE", () => {
  const built = fixture();
  assert.equal(built.proposal.evaluate(built.engine, 0, 2), 1);
  const summary = built.proposal.summary();
  assert.equal(summary.staticCandidateCount, 1);
  assert.equal(summary.deadlineCandidateCount, 1);
  assert.equal(summary.proposalCount, 1);
  assert.equal(summary.rootRestoreFailureCount, 0);
  assert.equal(summary.hotAllocationCount, 0);
  built.engine.adapter.state = { hashLo: 1, hashHi: 2, arrays: [] };
  built.engine.adapter.state.arrays[ARRAY.SCALAR] = new Uint32Array(16);
  built.engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 7;
  built.engine.adapter.state.arrays[ARRAY.TANK_CELL] = Uint16Array.from([4, 5]);
  built.engine.adapter.state.arrays[ARRAY.TANK_DIR] = Uint8Array.from([0, 1]);
  built.engine.adapter.state.arrays[ARRAY.TANK_STARS] = Uint8Array.from([0, 0]);
  const responsePolicy = { complete: true, relation: 3 };
  const sample = built.proposal.sample(built.engine, 0, 1, responsePolicy);
  assert.equal(sample.responsePolicy, responsePolicy);
});

test("later attack deadline cannot replace earlier star progress", () => {
  const built = fixture();
  built.engine.combat.vector.hitDeadline[1] = 4;
  assert.equal(built.proposal.evaluate(built.engine, 0, 2), -1);
  assert.equal(built.proposal.summary().deadlineBlockedCount, 1);
  assert.equal(built.proposal.summary().rolloutCount, 0);
});

test("bounded rollout blocks immediate star loss and proven death", () => {
  const star = fixture();
  star.proposal.rollout.evaluate = (_bundle, _actions, _arguments, count) => {
    star.proposal.rollout.physicalComplete.fill(1, 0, count);
    star.proposal.rollout.rootRestored.fill(1, 0, count);
    star.proposal.rollout.starGain[0] = 1; star.proposal.rollout.starGain[1] = 0;
    return count;
  };
  assert.equal(star.proposal.evaluate(star.engine, 0, 2), -1);
  assert.equal(star.proposal.summary().starLossBlockedCount, 1);

  const dead = fixture();
  dead.proposal.rollout.evaluate = (_bundle, _actions, _arguments, count) => {
    dead.proposal.rollout.physicalComplete.fill(1, 0, count);
    dead.proposal.rollout.rootRestored.fill(1, 0, count);
    dead.proposal.rollout.hardFatal[1] = 1; return count;
  };
  assert.equal(dead.proposal.evaluate(dead.engine, 0, 2), -1);
  assert.equal(dead.proposal.summary().survivalBlockedCount, 1);
});

test("committed danger and terminal mode remain higher owners", () => {
  const committed = fixture();
  committed.engine.escapeObligation.supportStatus = SUPPORT_STATUS.COMPLETE;
  assert.equal(committed.proposal.evaluate(committed.engine, 0, 2), -1);
  assert.equal(committed.proposal.summary().committedBlockedCount, 1);

  const terminal = fixture();
  terminal.engine.rootGlobalMode = () => GLOBAL_MODE.HARD_SURVIVAL;
  assert.equal(terminal.proposal.evaluate(terminal.engine, 0, 2), -1);
  assert.equal(terminal.proposal.summary().terminalBlockedCount, 1);
});
