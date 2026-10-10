'use strict';
const assert = require('node:assert/strict');
const { ACTION } = require('../../../engine-v2/src/abi/fast-codes');
const SPECS = Object.freeze([
  { id: 'R21', mode: 'positive-half', hypothesis: 'Halve only positive transition rewards; preserve every negative penalty.' },
  { id: 'R22', mode: 'positive-zero', hypothesis: 'Remove only positive transition rewards; preserve every negative penalty.' },
  { id: 'R23', mode: 'fire-half', hypothesis: 'Halve only the signed FIRE transition score.' },
  { id: 'R24', mode: 'fire-zero', hypothesis: 'Remove only the signed FIRE transition score.' },
  { id: 'R25', mode: 'go-edge-zero', hypothesis: 'Remove only the signed GO edge transition score.' },
  { id: 'R26', mode: 'bomb-positive-zero', hypothesis: 'Remove positive THROW_BOMB rewards while preserving all negative bomb penalties.' },
  { id: 'R27', mode: 'turn-half', hypothesis: 'Halve the complete signed turn penalty, including reversal and streak.' },
  { id: 'R28', mode: 'turn-reversal-zero', hypothesis: 'Remove only the 110-point reversal surcharge; preserve streak and ordinary turn cost.' },
  { id: 'R29', mode: 'turn-streak-extra-zero', hypothesis: 'Remove only the 60/180/360 streak surcharge; preserve linear turn cost and reversal.' },
  { id: 'R30', mode: 'stun-cost-zero', hypothesis: 'Remove only the 20-point CAST_STUN transition cost.' }
]);
function isTurn(action) { return action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT; }
function transform(mode, before, action, previous, streak, applied = false) {
  if (mode === 'noop') return before;
  if (mode === 'reference-half') return Math.trunc(before / 2);
  if (mode === 'positive-half') return before > 0 ? Math.trunc(before / 2) : before;
  if (mode === 'positive-zero') return Math.min(0, before);
  if (mode === 'fire-half' && action === ACTION.FIRE) return Math.trunc(before / 2);
  if (mode === 'fire-zero' && action === ACTION.FIRE) return 0;
  // Applied-transition scoring currently applies only to FIRE and is disabled.
  if (applied) return before;
  if (mode === 'go-edge-zero' && action === ACTION.GO) return 0;
  if (mode === 'bomb-positive-zero' && action === ACTION.THROW_BOMB) return Math.min(0, before);
  if (mode === 'turn-half' && isTurn(action)) return Math.trunc(before / 2);
  if (mode === 'turn-reversal-zero' && isTurn(action) && isTurn(previous) && action !== previous) return before + 110;
  if (mode === 'turn-streak-extra-zero' && isTurn(action)) {
    const next = streak + 1;
    return before + (next >= 4 ? 360 : next === 3 ? 180 : next === 2 ? 60 : 0);
  }
  if (mode === 'stun-cost-zero' && action === ACTION.CAST_STUN) return 0;
  return before;
}
function install(engine, mode = 'noop') {
  assert.ok(['noop', 'reference-half'].includes(mode) || SPECS.some(s => s.mode === mode), 'UNKNOWN_PATH_VARIANT');
  const stats = { mode, calls: 0, changedValues: 0, byAction: {} };
  const utility = engine.basePolicy.policySearch.pathUtility;
  for (const method of ['scoreTransition', 'scoreAppliedTransition']) {
    const original = utility[method];
    assert.equal(typeof original, 'function');
    utility[method] = function (...args) {
      const before = original.apply(this, args);
      const after = transform(mode, before, args[1], args[3], args[4], method === 'scoreAppliedTransition');
      stats.calls++;
      stats.changedValues += Number(before !== after);
      const k = method + ':' + args[1];
      const group = stats.byAction[k] ||= { calls: 0, positive: 0, negative: 0, changed: 0, beforeSum: 0, afterSum: 0 };
      group.calls++; group.positive += Number(before > 0); group.negative += Number(before < 0);
      group.changed += Number(before !== after); group.beforeSum += before; group.afterSum += after;
      return after;
    };
  }
  return stats;
}
module.exports = { SPECS, install, transform };
