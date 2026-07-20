"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { VALUE_MIN, VALUE_MAX, NODE_KIND, PROOF_GOAL, PROOF_STATUS, PROOF_MODE,
  PROOF_COVERAGE_REQUIRED, COVERAGE, NONE_NODE, PN_INF } = require("../abi/search-codes");
const { saturatedAdd } = require("./fixed-math");
const { CoverageArena } = require("./arenas");

function combineStatus(isOr, childStatus, start, count) {
  if (isOr) {
    let allDisproven = 1;
    for (let index = 0; index < count; index += 1) {
      const status = childStatus[start + index]; if (status === PROOF_STATUS.PROVEN) return PROOF_STATUS.PROVEN;
      if (status !== PROOF_STATUS.DISPROVEN) allDisproven = 0;
    }
    return allDisproven ? PROOF_STATUS.DISPROVEN : PROOF_STATUS.UNKNOWN;
  }
  let allProven = 1;
  for (let index = 0; index < count; index += 1) {
    const status = childStatus[start + index]; if (status === PROOF_STATUS.DISPROVEN) return PROOF_STATUS.DISPROVEN;
    if (status !== PROOF_STATUS.PROVEN) allProven = 0;
  }
  return allProven ? PROOF_STATUS.PROVEN : PROOF_STATUS.UNKNOWN;
}

class ProofSearch {
  constructor(graph, coverageArena = new CoverageArena()) {
    this.graph = graph; this.coverageArena = coverageArena; const size = graph.maxNodes;
    this.status = new Uint8Array(size); this.visit = new Uint8Array(size);
    this.mask = new Uint16Array(size); this.pn = new Uint32Array(size); this.dn = new Uint32Array(size);
    this.stackNode = new Uint16Array(SEARCH_CAPACITY.MAX_PROOF_FRAMES);
    this.stackCursor = new Uint16Array(SEARCH_CAPACITY.MAX_PROOF_FRAMES);
    this.childStatus = new Uint8Array(Math.max(graph.maxEdges, graph.maxNodes));
    this.counts = new Uint16Array(6); this.lastStatus = PROOF_STATUS.UNKNOWN;
    this.lastCoverageHandle = NONE_NODE; this.lastRoot = NONE_NODE; this.lastGoal = 0;
    this.visitedNodes = 0; this.interruptedCount = 0; this.capacityFailureCount = 0;
    this.cycleCount = 0; this.dfpnExpanded = 0; this.hotAllocationCount = 0;
    this.traceLo = 0; this.traceHi = 0;
  }

  terminalStatus(node, goal) {
    const value = this.graph.leafLower[node];
    if (goal === PROOF_GOAL.FORCED_WIN) return value === VALUE_MAX ?
      PROOF_STATUS.PROVEN : PROOF_STATUS.DISPROVEN;
    if (goal === PROOF_GOAL.FORCED_NONLOSS) return value === VALUE_MIN ?
      PROOF_STATUS.DISPROVEN : PROOF_STATUS.PROVEN;
    return value === VALUE_MIN ? PROOF_STATUS.PROVEN : PROOF_STATUS.DISPROVEN;
  }

  isOrNode(kind, goal) {
    if (kind === NODE_KIND.OUR_DECISION) return goal !== PROOF_GOAL.FORCED_LOSS;
    if (kind === NODE_KIND.ENEMY_DECISION) return goal === PROOF_GOAL.FORCED_LOSS;
    return false;
  }

  combineProofNumbers(node, isOr) {
    const graph = this.graph; const start = graph.edgeStart[node]; const count = graph.edgeCount[node];
    let pn = isOr ? PN_INF : 0; let dn = isOr ? 0 : PN_INF;
    for (let index = 0; index < count; index += 1) {
      const child = graph.edgeChild[start + index];
      if (isOr) { if (this.pn[child] < pn) pn = this.pn[child]; dn = saturatedAdd(dn, this.dn[child], PN_INF); }
      else { pn = saturatedAdd(pn, this.pn[child], PN_INF); if (this.dn[child] < dn) dn = this.dn[child]; }
    }
    this.pn[node] = pn; this.dn[node] = dn;
  }

