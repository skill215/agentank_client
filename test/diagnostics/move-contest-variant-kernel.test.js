"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");
const { MOVE_CONTEST_VARIANT, MOVE_CONTEST_KIND,
  MoveContestVariantKernel } = require(
  "../../tools/agentank/diagnostics/move-contest-variant-kernel");

function build(left, right) {
  return fast.createFastPhysical(physical({
    map: { width: 7, height: 5, terrainColumnMajor: boxedMap(7, 5) },
    tanks: [left, right]
  }));
}

function applyVariant(built, variant) {
  const kernel = new MoveContestVariantKernel(built.state, variant);
  const signature = built.state.rootSignature();
  const status = kernel.applyFrame(fast.ACTION.GO, fast.NONE_CELL,
    fast.ACTION.GO, fast.NONE_CELL);
  const cells = Array.from(built.state.arrays[fast.ARRAY.TANK_CELL]);
  const crash = Array.from(built.state.arrays[fast.ARRAY.TANK_CRASH]);
  const kind = kernel.contestKind;
  assert.equal(kernel.undoLast(), 1);
  assert.equal(built.state.rootSignature(), signature);
  return { status, cells, crash, kind };
}

test("default Fast remains fail-closed for unresolved same-target GO/GO", () => {
  const built = build(tank(0, [2, 2], "right"),
    tank(1, [4, 2], "left"));
  const signature = built.state.rootSignature();
  assert.equal(built.kernel.applyFrame(fast.ACTION.GO, fast.NONE_CELL,
    fast.ACTION.GO, fast.NONE_CELL), fast.FAST_STATUS.UNSUPPORTED_RULE);
  assert.equal(built.state.rootSignature(), signature);
});

test("same-target worlds are explicit and fully restorable", () => {
  const sequential = applyVariant(build(tank(0, [2, 2], "right"),
    tank(1, [4, 2], "left")), MOVE_CONTEST_VARIANT.SEQUENTIAL_BLOCK);
  assert.equal(sequential.status, fast.FAST_STATUS.APPLIED);
  assert.equal(sequential.kind, MOVE_CONTEST_KIND.SAME_TARGET);
  assert.deepEqual(sequential.cells, [17, 18]);
  assert.deepEqual(sequential.crash, [0, 0]);

  const intent = applyVariant(build(tank(0, [2, 2], "right"),
    tank(1, [4, 2], "left")), MOVE_CONTEST_VARIANT.INTENT_BLOCK);
  assert.equal(intent.status, fast.FAST_STATUS.APPLIED);
  assert.deepEqual(intent.cells, [16, 18]);
  assert.deepEqual(intent.crash, [0, 0]);

  const collision = applyVariant(build(
    tank(0, [2, 2], "right", { stars: 1, runtimeMs: 10 }),
    tank(1, [4, 2], "left", { stars: 0, runtimeMs: 20 })),
  MOVE_CONTEST_VARIANT.COLLISION_CRASH);
  assert.equal(collision.status, fast.FAST_STATUS.APPLIED_TERMINAL);
  assert.deepEqual(collision.cells, [16, 18]);
  assert.deepEqual(collision.crash, [1, 1]);
});

test("variant kernel counts every applied contest kind", () => {
  const built = build(tank(0, [2, 2], "right"),
    tank(1, [4, 2], "left"));
  const kernel = new MoveContestVariantKernel(built.state,
    MOVE_CONTEST_VARIANT.SEQUENTIAL_BLOCK);
  assert.equal(kernel.applyFrame(fast.ACTION.GO, fast.NONE_CELL,
    fast.ACTION.GO, fast.NONE_CELL), fast.FAST_STATUS.APPLIED);
  assert.equal(kernel.variantTransitionCount, 1);
  assert.equal(kernel.contestKindCount[MOVE_CONTEST_KIND.SAME_TARGET], 1);
});

test("swap worlds block both or crash both", () => {
  for (const variant of [MOVE_CONTEST_VARIANT.SEQUENTIAL_BLOCK,
    MOVE_CONTEST_VARIANT.INTENT_BLOCK]) {
    const result = applyVariant(build(tank(0, [2, 2], "right"),
      tank(1, [3, 2], "left")), variant);
    assert.equal(result.status, fast.FAST_STATUS.APPLIED);
    assert.equal(result.kind, MOVE_CONTEST_KIND.SWAP);
    assert.deepEqual(result.cells, [16, 17]);
    assert.deepEqual(result.crash, [0, 0]);
  }
  const collision = applyVariant(build(
    tank(0, [2, 2], "right", { stars: 1 }),
    tank(1, [3, 2], "left")), MOVE_CONTEST_VARIANT.COLLISION_CRASH);
  assert.equal(collision.status, fast.FAST_STATUS.APPLIED_TERMINAL);
  assert.deepEqual(collision.crash, [1, 1]);
});

test("sequential permits entering a vacated earlier-seat cell while intent blocks it", () => {
  const sequential = applyVariant(build(tank(0, [2, 2], "down"),
    tank(1, [3, 2], "left")), MOVE_CONTEST_VARIANT.SEQUENTIAL_BLOCK);
  assert.equal(sequential.kind, MOVE_CONTEST_KIND.ENTER_OCCUPIED_START);
  assert.deepEqual(sequential.cells, [23, 16]);

  const intent = applyVariant(build(tank(0, [2, 2], "down"),
    tank(1, [3, 2], "left")), MOVE_CONTEST_VARIANT.INTENT_BLOCK);
  assert.deepEqual(intent.cells, [23, 17]);

  const collision = applyVariant(build(
    tank(0, [2, 2], "down", { stars: 1 }),
    tank(1, [3, 2], "left")), MOVE_CONTEST_VARIANT.COLLISION_CRASH);
  assert.equal(collision.status, fast.FAST_STATUS.APPLIED_TERMINAL);
  assert.deepEqual(collision.crash, [1, 1]);
});

test("active boost remains unsupported in every diagnostic move world", () => {
  for (const variant of [MOVE_CONTEST_VARIANT.SEQUENTIAL_BLOCK,
    MOVE_CONTEST_VARIANT.INTENT_BLOCK, MOVE_CONTEST_VARIANT.COLLISION_CRASH]) {
    const built = build(tank(0, [2, 2], "right", { boostUntilFrame: 3 }),
      tank(1, [4, 2], "left"));
    const kernel = new MoveContestVariantKernel(built.state, variant);
    const signature = built.state.rootSignature();
    assert.equal(kernel.applyFrame(fast.ACTION.GO, fast.NONE_CELL,
      fast.ACTION.GO, fast.NONE_CELL), fast.FAST_STATUS.UNSUPPORTED_RULE);
    assert.equal(kernel.contestKind, MOVE_CONTEST_KIND.BOOST_UNSUPPORTED);
    assert.equal(built.state.rootSignature(), signature);
  }
});
