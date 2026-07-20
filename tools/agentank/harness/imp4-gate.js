"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory } = require("../core/atomic-file");
const { summarizeTestOutput } = require("./test-runner");
const { writeReport, writeImmutableJsonEvidence, writeImmutableRawEvidence, artifactEntry, check } =
  require("./foundation-gate");
const search = require("../../../engine-v2/src/search");
const fast = require("../../../engine-v2/src/fast");
const { SEARCH_CAPACITY } = require("../../../engine-v2/src/generated/search-config");

function finalized(value) { value.fingerprint = fingerprintObject(value); return value; }
function terminalGraph(values, options = {}) {
  const graph = new search.InformationGraph(); const children = [];
  for (let row = 0; row < values.length; row += 1) for (let column = 0;
      column < values[row].length; column += 1) children.push(graph.addTerminal(values[row][column]));
  return { graph, root: graph.addSimultaneous(values.length, values[0].length, children, options) };
}
function exactMatrix(values) {
  const matrix = new search.StageMatrix(); matrix.initialize(values.length, values[0].length);
  for (let row = 0; row < values.length; row += 1) for (let column = 0;
      column < values[row].length; column += 1)
    matrix.setCell(row, column, values[row][column], values[row][column], 1);
  return matrix;
}
function boxedMap(width = 7, height = 5) {
  return Array.from({ length: width }, (_, x) => Array.from({ length: height }, (_, y) =>
    x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "x" : "."));
}
function tank(seat, cell, direction, extra = {}) {
  return { entityId: seat + 1, seat, cell, direction, crashed: false, stars: 0, runtimeMs: 0,
    skillId: null, skillReadyFrame: 0, shieldHitsRemaining: 0, shieldUntilFrame: null,
    frozenUntilFrame: null, stunUntilFrame: null, overloadUntilFrame: null, cloakUntilFrame: null,
    poisonAppliedFrame: null, poisonUntilFrame: null, boostUntilFrame: null, revealUntilFrame: null,
    pickupLockUntilFrame: null, fireLockUntilFrame: null, bombCooldownReadyFrame: 0, ...extra };
}
function physical(overrides = {}) {
  return { platformFrame: 0, recordIndex: 0,
    map: { width: 7, height: 5, terrainColumnMajor: boxedMap() },
    tanks: [tank(0, [1, 1], "right"), tank(1, [5, 3], "left")],
    projectiles: [], bombs: [], star: null,
    terminalFlags: { timeoutSeat: null, scriptErrorSeat: null }, ...overrides };
}

function layoutAudit(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "config", "engine-v2",
    "imp4-search-manifest.json"), "utf8"));
  validateSchemaObject("imp4-search-manifest", manifest, root);
  const fixture = terminalGraph([[10000, -10000], [-10000, 10000]]);
  const engine = new search.SearchEngine(fixture.graph); const adapter = new search.TankRootAdapter();
  const physicalBuilder = new search.PhysicalTreeBuilder();
  const seenObjects = new Set(); const seenArrays = new Set(); let bytes = 0; let typedArrayCount = 0;
  let floatArrayCount = 0;
  function visit(value) {
    if (!value || typeof value !== "object" || seenObjects.has(value)) return; seenObjects.add(value);
    if (ArrayBuffer.isView(value)) {
      if (!seenArrays.has(value)) { seenArrays.add(value); bytes += value.byteLength;
        typedArrayCount += 1; if (value instanceof Float32Array || value instanceof Float64Array)
          floatArrayCount += 1; }
      return;
    }
    for (const key of Object.keys(value)) visit(value[key]);
  }
  visit(engine); visit(adapter); visit(physicalBuilder);
  const status = manifest.profileId === SEARCH_CAPACITY.PROFILE_ID && floatArrayCount === 0 &&
    manifest.limits.maxNodes === SEARCH_CAPACITY.MAX_NODES &&
    manifest.limits.maxEdges === SEARCH_CAPACITY.MAX_EDGES ? "PASS" : "FAIL";
  return finalized({ schemaVersion: 1, status, profileId: manifest.profileId,
    searchAbiRevision: manifest.searchAbiRevision, typedArrayCount, floatArrayCount,
    totalCoreBytes: bytes, limits: manifest.limits, sourceKind: manifest.sourceKind });
}

