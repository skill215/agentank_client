"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, NONE_CELL } = require("../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../engine-v2/src/state/fast-state");
const { ProductionCacheBank } = require("../../engine-v2/src/cache/production-cache");
const { OPTION_KIND, OptionPortfolioSlab } =
  require("../../engine-v2/src/policy/option-portfolio");
const { OPTION_SEARCH_STATUS, optionSearchTacticalKind, optionSearchOwnableKind,
  OptionAwareDepthSearch } =
  require("../../engine-v2/src/search/option-aware-depth-search");
const { fast, physical, tank, boxedMap } = require("../imp3/helpers");

function fixture() {
  return fast.createFastPhysical(physical({
    map: { width: 7, height: 5, terrainColumnMajor: boxedMap(7, 5) },
    tanks: [tank(0, [1, 2], "right"), tank(1, [5, 2], "left")],
    star: [1, 1]
  }));
}

function optionSearch() {
  const search = new OptionAwareDepthSearch(new ProductionCacheBank(), undefined, null, {
    selectiveContinuationEnabled: false,
    windowedBoundsEnabled: false,
    crossFramePVEnabled: false
  });
  search.rootTransitions.setEnabled(false);
  return search;
}

test("only tactical Options can own a Minimax proposal", () => {
  assert.equal(optionSearchOwnableKind(OPTION_KIND.DIRECT_KILL), 1);
  assert.equal(optionSearchOwnableKind(OPTION_KIND.ATTACK_SETUP), 0);
  assert.equal(optionSearchOwnableKind(OPTION_KIND.COMMITTED_RESCUE), 0);
  assert.equal(optionSearchOwnableKind(OPTION_KIND.STAR_CONTROL), 0);
  assert.equal(optionSearchOwnableKind(OPTION_KIND.TERMINAL), 0);
  assert.equal(optionSearchOwnableKind(OPTION_KIND.POSITION), 0);
  assert.equal(optionSearchOwnableKind(OPTION_KIND.RESOURCE), 0);
  assert.equal(optionSearchTacticalKind(OPTION_KIND.DIRECT_KILL), 1);
  assert.equal(optionSearchTacticalKind(OPTION_KIND.ATTACK_SETUP), 1);
  assert.equal(optionSearchTacticalKind(OPTION_KIND.STAR_CONTROL), 0);
});

test("same primitive root keeps separate attack and star continuation policies", () => {
  const built = fixture(); const search = optionSearch(); const state = built.state;
  search.optionCount = 2;
  search.optionKind[0] = OPTION_KIND.ATTACK_SETUP;
  search.optionKind[1] = OPTION_KIND.STAR_CONTROL;
  search.rootOurCount = 2; search.frameRow[0] = 0;
  search.iterationExpansionLimit = 2;
  search.generateDeep(1, state, 0);
  const attack = Array.from(search.deepOurActions.subarray(4, 4 + search.frameOurCount[1]));
  search.frameRow[0] = 1;
  search.generateDeep(1, state, 0);
  const star = Array.from(search.deepOurActions.subarray(4, 4 + search.frameOurCount[1]));
  assert.ok(attack.includes(ACTION.FIRE));
  assert.equal(star[0], ACTION.TURN_LEFT);
  assert.notDeepEqual(attack, star);
});

test("option search preserves aliases, completes, and restores the root", () => {
  const built = fixture(); const search = optionSearch(); const state = built.state;
  const root = state.rootSignature();
  const portfolio = new OptionPortfolioSlab(8);
  const star = state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL];
  const enemy = state.arrays[ARRAY.TANK_CELL][1];
  portfolio.add(0, OPTION_KIND.ATTACK_SETUP, enemy, 11, 8, 0, 1);
  portfolio.add(0, OPTION_KIND.STAR_CONTROL, star, 12, 8, 0, 1);
  const ownActions = new Uint8Array([ACTION.TURN_LEFT]);
  const ownArguments = new Uint16Array([NONE_CELL]);
  const enemyActions = new Uint8Array([ACTION.NONE, ACTION.GO]);
  const enemyArguments = new Uint16Array([NONE_CELL, NONE_CELL]);
  assert.equal(search.searchPortfolio(built, portfolio, ownActions, ownArguments, 1,
    enemyActions, enemyArguments, 2, 2, 4096, 50, 0), 1);
  assert.equal(search.lastStatus, OPTION_SEARCH_STATUS.COMPLETE);
  assert.equal(search.optionCount, 2);
  assert.equal(search.optionActions[0], ACTION.TURN_LEFT);
  assert.equal(search.optionActions[1], ACTION.TURN_LEFT);
  assert.equal(search.rootRestoreFailures, 0);
  assert.equal(state.rootSignature(), root);
  assert.equal(search.hotAllocationCount, 0);
});

test("capacity loss is explicit and cannot become a complete owner", () => {
  const built = fixture(); const search = optionSearch();
  const portfolio = new OptionPortfolioSlab(32);
  for (let index = 0; index < 25; index += 1)
    portfolio.add(index % 12, OPTION_KIND.ATTACK_SETUP, index, index + 1, 10, 0, 1);
  const ownActions = new Uint8Array(12).fill(ACTION.TURN_LEFT);
  const ownArguments = new Uint16Array(12).fill(NONE_CELL);
  const enemyActions = new Uint8Array([ACTION.NONE]);
  const enemyArguments = new Uint16Array([NONE_CELL]);
  assert.equal(search.searchPortfolio(built, portfolio, ownActions, ownArguments, 12,
    enemyActions, enemyArguments, 1, 1, 4096, 50, 0), 0);
  assert.equal(search.lastStatus, OPTION_SEARCH_STATUS.INCOMPLETE);
  assert.equal(search.optionTruncated, 1);
});
