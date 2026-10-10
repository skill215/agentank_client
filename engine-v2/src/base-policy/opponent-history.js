"use strict";

const { CAPACITY } = require("../generated/fast-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { ACTION, NONE_FRAME, NONE_CELL } = require("../abi/fast-codes");

const OPPONENT_HISTORY_ACTION = Object.freeze({
  GO: 0,
  LEFT: 1,
  RIGHT: 2,
  FIRE: 3
});

class NativeBasePolicyOpponentHistory {
  constructor() {
    this.counts = new Uint32Array(4);
    this.counts.fill(1);
    this.observations = 0;
    this.goStreak = 0;
    this.stationaryStreak = 0;
    this.lastEnemyCell = NONE_CELL;
    this.lastEnemyDirection = 0;
    this.lastEnemyBullet = 0;
    this.lastEnemyVisibleFrame = NONE_FRAME;
    this.lastObservedFrame = NONE_FRAME;
    this.lastVisible = 0;
    this.expectationBlendBasisPoints = 1500;
    this.observeCount = 0;
    this.hiddenCount = 0;
    this.classifiedCount = 0;
    this.hotAllocationCount = 0;
    this.countView = { GO: 1, LEFT: 1, RIGHT: 1, FIRE: 1 };
    this.view = { opponentCounts: this.countView, opponentObservations: 0,
      opponentGoStreak: 0, enemyStationaryStreak: 0,
      expectationBlendBasisPoints: 1500 };
  }

  reset() {
    this.counts.fill(1);
    this.observations = 0;
    this.goStreak = 0;
    this.stationaryStreak = 0;
    this.lastEnemyCell = NONE_CELL;
    this.lastEnemyDirection = 0;
    this.lastEnemyBullet = 0;
    this.lastEnemyVisibleFrame = NONE_FRAME;
    this.lastObservedFrame = NONE_FRAME;
    this.lastVisible = 0;
    this.expectationBlendBasisPoints = 1500;
    this.refreshView();
  }

  observedEnemyBullet(adapter) {
    const projectiles = adapter.tracker?.projectiles;
    return projectiles && projectiles.lastObservationCount > 0 ? 1 : 0;
  }

  observedEnemyBulletNear(adapter, enemy) {
    const tracker = adapter.tracker;
    if (!tracker || enemy === NONE_CELL) return 0;
    const state = adapter.state;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (tracker.projectileActive[slot] && tracker.projectileOwner[slot] === 1 &&
          tracker.projectiles.seen[slot] &&
          Math.abs(state.x(tracker.projectileCell[slot]) - state.x(enemy)) +
            Math.abs(state.y(tracker.projectileCell[slot]) - state.y(enemy)) <= 2)
        return 1;
    return 0;
  }

  expectationBlend() {
    const total = this.counts[0] + this.counts[1] +
      this.counts[2] + this.counts[3];
    let maximum = this.counts[0];
    if (this.counts[1] > maximum) maximum = this.counts[1];
    if (this.counts[2] > maximum) maximum = this.counts[2];
    if (this.counts[3] > maximum) maximum = this.counts[3];
    const concentration = maximum * 2 > total ?
      Math.floor((maximum * 2800 + (total >> 1)) / total) - 1400 : 0;
    const value = 1500 + Math.min(1200, this.observations * 100) +
      concentration + (this.goStreak >= 3 ? 500 : 0);
    return Math.min(3500, value);
  }

  refreshView() {
    this.expectationBlendBasisPoints = this.expectationBlend();
    this.countView.GO = this.counts[0];
    this.countView.LEFT = this.counts[1];
    this.countView.RIGHT = this.counts[2];
    this.countView.FIRE = this.counts[3];
    this.view.opponentObservations = this.observations;
    this.view.opponentGoStreak = this.goStreak;
    this.view.enemyStationaryStreak = this.stationaryStreak;
    this.view.expectationBlendBasisPoints = this.expectationBlendBasisPoints;
  }

  observe(engine) {
    const adapter = engine?.adapter;
    const state = adapter?.state;
    if (!state) return 0;
    const frame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    if (frame === this.lastObservedFrame) return 1;
    if (this.lastObservedFrame !== NONE_FRAME && frame < this.lastObservedFrame)
      this.reset();
    this.lastObservedFrame = frame;
    this.observeCount += 1;
    const bullet = this.observedEnemyBullet(adapter);
    if (!adapter.enemyVisible) {
      this.hiddenCount += 1;
      this.lastEnemyBullet = bullet;
      this.lastVisible = 0;
      this.refreshView();
      return 1;
    }
    const a = state.arrays;
    const cell = a[ARRAY.TANK_CELL][1];
    const direction = a[ARRAY.TANK_DIR][1];
    let observed = -1;
    const consecutive = this.lastVisible &&
      this.lastEnemyVisibleFrame !== NONE_FRAME &&
      frame === this.lastEnemyVisibleFrame + 1;
    if (consecutive && this.lastEnemyCell !== NONE_CELL) {
      if (cell !== this.lastEnemyCell) {
        observed = OPPONENT_HISTORY_ACTION.GO;
        this.stationaryStreak = 0;
      } else if (direction !== this.lastEnemyDirection) {
        this.stationaryStreak += 1;
        if (direction === ((this.lastEnemyDirection + 3) & 3))
          observed = OPPONENT_HISTORY_ACTION.LEFT;
        else if (direction === ((this.lastEnemyDirection + 1) & 3))
          observed = OPPONENT_HISTORY_ACTION.RIGHT;
      } else if (bullet && !this.lastEnemyBullet &&
          this.observedEnemyBulletNear(adapter, cell)) {
        this.stationaryStreak += 1;
        observed = OPPONENT_HISTORY_ACTION.FIRE;
      } else this.stationaryStreak += 1;
    }
    if (observed >= 0) {
      this.counts[observed] += 1;
      this.observations += 1;
      this.classifiedCount += 1;
      if (observed === OPPONENT_HISTORY_ACTION.GO) this.goStreak += 1;
      else this.goStreak = 0;
    }
    this.lastEnemyCell = cell;
    this.lastEnemyDirection = direction;
    this.lastEnemyBullet = bullet;
    this.lastEnemyVisibleFrame = frame;
    this.lastVisible = 1;
    this.refreshView();
    return 1;
  }

  contextView() { return this.view; }

  summary() {
    return { counts: Array.from(this.counts), observations: this.observations,
      goStreak: this.goStreak, stationaryStreak: this.stationaryStreak,
      expectationBlendBasisPoints: this.expectationBlendBasisPoints,
      observeCount: this.observeCount, hiddenCount: this.hiddenCount,
      classifiedCount: this.classifiedCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { OPPONENT_HISTORY_ACTION, NativeBasePolicyOpponentHistory };