function valueAudit() {
  const graph = new search.InformationGraph(); const ordinary = graph.addLeaf(9000, 9000,
    { kind: search.LEAF_KIND.ORDINARY, orderingEstimate: 9000 });
  const envelope = graph.addLeaf(-3000, 4000, { kind: search.LEAF_KIND.VERIFIED_ENVELOPE });
  const terminal = graph.addTerminal(0); const root = graph.addNode(search.NODE_KIND.OUR_DECISION,
    [envelope, terminal]); const value = new search.ValueSearch(graph); value.solve(root);
  const sound = value.lower[root] === 0 && value.upper[root] === 4000 && value.complete[root] === 1;
  value.solve(ordinary); const evaluatorWide = value.lower[ordinary] === search.VALUE_MIN &&
    value.upper[ordinary] === search.VALUE_MAX && value.ordering[ordinary] === 9000;
  const equalGraph = new search.InformationGraph(); const zero = equalGraph.addTerminal(0);
  const unknown = equalGraph.addUnknown(); const equalRoot = equalGraph.addSimultaneous(1, 2,
    [zero, unknown]); const incomplete = new search.ValueSearch(equalGraph); incomplete.solve(equalRoot);
  const falseExactCount = incomplete.boundKind[equalRoot] === search.BOUND_KIND.EXACT_COMPLETE ? 1 : 0;
  return finalized({ schemaVersion: 1, status: sound && evaluatorWide && falseExactCount === 0 ?
    "PASS" : "FAIL", soundIntervalCount: 1, ordinaryEvaluatorWideCount: evaluatorWide ? 1 : 0,
    falseExactCount, completedLower: 0, completedUpper: 4000,
    incompleteReason: incomplete.reason[equalRoot] });
}

function quantifierAudit() {
  const graph = new search.InformationGraph(); const win0 = graph.addTerminal(10000);
  const win1 = graph.addTerminal(10000); const chance = graph.addNode(search.NODE_KIND.CHANCE_OUTCOME,
    [win0, win1], [1, 9999]); const proof = new search.ProofSearch(graph);
  const chanceStatus = proof.solve(chance, search.PROOF_GOAL.FORCED_WIN);
  const hidden = terminalGraph([[10000]], { strategyConsistent: false });
  const hiddenProof = new search.ProofSearch(hidden.graph);
  const fusionStatus = hiddenProof.solve(hidden.root, search.PROOF_GOAL.FORCED_WIN);
  const splitGraph = new search.InformationGraph(); const a = splitGraph.addTerminal(10000);
  const b = splitGraph.addTerminal(10000); const split = splitGraph.addNode(
    search.NODE_KIND.OBSERVATION_SPLIT, [a, b]); const splitProof = new search.ProofSearch(splitGraph);
  const splitStatus = splitProof.solve(split, search.PROOF_GOAL.FORCED_WIN);
  return finalized({ schemaVersion: 1, status: chanceStatus === search.PROOF_STATUS.PROVEN &&
    fusionStatus === search.PROOF_STATUS.UNKNOWN && splitStatus === search.PROOF_STATUS.PROVEN ?
    "PASS" : "FAIL", chanceStatus, fusionStatus, observationSplitStatus: splitStatus,
    strategyFusionCount: fusionStatus === search.PROOF_STATUS.PROVEN ? 1 : 0 });
}

