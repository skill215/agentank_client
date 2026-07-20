"use strict";

const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ACTION, FAST_STATUS, HARD_STATUS, TERMINAL, CHANCE, NONE_CELL } =
  require("../abi/fast-codes");
const { TERRAIN } = require("../abi/fast-codes");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { VALUE_MIN, VALUE_MAX, NONE_NODE, NODE_KIND,
  INCOMPLETE } = require("../abi/search-codes");
const { InformationGraph } = require("./graph");

class TankRootAdapter {
  constructor(options = {}) {
    this.graph = options.graph || new InformationGraph();
    this.cellChildren = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS *
      SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.chanceChildren = new Uint16Array(SEARCH_CAPACITY.MAX_CHANCE_OUTCOMES);
    this.root = NONE_NODE; this.hardRejectCells = 0; this.incompleteCells = 0;
    this.hardCheckedCells = 0; this.lazyTeleportTargetsChecked = 0;
    this.lastOutcomeIncomplete = 0; this.hotAllocationCount = 0;
  }
  reset() {
    this.graph.nodeCount = 0; this.graph.edgeUsed = 0; this.graph.overflowReason = 0;
    this.root = NONE_NODE; this.hardRejectCells = 0; this.incompleteCells = 0;
    this.hardCheckedCells = 0; this.lazyTeleportTargetsChecked = 0;
  }
  terminalValue(terminal, perspectiveSeat) {
    if (terminal === TERMINAL.DRAW) return 0;
    if (terminal === (perspectiveSeat === 0 ? TERMINAL.WIN0 : TERMINAL.WIN1)) return VALUE_MAX;
    if (terminal === TERMINAL.WIN0 || terminal === TERMINAL.WIN1) return VALUE_MIN;
    return VALUE_MIN;
  }
  evaluateOutcome(bundle, ourAction, ourArgument, enemyAction, enemyArgument,
      ownChance, enemyChance, loss, win, draw, ordinary, unknown) {
    const hard = bundle.hard.evaluate(ourAction, ourArgument, enemyAction, enemyArgument,
      ownChance, enemyChance); this.hardCheckedCells += 1; this.lastOutcomeIncomplete = 0;
    if (bundle.hard.lastFastStatus !== FAST_STATUS.APPLIED &&
        bundle.hard.lastFastStatus !== FAST_STATUS.APPLIED_TERMINAL) {
      this.lastOutcomeIncomplete = 1; return unknown;
    }
    if (hard === HARD_STATUS.REJECT_POLICY) { this.lastOutcomeIncomplete = 1; return unknown; }
    if (bundle.hard.lastTerminal && bundle.hard.lastTerminal !== TERMINAL.INCOMPLETE) {
      const value = this.terminalValue(bundle.hard.lastTerminal, bundle.hard.perspectiveSeat);
      return value === VALUE_MAX ? win : value === 0 ? draw : loss;
    }
    if (hard === HARD_STATUS.REJECT_PROVEN) return loss;
    if (hard === HARD_STATUS.INCOMPLETE) { this.lastOutcomeIncomplete = 1; return unknown; }
    return ordinary;
  }
  evaluateTeleportFamily(bundle, ourAction, ourArgument, ownChance, enemyChance,
      loss, win, draw, ordinary, unknown) {
    // One invalid request represents every invalid target. If even that branch
    // is not an immediate win, the broad ordinary/terminal child already
    // blocks a false ForcedWin and preserves full terminal bounds.
    let child = this.evaluateOutcome(bundle, ourAction, ourArgument, ACTION.CAST_TELEPORT,
      NONE_CELL, ownChance, enemyChance, loss, win, draw, ordinary, unknown);
    let incomplete = this.lastOutcomeIncomplete;
    if (child !== win) { this.lastOutcomeIncomplete = incomplete; return child; }
    const state = bundle.kernel.state; const a = state.arrays;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL]; const terrain = a[ARRAY.TERRAIN];
    for (let cell = 0; cell < state.cells; cell += 1) {
      // Requesting the star is a chance request whose legal adjacent outcomes
      // are already present as direct target states in this complete scan.
      if (cell === star || (terrain[cell] !== TERRAIN.OPEN && terrain[cell] !== TERRAIN.GRASS) ||
          cell === a[ARRAY.TANK_CELL][0] || bundle.kernel.hostileProjectileAt(1, cell)) continue;
      child = this.evaluateOutcome(bundle, ourAction, ourArgument, ACTION.CAST_TELEPORT,
        cell, ownChance, enemyChance, loss, win, draw, ordinary, unknown);
      this.lazyTeleportTargetsChecked += 1; incomplete |= this.lastOutcomeIncomplete;
      if (child !== win) { this.lastOutcomeIncomplete = incomplete; return child; }
    }
    this.lastOutcomeIncomplete = incomplete; return win;
  }
  build(bundle, ourActions, ourArguments, ourCount, enemyActions, enemyArguments, enemyCount) {
    this.reset();
    if (!bundle || !bundle.hard || ourCount < 1 || enemyCount < 1 ||
        ourCount > SEARCH_CAPACITY.MAX_OUR_ACTIONS ||
        enemyCount > SEARCH_CAPACITY.MAX_ENEMY_POLICIES) return NONE_NODE;
    const loss = this.graph.addTerminal(VALUE_MIN); const win = this.graph.addTerminal(VALUE_MAX);
    const draw = this.graph.addTerminal(0); const ordinary = this.graph.addOrdinaryLeaf();
    const unknown = this.graph.addUnknown(INCOMPLETE.HARD);
    if (unknown === NONE_NODE) return NONE_NODE;
    for (let row = 0; row < ourCount; row += 1) for (let column = 0; column < enemyCount; column += 1) {
      const ourAction = ourActions[row] || ACTION.NONE; const enemyAction = enemyActions[column] || ACTION.NONE;
      const ourArgument = ourArguments ? ourArguments[row] : NONE_CELL;
      const enemyArgument = enemyArguments ? enemyArguments[column] : NONE_CELL;
      const ownAlternatives = bundle.hard.chanceAlternativeCount(0, ourAction);
      const enemyAlternatives = bundle.hard.chanceAlternativeCount(1, enemyAction);
      const chanceCount = ownAlternatives * enemyAlternatives; let allReject = 1; let anyIncomplete = 0;
      for (let chanceIndex = 0; chanceIndex < chanceCount; chanceIndex += 1) {
        const ownChance = chanceIndex % ownAlternatives;
        const enemyChance = Math.floor(chanceIndex / ownAlternatives);
        const child = enemyAction === ACTION.CAST_TELEPORT && enemyArgument === NONE_CELL ?
          this.evaluateTeleportFamily(bundle, ourAction, ourArgument, ownChance, enemyChance,
            loss, win, draw, ordinary, unknown) :
          this.evaluateOutcome(bundle, ourAction, ourArgument, enemyAction, enemyArgument,
            ownChance, enemyChance, loss, win, draw, ordinary, unknown);
        if (this.lastOutcomeIncomplete) anyIncomplete = 1;
        if (child !== loss) allReject = 0; this.chanceChildren[chanceIndex] = child;
      }
      if (allReject) this.hardRejectCells += 1;
      if (anyIncomplete) this.incompleteCells += 1;
      const child = chanceCount === 1 ? this.chanceChildren[0] :
        this.graph.addNode(NODE_KIND.CHANCE_OUTCOME, this.chanceChildren, null,
          // The official rules expose the complete normal/reversed support for
          // stun but do not freeze its probability. Proof can quantify over the
          // support; Value must not silently assume a uniform distribution.
          { childCount: chanceCount, probabilityComplete: false });
      if (child === NONE_NODE) return NONE_NODE;
      this.cellChildren[row * enemyCount + column] = child;
    }
    this.root = this.graph.addSimultaneousFromBuffer(ourCount, enemyCount,
      this.cellChildren, 0, 0);
    return this.root;
  }
}

module.exports = { TankRootAdapter };
