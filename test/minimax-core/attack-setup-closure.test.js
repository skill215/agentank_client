"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { OPTION_KIND } = require("../../engine-v2/src/policy/option-portfolio");
const { PAC_STATUS, PAC_CELL } =
  require("../../engine-v2/src/search/projectile-attack-closure");
const { ATTACK_SETUP_CERTIFICATE, ATTACK_SETUP_REASON, AttackSetupClosure } =
  require("../../engine-v2/src/search/attack-setup-closure");
const { SUPPORT_STATUS, SUCCESSOR_PROOF } =
  require("../../engine-v2/src/runtime/escape-obligation");
const { ACTION, NONE_CELL } = require("../../engine-v2/src/abi/fast-codes");
const { TWO_STAGE_SETUP_STATUS } =
  require("../../engine-v2/src/search/two-stage-attack-setup-shadow");

function fixture(enemyCount = 3) {
  const count = 4; const maxEnemy = 4; const incumbent = 0; const row = 1;
  const outcome = {
    immediateFatalMass: new Uint16Array(count),
    horizonFatalMass: new Uint16Array(count),
    unknownMass: new Uint16Array(count),
    escapeSlack: new Int8Array(count),
    robustLower: new Int16Array(count)
  };
  outcome.escapeSlack.fill(2); outcome.robustLower.fill(100);
  const combat = {
    attackClosureStatus: new Uint8Array(count),
    enemyUnknownFirstActions: new Uint8Array(count),
    hitDeadline: new Uint8Array(count),
    postFireEscape: new Uint8Array(count),
    ownCounterExposure: new Uint16Array(count)
  };
  combat.attackClosureStatus[row] = PAC_STATUS.COMPLETE;
  combat.hitDeadline.fill(0xff); combat.hitDeadline[row] = 3;
  combat.postFireEscape[row] = 2;
  const pac = {
    maxEnemy,
    status: new Uint8Array(count),
    cellStatus: new Uint8Array(count * maxEnemy),
    cellSetupDelay: new Uint8Array(count * maxEnemy),
    cellMobilityLoss: new Uint8Array(count * maxEnemy),
    cellEndpointReduction: new Uint16Array(count * maxEnemy)
  };
  pac.status[row] = PAC_STATUS.COMPLETE;
  for (let column = 0; column < enemyCount; column += 1) {
    const at = row * maxEnemy + column;
    pac.cellStatus[at] = column === 0 ? PAC_CELL.PROVEN_DOOMED : PAC_CELL.SURVIVES;
    if (column > 0) pac.cellSetupDelay[at] = 1;
  }
  const escape = {
    committedEntityCount: 0,
    supportStatus: SUPPORT_STATUS.NONE,
    member: new Uint8Array(count),
    successorProof: new Uint8Array(count)
  };
  const closure = new AttackSetupClosure(count); closure.reset(count, incumbent);
  return { closure, outcome, combat, pac, escape, row, enemyCount };
}

function evaluate(f, exact = 1) {
  return f.closure.evaluateRow(f.row, OPTION_KIND.ATTACK_SETUP, exact,
    f.outcome, f.combat, f.pac, f.enemyCount, f.escape);
}

test("AttackSetupClosure certifies only complete all-column pressure with a hit branch", () => {
  const f = fixture();
  assert.equal(evaluate(f), 1);
  assert.equal(f.closure.status[f.row], ATTACK_SETUP_CERTIFICATE.CERTIFIED);
  assert.equal(f.closure.doomedColumns[f.row], 1);
  assert.equal(f.closure.constrainedColumns[f.row], 2);
  assert.equal(f.closure.uncoveredColumns[f.row], 0);
  assert.equal(f.closure.hotAllocationCount, 0);
});

test("AttackSetupClosure rejects an uncovered enemy response column", () => {
  const f = fixture();
  const at = f.row * f.pac.maxEnemy + 2;
  f.pac.cellSetupDelay[at] = 0;
  assert.equal(evaluate(f), 0);
  assert.equal(f.closure.status[f.row], ATTACK_SETUP_CERTIFICATE.REJECTED);
  assert.ok(f.closure.reason[f.row] & ATTACK_SETUP_REASON.UNCONSTRAINED_COLUMN);
});