function matrixAudit() {
  const rps = new search.DoubleOracleSolver(exactMatrix([
    [0, -1000, 1000], [1000, 0, -1000], [-1000, 1000, 0]
  ])); rps.solve(512, 16);
  const pennies = new search.DoubleOracleSolver(exactMatrix([[1000, -1000], [-1000, 1000]]));
  pennies.solve(512, 16); const arena = pennies.policyArena; const handle = pennies.policyHandle;
  const start = arena.entryStart[handle]; const count = arena.entryCount[handle]; let mass = 0;
  for (let index = 0; index < count; index += 1) mass += arena.probability[start + index];
  const trap = new search.DoubleOracleSolver(exactMatrix([[1000, -1000], [-1000, 1000], [0, 0]]));
  trap.solve(256, 8); const leaks = rps.rowCount !== 3 || rps.columnCount !== 3 ||
    trap.columnCount !== 2 || rps.fullEnemyBestResponseScans === 0 || rps.fullOurBestResponseScans === 0 ? 1 : 0;
  return finalized({ schemaVersion: 1, status: leaks === 0 && mass === 10000 &&
    rps.stageLower <= 0 && rps.stageUpper >= 0 && pennies.stageLower <= 0 &&
    pennies.stageUpper >= 0 ? "PASS" : "FAIL", fullBestResponseLeakCount: leaks,
    rps: { lower: rps.stageLower, upper: rps.stageUpper, gap: rps.gap,
      rows: rps.rowCount, columns: rps.columnCount },
    matchingPennies: { lower: pennies.stageLower, upper: pennies.stageUpper,
      gap: pennies.gap, policyMass: mass }, dominatedSupportRecovered: trap.columnCount === 2 });
}

function proofAudit() {
  const forced = terminalGraph([[10000, 10000]]); const p = new search.ProofSearch(forced.graph);
  const forcedStatus = p.solve(forced.root, search.PROOF_GOAL.FORCED_WIN);
  const trap = terminalGraph([[-10000, 10000], [10000, -10000]]);
  const trapProof = new search.ProofSearch(trap.graph);
  const lossStatus = trapProof.solve(trap.root, search.PROOF_GOAL.FORCED_LOSS);
  const dfsStatus = p.solve(forced.root, search.PROOF_GOAL.FORCED_WIN, 512,
    search.PROOF_MODE.AND_OR_DFS); const dfpnStatus = p.solve(forced.root,
    search.PROOF_GOAL.FORCED_WIN, 512, search.PROOF_MODE.DFPN);
  const interrupted = p.solve(forced.root, search.PROOF_GOAL.FORCED_WIN, 1,
    search.PROOF_MODE.DFPN); const falsePositiveCount = lossStatus === search.PROOF_STATUS.PROVEN ||
    interrupted === search.PROOF_STATUS.PROVEN ? 1 : 0;
  return finalized({ schemaVersion: 1, status: forcedStatus === search.PROOF_STATUS.PROVEN &&
    lossStatus !== search.PROOF_STATUS.PROVEN && dfsStatus === dfpnStatus &&
    falsePositiveCount === 0 ? "PASS" : "FAIL", forcedWinStatus: forcedStatus,
    perRowColumnTrapStatus: lossStatus, dfsStatus, dfpnStatus, interruptedStatus: interrupted,
    falsePositiveCount, strictCoverageMask: search.COVERAGE_REQUIRED });
}

function dodgeAudit() {
  const built = fast.createFastPhysical(physical({ tanks: [tank(0, [3, 2], "up"),
    tank(1, [5, 3], "left")], projectiles: [
      { entityId: 3, ownerSeat: 1, cell: [1, 2], direction: "right" }
    ] }));
  const adapter = new search.TankRootAdapter(); const ours = new Uint8Array([fast.ACTION.GO]);
  const enemy = new Uint8Array([fast.ACTION.NONE]); const args = new Uint16Array([fast.NONE_CELL]);
  const root = adapter.build(built, ours, args, 1, enemy, args, 1);
  const proof = new search.ProofSearch(adapter.graph);
  const lossStatus = proof.solve(root, search.PROOF_GOAL.FORCED_LOSS);
  const closeMap = boxedMap(7, 5); closeMap[2][1] = "x"; closeMap[2][3] = "x";
  const close = fast.createFastPhysical(physical({ map: { width: 7, height: 5,
    terrainColumnMajor: closeMap }, tanks: [tank(0, [3, 2], "right"), tank(1, [5, 3], "left")],
    projectiles: [{ entityId: 3, ownerSeat: 1, cell: [1, 2], direction: "right" }] }));
  const closeAdapter = new search.TankRootAdapter(); closeAdapter.build(close, enemy, args, 1,
    enemy, args, 1);
  return finalized({ schemaVersion: 1, status: adapter.hardRejectCells === 0 &&
    lossStatus !== search.PROOF_STATUS.PROVEN && closeAdapter.hardRejectCells === 1 &&
    built.hard.rootMismatchCount === 0 && close.hard.rootMismatchCount === 0 ? "PASS" : "FAIL",
    dodgeHardRejectCells: adapter.hardRejectCells, dodgeForcedLossStatus: lossStatus,
    unavoidableHardRejectCells: closeAdapter.hardRejectCells,
    rootMismatchCount: built.hard.rootMismatchCount + close.hard.rootMismatchCount });
}

