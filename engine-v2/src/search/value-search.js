"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { VALUE_MIN, VALUE_MAX, VALUE_UNKNOWN, SEARCH_STATUS, NODE_KIND, BOUND_KIND,
  LEAF_KIND, INTERVAL_SEMANTIC, INCOMPLETE, RISK_DIMENSION, COVERAGE } =
  require("../abi/search-codes");
const { RiskKernel, RiskProfile } = require("./risk");

function mix(hash, value) {
  let result = (hash ^ (value >>> 0)) >>> 0;
  result = (result + ((result << 1) >>> 0) + ((result << 4) >>> 0) +
    ((result << 7) >>> 0) + ((result << 8) >>> 0) + ((result << 24) >>> 0)) >>> 0;
  return result;
}

class ValueSearch {
  constructor(graph, options = {}) {
    this.graph = graph; const size = graph.maxNodes || SEARCH_CAPACITY.MAX_NODES;
    this.lower = new Int16Array(size); this.upper = new Int16Array(size);
    this.worst = new Int16Array(size); this.expected = new Int16Array(size);
    this.robust = new Int16Array(size); this.ordering = new Int16Array(size);
    this.boundKind = new Uint8Array(size); this.complete = new Uint8Array(size);
    this.semantic = new Uint8Array(size); this.reason = new Uint16Array(size);
    // Graph nodes are append-only and children always have smaller ids.  Mark
    // the root's reachable subgraph so unrelated earlier roots cannot consume
    // this solve's node budget.
    this.reachable = new Uint8Array(size);
    this.risk = options.riskKernel || new RiskKernel(options.riskProfile || new RiskProfile());
    this.baseRisk = options.baseRisk === undefined ? 0 : options.baseRisk;
    this.visitedNodes = 0; this.interruptedCount = 0; this.hotAllocationCount = 0;
    this.lastRoot = 0xffff; this.lastStatus = SEARCH_STATUS.INCOMPLETE;
    this.lastFingerprintLo = 0; this.lastFingerprintHi = 0;
  }

  reset() {
    const count = this.graph.nodeCount;
    for (let node = 0; node < count; node += 1) {
      this.lower[node] = VALUE_MIN; this.upper[node] = VALUE_MAX;
      this.worst[node] = VALUE_UNKNOWN; this.expected[node] = VALUE_UNKNOWN;
      this.robust[node] = VALUE_UNKNOWN; this.ordering[node] = 0;
      this.boundKind[node] = BOUND_KIND.INCOMPLETE; this.complete[node] = 0;
      this.semantic[node] = INTERVAL_SEMANTIC.TERMINAL_GAME;
      this.reason[node] = INCOMPLETE.BUDGET;
    }
    this.visitedNodes = 0;
  }

  childCoverageComplete(node) {
    const graph = this.graph; const start = graph.edgeStart[node]; const count = graph.edgeCount[node];
    let reason = graph.incompleteReason[node]; let complete = reason === INCOMPLETE.NONE ? 1 : 0;
    for (let index = 0; index < count; index += 1) {
      const child = graph.edgeChild[start + index]; reason |= this.reason[child];
      if (!this.complete[child]) complete = 0;
    }
    this.reason[node] = reason; return complete;
  }

