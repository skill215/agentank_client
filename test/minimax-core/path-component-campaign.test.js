'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { ACTION } = require('../../engine-v2/src/abi/fast-codes');
const { NativeBasePolicyPathUtility } = require('../../engine-v2/src/base-policy-specialized/path-utility');
const { install, SPECS } = require('../../tools/agentank/diagnostics/path-component-variants');
const { chooseValidation, loadCheckpoint, jsonHash } = require('../../tools/agentank/diagnostics/path-component-campaign');
function engine(mode) {
  const p = new NativeBasePolicyPathUtility();
  p.fireTransitionUtility = () => 401; p.goEdgeUtility = () => -120; p.bombPlacementUtility = () => -24000;
  const e = { basePolicy: { policySearch: { pathUtility: p } } };
  const stats = install(e, mode); return { p, stats };
}
const score = (p, action, previous = ACTION.GO, streak = 0) => p.scoreTransition({}, action, ACTION.GO, previous, streak);
test('positive-only interventions preserve negative bomb escape and GO penalties', () => {
  for (const mode of ['positive-half', 'positive-zero', 'bomb-positive-zero']) {
    const { p } = engine(mode); assert.equal(score(p, ACTION.THROW_BOMB), -24000); assert.equal(score(p, ACTION.GO), -120);
  }
  assert.equal(score(engine('positive-half').p, ACTION.FIRE), 200);
  assert.equal(score(engine('positive-zero').p, ACTION.FIRE), 0);
});
test('single-action path variants leave other channels unchanged and do not leak across instances', () => {
  const a = engine('fire-zero'), b = engine('noop');
  assert.equal(score(a.p, ACTION.FIRE), 0); assert.equal(score(b.p, ACTION.FIRE), 401);
  assert.equal(score(a.p, ACTION.THROW_BOMB), -24000); assert.equal(score(a.p, ACTION.CAST_STUN), -20);
  const bomb = engine('bomb-positive-zero'); bomb.p.bombPlacementUtility = () => 190;
  assert.equal(score(bomb.p, ACTION.THROW_BOMB), 0); assert.equal(score(bomb.p, ACTION.FIRE), 401);
  assert.equal(SPECS.length, 10); assert.throws(() => engine('unknown'));
});
test('turn reversal ablation preserves linear and escalating streak costs', () => {
  const { p } = engine('turn-reversal-zero');
  assert.equal(score(p, ACTION.TURN_LEFT, ACTION.TURN_RIGHT, 3), score(p, ACTION.TURN_LEFT, ACTION.TURN_LEFT, 3));
  assert.equal(score(p, ACTION.TURN_LEFT, ACTION.TURN_RIGHT, 3), -412);
  assert.equal(score(p, ACTION.TURN_LEFT, ACTION.TURN_RIGHT, 0), -22);
  assert.equal(score(p, ACTION.GO, ACTION.TURN_RIGHT, 3), -120);
});
test('streak surcharge ablation preserves linear cost and reversal separately', () => {
  const { p } = engine('turn-streak-extra-zero');
  assert.equal(score(p, ACTION.TURN_LEFT, ACTION.TURN_RIGHT, 3), -162);
  assert.equal(score(p, ACTION.TURN_LEFT, ACTION.TURN_LEFT, 3), -52);
  assert.equal(score(p, ACTION.TURN_LEFT, ACTION.TURN_LEFT, 4), -62);
});
test('applied-transition parameters cannot trigger turn or stun adjustments', () => {
  for (const mode of SPECS.map(x => x.mode)) {
    const { p } = engine(mode);
    assert.equal(p.scoreAppliedTransition({}, ACTION.FIRE, ACTION.TURN_LEFT, ACTION.TURN_RIGHT, 0xffffffff), 0);
  }
});
test('validation is deterministic and excludes every prior map, including aliases', () => {
  const scenes = Array.from({ length: 400 }, (_, i) => ({ matchUrlId: 's' + i, map: [[i]] }));
  scenes.push({ matchUrlId: 'alias', map: [[3]] });
  const excluded = ['s0', 's1', 's2', 's3']; const selected = chooseValidation(scenes, excluded);
  assert.equal(selected.length, 128); assert.deepEqual(selected, chooseValidation(scenes, excluded));
  for (const id of [...excluded, 'alias']) assert.ok(!selected.includes(id));
});
test('checkpoint accepts complete checksummed rows and identifies only a torn trailing fragment', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp390-checkpoint-'));
  try {
    const file = path.join(dir, 'rows'), jobs = [{ id: 's', seat: 0, mode: 'noop' }], fingerprints = new Map([['s', 'fp']]);
    const row = { matchUrlId: 's', candidateSeat: 0, scenarioFingerprint: 'fp', variant: { mode: 'noop' },
      candidate: { errorCount: 0, timeoutCount: 0 }, control: { errorCount: 0, timeoutCount: 0 }, candidateEngine: { rootRestoreFailures: 0 } };
    const line = JSON.stringify({ index: 0, row, sha256: jsonHash(row) }) + '\n';
    fs.writeFileSync(file, line + '{"index":'); const loaded = loadCheckpoint(file, jobs, fingerprints);
    assert.equal(loaded.records.size, 1); assert.equal(loaded.truncatedBytes, 9); assert.deepEqual(loaded.records.get(0), row);
    fs.writeFileSync(file, line + line); assert.throws(() => loadCheckpoint(file, jobs, fingerprints), /DUPLICATE/);
    fs.writeFileSync(file, line.replace('"fp"', '"wrong"')); assert.throws(() => loadCheckpoint(file, jobs, fingerprints));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
