"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const manifest = require("../../config/engine-v2/imp4-search-manifest.json");
const { search, fast, physical, tank, boxedMap, terminalMatrixGraph } = require("./helpers");

test("normal and fallback budgets share search semantics and differ only in completed work", () => {
  const fixture = terminalMatrixGraph([[10000, -10000], [-10000, 10000]]);
  const normal = new search.ValueSearch(fixture.graph); const fallback = new search.ValueSearch(fixture.graph);
  normal.solve(fixture.root, 512, 50); fallback.solve(fixture.root, 512, 50);
  assert.equal(normal.lastFingerprintLo, fallback.lastFingerprintLo);
  assert.equal(normal.lastFingerprintHi, fallback.lastFingerprintHi);
  const limited = new search.ValueSearch(fixture.graph); limited.solve(fixture.root, 1, 50);
  assert.ok(limited.lower[fixture.root] <= normal.lower[fixture.root]);
  assert.ok(limited.upper[fixture.root] >= normal.upper[fixture.root]);
});

test("Tank root search consumes IMP3 Hard results before Value Matrix or Proof", () => {
  const map = boxedMap(7, 5); map[2][1] = "x"; map[2][3] = "x";
  const built = fast.createFastPhysical(physical({ map: { width: 7, height: 5,
    terrainColumnMajor: map }, tanks: [tank(0, [3, 2], "right"), tank(1, [5, 3], "left")],
    projectiles: [{ entityId: 3, ownerSeat: 1, cell: [1, 2], direction: "right" }] }));
  const adapter = new search.TankRootAdapter(); const actions = new Uint8Array([fast.ACTION.NONE]);
  const args = new Uint16Array([fast.NONE_CELL]);
  const root = adapter.build(built, actions, args, 1, actions, args, 1);
  assert.notEqual(root, search.NONE_NODE); assert.equal(adapter.hardCheckedCells, 1);
  assert.equal(adapter.hardRejectCells, 1);
  const engine = new search.SearchEngine(adapter.graph);
  engine.solveRoot(root); assert.equal(engine.value.risk.hotAllocationCount, 0);
  assert.equal(built.hard.rootMismatchCount, 0);
});

test("a fired projectile with a real dodge is not promoted to forced loss by the search adapter", () => {
  const built = fast.createFastPhysical(physical({ tanks: [tank(0, [3, 2], "up"),
    tank(1, [5, 3], "left")], projectiles: [
      { entityId: 3, ownerSeat: 1, cell: [1, 2], direction: "right" }
    ] }));
  const adapter = new search.TankRootAdapter(); const ours = new Uint8Array([fast.ACTION.GO]);
  const enemy = new Uint8Array([fast.ACTION.NONE]); const args = new Uint16Array([fast.NONE_CELL]);
  const root = adapter.build(built, ours, args, 1, enemy, args, 1);
  assert.equal(adapter.hardRejectCells, 0); const proof = new search.ProofSearch(adapter.graph);
  assert.notEqual(proof.solve(root, search.PROOF_GOAL.FORCED_LOSS), search.PROOF_STATUS.PROVEN);
});

test("risk changes Value policy inputs but cannot change Hard or strict Proof fingerprints", () => {
  const fixture = terminalMatrixGraph([[10000, -10000], [-10000, 10000]]);
  const engine0 = new search.SearchEngine(fixture.graph); engine0.solveRoot(fixture.root,
    { baseRisk: 0, matrixIterations: 64 });
  const strictLo = engine0.strictFingerprintLo; const strictHi = engine0.strictFingerprintHi;
  const engine100 = new search.SearchEngine(fixture.graph); engine100.solveRoot(fixture.root,
    { baseRisk: 100, matrixIterations: 64 });
  assert.equal(engine100.strictFingerprintLo, strictLo); assert.equal(engine100.strictFingerprintHi, strictHi);
});