  solveDecision(node, maximize) {
    const graph = this.graph; const start = graph.edgeStart[node]; const count = graph.edgeCount[node];
    if (count === 0) return;
    let lower = maximize ? VALUE_MIN : VALUE_MAX; let upper = maximize ? VALUE_MIN : VALUE_MAX;
    let reason = graph.incompleteReason[node]; let allComplete = reason === 0 ? 1 : 0;
    for (let index = 0; index < count; index += 1) {
      const child = graph.edgeChild[start + index]; const childLower = this.lower[child];
      const childUpper = this.upper[child];
      if (maximize) { if (childLower > lower) lower = childLower; if (childUpper > upper) upper = childUpper; }
      else { if (childLower < lower) lower = childLower; if (childUpper < upper) upper = childUpper; }
      reason |= this.reason[child]; if (!this.complete[child]) allComplete = 0;
    }
    const required = maximize ? COVERAGE.OUR_ACTIONS : COVERAGE.ENEMY_POLICIES;
    if (!(graph.coverageMask[node] & required)) {
      allComplete = 0; reason |= INCOMPLETE.SUPPORT;
      if (maximize) upper = VALUE_MAX; else lower = VALUE_MIN;
    }
    this.lower[node] = lower; this.upper[node] = upper; this.reason[node] = reason;
    this.complete[node] = allComplete;
    this.boundKind[node] = allComplete ? (lower === upper ? BOUND_KIND.EXACT_COMPLETE :
      BOUND_KIND.INTERVAL_COMPLETE) : BOUND_KIND.INCOMPLETE;
    this.robust[node] = lower === upper ? lower : VALUE_UNKNOWN;
  }

  solveNature(node, dimension) {
    const graph = this.graph; const coverage = graph.coverageMask[node];
    const supportBit = dimension === RISK_DIMENSION.CHANCE_OUTCOME ? COVERAGE.CHANCE : COVERAGE.WORLDS;
    const probabilityComplete = (coverage & COVERAGE.NO_PROBABILITY_PRUNING) !== 0;
    if (!(coverage & supportBit) || !(coverage & COVERAGE.NO_CAPACITY_TRUNCATION)) {
      this.reason[node] = graph.incompleteReason[node] | INCOMPLETE.SUPPORT; return;
    }
    let childrenComplete = 1; let reason = graph.incompleteReason[node]; const start = graph.edgeStart[node];
    const count = graph.edgeCount[node];
    for (let index = 0; index < count; index += 1) {
      const child = graph.edgeChild[start + index]; reason |= this.reason[child];
      if (!this.complete[child]) childrenComplete = 0;
    }
    const status = this.risk.backupIndexed(count, start, graph.edgeChild, graph.edgeProbability,
      this.lower, this.upper, this.baseRisk, graph.riskClass[node], dimension,
      probabilityComplete ? 1 : 0);
    if (status !== SEARCH_STATUS.COMPLETE) {
      this.reason[node] = reason | (probabilityComplete ? INCOMPLETE.SUPPORT : INCOMPLETE.PROBABILITY);
      return;
    }
    this.lower[node] = this.risk.lower; this.upper[node] = this.risk.upper;
    this.worst[node] = this.risk.worstLower === this.risk.worstUpper ? this.risk.worstLower : VALUE_UNKNOWN;
    this.expected[node] = this.risk.expectedLower === this.risk.expectedUpper ?
      this.risk.expectedLower : VALUE_UNKNOWN;
    this.robust[node] = this.risk.lower === this.risk.upper ? this.risk.lower : VALUE_UNKNOWN;
    this.reason[node] = reason; this.complete[node] = childrenComplete;
    this.boundKind[node] = childrenComplete ? (this.lower[node] === this.upper[node] ?
      BOUND_KIND.EXACT_COMPLETE : BOUND_KIND.INTERVAL_COMPLETE) : BOUND_KIND.INCOMPLETE;
  }