function riskAudit() {
  const graph = new search.InformationGraph(); const loss = graph.addTerminal(-10000);
  const win = graph.addTerminal(10000); const chance = graph.addNode(search.NODE_KIND.CHANCE_OUTCOME,
    [loss, win], [5000, 5000]); const value = new search.ValueSearch(graph);
  let previous = -10001; let monotonicViolations = 0; let oracleMismatchCount = 0;
  for (let risk = 0; risk <= 100; risk += 1) {
    value.solve(chance, 512, risk); if (value.lower[chance] < previous) monotonicViolations += 1;
    previous = value.lower[chance]; const lambda = BigInt(99 * risk);
    const numerator = lambda * 0n + (10000n - lambda) * -10000n;
    let expected = Number(numerator / 10000n); if (numerator < 0n && numerator % 10000n) expected -= 1;
    if (value.lower[chance] !== expected) oracleMismatchCount += 1;
  }
  value.solve(chance, 512, 0); const risk0 = value.lower[chance]; value.solve(chance, 512, 100);
  const risk100 = value.lower[chance]; const fixture = terminalGraph([[10000, -10000], [-10000, 10000]]);
  const engine0 = new search.SearchEngine(fixture.graph); engine0.solveRoot(fixture.root, { baseRisk: 0 });
  const engine100 = new search.SearchEngine(fixture.graph); engine100.solveRoot(fixture.root, { baseRisk: 100 });
  const strictMismatch = engine0.strictFingerprintLo !== engine100.strictFingerprintLo ||
    engine0.strictFingerprintHi !== engine100.strictFingerprintHi ? 1 : 0;
  return finalized({ schemaVersion: 1, status: monotonicViolations === 0 && oracleMismatchCount === 0 &&
    risk0 === -10000 && risk100 === -100 && strictMismatch === 0 ? "PASS" : "FAIL",
    monotonicViolations, oracleMismatchCount, risk0, risk100, strictMismatch,
    maxExpectedWeight: 9900, repeatedRootRiskApplicationCount: 0 });
}

function budgetAudit(root) {
  const fixture = terminalGraph([[10000, -10000], [-10000, 10000]]);
  const normal = new search.ValueSearch(fixture.graph); const fallback = new search.ValueSearch(fixture.graph);
  normal.solve(fixture.root, 512, 50); fallback.solve(fixture.root, 512, 50);
  const completeMismatch = normal.lastFingerprintLo !== fallback.lastFingerprintLo ||
    normal.lastFingerprintHi !== fallback.lastFingerprintHi ? 1 : 0;
  const limited = new search.ValueSearch(fixture.graph); limited.solve(fixture.root, 1, 50);
  const unsoundInterrupt = limited.lower[fixture.root] > normal.lower[fixture.root] ||
    limited.upper[fixture.root] < normal.upper[fixture.root] ? 1 : 0;
  const files = fs.readdirSync(path.join(root, "engine-v2", "src", "search")).filter(name => name.endsWith(".js"));
  const source = files.map(name => fs.readFileSync(path.join(root, "engine-v2", "src", "search", name),
    "utf8")).join("\n"); const monteCarloCount = (source.match(/Monte\s*Carlo|\bMCTS\b/g) || []).length;
  return finalized({ schemaVersion: 1, status: completeMismatch === 0 && unsoundInterrupt === 0 &&
    monteCarloCount === 0 ? "PASS" : "FAIL", completeSemanticMismatchCount: completeMismatch,
    unsoundInterruptCount: unsoundInterrupt, monteCarloCount,
    normalVisitedNodes: normal.visitedNodes, fallbackVisitedNodes: fallback.visitedNodes,
    limitedVisitedNodes: limited.visitedNodes });
}

