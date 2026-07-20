"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { CAPACITY } = require("../generated/fast-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { FAST_STATUS, HARD_STATUS, TERMINAL, NONE_CELL } = require("../abi/fast-codes");
const { VALUE_MIN, VALUE_MAX, NONE_NODE, SEARCH_STATUS, LEAF_KIND,
  INCOMPLETE } = require("../abi/search-codes");
const { InformationGraph } = require("./graph");
const { RiskProfile } = require("./risk");

class PhysicalTreeBuilder {
  constructor(options = {}) {
    this.graph = options.graph || new InformationGraph(); this.riskProfile = options.riskProfile || new RiskProfile();
    const frames = SEARCH_CAPACITY.MAX_DECISION_DEPTH + 1;
    this.frameDepth = new Uint8Array(frames); this.frameCursor = new Uint16Array(frames);
    this.frameChildStart = new Uint16Array(frames); this.frameBranchMark = new Uint32Array(frames);
    this.frameHashLo = new Uint32Array(frames); this.frameHashHi = new Uint32Array(frames);
    this.frameRiskClass = new Uint8Array(frames); this.childNodes = new Uint16Array(SEARCH_CAPACITY.MAX_EDGES);
    this.root = NONE_NODE; this.childUsed = 0; this.hardCheckedCells = 0; this.incompleteCells = 0;
    this.rootMismatchCount = 0; this.highWaterDepth = 0; this.highWaterNodes = 0;
    this.highWaterEdges = 0; this.lastStatus = SEARCH_STATUS.INCOMPLETE; this.hotAllocationCount = 0;
  }
  reset() {
    this.graph.nodeCount = 0; this.graph.edgeUsed = 0; this.graph.overflowReason = 0;
    this.root = NONE_NODE; this.childUsed = 0; this.hardCheckedCells = 0; this.incompleteCells = 0;
    this.rootMismatchCount = 0; this.highWaterDepth = 0; this.highWaterNodes = 0;
    this.highWaterEdges = 0; this.lastStatus = SEARCH_STATUS.INCOMPLETE;
  }
  riskClass(bundle) {
    const a = bundle.state.arrays; const scalar = a[ARRAY.SCALAR]; const perspective = bundle.hard.perspectiveSeat;
    const starDelta = a[ARRAY.TANK_STARS][perspective] - a[ARRAY.TANK_STARS][perspective ^ 1];
    const frames = 127 - scalar[SCALAR.RECORD];
    return this.riskProfile.classify(starDelta, frames, frames, 1, 0, 0);
  }
  terminalValue(terminal, perspective) {
    if (terminal === TERMINAL.DRAW) return 0;
    if (terminal === (perspective === 0 ? TERMINAL.WIN0 : TERMINAL.WIN1)) return VALUE_MAX;
    return VALUE_MIN;
  }
  nodeForValue(value, win, loss, draw) { return value === VALUE_MAX ? win : value === 0 ? draw : loss; }
  initializeFrame(top, depth, bundle, jointCount) {
    if (this.childUsed + jointCount > this.childNodes.length) return 0;
    this.frameDepth[top] = depth; this.frameCursor[top] = 0;
    this.frameChildStart[top] = this.childUsed; this.childUsed += jointCount;
    this.frameHashLo[top] = bundle.state.hashLo; this.frameHashHi[top] = bundle.state.hashHi;
    this.frameRiskClass[top] = this.riskClass(bundle);
    if (top > this.highWaterDepth) this.highWaterDepth = top; return 1;
  }
  restoreBranch(bundle, top) {
    bundle.state.undoTo(this.frameBranchMark[top]);
    if (bundle.state.hashLo !== this.frameHashLo[top] || bundle.state.hashHi !== this.frameHashHi[top]) {
      this.rootMismatchCount += 1; return 0;
    }
    return 1;
  }
  unwindToRoot(bundle, frameTop) {
    for (let level = frameTop - 1; level >= 0; level -= 1)
      bundle.state.undoTo(this.frameBranchMark[level]);
  }
  build(bundle, ourActions, ourArguments, ourCount, enemyActions, enemyArguments, enemyCount, depth) {
    this.reset();
    if (!bundle || !bundle.kernel || !bundle.hazard || !bundle.hard || depth < 0 ||
        depth > Math.min(SEARCH_CAPACITY.MAX_DECISION_DEPTH, CAPACITY.MAX_ACTIVE_TRANSITIONS) ||
        ourCount < 1 || enemyCount < 1 || ourCount > SEARCH_CAPACITY.MAX_OUR_ACTIONS ||
        enemyCount > SEARCH_CAPACITY.MAX_ENEMY_POLICIES) return SEARCH_STATUS.INVALID;
    const win = this.graph.addTerminal(VALUE_MAX); const loss = this.graph.addTerminal(VALUE_MIN);
    const draw = this.graph.addTerminal(0); const ordinary = this.graph.addOrdinaryLeaf();
    const unknown = this.graph.addUnknown(INCOMPLETE.HARD);
    if (unknown === NONE_NODE) return SEARCH_STATUS.CAPACITY;
    if (depth === 0) { this.root = ordinary; this.lastStatus = SEARCH_STATUS.COMPLETE; return this.lastStatus; }
    const jointCount = ourCount * enemyCount; let top = 0;
    if (!this.initializeFrame(0, depth, bundle, jointCount)) return SEARCH_STATUS.CAPACITY;
    while (top >= 0) {
      const cursor = this.frameCursor[top];
      if (cursor >= jointCount) {
        const node = this.graph.addSimultaneousFromBuffer(ourCount, enemyCount, this.childNodes,
          this.frameChildStart[top], this.frameRiskClass[top]);
        if (node === NONE_NODE) { this.unwindToRoot(bundle, top); this.lastStatus = SEARCH_STATUS.CAPACITY;
          return this.lastStatus; }
        if (this.graph.nodeCount > this.highWaterNodes) this.highWaterNodes = this.graph.nodeCount;
        if (this.graph.edgeUsed > this.highWaterEdges) this.highWaterEdges = this.graph.edgeUsed;
        top -= 1;
        if (top < 0) { this.root = node; break; }
        if (!this.restoreBranch(bundle, top)) { this.unwindToRoot(bundle, top);
          this.lastStatus = SEARCH_STATUS.INCOMPLETE; return this.lastStatus; }
        this.childNodes[this.frameChildStart[top] + this.frameCursor[top] - 1] = node; continue;
      }
      const row = Math.floor(cursor / enemyCount); const column = cursor - row * enemyCount;
      this.frameCursor[top] = cursor + 1;
      const ourArgument = ourArguments ? ourArguments[row] : NONE_CELL;
      const enemyArgument = enemyArguments ? enemyArguments[column] : NONE_CELL;
      const perspective = bundle.hard.perspectiveSeat;
      const action0 = perspective === 0 ? ourActions[row] : enemyActions[column];
      const argument0 = perspective === 0 ? ourArgument : enemyArgument;
      const action1 = perspective === 0 ? enemyActions[column] : ourActions[row];
      const argument1 = perspective === 0 ? enemyArgument : ourArgument;
      const status = bundle.kernel.applyFrame(action0, argument0, action1, argument1);
      const mark = bundle.kernel.lastMark; this.frameBranchMark[top] = mark; this.hardCheckedCells += 1;
      let child = NONE_NODE; let applied = 0;
      if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
        child = unknown; this.incompleteCells += 1;
      } else {
        applied = 1; const hard = bundle.hard.classifyApplied();
        const terminal = bundle.hard.lastTerminal;
        if (hard === HARD_STATUS.REJECT_POLICY) { child = unknown; this.incompleteCells += 1; }
        else if (terminal) child = this.nodeForValue(this.terminalValue(terminal, perspective), win, loss, draw);
        else {
          if (hard === HARD_STATUS.REJECT_PROVEN) child = loss;
          else if (hard === HARD_STATUS.INCOMPLETE) { child = unknown; this.incompleteCells += 1; }
          else if (this.frameDepth[top] === 1) child = ordinary;
        }
      }
      if (child !== NONE_NODE) {
        this.childNodes[this.frameChildStart[top] + cursor] = child;
        if (applied && !this.restoreBranch(bundle, top)) {
          this.unwindToRoot(bundle, top);
          this.lastStatus = SEARCH_STATUS.INCOMPLETE; return this.lastStatus;
        }
        continue;
      }
      if (top + 1 >= this.frameDepth.length || !this.initializeFrame(top + 1,
          this.frameDepth[top] - 1, bundle, jointCount)) {
        if (applied) this.restoreBranch(bundle, top); this.unwindToRoot(bundle, top);
        this.lastStatus = SEARCH_STATUS.CAPACITY;
        return this.lastStatus;
      }
      top += 1;
    }
    this.lastStatus = this.rootMismatchCount === 0 && this.root !== NONE_NODE ?
      SEARCH_STATUS.COMPLETE : SEARCH_STATUS.INCOMPLETE; return this.lastStatus;
  }
}

module.exports = { PhysicalTreeBuilder };
