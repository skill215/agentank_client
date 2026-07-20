"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const reference = require("../../engine-v2/src/reference");
const { fast, physical, tank, boxedMap, commandAction, fastSnapshot } = require("./helpers");

test("Fast physical layout uses fixed TypedArray SoA and generation-bearing entity slots", () => {
  const built = fast.createFastPhysical(physical({ projectiles: [
    { entityId: 3, ownerSeat: 0, cell: [2, 1], direction: "right", shotGroupId: 3, memberIndex: 0 }
  ] }));
  assert.equal(built.status, fast.FAST_STATUS.APPLIED);
  assert.ok(built.state.arrays.every(array => ArrayBuffer.isView(array)));
  assert.equal(built.state.arrays[fast.ARRAY.PROJECTILE_GENERATION][0], 1);
  assert.equal(built.state.arrays[fast.ARRAY.PROJECTILE_ID][0], 3);
});

test("Fast apply and undo restore every physical field hash arena count and event cursor", () => {
  const built = fast.createFastPhysical(physical()); const root = built.state.rootSignature();
  const status = built.kernel.applyFrame(fast.ACTION.TURN_RIGHT, fast.NONE_CELL,
    fast.ACTION.NONE, fast.NONE_CELL);
  assert.equal(status, fast.FAST_STATUS.APPLIED); assert.notEqual(built.state.rootSignature(), root);
  built.kernel.undoLast(); assert.equal(built.state.rootSignature(), root);
  assert.equal(built.state.deltaUsed, 0); assert.equal(built.state.eventUsed, 0);
});

test("Fast exact and common canonical physical results match the independent Reference Oracle", () => {
  const run = reference.runCanonicalScenarios(path.resolve(__dirname, "../.."));
  for (const result of run.results) {
    const built = fast.createFastPhysical(result.parentState);
    const [action0, arg0] = commandAction(result.parentState.tanks[0], result.parentState.map.width);
    const [action1, arg1] = commandAction(result.parentState.tanks[1], result.parentState.map.width);
    const status = built.kernel.applyFrame(action0, arg0, action1, arg1);
    assert.ok(status === fast.FAST_STATUS.APPLIED || status === fast.FAST_STATUS.APPLIED_TERMINAL,
      `${result.fixtureId} fast status ${status}`);
    const actual = fastSnapshot(built.state); const expected =
      run.kernel.advanceFrame(result.parentState).childState;
    assert.equal(actual.frame, expected.platformFrame, `${result.fixtureId} frame`);
    assert.equal(actual.record, expected.recordIndex, `${result.fixtureId} record`);
    const terrainCodes = { ".": 0, x: 1, m: 2, o: 3 };
    assert.deepEqual(actual.terrain, expected.map.terrainColumnMajor.map(column =>
      column.map(tile => terrainCodes[tile])), `${result.fixtureId} terrain`);
    for (let seat = 0; seat < 2; seat += 1) {
      const expectedTank = expected.tanks[seat]; const actualTank = actual.tanks[seat];
      assert.equal(actualTank.cell, expectedTank.cell[1] * expected.map.width + expectedTank.cell[0]);
      assert.equal(actualTank.crashed, Number(expectedTank.crashed));
      assert.equal(actualTank.stars, expectedTank.stars);
      assert.equal(actualTank.shieldHitsRemaining, expectedTank.shieldHitsRemaining);
    }
    assert.deepEqual(actual.projectiles.map(item => item.id),
      expected.projectiles.filter(item => item.active).map(item => item.entityId));
    assert.deepEqual(actual.bombs.map(item => item.id),
      expected.bombs.filter(item => item.active).map(item => item.entityId));
    const expectedWinner = expected.terminal?.winnerSeat ?? 2;
    assert.equal(actual.winner, expectedWinner, `${result.fixtureId} terminal winner`);
  }
});

test("confirmed shield and overload mechanics use independent slots and exact charge consumption", () => {
  const map = boxedMap(9, 5);
  const built = fast.createFastPhysical(physical({ map: { width: 9, height: 5,
    terrainColumnMajor: map }, platformFrame: 3, recordIndex: 3,
    tanks: [tank(0, [1, 1], "right", { skillId: "overload", overloadUntilFrame: 8 }),
      tank(1, [6, 1], "left", { skillId: "shield", shieldHitsRemaining: 2,
        shieldUntilFrame: 8 })] }));
  const status = built.kernel.applyFrame(fast.ACTION.FIRE, fast.NONE_CELL,
    fast.ACTION.NONE, fast.NONE_CELL);
  assert.equal(status, fast.FAST_STATUS.APPLIED);
  assert.equal(built.state.activeProjectileCount(), 2);
  const groups = built.state.arrays[fast.ARRAY.PROJECTILE_GROUP];
  assert.equal(groups[0], groups[1]);
  assert.notEqual(built.state.arrays[fast.ARRAY.PROJECTILE_ID][0],
    built.state.arrays[fast.ARRAY.PROJECTILE_ID][1]);
});

