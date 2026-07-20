"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { VALUE_MIN, VALUE_MAX, PROBABILITY_SCALE, SEARCH_STATUS, BOUND_KIND,
  POLICY_FLAG, NONE_NODE } = require("../abi/search-codes");
const { weightedLower, weightedUpper } = require("./fixed-math");
const { PolicyArena } = require("./arenas");

const MAX_REGRET = 100000000;

class StageMatrix {
  constructor(options = {}) {
    this.maxRows = options.maxRows || SEARCH_CAPACITY.MAX_OUR_ACTIONS;
    this.maxColumns = options.maxColumns || SEARCH_CAPACITY.MAX_ENEMY_POLICIES;
    this.maxColumns = Math.max(this.maxColumns, 1); const cells = this.maxRows * this.maxColumns;
    this.lower = new Int16Array(cells); this.upper = new Int16Array(cells);
    this.riskLower = new Int16Array(cells); this.riskUpper = new Int16Array(cells);
    this.complete = new Uint8Array(cells); this.rows = 0; this.columns = 0;
    this.pureLower = VALUE_MIN; this.pureUpper = VALUE_MAX; this.pureRow = 0; this.pureColumn = 0;
    this.allCellsComplete = 0; this.riskTransformed = 0; this.hotAllocationCount = 0;
  }
  initialize(rows, columns) {
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 ||
        rows > this.maxRows || columns > this.maxColumns)
      return SEARCH_STATUS.CAPACITY;
    this.rows = rows; this.columns = columns; this.riskTransformed = 0;
    // A reused slab starts conservative.  Missing setCell calls must remain
    // incomplete intervals instead of inheriting an exact cell from a prior
    // matrix with the same dimensions.
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const at = row * this.maxColumns + column; this.lower[at] = VALUE_MIN;
      this.upper[at] = VALUE_MAX; this.riskLower[at] = VALUE_MIN;
      this.riskUpper[at] = VALUE_MAX; this.complete[at] = 0;
    }
    return SEARCH_STATUS.COMPLETE;
  }
  setCell(row, column, lower, upper, complete = 1) {
    if (!Number.isInteger(row) || !Number.isInteger(column) || !Number.isInteger(lower) ||
        !Number.isInteger(upper) || row < 0 || row >= this.rows || column < 0 ||
        column >= this.columns || lower < VALUE_MIN || upper > VALUE_MAX || lower > upper ||
        (complete !== 0 && complete !== 1 && complete !== false && complete !== true))
      return SEARCH_STATUS.INVALID;
    const at = row * this.maxColumns + column; this.lower[at] = lower; this.upper[at] = upper;
    this.riskLower[at] = lower; this.riskUpper[at] = upper; this.complete[at] = complete ? 1 : 0;
    return SEARCH_STATUS.COMPLETE;
  }
  cellLower(row, column) {
    const at = row * this.maxColumns + column;
    return this.riskTransformed ? this.riskLower[at] : this.lower[at];
  }
  cellUpper(row, column) {
    const at = row * this.maxColumns + column;
    return this.riskTransformed ? this.riskUpper[at] : this.upper[at];
  }
  computePureBounds() {
    let lower = VALUE_MIN; let upper = VALUE_MAX; let bestRow = 0; let bestColumn = 0;
    let complete = 1;
    for (let row = 0; row < this.rows; row += 1) {
      let rowMin = VALUE_MAX;
      for (let column = 0; column < this.columns; column += 1) {
        const at = row * this.maxColumns + column; const value = this.cellLower(row, column);
        if (value < rowMin) rowMin = value; if (!this.complete[at]) complete = 0;
      }
      if (rowMin > lower) { lower = rowMin; bestRow = row; }
    }
    for (let column = 0; column < this.columns; column += 1) {
      let columnMax = VALUE_MIN;
      for (let row = 0; row < this.rows; row += 1) {
        const value = this.cellUpper(row, column); if (value > columnMax) columnMax = value;
      }
      if (columnMax < upper) { upper = columnMax; bestColumn = column; }
    }
    this.pureLower = lower; this.pureUpper = upper; this.pureRow = bestRow;
    this.pureColumn = bestColumn; this.allCellsComplete = complete; return complete;
  }
}

