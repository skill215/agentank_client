'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { ACTION } = require('../../engine-v2/src/abi/fast-codes');
const { ARRAY } = require('../../engine-v2/src/state/fast-state');
const { NativeBasePolicyPathUtility } = require('../../engine-v2/src/base-policy-specialized/path-utility');
const { install, SPECS } = require('../../tools/agentank/diagnostics/turn-schedule-variants');
const { install: priorInstall } = require('../../tools/agentank/diagnostics/path-component-variants');
const { chooseCohort } = require('../../tools/agentank/diagnostics/turn-schedule-campaign');
function utility(mode, installer = install) {
  const p = new NativeBasePolicyPathUtility(); p.fireTransitionUtility = () => 401;
  p.goEdgeUtility = () => -120; p.bombPlacementUtility = () => -24000;
  installer({ basePolicy: { policySearch: { pathUtility: p } } }, mode); return p;
}
function state(stars = [0, 1]) { const arrays = []; arrays[ARRAY.TANK_STARS] = stars; return { arrays }; }
const score = (p, n, previous = ACTION.TURN_LEFT, top = 1, stars) => p.scoreTransition(state(stars), ACTION.TURN_LEFT, ACTION.GO, previous, n - 1, top);
test('turn tier ablations affect only their declared streak lengths', () => {
  const b = utility('noop');
  for (const [mode, at] of [['second-turn-zero', 2], ['third-turn-zero', 3], ['fourth-plus-zero', 4]]) {
    const p = utility(mode);
    for (let n = 1; n <= 6; n++) {
      const active = at === 4 ? n >= 4 : n === at;
      assert.equal(score(p, n) - score(b, n), active ? (at === 2 ? 60 : at === 3 ? 180 : 360) : 0);
    }
  }
});
test('half and capped surcharge preserve the original linear and reversal costs', () => {
  const half = utility('streak-half'), cap = utility('streak-cap60');
  assert.equal(score(half, 4, ACTION.TURN_RIGHT), -342);
  assert.equal(score(cap, 4, ACTION.TURN_RIGHT), -222);
  assert.equal(score(cap, 2), score(utility('noop'), 2));
});
test('same-direction and reversal experiments distinguish turning around from reversing a turn', () => {
  const b = utility('noop'), same = utility('same-direction-zero'), reverse = utility('reversal-half');
  assert.equal(score(same, 3), -42); assert.equal(score(same, 3, ACTION.TURN_RIGHT), score(b, 3, ACTION.TURN_RIGHT));
  assert.equal(score(reverse, 3), score(b, 3)); assert.equal(score(reverse, 3, ACTION.TURN_RIGHT) - score(b, 3, ACTION.TURN_RIGHT), 55);
});
test('root and deep interventions partition the true top boundary', () => {
  const root = utility('root-streak-zero'), deep = utility('deep-streak-zero'), b = utility('noop');
  assert.equal(score(root, 3, ACTION.TURN_LEFT, 1), -42); assert.equal(score(deep, 3, ACTION.TURN_LEFT, 1), score(b, 3));
  assert.equal(score(root, 3, ACTION.TURN_LEFT, 2), score(b, 3)); assert.equal(score(deep, 3, ACTION.TURN_LEFT, 2), -42);
});
test('star condition uses simulated own/enemy scores and preserves non-turn safety penalties', () => {
  const p = utility('trailing-streak-zero'), b = utility('noop');
  assert.equal(score(p, 3, ACTION.TURN_LEFT, 1, [0, 1]), -42);
  for (const stars of [[1, 1], [2, 1]]) assert.equal(score(p, 3, ACTION.TURN_LEFT, 1, stars), score(b, 3));
  for (const spec of SPECS) {
    const q = utility(spec.mode);
    assert.equal(q.scoreTransition({}, ACTION.THROW_BOMB, ACTION.GO, ACTION.TURN_RIGHT, 3, 2), -24000);
    assert.equal(q.scoreAppliedTransition({}, ACTION.FIRE, ACTION.GO, ACTION.TURN_RIGHT, 0xffffffff), 0);
  }
});
test('reference adapters reproduce prior R15/R29 utility behavior without sharing instances', () => {
  for (const [mode, prior] of [['reference-half', 'reference-half'], ['reference-r29', 'turn-streak-extra-zero']]) {
    const a = utility(mode), b = utility(prior, priorInstall);
    for (let n = 1; n <= 6; n++) for (const previous of [ACTION.GO, ACTION.TURN_LEFT, ACTION.TURN_RIGHT]) assert.equal(score(a, n, previous), score(b, n, previous));
    assert.equal(a.scoreTransition({}, ACTION.THROW_BOMB, 0, 0, 0), b.scoreTransition({}, ACTION.THROW_BOMB, 0, 0, 0));
  }
  assert.equal(score(utility('noop'), 2), -92); assert.equal(SPECS.length, 10); assert.throws(() => utility('typo'));
});
test('refreshed development and validation are deterministic, mutually disjoint and exclude historical map aliases', () => {
  const scenes = Array.from({ length: 500 }, (_, i) => ({ matchUrlId: 's' + i, map: [[i]] }));
  scenes.push({ matchUrlId: 'alias', map: [[3]] });
  const excluded = ['s0', 's1', 's2', 's3']; const dev = chooseCohort(scenes, excluded, 'bp391-development-v1', 64);
  const val = chooseCohort(scenes, [...excluded, ...dev], 'bp391-validation-v1', 128);
  assert.equal(dev.length, 64); assert.equal(val.length, 128); assert.deepEqual(dev, chooseCohort(scenes, excluded, 'bp391-development-v1', 64));
  for (const id of [...excluded, 'alias']) { assert.ok(!dev.includes(id)); assert.ok(!val.includes(id)); }
  for (const id of dev) assert.ok(!val.includes(id));
});