test("IMP4 hot search structures use bounded integer TypedArrays and report zero tracked allocation", () => {
  const fixture = terminalMatrixGraph([[0, -1000, 1000], [1000, 0, -1000], [-1000, 1000, 0]]);
  const engine = new search.SearchEngine(fixture.graph); engine.solveRoot(fixture.root,
    { baseRisk: 50, matrixIterations: 128 });
  const arrays = [engine.value.lower, engine.value.upper, engine.proof.stackNode,
    engine.matrix.lower, engine.matrixSolver.rowRegret, engine.policyArena.probability];
  assert.ok(arrays.every(array => ArrayBuffer.isView(array) && !(array instanceof Float32Array) &&
    !(array instanceof Float64Array)));
  assert.equal(engine.hotAllocationCount + engine.value.hotAllocationCount +
    engine.proof.hotAllocationCount + engine.matrix.hotAllocationCount +
    engine.matrixSolver.hotAllocationCount + engine.policyArena.hotAllocationCount, 0);
  assert.ok(fixture.graph.nodeCount <= manifest.limits.maxNodes);
  assert.ok(fixture.graph.edgeUsed <= manifest.limits.maxEdges);
  const source = fs.readFileSync(path.join(__dirname, "../../engine-v2/src/search/engine.js"), "utf8") +
    fs.readFileSync(path.join(__dirname, "../../engine-v2/src/search/value-search.js"), "utf8");
  assert.doesNotMatch(source, /Monte\s*Carlo|\bMCTS\b|Math\.random|Date\.now/);
});

test("search capacity faults stay incomplete and never become exact proof or a truncated policy", () => {
  const graph = new search.InformationGraph({ maxNodes: 2, maxEdges: 1 });
  const win = graph.addTerminal(10000); const loss = graph.addTerminal(-10000);
  assert.equal(graph.addNode(search.NODE_KIND.HIDDEN_WORLD, [win, loss], [5000, 5000]), search.NONE_NODE);
  assert.ok(graph.overflowReason & search.INCOMPLETE.CAPACITY || graph.overflowReason & search.INCOMPLETE.SUPPORT);
  const coverage = new search.CoverageArena({ capacity: 1 });
  const proof = new search.ProofSearch(graph, coverage); assert.equal(proof.solve(win,
    search.PROOF_GOAL.FORCED_WIN), search.PROOF_STATUS.PROVEN);
  assert.equal(proof.solve(loss, search.PROOF_GOAL.FORCED_LOSS), search.PROOF_STATUS.UNKNOWN);
});

test("deep physical search expands Fast make undo with explicit frames and restores root", () => {
  const built = fast.createFastPhysical(physical()); const signature = built.state.rootSignature();
  const ours = new Uint8Array([fast.ACTION.NONE, fast.ACTION.TURN_LEFT]);
  const enemy = new Uint8Array([fast.ACTION.NONE, fast.ACTION.TURN_RIGHT]);
  const args = new Uint16Array(2); args.fill(fast.NONE_CELL);
  const builder = new search.PhysicalTreeBuilder();
  assert.equal(builder.build(built, ours, args, 2, enemy, args, 2, 2), search.SEARCH_STATUS.COMPLETE);
  assert.equal(builder.hardCheckedCells, 20); assert.equal(builder.rootMismatchCount, 0);
  assert.equal(built.state.rootSignature(), signature); assert.ok(builder.graph.nodeCount > 5);
  const engine = new search.SearchEngine(builder.graph);
  assert.notEqual(engine.solveRoot(builder.root, { nodeBudget: 512, proofBudget: 512,
    matrixIterations: 64 }), search.SEARCH_STATUS.INVALID);
  const constrained = new search.PhysicalTreeBuilder({ graph:
    new search.InformationGraph({ maxNodes: 32, maxEdges: 4 }) });
  assert.equal(constrained.build(built, ours, args, 2, enemy, args, 2, 2), search.SEARCH_STATUS.CAPACITY);
  assert.equal(built.state.rootSignature(), signature);
});