function normalizeWeights(ids, count, weights, probabilities, remainders) {
  let sum = 0; for (let index = 0; index < count; index += 1) sum += weights[index];
  if (sum === 0) {
    const base = Math.floor(PROBABILITY_SCALE / count); let remaining = PROBABILITY_SCALE - base * count;
    for (let index = 0; index < count; index += 1) {
      probabilities[index] = base + (remaining > 0 ? 1 : 0); if (remaining > 0) remaining -= 1;
      remainders[index] = 0;
    }
    return;
  }
  let assigned = 0;
  for (let index = 0; index < count; index += 1) {
    const scaled = weights[index] * PROBABILITY_SCALE; const probability = Math.floor(scaled / sum);
    probabilities[index] = probability; remainders[index] = scaled - probability * sum; assigned += probability;
  }
  let remaining = PROBABILITY_SCALE - assigned;
  while (remaining > 0) {
    let best = -1;
    for (let index = 0; index < count; index += 1) if (remainders[index] > 0 &&
        (best < 0 || remainders[index] > remainders[best] ||
        (remainders[index] === remainders[best] && ids[index] < ids[best]))) best = index;
    if (best < 0) best = 0; probabilities[best] += 1; remainders[best] = 0; remaining -= 1;
  }
}

class DoubleOracleSolver {
  constructor(matrix, policyArena = new PolicyArena()) {
    this.matrix = matrix; this.policyArena = policyArena;
    const rows = matrix.maxRows; const columns = matrix.maxColumns;
    this.rowIds = new Uint16Array(rows); this.columnIds = new Uint16Array(columns);
    this.rowActive = new Uint8Array(rows); this.columnActive = new Uint8Array(columns);
    this.rowRegret = new Uint32Array(rows); this.columnRegret = new Uint32Array(columns);
    this.rowStrategy = new Uint16Array(rows); this.columnStrategy = new Uint16Array(columns);
    this.rowStrategySum = new Uint32Array(rows); this.columnStrategySum = new Uint32Array(columns);
    this.averageRow = new Uint16Array(rows); this.averageColumn = new Uint16Array(columns);
    this.rowUtility = new Int32Array(rows); this.columnUtility = new Int32Array(columns);
    this.remainders = new Uint32Array(Math.max(rows, columns));
    this.policyActions = new Uint16Array(rows); this.policyProbabilities = new Uint16Array(rows);
    this.rowCount = 0; this.columnCount = 0; this.iterations = 0; this.expansions = 0;
    this.stageLower = VALUE_MIN; this.stageUpper = VALUE_MAX; this.gap = VALUE_MAX - VALUE_MIN;
    this.boundKind = BOUND_KIND.APPROXIMATE_WITH_GAP; this.policyHandle = NONE_NODE;
    this.fullEnemyBestResponseScans = 0; this.fullOurBestResponseScans = 0;
    this.lastEnemyBestResponse = 0; this.lastOurBestResponse = 0;
    this.hotAllocationCount = 0;
  }