  evaluateSimultaneous(node, goal) {
    const graph = this.graph; const rows = graph.rows[node]; const columns = graph.columns[node];
    const start = graph.edgeStart[node]; if (rows < 1 || columns < 1 || rows * columns !== graph.edgeCount[node])
      return PROOF_STATUS.UNKNOWN;
    const outerCount = goal === PROOF_GOAL.FORCED_LOSS ? columns : rows;
    const innerCount = goal === PROOF_GOAL.FORCED_LOSS ? rows : columns;
    let outerAllDisproven = 1; let outerPn = PN_INF; let outerDn = 0;
    for (let outer = 0; outer < outerCount; outer += 1) {
      let innerAllProven = 1; let innerDisproven = 0; let innerPn = 0; let innerDn = PN_INF;
      for (let inner = 0; inner < innerCount; inner += 1) {
        const cell = goal === PROOF_GOAL.FORCED_LOSS ? inner * columns + outer : outer * columns + inner;
        const child = graph.edgeChild[start + cell]; const status = this.status[child];
        if (status !== PROOF_STATUS.PROVEN) innerAllProven = 0;
        if (status === PROOF_STATUS.DISPROVEN) innerDisproven = 1;
        innerPn = saturatedAdd(innerPn, this.pn[child], PN_INF);
        if (this.dn[child] < innerDn) innerDn = this.dn[child];
      }
      const innerStatus = innerDisproven ? PROOF_STATUS.DISPROVEN :
        innerAllProven ? PROOF_STATUS.PROVEN : PROOF_STATUS.UNKNOWN;
      if (innerStatus === PROOF_STATUS.PROVEN) {
        this.pn[node] = 0; this.dn[node] = PN_INF; return PROOF_STATUS.PROVEN;
      }
      if (innerStatus !== PROOF_STATUS.DISPROVEN) outerAllDisproven = 0;
      if (innerPn < outerPn) outerPn = innerPn; outerDn = saturatedAdd(outerDn, innerDn, PN_INF);
    }
    this.pn[node] = outerPn; this.dn[node] = outerDn;
    return outerAllDisproven ? PROOF_STATUS.DISPROVEN : PROOF_STATUS.UNKNOWN;
  }

  evaluateNode(node, goal) {
    const graph = this.graph; const kind = graph.kind[node]; let mask = graph.coverageMask[node];
    const start = graph.edgeStart[node]; const count = graph.edgeCount[node];
    for (let index = 0; index < count; index += 1) mask &= this.mask[graph.edgeChild[start + index]];
    this.mask[node] = mask; let status = PROOF_STATUS.UNKNOWN;
    if (kind === NODE_KIND.TERMINAL) status = this.terminalStatus(node, goal);
    else if (count === 0) {
      this.pn[node] = 1; this.dn[node] = 1; status = PROOF_STATUS.UNKNOWN;
    }
    else if (kind === NODE_KIND.SIMULTANEOUS) status = this.evaluateSimultaneous(node, goal);
    else if (kind === NODE_KIND.OUR_DECISION || kind === NODE_KIND.ENEMY_DECISION) {
      for (let index = 0; index < count; index += 1)
        this.childStatus[index] = this.status[graph.edgeChild[start + index]];
      const isOr = this.isOrNode(kind, goal); status = combineStatus(isOr, this.childStatus, 0, count);
      this.combineProofNumbers(node, isOr);
    } else if (kind === NODE_KIND.HIDDEN_WORLD || kind === NODE_KIND.CHANCE_OUTCOME ||
        kind === NODE_KIND.OBSERVATION_SPLIT) {
      for (let index = 0; index < count; index += 1)
        this.childStatus[index] = this.status[graph.edgeChild[start + index]];
      status = combineStatus(false, this.childStatus, 0, count); this.combineProofNumbers(node, false);
    } else if (kind === NODE_KIND.AUTOMATIC && count === 1) {
      const child = graph.edgeChild[start]; status = this.status[child]; this.pn[node] = this.pn[child];
      this.dn[node] = this.dn[child];
    }
    if (kind === NODE_KIND.TERMINAL) {
      this.pn[node] = status === PROOF_STATUS.PROVEN ? 0 : PN_INF;
      this.dn[node] = status === PROOF_STATUS.PROVEN ? PN_INF : 0;
    }
    if (status !== PROOF_STATUS.UNKNOWN &&
        ((mask & PROOF_COVERAGE_REQUIRED) !== PROOF_COVERAGE_REQUIRED ||
          graph.assumptionMask[node] !== 0)) {
      status = PROOF_STATUS.UNKNOWN; this.pn[node] = 1; this.dn[node] = 1;
    }
    if (status === PROOF_STATUS.UNKNOWN && this.pn[node] === 0 && this.dn[node] === 0) {
      this.pn[node] = 1; this.dn[node] = 1;
    }
    this.status[node] = status;
    this.traceLo = ((this.traceLo ^ node ^ (kind << 16) ^ status) * 16777619) >>> 0;
    this.traceHi = ((this.traceHi ^ mask ^ this.pn[node] ^ this.dn[node]) * 2246822519) >>> 0;
  }

