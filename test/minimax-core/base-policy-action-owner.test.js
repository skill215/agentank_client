"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS } = require(
  "../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { ROOT_CONTROL_MODE } = require(
  "../../engine-v2/src/runtime/root-control-mode");
const { NativeBasePolicyActionOwner } = require(
  "../../engine-v2/src/base-policy/action-owner");
const { NativeTacticalActionOwnerPoc } = require(
  "../../tools/agentank/diagnostics/native-tactical-action-owner-poc");

function next(seed) {
  seed.value = Math.imul(seed.value ^ seed.value >>> 15, 0x2c1b3c6d);
  seed.value = Math.imul(seed.value ^ seed.value >>> 12, 0x297a2d39);
  seed.value ^= seed.value >>> 15;
  return seed.value >>> 0;
}

function dependency(values) {
  return {
    contextEpoch: 0,
    prepare() {},
    member(row) { return values.member[row]; },
    bonus(row) { return values.bonus[row]; },
    commitSelection() {}
  };
}

function search(values) {
  return {
    rootScore: Int32Array.from(values.score),
    rootNominalScore: Int32Array.from(values.nominal),
    rootCellScore: new Int32Array(24 * 24),
    rootNominalCellScore: new Int32Array(24 * 24),
    rootDomainRestricted: values.restricted,
    rootDomainMask: Uint8Array.from(values.domain),
    prepare() { return values.supported; }
  };
}

function domain(values) {
  return { allows(_engine, row) { return values.ownerDomain[row]; } };
}

function engine(values, policySearch, intent, ownerDomain) {
  const outcome = {
    count: values.count,
    acceptable: Uint8Array.from(values.acceptable),
    immediateFatalMass: Uint16Array.from(values.immediate),
    unknownMass: Uint16Array.from(values.unknown),
    dominated: Uint8Array.from(values.dominated)
  };
  return {
    adapter: { enemyVisible: values.visible, state: { arrays: [] } },
    lastControlMode: values.tactical ? ROOT_CONTROL_MODE.TACTICAL_CONTACT :
      ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION,
    controlMode: { context: { reason: 0 } },
    lastProofStatus: values.proven ? PROOF_STATUS.PROVEN : PROOF_STATUS.UNKNOWN,
    lastSelectionWasStrictRescue: values.rescue,
    lastSelectionWasVerifiedDirectKill: values.kill,
    escapeObligation: { committedEntityCount: values.committed },
    ourCount: values.count,
    ourActions: Int8Array.from(values.actions),
    ourArguments: Int16Array.from(values.arguments),
    hardStatus: Uint8Array.from(values.hard),
    enemyCount: 3,
    riskController: {
      outcome,
      strictlyDominates(left, right) {
        return values.riskRank[left] < values.riskRank[right];
      }
    },
    policySearch,
    intent,
    ownerDomain
  };
}

function fixture(seed) {
  const actions = [ACTION.GO, ACTION.FIRE, ACTION.TURN_LEFT, ACTION.TURN_RIGHT,
    ACTION.CAST_STUN, ACTION.THROW_BOMB, ACTION.NONE];
  const count = actions.length;
  const values = {
    count,
    actions,
    arguments: actions.map((_, row) => row * 17),
    score: [], nominal: [], member: [], bonus: [], domain: [], ownerDomain: [],
    acceptable: [], immediate: [], unknown: [], dominated: [], hard: [],
    riskRank: [],
    supported: next(seed) % 17 !== 0,
    restricted: next(seed) % 3 === 0 ? 1 : 0,
    visible: next(seed) % 19 !== 0,
    tactical: next(seed) % 13 !== 0,
    proven: next(seed) % 41 === 0,
    rescue: next(seed) % 43 === 0,
    kill: next(seed) % 47 === 0,
    committed: next(seed) % 37 === 0 ? 1 : 0
  };
  for (let row = 0; row < count; row += 1) {
    values.score[row] = (next(seed) % 9 - 4) * 100;
    values.nominal[row] = (next(seed) % 9 - 4) * 100;
    values.member[row] = next(seed) % 4 === 0 ? 0 : 1;
    values.bonus[row] = values.member[row] ? next(seed) % 301 : 0;
    values.domain[row] = next(seed) % 5 ? 1 : 0;
    values.ownerDomain[row] = next(seed) % 7 ? 1 : 0;
    values.acceptable[row] = next(seed) % 3 ? 1 : 0;
    values.immediate[row] = next(seed) % 5 === 0 ? 1 : 0;
    values.unknown[row] = next(seed) % 6 === 0 ? 1 : 0;
    values.dominated[row] = next(seed) % 7 === 0 ? 1 : 0;
    values.hard[row] = next(seed) % 8 ? HARD_STATUS.ALLOW : HARD_STATUS.REJECT;
    values.riskRank[row] = next(seed) % 6;
  }
  values.hard[count - 1] = HARD_STATUS.ALLOW;
  return values;
}

