"use strict";
const fs = require("node:fs"), path = require("node:path"), zlib = require("node:zlib");
const { ACTION } = require("../../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { NativeBasePolicySearch } = require("../../../engine-v2/src/base-policy-specialized/policy-search");
const { NativeBasePolicyDiagnosticBot, play, productionTreeSha256 } = require("./native-base-policy-standalone-arena");
const { prefixMatches } = require("./native-base-policy-root-action-counterfactual");
const { loadCohort } = require("./v2-native-initiative-arena");
const { loadSimulator } = require("../simulation/paired-arena");
const COUNTERS = ["leafBudgetCount", "depthLeafCount", "topLeafCount",
  "fastIncompleteCount", "hardIncompleteCount", "noActionLeafCount"];

function equalCellBudget(total, rows, columns) {
  if (rows < 1 || columns < 1 || total < rows * columns) return 0;
  return Math.floor(total / (rows * columns));
}

function coverageComparison(records) {
  const summary = {};
  for (const record of records) {
    const bucket = summary[record.mode] ||= { roots: 0, nodes: 0, budgetLeaves: 0,
      wins: 0, draws: 0, losses: 0, restoreFailures: 0 };
    bucket.roots++; bucket.nodes += record.measuredNodes;
    bucket.budgetLeaves += record.budgetLeaves;
    bucket.restoreFailures += record.rootRestoreFailures;
    bucket[record.outcome === "V2_WIN" ? "wins" : record.outcome === "DRAW" ? "draws" : "losses"]++;
  }
  for (const mode of ["CELL_EQUAL", "SHALLOW_COMPLETE"]) {
    if (!summary[mode]) continue;
    summary[mode].permutationMismatch = 0;
    for (const record of records.filter(r => r.mode === mode)) {
      const reverse = records.find(r => r.mode === mode + "_REVERSE" &&
        r.matchUrlId === record.matchUrlId && r.seat === record.seat && r.frame === record.frame);
      if (!reverse || record.selected !== reverse.selected ||
          JSON.stringify(record.rows) !== JSON.stringify(reverse.rows)) summary[mode].permutationMismatch++;
    }
  }
  return summary;
}

function rowSummary(cells, blend) {
  let worst = Infinity, sum = 0, weight = 0;
  for (const cell of cells) {
    worst = Math.min(worst, cell.value);
    sum += cell.value * cell.weight; weight += cell.weight;
  }
  const expected = weight ? Math.trunc(sum / weight) : null;
  return { worst: cells.length ? worst : null, expected,
    backed: cells.length ? (!weight ? worst :
      worst + Math.trunc((expected - worst) * blend / 10000)) : null };
}

async function run(root, input, output) {
  const oracle = JSON.parse(fs.readFileSync(input));
  if (oracle.productionTreeSha256 !== productionTreeSha256(root)) throw Error("SOURCE_DRIFT");
  const baseline = zlib.gunzipSync(fs.readFileSync(path.join(oracle.input.directory, "matches.ndjson.gz")))
    .toString().trim().split("\n").map(JSON.parse);
  const targets = oracle.records.filter(r => r.recoverable && r.root.searchEvidenceCurrent &&
    r.baselineOutcome !== r.oracle.terminal.outcome);
  const scenarios = loadCohort(root, path.join(root, "config/engine-v3/v3-repair-cohort.json"), "DISCOVERY").scenarios;
  const { module } = await loadSimulator(root);
  const proto = NativeBasePolicySearch.prototype;
  const original = { rootCell: proto.rootCell, pairedLeaf: proto.pairedLeaf,
    scheduledDepth: proto.scheduledDepth,
    buildRootColumnSequence: proto.buildRootColumnSequence,
    rootV1ShapedAllowed: proto.rootV1ShapedAllowed,
    captureRoot: NativeBasePolicyDiagnosticBot.prototype.captureRoot };
  const records = [];
  try {
    for (const target of targets) {
      const modes = process.argv.includes("--budget-poc") ?
        ["CURRENT", "REVERSE_COLUMNS", "CELL_EQUAL", "CELL_EQUAL_REVERSE",
          "SHALLOW_COMPLETE", "SHALLOW_COMPLETE_REVERSE"] :
        target.oracle.row.basePolicyMembership === 3 ?
        ["CURRENT", "ADMIT_FIRE", "REVERSE_COLUMNS"] : ["CURRENT", "REVERSE_COLUMNS"];
      for (const mode of modes) {
        const cells = []; let currentCell = null, captured = null;
        proto.scheduledDepth = function(engine) {
          if (mode.startsWith("SHALLOW_COMPLETE") &&
              engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] === target.root.frame) return 1;
          return original.scheduledDepth.call(this, engine);
        };
        proto.buildRootColumnSequence = function(engine) {
          const result = original.buildRootColumnSequence.call(this, engine);
          if ((mode === "REVERSE_COLUMNS" || mode.endsWith("_REVERSE")) &&
              engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] === target.root.frame)
            this.rootColumnSequence.subarray(0, engine.enemyCount).reverse();
          return result;
        };
        proto.rootV1ShapedAllowed = function(engine, action) {
          if (mode === "ADMIT_FIRE" && action === ACTION.FIRE &&
            engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] === target.root.frame)
            return this.canFire(engine.adapter.state, 0) ? 1 : 0;
          return original.rootV1ShapedAllowed.call(this, engine, action);
        };
        proto.rootCell = function(engine, row, column) {
          if (engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] !== target.root.frame)
            return original.rootCell.call(this, engine, row, column);
          if (mode.startsWith("CELL_EQUAL") || mode.startsWith("SHALLOW_COMPLETE")) {
            const count = engine.ourCount > 1 && engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
              engine.ourCount - 1 : engine.ourCount;
            let rows = 0, columns = 0;
            for (let i = 0; i < count; i++) rows += this.rootDomainMask[i] ? 1 : 0;
            for (let i = 0; i < engine.enemyCount; i++) columns += this.rootEnemyDomainMask[i] ? 1 : 0;
            const budget = equalCellBudget(128, rows, columns);
            if (!budget) throw Error("BASE_COVERAGE_BUDGET_INSUFFICIENT");
            this.nodes = 0; this.perRootBudget = budget;
          }
          const before = COUNTERS.map(key => this[key]);
          currentCell = { row, column, action: engine.ourActions[row],
            enemyAction: engine.enemyActions[column], nodesBefore: this.nodes,
            budget: this.perRootBudget, weight: this.opponentWeight(engine, engine.adapter.state, engine.enemyActions[column]),
            leafTop: {}, leafCount: 0, leafMin: null, leafMax: null };
          const value = original.rootCell.call(this, engine, row, column);
          currentCell.value = value; currentCell.nominal = this.lastNominalValue;
          currentCell.nodesAfter = this.nodes;
          for (let i = 0; i < COUNTERS.length; i++) currentCell[COUNTERS[i]] = this[COUNTERS[i]] - before[i];
          cells.push(currentCell); currentCell = null;
          return value;
        };
        proto.pairedLeaf = function(...args) {
          const value = original.pairedLeaf.apply(this, args);
          if (currentCell) {
            const top = args[3] || 0;
            currentCell.leafTop[top] = (currentCell.leafTop[top] || 0) + 1;
            currentCell.leafCount++;
            currentCell.leafMin = currentCell.leafMin === null ? value : Math.min(value, currentCell.leafMin);
            currentCell.leafMax = currentCell.leafMax === null ? value : Math.max(value, currentCell.leafMax);
          }
          return value;
        };
        NativeBasePolicyDiagnosticBot.prototype.captureRoot = function(context) {
          const engine = this.engine, search = engine.basePolicy.policySearch;
          if (engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] !== target.root.frame) return;
          const count = engine.ourCount > 1 && engine.ourActions[engine.ourCount - 1] === ACTION.NONE ?
            engine.ourCount - 1 : engine.ourCount;
          const rows = Array.from({ length: count }, (_, row) => ({ row,
            action: engine.ourActions[row], included: search.rootDomainMask[row],
            rootScore: search.rootScore[row], nominalScore: search.rootNominalScore[row],
            membership: engine.basePolicy.owner.membership[row],
            ownerValue: engine.basePolicy.owner.membership[row] === 5 ? engine.basePolicy.owner.backedValue[row] : null,
            ...rowSummary(cells.filter(c => c.row === row), search.currentBlendBasisPoints) }));
          captured = { depth: search.currentDepth, blend: search.currentBlendBasisPoints,
            selected: engine.ourActions[engine.lastSelectedRow], rows };
        };
        const scenario = scenarios.find(s => s.matchUrlId === target.matchUrlId);
        const replay = await play(module, scenario, target.candidateSeat, true);
        const source = baseline.find(m => m.matchUrlId === target.matchUrlId && m.candidateSeat === target.candidateSeat);
        if (!captured || !prefixMatches(source, replay, target.root.frame, captured.selected)) throw Error("PREFIX_MISMATCH");
        if (mode === "CURRENT") for (const side of ["candidate", "control"])
          if (source[side].compactActionStream !== replay[side].compactActionStream) throw Error("TRACE_ACTION_DRIFT");
        for (const row of captured.rows) if (row.backed !== null && row.backed !== row.rootScore) throw Error("BACKUP_MISMATCH");
        records.push({ matchUrlId: target.matchUrlId, seat: target.candidateSeat,
          frame: target.root.frame, mode, outcome: replay.analysisOutcome,
          measuredNodes: cells.reduce((n, c) => n + c.nodesAfter - c.nodesBefore, 0),
          budgetLeaves: cells.reduce((n, c) => n + c.leafBudgetCount, 0),
          rootRestoreFailures: replay.candidateEngine.rootRestoreFailures,
          alternativeAction: target.oracle.row.action, ...captured, cells });
      }
    }
  } finally {
    proto.rootCell = original.rootCell; proto.pairedLeaf = original.pairedLeaf;
    proto.scheduledDepth = original.scheduledDepth;
    proto.buildRootColumnSequence = original.buildRootColumnSequence;
    proto.rootV1ShapedAllowed = original.rootV1ShapedAllowed;
    NativeBasePolicyDiagnosticBot.prototype.captureRoot = original.captureRoot;
  }
  fs.writeFileSync(output, JSON.stringify({ productionTreeSha256: oracle.productionTreeSha256,
    coverageComparison: coverageComparison(records), records }, null, 2) + "\n");
  console.log(JSON.stringify({ output, roots: records.length, cells: records.reduce((n,r)=>n+r.cells.length,0) }));
}
if (require.main === module) run(process.cwd(), process.argv[2], process.argv[3])
  .catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { rowSummary, equalCellBudget, coverageComparison, run };