  solveSimultaneous(node) {
    const graph = this.graph; const rows = graph.rows[node]; const columns = graph.columns[node];
    const start = graph.edgeStart[node];
    if (rows < 1 || columns < 1 || rows * columns !== graph.edgeCount[node]) {
      this.reason[node] = graph.incompleteReason[node] | INCOMPLETE.SUPPORT; return;
    }
    let pureLower = VALUE_MIN; let pureUpper = VALUE_MAX; let allComplete = 1;
    let reason = graph.incompleteReason[node];
    for (let row = 0; row < rows; row += 1) {
      let rowMinimum = VALUE_MAX;
      for (let column = 0; column < columns; column += 1) {
        const child = graph.edgeChild[start + row * columns + column];
        if (this.lower[child] < rowMinimum) rowMinimum = this.lower[child];
        reason |= this.reason[child]; if (!this.complete[child]) allComplete = 0;
      }
      if (rowMinimum > pureLower) pureLower = rowMinimum;
    }
    for (let column = 0; column < columns; column += 1) {
      let columnMaximum = VALUE_MIN;
      for (let row = 0; row < rows; row += 1) {
        const child = graph.edgeChild[start + row * columns + column];
        if (this.upper[child] > columnMaximum) columnMaximum = this.upper[child];
      }
      if (columnMaximum < pureUpper) pureUpper = columnMaximum;
    }
    const required = COVERAGE.OUR_ACTIONS | COVERAGE.ENEMY_POLICIES |
      COVERAGE.NO_CAPACITY_TRUNCATION | COVERAGE.STRATEGY_CONSISTENT;
    if ((graph.coverageMask[node] & required) !== required) {
      allComplete = 0; reason |= INCOMPLETE.SUPPORT; pureLower = VALUE_MIN; pureUpper = VALUE_MAX;
    }
    this.lower[node] = pureLower; this.upper[node] = pureUpper; this.reason[node] = reason;
    this.complete[node] = allComplete; this.boundKind[node] = allComplete ?
      (pureLower === pureUpper ? BOUND_KIND.EXACT_COMPLETE : BOUND_KIND.INTERVAL_COMPLETE) :
      BOUND_KIND.INCOMPLETE;
    this.robust[node] = pureLower === pureUpper ? pureLower : VALUE_UNKNOWN;
  }

  solveObservation(node) {
    const graph = this.graph; const start = graph.edgeStart[node]; const count = graph.edgeCount[node];
    if (count < 1) return;
    let lower = VALUE_MAX; let upper = VALUE_MIN; let reason = graph.incompleteReason[node];
    let allComplete = 1;
    for (let index = 0; index < count; index += 1) {
      const child = graph.edgeChild[start + index]; if (this.lower[child] < lower) lower = this.lower[child];
      if (this.upper[child] > upper) upper = this.upper[child]; reason |= this.reason[child];
      if (!this.complete[child]) allComplete = 0;
    }
    if (!(graph.coverageMask[node] & COVERAGE.OBSERVATIONS)) {
      allComplete = 0; reason |= INCOMPLETE.SUPPORT; lower = VALUE_MIN; upper = VALUE_MAX;
    }
    this.lower[node] = lower; this.upper[node] = upper; this.reason[node] = reason;
    this.complete[node] = allComplete; this.boundKind[node] = allComplete ?
      (lower === upper ? BOUND_KIND.EXACT_COMPLETE : BOUND_KIND.INTERVAL_COMPLETE) : BOUND_KIND.INCOMPLETE;
  }