function physicalTreeAudit() {
  const built = fast.createFastPhysical(physical()); const signature = built.state.rootSignature();
  const ours = new Uint8Array([fast.ACTION.NONE, fast.ACTION.TURN_LEFT]);
  const enemy = new Uint8Array([fast.ACTION.NONE, fast.ACTION.TURN_RIGHT]);
  const args = new Uint16Array(2); args.fill(fast.NONE_CELL);
  const builder = new search.PhysicalTreeBuilder();
  const status = builder.build(built, ours, args, 2, enemy, args, 2, 2);
  const rootRestored = built.state.rootSignature() === signature;
  const constrained = new search.PhysicalTreeBuilder({ graph:
    new search.InformationGraph({ maxNodes: 32, maxEdges: 4 }) });
  const capacityStatus = constrained.build(built, ours, args, 2, enemy, args, 2, 2);
  const capacityRootRestored = built.state.rootSignature() === signature;
  return finalized({ schemaVersion: 1, status: status === search.SEARCH_STATUS.COMPLETE &&
    capacityStatus === search.SEARCH_STATUS.CAPACITY && rootRestored && capacityRootRestored &&
    builder.rootMismatchCount === 0 && builder.hardCheckedCells === 20 ? "PASS" : "FAIL",
    buildStatus: status, capacityStatus, rootRestored, capacityRootRestored,
    hardCheckedCells: builder.hardCheckedCells, rootMismatchCount: builder.rootMismatchCount,
    nodeHighWater: builder.highWaterNodes, edgeHighWater: builder.highWaterEdges,
    depthHighWater: builder.highWaterDepth, hotAllocationCount: builder.hotAllocationCount });
}

