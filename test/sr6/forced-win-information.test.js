"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProductionForcedWinSearch } =
  require("../../engine-v2/src/search/production-forced-win-search");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");
const { ACTION, NONE_CELL } = require("../../engine-v2/src/abi/fast-codes");
const { ARRAY } = require("../../engine-v2/src/state/fast-state");
const { PROOF_STATUS } = require("../../engine-v2/src/abi/search-codes");
const { productionRootFixture } = require("../../tools/agentank/build/imp6-builder");

function preparedRoot() {
  const fixture = productionRootFixture(); fixture.enemy.status.fireLocked = true;
  const engine = new ProductionRootEngine(); const adapted = engine.adapter.adapt(
    fixture.me, fixture.enemy, fixture.game); engine.generateActions();
  const ourCount = engine.ourCount > 1 && engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
    engine.ourCount - 1 : engine.ourCount;
  return { fixture, engine, bundle: adapted.bundle, ourCount };
}

test("SR6 Information ForcedWin on a singleton world matches Physical ForcedWin", () => {
  const prepared = preparedRoot();
  const state = prepared.bundle.state;
  const enemyCell = state.arrays[ARRAY.TANK_CELL][1];
  const worlds = new Uint16Array([enemyCell]);
  const proof = new ProductionForcedWinSearch();
  const physical = proof.search(prepared.bundle, prepared.engine.ourActions,
    prepared.engine.ourArguments, prepared.ourCount, prepared.engine.enemyActions,
    prepared.engine.enemyArguments, prepared.engine.enemyCount, 2, 256);
  const info = new ProductionForcedWinSearch();
  const informational = info.searchInformation(prepared.bundle, prepared.engine.ourActions,
    prepared.engine.ourArguments, prepared.ourCount, prepared.engine.enemyActions,
    prepared.engine.enemyArguments, prepared.engine.enemyCount, worlds, 1, 1,
    state.arrays[ARRAY.TANK_DIR][1], 1, 2, 256);
  assert.equal(informational, physical);
  assert.equal(info.winningRootRow, proof.winningRootRow);
  assert.equal(info.rootRestoreFailures, 0);
});

test("SR6 Information ForcedWin refuses to prove without supportComplete", () => {
  const prepared = preparedRoot();
  const state = prepared.bundle.state;
  const enemyCell = state.arrays[ARRAY.TANK_CELL][1];
  const worlds = new Uint16Array([enemyCell]);
  const proof = new ProductionForcedWinSearch();
  assert.equal(proof.searchInformation(prepared.bundle, prepared.engine.ourActions,
    prepared.engine.ourArguments, prepared.ourCount, prepared.engine.enemyActions,
    prepared.engine.enemyArguments, prepared.engine.enemyCount, worlds, 1, 0,
    state.arrays[ARRAY.TANK_DIR][1], 1, 2, 256), PROOF_STATUS.UNKNOWN);
  assert.equal(proof.winningRootRow, -1);
  assert.equal(proof.nodes, 0);
});

test("SR6 Information ForcedWin refuses oversized world sets instead of soft-topping", () => {
  const prepared = preparedRoot();
  const state = prepared.bundle.state;
  const enemyCell = state.arrays[ARRAY.TANK_CELL][1];
  const worlds = new Uint16Array(5);
  worlds.fill(enemyCell);
  const proof = new ProductionForcedWinSearch();
  assert.equal(proof.searchInformation(prepared.bundle, prepared.engine.ourActions,
    prepared.engine.ourArguments, prepared.ourCount, prepared.engine.enemyActions,
    prepared.engine.enemyArguments, prepared.engine.enemyCount, worlds, 5, 1,
    state.arrays[ARRAY.TANK_DIR][1], 1, 2, 512), PROOF_STATUS.UNKNOWN);
  assert.equal(proof.winningRootRow, -1);
  assert.equal(proof.nodes, 0);
});

test("SR6 Information ForcedWin requires the same winning row across worlds", () => {
  const prepared = preparedRoot();
  const state = prepared.bundle.state;
  const enemyCell = state.arrays[ARRAY.TANK_CELL][1];
  const far = Math.min(state.cells - 1, enemyCell + 17);
  const worlds = new Uint16Array([enemyCell, far]);
  const proof = new ProductionForcedWinSearch();
  const status = proof.searchInformation(prepared.bundle, prepared.engine.ourActions,
    prepared.engine.ourArguments, prepared.ourCount, prepared.engine.enemyActions,
    prepared.engine.enemyArguments, prepared.engine.enemyCount, worlds, 2, 1,
    state.arrays[ARRAY.TANK_DIR][1], 1, 2, 512);
  assert.notEqual(status, PROOF_STATUS.PROVEN,
    "a pose that is not covered by the same root win must block authorization");
  assert.equal(proof.rootRestoreFailures, 0);
  assert.equal(state.arrays[ARRAY.TANK_CELL][1], enemyCell);
});