  reset() {
    this.rowActive.fill(0); this.columnActive.fill(0); this.rowRegret.fill(0); this.columnRegret.fill(0);
    this.rowStrategySum.fill(0); this.columnStrategySum.fill(0);
    this.rowCount = 0; this.columnCount = 0; this.iterations = 0; this.expansions = 0;
    this.stageLower = VALUE_MIN; this.stageUpper = VALUE_MAX; this.gap = VALUE_MAX - VALUE_MIN;
    this.policyHandle = NONE_NODE; this.fullEnemyBestResponseScans = 0; this.fullOurBestResponseScans = 0;
  }
  addRow(row) {
    if (this.rowActive[row]) return 0; if (this.rowCount >= this.rowIds.length) return -1;
    this.rowActive[row] = 1; this.rowIds[this.rowCount++] = row; return 1;
  }
  addColumn(column) {
    if (this.columnActive[column]) return 0; if (this.columnCount >= this.columnIds.length) return -1;
    this.columnActive[column] = 1; this.columnIds[this.columnCount++] = column; return 1;
  }
  updateStrategies() {
    normalizeWeights(this.rowIds, this.rowCount, this.rowRegret, this.rowStrategy, this.remainders);
    normalizeWeights(this.columnIds, this.columnCount, this.columnRegret,
      this.columnStrategy, this.remainders);
  }
  iterate(batch) {
    const matrix = this.matrix;
    for (let iteration = 0; iteration < batch; iteration += 1) {
      this.updateStrategies();
      for (let rowSlot = 0; rowSlot < this.rowCount; rowSlot += 1) {
        const row = this.rowIds[rowSlot]; let sum = 0;
        for (let columnSlot = 0; columnSlot < this.columnCount; columnSlot += 1)
          sum += this.columnStrategy[columnSlot] * matrix.cellLower(row, this.columnIds[columnSlot]);
        this.rowUtility[rowSlot] = weightedLower(sum);
      }
      let rowPolicySum = 0;
      for (let rowSlot = 0; rowSlot < this.rowCount; rowSlot += 1)
        rowPolicySum += this.rowStrategy[rowSlot] * this.rowUtility[rowSlot];
      const rowPolicyUtility = weightedLower(rowPolicySum);
      for (let columnSlot = 0; columnSlot < this.columnCount; columnSlot += 1) {
        const column = this.columnIds[columnSlot]; let sum = 0;
        for (let rowSlot = 0; rowSlot < this.rowCount; rowSlot += 1)
          sum += this.rowStrategy[rowSlot] * matrix.cellUpper(this.rowIds[rowSlot], column);
        this.columnUtility[columnSlot] = weightedUpper(sum);
      }
      let columnPolicySum = 0;
      for (let columnSlot = 0; columnSlot < this.columnCount; columnSlot += 1)
        columnPolicySum += this.columnStrategy[columnSlot] * this.columnUtility[columnSlot];
      const columnPolicyUtility = weightedUpper(columnPolicySum);
      for (let rowSlot = 0; rowSlot < this.rowCount; rowSlot += 1) {
        let regret = this.rowRegret[rowSlot] + this.rowUtility[rowSlot] - rowPolicyUtility;
        if (regret < 0) regret = 0; if (regret > MAX_REGRET) regret = MAX_REGRET;
        this.rowRegret[rowSlot] = regret; this.rowStrategySum[rowSlot] += this.rowStrategy[rowSlot];
      }
      for (let columnSlot = 0; columnSlot < this.columnCount; columnSlot += 1) {
        let regret = this.columnRegret[columnSlot] + columnPolicyUtility - this.columnUtility[columnSlot];
        if (regret < 0) regret = 0; if (regret > MAX_REGRET) regret = MAX_REGRET;
        this.columnRegret[columnSlot] = regret;
        this.columnStrategySum[columnSlot] += this.columnStrategy[columnSlot];
      }
      this.iterations += 1;
    }
    normalizeWeights(this.rowIds, this.rowCount, this.rowStrategySum, this.averageRow, this.remainders);
    normalizeWeights(this.columnIds, this.columnCount, this.columnStrategySum,
      this.averageColumn, this.remainders);
  }

  scanBestResponses() {
    const matrix = this.matrix; let lower = VALUE_MAX; let lowerColumn = 0;
    for (let column = 0; column < matrix.columns; column += 1) {
      let sum = 0; for (let rowSlot = 0; rowSlot < this.rowCount; rowSlot += 1)
        sum += this.averageRow[rowSlot] * matrix.cellLower(this.rowIds[rowSlot], column);
      const value = weightedLower(sum); if (value < lower) { lower = value; lowerColumn = column; }
    }
    let upper = VALUE_MIN; let upperRow = 0;
    for (let row = 0; row < matrix.rows; row += 1) {
      let sum = 0; for (let columnSlot = 0; columnSlot < this.columnCount; columnSlot += 1)
        sum += this.averageColumn[columnSlot] * matrix.cellUpper(row, this.columnIds[columnSlot]);
      const value = weightedUpper(sum); if (value > upper) { upper = value; upperRow = row; }
    }
    this.stageLower = lower; this.stageUpper = upper < lower ? lower : upper;
    this.gap = this.stageUpper - this.stageLower; this.lastEnemyBestResponse = lowerColumn;
    this.lastOurBestResponse = upperRow; this.fullEnemyBestResponseScans += 1;
    this.fullOurBestResponseScans += 1;
  }

  writePolicy(flags) {
    let count = 0;
    for (let slot = 0; slot < this.rowCount; slot += 1) if (this.averageRow[slot] > 0) {
      this.policyActions[count] = this.rowIds[slot]; this.policyProbabilities[count] = this.averageRow[slot];
      count += 1;
    }
    this.policyHandle = this.policyArena.write(this.policyActions, this.policyProbabilities,
      count, flags); return this.policyHandle;
  }

