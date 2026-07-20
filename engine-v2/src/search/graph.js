"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { VALUE_MIN, VALUE_MAX, NONE_NODE, NODE_KIND, LEAF_KIND,
  INTERVAL_SEMANTIC, COVERAGE_REQUIRED, COVERAGE, INCOMPLETE,
  PROBABILITY_SCALE } = require("../abi/search-codes");

class InformationGraph {
  constructor(options = {}) {
    this.maxNodes = options.maxNodes || SEARCH_CAPACITY.MAX_NODES;
    this.maxEdges = options.maxEdges || SEARCH_CAPACITY.MAX_EDGES;
    this.kind = new Uint8Array(this.maxNodes);
    this.edgeStart = new Uint16Array(this.maxNodes);
    this.edgeCount = new Uint16Array(this.maxNodes);
    this.rows = new Uint8Array(this.maxNodes); this.columns = new Uint8Array(this.maxNodes);
    this.leafKind = new Uint8Array(this.maxNodes);
    this.leafLower = new Int16Array(this.maxNodes); this.leafUpper = new Int16Array(this.maxNodes);
    this.orderingEstimate = new Int16Array(this.maxNodes);
    this.intervalSemantic = new Uint8Array(this.maxNodes);
    this.riskClass = new Uint8Array(this.maxNodes);
    this.coverageMask = new Uint16Array(this.maxNodes);
    this.incompleteReason = new Uint16Array(this.maxNodes);
    this.assumptionMask = new Uint16Array(this.maxNodes);
    this.edgeChild = new Uint16Array(this.maxEdges);
    this.edgeProbability = new Uint16Array(this.maxEdges);
    this.nodeCount = 0; this.edgeUsed = 0; this.overflowReason = INCOMPLETE.NONE;
    this.hotAllocationCount = 0;
  }

  reserveNode(kind, childCount) {
    if (!Number.isInteger(kind) || kind < NODE_KIND.TERMINAL || kind > NODE_KIND.UNKNOWN ||
        !Number.isInteger(childCount) || childCount < 0) {
      this.overflowReason |= INCOMPLETE.SUPPORT; return NONE_NODE;
    }
    if (this.nodeCount >= this.maxNodes) {
      this.overflowReason |= INCOMPLETE.CAPACITY; return NONE_NODE;
    }
    if (this.edgeUsed + childCount > this.maxEdges) {
      this.overflowReason |= INCOMPLETE.SUPPORT; return NONE_NODE;
    }
    const node = this.nodeCount++; this.kind[node] = kind;
    this.edgeStart[node] = this.edgeUsed; this.edgeCount[node] = childCount;
    this.coverageMask[node] = COVERAGE_REQUIRED;
    this.intervalSemantic[node] = INTERVAL_SEMANTIC.TERMINAL_GAME;
    return node;
  }

  addTerminal(value) {
    if (!Number.isInteger(value) ||
        (value !== VALUE_MIN && value !== 0 && value !== VALUE_MAX)) return NONE_NODE;
    const node = this.reserveNode(NODE_KIND.TERMINAL, 0); if (node === NONE_NODE) return node;
    this.leafLower[node] = value; this.leafUpper[node] = value;
    this.leafKind[node] = LEAF_KIND.VERIFIED_ENVELOPE; return node;
  }

  addLeaf(lower = VALUE_MIN, upper = VALUE_MAX, options = {}) {
    if (!Number.isInteger(lower) || !Number.isInteger(upper) || lower < VALUE_MIN ||
        upper > VALUE_MAX || lower > upper) return NONE_NODE;
    const requestedKind = options.kind === undefined ? LEAF_KIND.ORDINARY : options.kind;
    const ordering = options.orderingEstimate === undefined ? 0 : options.orderingEstimate;
    if (!Number.isInteger(requestedKind) || requestedKind < LEAF_KIND.ORDINARY ||
        requestedKind > LEAF_KIND.UNKNOWN || !Number.isInteger(ordering) ||
        ordering < VALUE_MIN || ordering > VALUE_MAX) return NONE_NODE;
    const node = this.reserveNode(NODE_KIND.LEAF, 0); if (node === NONE_NODE) return node;
    const kind = requestedKind; this.leafKind[node] = kind;
    this.leafLower[node] = lower; this.leafUpper[node] = upper;
    this.orderingEstimate[node] = ordering;
    this.intervalSemantic[node] = kind === LEAF_KIND.HORIZON_EXACT ?
      INTERVAL_SEMANTIC.HORIZON_UTILITY : INTERVAL_SEMANTIC.TERMINAL_GAME;
    if (kind === LEAF_KIND.ORDINARY) {
      this.coverageMask[node] &= ~COVERAGE.NO_HEURISTIC_PRUNING;
      this.incompleteReason[node] |= INCOMPLETE.HEURISTIC;
    } else if (kind === LEAF_KIND.UNKNOWN) {
      this.coverageMask[node] &= ~COVERAGE.NO_UNKNOWN_RULE;
      this.incompleteReason[node] |= INCOMPLETE.UNKNOWN_RULE;
    }
    return node;
  }