test("AttackSetupClosure does not promote posture pressure without hit progress", () => {
  const f = fixture();
  const at = f.row * f.pac.maxEnemy;
  f.pac.cellStatus[at] = PAC_CELL.SURVIVES;
  f.pac.cellMobilityLoss[at] = 1;
  assert.equal(evaluate(f), 0);
  assert.ok(f.closure.reason[f.row] & ATTACK_SETUP_REASON.NO_HIT_PROGRESS);
});

test("AttackSetupClosure treats incomplete interval and PAC support as incomplete", () => {
  const f = fixture();
  f.pac.status[f.row] = PAC_STATUS.INCOMPLETE;
  assert.equal(evaluate(f, 0), 0);
  assert.equal(f.closure.status[f.row], ATTACK_SETUP_CERTIFICATE.INCOMPLETE);
  assert.ok(f.closure.reason[f.row] & ATTACK_SETUP_REASON.INTERVAL_INCOMPLETE);
  assert.ok(f.closure.reason[f.row] & ATTACK_SETUP_REASON.PAC_INCOMPLETE);
});

test("AttackSetupClosure rejects risk, nonloss, or counter-exposure regression", () => {
  const f = fixture();
  f.outcome.horizonFatalMass[f.row] = 1;
  f.outcome.robustLower[f.row] = 99;
  f.combat.ownCounterExposure[f.row] = 1;
  assert.equal(evaluate(f), 0);
  const reason = f.closure.reason[f.row];
  assert.ok(reason & ATTACK_SETUP_REASON.RISK_REGRESSION);
  assert.ok(reason & ATTACK_SETUP_REASON.NONLOSS_REGRESSION);
  assert.ok(reason & ATTACK_SETUP_REASON.EXPOSURE_REGRESSION);
});

test("AttackSetupClosure requires complete committed escape support when hazards exist", () => {
  const f = fixture();
  f.escape.committedEntityCount = 1;
  f.escape.supportStatus = SUPPORT_STATUS.INCOMPLETE;
  assert.equal(evaluate(f), 0);
  assert.equal(f.closure.status[f.row], ATTACK_SETUP_CERTIFICATE.INCOMPLETE);
  f.closure.reset(4, 0);
  f.escape.supportStatus = SUPPORT_STATUS.COMPLETE;
  f.escape.member[f.row] = 1;
  f.escape.successorProof[f.row] = SUCCESSOR_PROOF.PROVEN_VIABLE;
  assert.equal(evaluate(f), 1);
});

test("AttackSetupClosure scans every movement primitive, not only pre-labelled setup Options", () => {
  const closure = new AttackSetupClosure(6, { twoStageShadow: true });
  const seen = [];
  closure.twoStage.evaluateCandidate = (_bundle, row, kind) => {
    seen.push([row, kind]); return 0;
  };
  closure.reset(6, 0);
  const actions = new Uint8Array([
    ACTION.NONE, ACTION.GO, ACTION.TURN_LEFT, ACTION.TURN_RIGHT,
    ACTION.FIRE, ACTION.THROW_BOMB
  ]);
  const arguments_ = new Uint16Array(6).fill(NONE_CELL);
  assert.equal(closure.scanTwoStageFrontier({}, actions, arguments_, 6,
    new Uint8Array([ACTION.NONE]), new Uint16Array([NONE_CELL]), 1), 3);
  assert.deepEqual(seen, [[1, OPTION_KIND.ATTACK_SETUP],
    [2, OPTION_KIND.ATTACK_SETUP], [3, OPTION_KIND.ATTACK_SETUP]]);
});

test("two-stage ownership accepts only a certified frontier row", () => {
  const closure = new AttackSetupClosure(4, {
    twoStageShadow: true, twoStageOwnership: true
  });
  closure.reset(4, 0);
  closure.twoStage.status[1] = TWO_STAGE_SETUP_STATUS.CERTIFIED;
  closure.twoStage.status[2] = TWO_STAGE_SETUP_STATUS.REJECTED;
  assert.equal(closure.allowsOwnership(1, 0), 1);
  assert.equal(closure.allowsOwnership(2, 1), 0);
});
