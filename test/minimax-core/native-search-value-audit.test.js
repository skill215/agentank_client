"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { rowSummary } = require("../../tools/agentank/diagnostics/native-search-value-audit");
const { equalCellBudget } = require("../../tools/agentank/diagnostics/native-search-value-audit");
test("cell quota fits total and does not pretend insufficient coverage is funded", () => {
  assert.equal(equalCellBudget(128, 4, 3), 10);
  assert.equal(equalCellBudget(8, 4, 3), 0);
  assert.equal(equalCellBudget(128, 0, 3), 0);
  for (let rows = 1; rows <= 12; rows++) for (let cols = 1; cols <= 12; cols++)
    assert.ok(equalCellBudget(128, rows, cols) * rows * cols <= 128);
});
test("complete cell backup is invariant to enemy-column permutation", () => {
  const cells = [{value:-400,weight:3},{value:200,weight:7},{value:-17,weight:2}];
  assert.deepEqual(rowSummary(cells, 2700), rowSummary([...cells].reverse(), 2700));
});
test("root audit reconstructs integer worst/weighted blend without changing quantifiers", () => {
  assert.deepEqual(rowSummary([{value:-100,weight:1},{value:100,weight:3}],2000),
    {worst:-100,expected:50,backed:-70});
  assert.deepEqual(rowSummary([{value:-11,weight:1},{value:0,weight:2}],2000),
    {worst:-11,expected:-3,backed:-10});
});
test("missing cells are not zero-valued evidence and zero mass retains worst", () => {
  assert.deepEqual(rowSummary([],2000),{worst:null,expected:null,backed:null});
  assert.deepEqual(rowSummary([{value:-7,weight:0}],2000),
    {worst:-7,expected:null,backed:-7});
});

test("exhausted shared budget evaluates a later response at its current top despite target depth", () => {
  const { NativeBasePolicyRoot } = require("../../engine-v2/src/base-policy-specialized/native-root");
  const search = new NativeBasePolicyRoot().policySearch;
  search.perRootBudget = 32;
  search.nodes = 39;
  const before = search.leafBudgetCount;
  let observedTop = -1;
  search.pairedLeaf = (_engine, _path, _nominal, top) => { observedTop = top; return 777; };
  assert.equal(search.policyValue({}, 2, 1, 0, 0), 777);
  assert.equal(observedTop, 1);
  assert.equal(search.leafBudgetCount, before + 1);
  assert.equal(search.nodes, 40);
});