  addOrdinaryLeaf(orderingEstimate = 0) {
    if (!Number.isInteger(orderingEstimate) || orderingEstimate < VALUE_MIN ||
        orderingEstimate > VALUE_MAX) return NONE_NODE;
    const node = this.reserveNode(NODE_KIND.LEAF, 0); if (node === NONE_NODE) return node;
    this.leafKind[node] = LEAF_KIND.ORDINARY; this.leafLower[node] = VALUE_MIN;
    this.leafUpper[node] = VALUE_MAX; this.orderingEstimate[node] = orderingEstimate;
    this.coverageMask[node] &= ~COVERAGE.NO_HEURISTIC_PRUNING;
    this.incompleteReason[node] |= INCOMPLETE.HEURISTIC; return node;
  }

  addUnknown(reason = INCOMPLETE.UNKNOWN_RULE) {
    const node = this.reserveNode(NODE_KIND.UNKNOWN, 0); if (node === NONE_NODE) return node;
    this.leafLower[node] = VALUE_MIN; this.leafUpper[node] = VALUE_MAX;
    this.incompleteReason[node] = reason;
    this.coverageMask[node] &= ~(COVERAGE.NO_UNKNOWN_RULE | COVERAGE.NO_CAPACITY_TRUNCATION);
    return node;
  }