  solveNode(node) {
    const graph = this.graph; const kind = graph.kind[node]; this.reason[node] = graph.incompleteReason[node];
    this.semantic[node] = graph.intervalSemantic[node]; this.ordering[node] = graph.orderingEstimate[node];
    if (kind === NODE_KIND.TERMINAL) {
      this.lower[node] = graph.leafLower[node]; this.upper[node] = graph.leafUpper[node];
      this.worst[node] = this.lower[node]; this.expected[node] = this.lower[node];
      this.robust[node] = this.lower[node]; this.complete[node] = 1;
      this.boundKind[node] = BOUND_KIND.EXACT_COMPLETE; return;
    }
    if (kind === NODE_KIND.LEAF) {
      const leafKind = graph.leafKind[node]; this.ordering[node] = graph.orderingEstimate[node];
      if (leafKind === LEAF_KIND.ORDINARY) {
        this.lower[node] = VALUE_MIN; this.upper[node] = VALUE_MAX;
        this.boundKind[node] = BOUND_KIND.HEURISTIC_ONLY; this.reason[node] |= INCOMPLETE.HEURISTIC;
      } else if (leafKind === LEAF_KIND.UNKNOWN) {
        this.lower[node] = VALUE_MIN; this.upper[node] = VALUE_MAX;
        this.boundKind[node] = BOUND_KIND.INCOMPLETE; this.reason[node] |= INCOMPLETE.UNKNOWN_RULE;
      } else {
        this.lower[node] = graph.leafLower[node]; this.upper[node] = graph.leafUpper[node];
        this.complete[node] = 1; this.boundKind[node] = this.lower[node] === this.upper[node] ?
          BOUND_KIND.EXACT_COMPLETE : BOUND_KIND.INTERVAL_COMPLETE;
        if (this.lower[node] === this.upper[node]) this.robust[node] = this.lower[node];
      }
      return;
    }
    if (kind === NODE_KIND.UNKNOWN) { this.reason[node] |= INCOMPLETE.UNKNOWN_RULE; return; }
    if (kind === NODE_KIND.OUR_DECISION) { this.solveDecision(node, true); return; }
    if (kind === NODE_KIND.ENEMY_DECISION) { this.solveDecision(node, false); return; }
    if (kind === NODE_KIND.SIMULTANEOUS) { this.solveSimultaneous(node); return; }
    if (kind === NODE_KIND.CHANCE_OUTCOME) {
      this.solveNature(node, RISK_DIMENSION.CHANCE_OUTCOME); return;
    }
    if (kind === NODE_KIND.HIDDEN_WORLD) {
      this.solveNature(node, RISK_DIMENSION.HIDDEN_WORLD); return;
    }
    if (kind === NODE_KIND.OBSERVATION_SPLIT) { this.solveObservation(node); return; }
    if (kind === NODE_KIND.AUTOMATIC && graph.edgeCount[node] === 1) {
      const child = graph.edgeChild[graph.edgeStart[node]]; this.lower[node] = this.lower[child];
      this.upper[node] = this.upper[child]; this.worst[node] = this.worst[child];
      this.expected[node] = this.expected[child]; this.robust[node] = this.robust[child];
      this.boundKind[node] = this.boundKind[child]; this.complete[node] = this.complete[child];
      this.semantic[node] = this.semantic[child]; this.reason[node] |= this.reason[child];
    }
  }

  solve(root, nodeBudget = SEARCH_CAPACITY.MAX_NODES, baseRisk = this.baseRisk) {
    if (!Number.isInteger(root) || root < 0 || root >= this.graph.nodeCount ||
        !Number.isInteger(nodeBudget) || nodeBudget < 0 || !Number.isInteger(baseRisk) ||
        baseRisk < 0 || baseRisk > 100)
      return SEARCH_STATUS.INVALID;
    this.reset(); this.baseRisk = baseRisk; let status = SEARCH_STATUS.COMPLETE;
    this.reachable.fill(0, 0, root + 1); this.reachable[root] = 1;
    for (let node = root; node >= 0; node -= 1) if (this.reachable[node]) {
      const start = this.graph.edgeStart[node]; const count = this.graph.edgeCount[node];
      for (let index = 0; index < count; index += 1)
        this.reachable[this.graph.edgeChild[start + index]] = 1;
    }
    for (let node = 0; node <= root; node += 1) {
      if (!this.reachable[node]) continue;
      if (this.visitedNodes >= nodeBudget) { status = SEARCH_STATUS.INCOMPLETE; this.interruptedCount += 1; break; }
      this.solveNode(node); this.visitedNodes += 1;
    }
    if (!this.complete[root]) status = SEARCH_STATUS.INCOMPLETE;
    this.lastRoot = root; this.lastStatus = status; let lo = 0x811c9dc5; let hi = 0x9e3779b9;
    lo = mix(lo, root); lo = mix(lo, this.lower[root]); lo = mix(lo, this.upper[root]);
    lo = mix(lo, this.boundKind[root]); hi = mix(hi, this.reason[root]);
    hi = mix(hi, this.semantic[root]); hi = mix(hi, baseRisk);
    this.lastFingerprintLo = lo; this.lastFingerprintHi = hi; return status;
  }
}

module.exports = { ValueSearch };