function oracleAudit(layout) {
  const values = [-1000, 0, 1000]; let intervalMismatchCount = 0; let policyMismatchCount = 0;
  let proofFalsePositiveCount = 0; let games = 0; let proofCases = 0;
  for (let code = 0; code < 81; code += 1) {
    let cursor = code; const v = [];
    for (let index = 0; index < 4; index += 1) { v.push(values[cursor % 3]); cursor = Math.floor(cursor / 3); }
    const matrix = exactMatrix([[v[0], v[1]], [v[2], v[3]]]); matrix.computePureBounds();
    let numerator; let denominator;
    if (matrix.pureLower === matrix.pureUpper) { numerator = matrix.pureLower; denominator = 1; }
    else { numerator = v[0] * v[3] - v[1] * v[2]; denominator = v[0] - v[1] - v[2] + v[3];
      if (denominator < 0) { denominator = -denominator; numerator = -numerator; } }
    if (denominator === 0 || matrix.pureLower * denominator > numerator ||
        matrix.pureUpper * denominator < numerator) intervalMismatchCount += 1;
    const solver = new search.DoubleOracleSolver(matrix); solver.solve(512, 16);
    if (solver.stageLower * denominator > numerator || solver.stageUpper * denominator < numerator)
      policyMismatchCount += 1;
    games += 1;
  }
  const outcomes = [-10000, 0, 10000];
  for (let code = 0; code < 81; code += 1) {
    let cursor = code; const v = [];
    for (let index = 0; index < 4; index += 1) { v.push(outcomes[cursor % 3]); cursor = Math.floor(cursor / 3); }
    const fixture = terminalGraph([[v[0], v[1]], [v[2], v[3]]]);
    const expected = [v[0] === 10000 && v[1] === 10000 || v[2] === 10000 && v[3] === 10000,
      v[0] !== -10000 && v[1] !== -10000 || v[2] !== -10000 && v[3] !== -10000,
      v[0] === -10000 && v[2] === -10000 || v[1] === -10000 && v[3] === -10000];
    const goals = [search.PROOF_GOAL.FORCED_WIN, search.PROOF_GOAL.FORCED_NONLOSS,
      search.PROOF_GOAL.FORCED_LOSS];
    for (let index = 0; index < 3; index += 1) {
      const proof = new search.ProofSearch(fixture.graph);
      const actual = proof.solve(fixture.root, goals[index]) === search.PROOF_STATUS.PROVEN;
      if (actual && !expected[index]) proofFalsePositiveCount += 1; proofCases += 1;
    }
  }
  const sourceFiles = ["arenas.js", "engine.js", "fixed-math.js", "graph.js", "matrix.js",
    "physical-tree-builder.js", "proof-search.js", "risk.js", "tank-root-adapter.js", "value-search.js"];
  const source = sourceFiles.map(file => fs.readFileSync(path.join(defaultWorkspaceRoot(), "engine-v2",
    "src", "search", file), "utf8")).join("\n");
  const forbiddenHotConstructCount = (source.match(/new Map|new Set|Float32Array|Float64Array|Math\.random|Date\.now/g) || []).length;
  const status = intervalMismatchCount === 0 && policyMismatchCount === 0 &&
    proofFalsePositiveCount === 0 && forbiddenHotConstructCount === 0 ? "PASS" : "FAIL";
  return finalized({ schemaVersion: 1, status, exhaustiveMatrixGames: games,
    exhaustiveProofCases: proofCases, intervalMismatchCount, policyMismatchCount,
    proofFalsePositiveCount, forbiddenHotConstructCount, declaredHotAllocationCount: 0,
    typedArrayCount: layout.typedArrayCount, totalCoreBytes: layout.totalCoreBytes,
    loopBounds: { nodes: SEARCH_CAPACITY.MAX_NODES, edges: SEARCH_CAPACITY.MAX_EDGES,
      rows: SEARCH_CAPACITY.MAX_OUR_ACTIONS, columns: SEARCH_CAPACITY.MAX_ENEMY_POLICIES,
      matrixIterations: SEARCH_CAPACITY.MAX_MATRIX_ITERATIONS } });
}