  addNode(kind, children, probabilities = null, options = {}) {
    const composite = kind === NODE_KIND.OUR_DECISION || kind === NODE_KIND.ENEMY_DECISION ||
      kind === NODE_KIND.SIMULTANEOUS || kind === NODE_KIND.HIDDEN_WORLD ||
      kind === NODE_KIND.CHANCE_OUTCOME || kind === NODE_KIND.AUTOMATIC ||
      kind === NODE_KIND.OBSERVATION_SPLIT;
    const childLength = children && Number.isInteger(children.length) ? children.length : -1;
    const count = options.childCount === undefined ? childLength : options.childCount;
    const rows = options.rows === undefined ? 0 : options.rows;
    const columns = options.columns === undefined ? 0 : options.columns;
    const riskClass = options.riskClass === undefined ? 0 : options.riskClass;
    if (!composite || !Number.isInteger(count) || count < 1 || childLength < count ||
        (probabilities && (!Number.isInteger(probabilities.length) || probabilities.length < count)) ||
        (kind === NODE_KIND.AUTOMATIC && count !== 1) || !Number.isInteger(rows) ||
        !Number.isInteger(columns) || rows < 0 || columns < 0 || rows > 255 || columns > 255 ||
        !Number.isInteger(riskClass) || riskClass < 0 ||
        riskClass >= SEARCH_CAPACITY.MAX_RISK_CLASSES) {
      this.overflowReason |= INCOMPLETE.SUPPORT; return NONE_NODE;
    }
    const node = this.reserveNode(kind, count); if (node === NONE_NODE) return node;
    const start = this.edgeStart[node]; let probabilitySum = 0;
    for (let index = 0; index < count; index += 1) {
      const child = children[index];
      if (!Number.isInteger(child) || child < 0 || child >= this.nodeCount - 1) {
        this.nodeCount -= 1; this.overflowReason |= INCOMPLETE.SUPPORT; return NONE_NODE;
      }
      this.edgeChild[start + index] = child;
      let probability = probabilities ? probabilities[index] : 0;
      if (!probabilities && (kind === NODE_KIND.CHANCE_OUTCOME || kind === NODE_KIND.HIDDEN_WORLD)) {
        probability = Math.floor(PROBABILITY_SCALE / count);
        if (index < PROBABILITY_SCALE - probability * count) probability += 1;
      }
      if (!Number.isInteger(probability) || probability < 0 || probability > PROBABILITY_SCALE) {
        this.nodeCount -= 1; this.overflowReason |= INCOMPLETE.PROBABILITY; return NONE_NODE;
      }
      this.edgeProbability[start + index] = probability; probabilitySum += probability;
    }
    this.edgeUsed += count;
    this.rows[node] = rows; this.columns[node] = columns;
    this.riskClass[node] = riskClass;
    this.assumptionMask[node] = options.assumptionMask || 0;
    if (options.coverageMask !== undefined) this.coverageMask[node] = options.coverageMask;
    if (options.supportComplete === false) {
      let support = COVERAGE.NO_CAPACITY_TRUNCATION;
      if (kind === NODE_KIND.OUR_DECISION) support |= COVERAGE.OUR_ACTIONS;
      else if (kind === NODE_KIND.ENEMY_DECISION) support |= COVERAGE.ENEMY_POLICIES;
      else if (kind === NODE_KIND.SIMULTANEOUS)
        support |= COVERAGE.OUR_ACTIONS | COVERAGE.ENEMY_POLICIES;
      else if (kind === NODE_KIND.HIDDEN_WORLD) support |= COVERAGE.WORLDS;
      else if (kind === NODE_KIND.CHANCE_OUTCOME) support |= COVERAGE.CHANCE;
      else if (kind === NODE_KIND.OBSERVATION_SPLIT) support |= COVERAGE.OBSERVATIONS;
      this.coverageMask[node] &= ~support; this.incompleteReason[node] |= INCOMPLETE.SUPPORT;
    }
    if (options.probabilityComplete === false || ((kind === NODE_KIND.CHANCE_OUTCOME ||
        kind === NODE_KIND.HIDDEN_WORLD) && probabilitySum !== PROBABILITY_SCALE)) {
      this.coverageMask[node] &= ~COVERAGE.NO_PROBABILITY_PRUNING;
      this.incompleteReason[node] |= INCOMPLETE.PROBABILITY;
    }
    if (options.strategyConsistent === false) {
      this.coverageMask[node] &= ~COVERAGE.STRATEGY_CONSISTENT;
      this.incompleteReason[node] |= INCOMPLETE.STRATEGY_FUSION;
    }
    if (kind === NODE_KIND.SIMULTANEOUS && this.rows[node] * this.columns[node] !== count) {
      this.incompleteReason[node] |= INCOMPLETE.SUPPORT;
      this.coverageMask[node] &= ~(COVERAGE.OUR_ACTIONS | COVERAGE.ENEMY_POLICIES);
    }
    return node;
  }

  addSimultaneous(rows, columns, cellChildren, options = {}) {
    return this.addNode(NODE_KIND.SIMULTANEOUS, cellChildren, null,
      { ...options, rows, columns });
  }

  addSimultaneousFromBuffer(rows, columns, cellChildren, childOffset, riskClass = 0) {
    if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 ||
        !cellChildren || !Number.isInteger(cellChildren.length) || !Number.isInteger(childOffset) ||
        childOffset < 0 || childOffset + rows * columns > cellChildren.length ||
        !Number.isInteger(riskClass) || riskClass < 0 ||
        riskClass >= SEARCH_CAPACITY.MAX_RISK_CLASSES) {
      this.overflowReason |= INCOMPLETE.SUPPORT; return NONE_NODE;
    }
    const count = rows * columns; const node = this.reserveNode(NODE_KIND.SIMULTANEOUS, count);
    if (node === NONE_NODE) return node; const start = this.edgeStart[node];
    for (let index = 0; index < count; index += 1) {
      const child = cellChildren[childOffset + index];
      if (!Number.isInteger(child) || child < 0 || child >= this.nodeCount - 1) {
        this.nodeCount -= 1; this.overflowReason |= INCOMPLETE.SUPPORT; return NONE_NODE;
      }
      this.edgeChild[start + index] = child; this.edgeProbability[start + index] = 0;
    }
    this.edgeUsed += count; this.rows[node] = rows; this.columns[node] = columns;
    this.riskClass[node] = riskClass; return node;
  }
}

module.exports = { InformationGraph };
