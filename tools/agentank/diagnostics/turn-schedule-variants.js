'use strict';
const assert = require('node:assert/strict');
const { ACTION } = require('../../../engine-v2/src/abi/fast-codes');
const { ARRAY } = require('../../../engine-v2/src/state/fast-state');
const SPECS = Object.freeze([
  { id: 'R31', mode: 'streak-half', hypothesis: 'Halve only the 60/180/360 streak surcharge.' },
  { id: 'R32', mode: 'streak-cap60', hypothesis: 'Cap the streak surcharge at 60 while retaining linear and reversal costs.' },
  { id: 'R33', mode: 'second-turn-zero', hypothesis: 'Remove only the surcharge on exactly the second consecutive turn.' },
  { id: 'R34', mode: 'third-turn-zero', hypothesis: 'Remove only the surcharge on exactly the third consecutive turn.' },
  { id: 'R35', mode: 'fourth-plus-zero', hypothesis: 'Remove only the surcharge on the fourth and later consecutive turns.' },
  { id: 'R36', mode: 'reversal-half', hypothesis: 'Halve only the 110-point reversal surcharge.' },
  { id: 'R37', mode: 'same-direction-zero', hypothesis: 'Remove streak surcharge only when repeating the same turn direction.' },
  { id: 'R38', mode: 'root-streak-zero', hypothesis: 'Remove streak surcharge only at the root transition (top=1).' },
  { id: 'R39', mode: 'deep-streak-zero', hypothesis: 'Remove streak surcharge only at recursive transitions (top>1).' },
  { id: 'R40', mode: 'trailing-streak-zero', hypothesis: 'Remove streak surcharge only when behind in stars at the simulated state.' }
]);
const isTurn = a => a === ACTION.TURN_LEFT || a === ACTION.TURN_RIGHT;
const surcharge = next => next >= 4 ? 360 : next === 3 ? 180 : next === 2 ? 60 : 0;
function transform(mode, before, args, applied = false) {
  if (mode === 'noop') return before;
  if (mode === 'reference-half') return Math.trunc(before / 2);
  const [state, action, , previous, streak, top = 1] = args;
  if (applied || !isTurn(action)) return before;
  const next = streak + 1, extra = surcharge(next);
  if (mode === 'reference-r29') return before + extra;
  if (mode === 'streak-half') return before + extra / 2;
  if (mode === 'streak-cap60') return before + Math.max(0, extra - 60);
  if (mode === 'second-turn-zero' && next === 2) return before + extra;
  if (mode === 'third-turn-zero' && next === 3) return before + extra;
  if (mode === 'fourth-plus-zero' && next >= 4) return before + extra;
  if (mode === 'reversal-half' && isTurn(previous) && previous !== action) return before + 55;
  if (mode === 'same-direction-zero' && previous === action) return before + extra;
  if (mode === 'root-streak-zero' && top === 1) return before + extra;
  if (mode === 'deep-streak-zero' && top > 1) return before + extra;
  if (mode === 'trailing-streak-zero' && state.arrays[ARRAY.TANK_STARS][0] < state.arrays[ARRAY.TANK_STARS][1]) return before + extra;
  return before;
}
function install(engine, mode = 'noop') {
  assert.ok(['noop', 'reference-half', 'reference-r29'].includes(mode) || SPECS.some(s => s.mode === mode), 'UNKNOWN_TURN_VARIANT');
  const stats = { mode, calls: 0, changedValues: 0, byAction: {}, byContext: {} };
  const utility = engine.basePolicy.policySearch.pathUtility;
  for (const method of ['scoreTransition', 'scoreAppliedTransition']) {
    const original = utility[method]; assert.equal(typeof original, 'function');
    utility[method] = function (...args) {
      const before = original.apply(this, args), applied = method === 'scoreAppliedTransition';
      const after = transform(mode, before, args, applied);
      stats.calls++; stats.changedValues += Number(before !== after);
      const actionKey = method + ':' + args[1];
      const group = stats.byAction[actionKey] ||= { calls: 0, changed: 0, beforeSum: 0, afterSum: 0 };
      group.calls++; group.changed += Number(before !== after); group.beforeSum += before; group.afterSum += after;
      if (!applied && isTurn(args[1])) {
        const context = (args[5] > 1 ? 'deep' : 'root') + ':' + Math.min(4, args[4] + 1) + ':' + (args[3] === args[1] ? 'same' : 'other');
        const counts = stats.byContext[context] ||= { calls: 0, changed: 0 };
        counts.calls++; counts.changed += Number(before !== after);
      }
      return after;
    };
  }
  return stats;
}
module.exports = { SPECS, install, transform, surcharge };