  solveClosed2x2() {
    const matrix = this.matrix;
    if (matrix.rows !== 2 || matrix.columns !== 2 || !matrix.allCellsComplete) return 0;
    const a = matrix.cellLower(0, 0); const b = matrix.cellLower(0, 1);
    const c = matrix.cellLower(1, 0); const d = matrix.cellLower(1, 1);
    if (a !== matrix.cellUpper(0, 0) || b !== matrix.cellUpper(0, 1) ||
        c !== matrix.cellUpper(1, 0) || d !== matrix.cellUpper(1, 1)) return 0;
    let denominator = a - b - c + d; let rowNumerator = d - c; let columnNumerator = d - b;
    if (denominator === 0) return 0;
    if (denominator < 0) { denominator = -denominator; rowNumerator = -rowNumerator;
      columnNumerator = -columnNumerator; }
    if (rowNumerator <= 0 || rowNumerator >= denominator ||
        columnNumerator <= 0 || columnNumerator >= denominator) return 0;
    this.rowCount = 2; this.columnCount = 2; this.rowIds[0] = 0; this.rowIds[1] = 1;
    this.columnIds[0] = 0; this.columnIds[1] = 1; this.rowActive[0] = 1; this.rowActive[1] = 1;
    this.columnActive[0] = 1; this.columnActive[1] = 1;
    this.rowStrategySum[0] = rowNumerator; this.rowStrategySum[1] = denominator - rowNumerator;
    this.columnStrategySum[0] = columnNumerator;
    this.columnStrategySum[1] = denominator - columnNumerator;
    normalizeWeights(this.rowIds, 2, this.rowStrategySum, this.averageRow, this.remainders);
    normalizeWeights(this.columnIds, 2, this.columnStrategySum, this.averageColumn, this.remainders);
    this.scanBestResponses(); this.boundKind = this.gap === 0 ? BOUND_KIND.EXACT_COMPLETE :
      BOUND_KIND.APPROXIMATE_WITH_GAP;
    this.writePolicy(POLICY_FLAG.MIXED | (this.gap === 0 ? 0 : POLICY_FLAG.APPROXIMATE));
    return 1;
  }

  solve(iterationBudget = 128, iterationBatch = 16,
      expansionBudget = SEARCH_CAPACITY.MAX_DOUBLE_ORACLE_EXPANSIONS) {
    const matrix = this.matrix;
    if (matrix.rows < 1 || matrix.columns < 1 || !Number.isInteger(iterationBudget) ||
        !Number.isInteger(iterationBatch) || !Number.isInteger(expansionBudget) ||
        iterationBudget < 0 || iterationBatch < 1 || expansionBudget < 0)
      return SEARCH_STATUS.INVALID;
    this.reset(); matrix.computePureBounds();
    if (matrix.allCellsComplete && matrix.pureLower === matrix.pureUpper) {
      this.rowIds[0] = matrix.pureRow; this.averageRow[0] = PROBABILITY_SCALE; this.rowCount = 1;
      this.stageLower = matrix.pureLower; this.stageUpper = matrix.pureUpper; this.gap = 0;
      this.boundKind = BOUND_KIND.EXACT_COMPLETE;
      this.writePolicy(POLICY_FLAG.DETERMINISTIC); return SEARCH_STATUS.COMPLETE;
    }
    if (this.solveClosed2x2()) return this.gap === 0 ? SEARCH_STATUS.COMPLETE : SEARCH_STATUS.APPROXIMATE;
    if (iterationBudget === 0 || expansionBudget === 0) return SEARCH_STATUS.INCOMPLETE;
    this.addRow(matrix.pureRow); this.addColumn(matrix.pureColumn);
    while (this.iterations < iterationBudget && this.expansions < expansionBudget) {
      const batch = Math.min(iterationBatch, iterationBudget - this.iterations); this.iterate(batch);
      this.scanBestResponses(); let added = 0; const enemy = this.addColumn(this.lastEnemyBestResponse);
      const ours = this.addRow(this.lastOurBestResponse); if (enemy < 0 || ours < 0) break;
      added += enemy + ours; if (added > 0) this.expansions += 1;
      if (this.gap === 0 && matrix.allCellsComplete) break;
      if (added === 0 && this.iterations >= iterationBudget) break;
    }
    this.scanBestResponses();
    const exact = this.gap === 0 && matrix.allCellsComplete;
    this.boundKind = exact ? BOUND_KIND.EXACT_COMPLETE : BOUND_KIND.APPROXIMATE_WITH_GAP;
    this.writePolicy((this.rowCount === 1 ? POLICY_FLAG.DETERMINISTIC : POLICY_FLAG.MIXED) |
      (exact ? 0 : POLICY_FLAG.APPROXIMATE));
    if (this.policyHandle === NONE_NODE) return SEARCH_STATUS.CAPACITY;
    return exact ? SEARCH_STATUS.COMPLETE : SEARCH_STATUS.APPROXIMATE;
  }
}

module.exports = { StageMatrix, DoubleOracleSolver, normalizeWeights };