function owner(Kind, values) {
  return new Kind({
    domain: domain(values),
    intent: dependency(values),
    policySearch: search(values),
    riskFrontierMode: "joint",
    riskSoftBandMode: "intent-known",
    intentValueMode: "bonus"
  });
}

test("thin owner is root-equivalent to the frozen BP68 diagnostic owner", () => {
  const seed = { value: 0x68b15601 };
  for (let index = 0; index < 4096; index += 1) {
    const values = fixture(seed);
    const expectedOwner = owner(NativeTacticalActionOwnerPoc, values);
    const actualOwner = owner(NativeBasePolicyActionOwner, values);
    const expectedEngine = engine(values, expectedOwner.policySearch,
      expectedOwner.intent, expectedOwner.domain);
    const actualEngine = engine(values, actualOwner.policySearch,
      actualOwner.intent, actualOwner.domain);
    const incumbent = values.actions[next(seed) % (values.count - 1)];
    const expected = expectedOwner.selectOverride(expectedEngine, -1, incumbent);
    const actual = actualOwner.selectOverride(actualEngine, -1, incumbent);
    assert.equal(actual?.action ?? ACTION.NONE, expected?.action ?? ACTION.NONE,
      `action mismatch at root ${index}`);
    assert.equal(actual?.argument ?? 0, expected?.argument ?? 0,
      `argument mismatch at root ${index}`);
    assert.equal(actual?.row ?? -1, expected?.row ?? -1,
      `row mismatch at root ${index}`);
    assert.deepEqual(Array.from(actualOwner.allowedRow.slice(0, values.count - 1)),
      Array.from(expectedOwner.allowedRow.slice(0, values.count - 1)),
      `membership mismatch at root ${index}`);
  }
});

test("thin owner returns a reused result object on overrides", () => {
  const values = fixture({ value: 0x156 });
  values.visible = 1; values.tactical = 1; values.proven = 0;
  values.rescue = 0; values.kill = 0; values.committed = 0;
  values.supported = 1; values.restricted = 0;
  values.score.fill(0); values.nominal.fill(0); values.member.fill(1);
  values.bonus.fill(0); values.domain.fill(1); values.ownerDomain.fill(1);
  values.acceptable.fill(1); values.immediate.fill(0); values.unknown.fill(0);
  values.dominated.fill(0); values.hard.fill(HARD_STATUS.ALLOW);
  const value = owner(NativeBasePolicyActionOwner, values);
  const root = engine(values, value.policySearch, value.intent, value.domain);
  const first = value.selectOverride(root, -1, ACTION.TURN_RIGHT);
  const second = value.selectOverride(root, -1, ACTION.TURN_LEFT);
  assert.equal(first, second);
  assert.equal(second.action, ACTION.GO);
});

test("committed tactical search requires an explicit host opt-in", () => {
  const values = fixture({ value: 0x204 });
  values.visible = 1; values.tactical = 1; values.proven = 0;
  values.rescue = 0; values.kill = 0; values.committed = 1;
  values.supported = 1; values.restricted = 0;
  values.score.fill(0); values.nominal.fill(0); values.member.fill(1);
  values.bonus.fill(0); values.domain.fill(1); values.ownerDomain.fill(1);
  values.acceptable.fill(1); values.immediate.fill(0); values.unknown.fill(0);
  values.dominated.fill(0); values.hard.fill(HARD_STATUS.ALLOW);
  const value = owner(NativeBasePolicyActionOwner, values);
  const root = engine(values, value.policySearch, value.intent, value.domain);
  assert.equal(value.selectOverride(root, -1, ACTION.TURN_RIGHT), null);
  root.basePolicyOwnsViableCommitted = 1;
  assert.ok(value.selectOverride(root, -1, ACTION.TURN_RIGHT));
});