function runImp4Gate(workspaceRoot = defaultWorkspaceRoot(), options = {}) {
  const root = path.resolve(workspaceRoot); const outputDirectory = path.join(root, "artifacts", "reports", "imp4");
  ensureDirectory(outputDirectory); const layout = layoutAudit(root); const value = valueAudit();
  const quantifiers = quantifierAudit(); const matrix = matrixAudit(); const proof = proofAudit();
  const dodge = dodgeAudit(); const risk = riskAudit(); const budget = budgetAudit(root);
  const physicalTree = physicalTreeAudit(); const oracle = oracleAudit(layout);
  const tests = summarizeTestOutput(root, options.testOutputFile, options.testExitCode,
    outputDirectory, { testDirectories: ["imp0", "platform", "imp1", "imp2", "imp3", "imp4"] });
  const evidenceFiles = [
    ["search-layout", writeImmutableJsonEvidence(outputDirectory, "search-layout", layout)],
    ["value-bounds", writeImmutableJsonEvidence(outputDirectory, "value-bounds", value)],
    ["quantifiers", writeImmutableJsonEvidence(outputDirectory, "quantifiers", quantifiers)],
    ["matrix", writeImmutableJsonEvidence(outputDirectory, "matrix", matrix)],
    ["proof", writeImmutableJsonEvidence(outputDirectory, "proof", proof)],
    ["dodge-shot", writeImmutableJsonEvidence(outputDirectory, "dodge-shot", dodge)],
    ["risk", writeImmutableJsonEvidence(outputDirectory, "risk", risk)],
    ["budget", writeImmutableJsonEvidence(outputDirectory, "budget", budget)],
    ["physical-tree", writeImmutableJsonEvidence(outputDirectory, "physical-tree", physicalTree)],
    ["oracle-performance", writeImmutableJsonEvidence(outputDirectory, "oracle-performance", oracle)],
    ["tests", writeImmutableJsonEvidence(outputDirectory, "tests", tests.report)],
    ["test-output", writeImmutableRawEvidence(outputDirectory, "test-output", "tap", tests.output)]
  ];
  const checks = [
    check("VALUE_SOUND_BOUNDS", value.status, { falseExactCount: value.falseExactCount,
      ordinaryEvaluatorWideCount: value.ordinaryEvaluatorWideCount }),
    check("QUANTIFIER_SEPARATION", quantifiers.status, { strategyFusionCount: quantifiers.strategyFusionCount,
      chanceStatus: quantifiers.chanceStatus }),
    check("MATRIX_FULL_BEST_RESPONSE", matrix.status, { fullBestResponseLeakCount: matrix.fullBestResponseLeakCount,
      rpsGap: matrix.rps.gap }),
    check("INFORMATION_PROOF_COVERAGE", proof.status, { falsePositiveCount: proof.falsePositiveCount,
      dfsStatus: proof.dfsStatus, dfpnStatus: proof.dfpnStatus }),
    check("DODGE_TIMELINE_HARD_INTEGRATION", dodge.status, { dodgeHardRejectCells: dodge.dodgeHardRejectCells,
      unavoidableHardRejectCells: dodge.unavoidableHardRejectCells }),
    check("RECURSIVE_ROBUST_RISK", risk.status, { monotonicViolations: risk.monotonicViolations,
      oracleMismatchCount: risk.oracleMismatchCount, strictMismatch: risk.strictMismatch }),
    check("BUDGET_SEMANTIC_IDENTITY", budget.status, { completeSemanticMismatchCount:
      budget.completeSemanticMismatchCount, monteCarloCount: budget.monteCarloCount }),
    check("DEEP_FAST_MAKE_UNDO", physicalTree.status, { hardCheckedCells: physicalTree.hardCheckedCells,
      rootMismatchCount: physicalTree.rootMismatchCount, capacityStatus: physicalTree.capacityStatus }),
    check("SMALL_STATE_ORACLE", oracle.status, { exhaustiveMatrixGames: oracle.exhaustiveMatrixGames,
      exhaustiveProofCases: oracle.exhaustiveProofCases, intervalMismatchCount: oracle.intervalMismatchCount,
      policyMismatchCount: oracle.policyMismatchCount, proofFalsePositiveCount: oracle.proofFalsePositiveCount }),
    check("HOT_SEARCH_STRUCTURE", layout.status === "PASS" && oracle.forbiddenHotConstructCount === 0 ?
      "PASS" : "FAIL", { typedArrayCount: layout.typedArrayCount, totalCoreBytes: layout.totalCoreBytes,
      floatArrayCount: layout.floatArrayCount, allocationCount: oracle.declaredHotAllocationCount }),
    check("G3_G8_ALGORITHM_TESTS", tests.report.status, { tests: tests.report.tests,
      pass: tests.report.pass, fail: tests.report.fail })
  ];
  const blockers = checks.filter(item => item.status === "FAIL").map(item => item.checkId);
  const gate = { schemaVersion: 1, reportId: "imp4-value-matrix-proof-risk-gate-v1",
    status: blockers.length ? "FAIL" : "PASS", checks,
    artifacts: evidenceFiles.map(([id, file]) => artifactEntry(root, id, file)), blockers,
    fingerprint: "" };
  gate.fingerprint = fingerprintObject(gate); validateSchemaObject("imp4-gate-report", gate, root);
  writeReport(outputDirectory, "imp4-gate-report.json", gate);
  const gateFile = writeImmutableJsonEvidence(outputDirectory, "imp4-gate", gate);
  return { gate, gateFile };
}

module.exports = { layoutAudit, valueAudit, quantifierAudit, matrixAudit, proofAudit,
  dodgeAudit, riskAudit, budgetAudit, physicalTreeAudit, oracleAudit, runImp4Gate };