test("freeze and poison HOLD frames are valid symmetric no-op transitions", () => {
  const frozen = fast.createFastPhysical(physical({ platformFrame: 1, recordIndex: 1,
    tanks: [tank(0, [1, 1], "right", { frozenUntilFrame: 3 }),
      tank(1, [5, 3], "left")] }));
  assert.equal(frozen.kernel.applyFrame(fast.ACTION.NONE, fast.NONE_CELL,
    fast.ACTION.NONE, fast.NONE_CELL), fast.FAST_STATUS.APPLIED);
  assert.equal(frozen.state.arrays[fast.ARRAY.TANK_CELL][0], frozen.state.cell(1, 1));

  const poisoned = fast.createFastPhysical(physical({ platformFrame: 1, recordIndex: 1,
    tanks: [tank(0, [1, 1], "right", { poisonAppliedFrame: 0, poisonUntilFrame: 4 }),
      tank(1, [5, 3], "left")] }));
  assert.equal(poisoned.kernel.applyFrame(fast.ACTION.GO, fast.NONE_CELL,
    fast.ACTION.NONE, fast.NONE_CELL), fast.FAST_STATUS.APPLIED);
  assert.equal(poisoned.state.arrays[fast.ARRAY.TANK_CELL][0], poisoned.state.cell(1, 1));
});

test("teleport onto an enemy projectile fails and still consumes cooldown", () => {
  const target = [3, 2]; const built = fast.createFastPhysical(physical({ platformFrame: 4,
    recordIndex: 4, tanks: [tank(0, [1, 1], "right", { skillId: "teleport" }),
      tank(1, [5, 3], "left")], projectiles: [
      { entityId: 3, ownerSeat: 1, cell: target, direction: "left" }
    ] }));
  const targetCell = built.state.cell(target[0], target[1]);
  assert.equal(built.kernel.applyFrame(fast.ACTION.CAST_TELEPORT, targetCell,
    fast.ACTION.NONE, fast.NONE_CELL), fast.FAST_STATUS.APPLIED);
  assert.equal(built.state.arrays[fast.ARRAY.TANK_CELL][0], built.state.cell(1, 1));
  assert.equal(built.state.arrays[fast.ARRAY.TANK_SKILL_READY][0],
    4 + require("../../engine-v2/src/generated/fast-config").RULE.SKILL_COOLDOWN[fast.SKILL.TELEPORT]);
});

test("boost compound program executes free turn and main command in one frame", () => {
  const map = boxedMap(7, 7); const built = fast.createFastPhysical(physical({
    map: { width: 7, height: 7, terrainColumnMajor: map }, platformFrame: 1, recordIndex: 1,
    tanks: [tank(0, [2, 3], "right", { skillId: "boost", boostUntilFrame: 5,
      stunUntilFrame: 5 }),
      tank(1, [5, 5], "left")] }));
  assert.equal(built.kernel.applyFrame(fast.ACTION.BOOST_LEFT_GO, fast.NONE_CELL,
    fast.ACTION.NONE, fast.NONE_CELL), fast.FAST_STATUS.APPLIED);
  assert.equal(built.state.arrays[fast.ARRAY.TANK_DIR][0], fast.DIRECTION.UP);
  assert.equal(built.state.arrays[fast.ARRAY.TANK_CELL][0], built.state.cell(2, 1));

  built.kernel.undoLast();
  assert.equal(built.kernel.applyFrame(fast.ACTION.BOOST_LEFT_GO, fast.NONE_CELL,
    fast.ACTION.NONE, fast.NONE_CELL, fast.CHANCE.SECOND_REVERSED), fast.FAST_STATUS.APPLIED);
  assert.equal(built.state.arrays[fast.ARRAY.TANK_DIR][0], fast.DIRECTION.UP);
  assert.equal(built.state.arrays[fast.ARRAY.TANK_CELL][0], built.state.cell(2, 5));
});

test("unresolved shared-resource and exact-tie rules return unsupported with no partial mutation", () => {
  const map = boxedMap(); map[3][2] = "m";
  const shared = fast.createFastPhysical(physical({ map: { width: 7, height: 5,
    terrainColumnMajor: map }, projectiles: [
    { entityId: 3, ownerSeat: 0, cell: [2, 2], direction: "right" },
    { entityId: 4, ownerSeat: 1, cell: [4, 2], direction: "left" }
  ] }));
  const root = shared.state.rootSignature();
  assert.equal(shared.kernel.applyFrame(), fast.FAST_STATUS.UNSUPPORTED_RULE);
  assert.equal(shared.state.rootSignature(), root);
  const tied = fast.createFastPhysical(physical({ platformFrame: 127, recordIndex: 127,
    tanks: [tank(0, [1, 1], "right", { stars: 2, runtimeMs: 10 }),
      tank(1, [5, 3], "left", { stars: 2, runtimeMs: 10 })] }));
  const tiedRoot = tied.state.rootSignature();
  assert.equal(tied.kernel.applyFrame(), fast.FAST_STATUS.UNSUPPORTED_RULE);
  assert.equal(tied.state.rootSignature(), tiedRoot);
});