  countNode(node) {
    const kind = this.graph.kind[node]; this.counts[0] += 1;
    if (kind === NODE_KIND.OUR_DECISION) this.counts[1] += this.graph.edgeCount[node];
    else if (kind === NODE_KIND.HIDDEN_WORLD) this.counts[2] += this.graph.edgeCount[node];
    else if (kind === NODE_KIND.CHANCE_OUTCOME) this.counts[3] += this.graph.edgeCount[node];
    else if (kind === NODE_KIND.ENEMY_DECISION || kind === NODE_KIND.SIMULTANEOUS)
      this.counts[4] += kind === NODE_KIND.SIMULTANEOUS ? this.graph.columns[node] : this.graph.edgeCount[node];
    else if (kind === NODE_KIND.OBSERVATION_SPLIT) this.counts[5] += this.graph.edgeCount[node];
  }

  solve(root, goal, nodeBudget = SEARCH_CAPACITY.MAX_NODES, mode = PROOF_MODE.AND_OR_DFS) {
    const graph = this.graph;
    if (!Number.isInteger(root) || root < 0 || root >= graph.nodeCount ||
        !Number.isInteger(goal) || goal < PROOF_GOAL.FORCED_WIN ||
        goal > PROOF_GOAL.FORCED_LOSS || !Number.isInteger(nodeBudget) || nodeBudget < 0 ||
        (mode !== PROOF_MODE.AND_OR_DFS && mode !== PROOF_MODE.DFPN)) return PROOF_STATUS.UNKNOWN;
    this.visit.fill(0, 0, graph.nodeCount); this.status.fill(PROOF_STATUS.UNKNOWN, 0, graph.nodeCount);
    this.mask.fill(0, 0, graph.nodeCount); this.pn.fill(1, 0, graph.nodeCount);
    this.dn.fill(1, 0, graph.nodeCount); this.counts.fill(0); this.visitedNodes = 0;
    this.traceLo = 0x811c9dc5; this.traceHi = 0x9e3779b9; let top = 0; let interrupted = 0;
    this.stackNode[0] = root; this.stackCursor[0] = 0;
    while (top >= 0) {
      const node = this.stackNode[top];
      if (this.visit[node] === 0) { this.visit[node] = 1; this.stackCursor[top] = 0; }
      const cursor = this.stackCursor[top]; const count = graph.edgeCount[node]; const start = graph.edgeStart[node];
      if (cursor < count) {
        const child = graph.edgeChild[start + cursor]; this.stackCursor[top] = cursor + 1;
        if (this.visit[child] === 0) {
          if (top + 1 >= this.stackNode.length) { interrupted = 1; this.capacityFailureCount += 1; break; }
          top += 1; this.stackNode[top] = child; this.stackCursor[top] = 0; continue;
        }
        if (this.visit[child] === 1) { interrupted = 1; this.cycleCount += 1; break; }
        continue;
      }
      if (this.visitedNodes >= nodeBudget) { interrupted = 1; this.interruptedCount += 1; break; }
      this.evaluateNode(node, goal); this.countNode(node); this.visit[node] = 2;
      this.visitedNodes += 1; if (mode === PROOF_MODE.DFPN) this.dfpnExpanded += 1; top -= 1;
    }
    if (interrupted) {
      this.status[root] = PROOF_STATUS.UNKNOWN; this.mask[root] &= ~COVERAGE.NO_CAPACITY_TRUNCATION;
      this.pn[root] = 1; this.dn[root] = 1;
    }
    const handle = this.coverageArena.write(goal, this.status[root], this.mask[root],
      graph.assumptionMask[root], this.counts, this.traceLo, this.traceHi);
    if (handle === NONE_NODE && this.status[root] === PROOF_STATUS.PROVEN) {
      this.status[root] = PROOF_STATUS.UNKNOWN; this.capacityFailureCount += 1;
    }
    this.lastCoverageHandle = handle; this.lastStatus = this.status[root]; this.lastRoot = root;
    this.lastGoal = goal; return this.lastStatus;
  }

  refuteAction(actionChild, goal, nodeBudget = SEARCH_CAPACITY.MAX_NODES) {
    const status = this.solve(actionChild, goal, nodeBudget, PROOF_MODE.AND_OR_DFS);
    return status === PROOF_STATUS.DISPROVEN && this.lastCoverageHandle !== NONE_NODE &&
      (this.mask[actionChild] & PROOF_COVERAGE_REQUIRED) === PROOF_COVERAGE_REQUIRED ?
        PROOF_STATUS.ACTION_REFUTED : PROOF_STATUS.UNKNOWN;
  }
}

module.exports = { ProofSearch, combineStatus };
