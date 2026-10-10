'use strict';
// Build-time source variants. The generated production source is never edited.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { assembleProductionSource } = require('./imp6-builder');
const { ENTRY, compile } = require('./native-base-policy-upload-builder');
const { executeSequence } = require('./base-policy-candidate-builder');
const { PLATFORM_CODE_LIMIT_BYTES } = require('../platform/code-size-policy');
const MODULE = 'engine-v2/src/base-policy-specialized/path-utility.js';
function port(source, mode) {
  assert.ok(['baseline', 'R15', 'R29'].includes(mode));
  if (mode === 'baseline') return source;
  if (mode === 'R29') {
    const block = '      if (next === 2) score -= 60;\n      else if (next === 3) score -= 180;\n      else if (next >= 4) score -= 360;';
    assert.equal(source.split(block).length, 2, 'STREAK_SOURCE_DRIFT');
    return source.replace(block, '      // BP392 R29: retain linear and reversal costs.');
  }
  for (const [start, end, count] of [
    ['scoreAppliedTransition(state,', '\nfireUtility(state)', 1],
    ['scoreTransition(state,', '\n}\n\nmodule.exports', 3]
  ]) {
    const a = source.indexOf(start), b = source.indexOf(end, a);
    assert.ok(a >= 0 && b > a, 'METHOD_SOURCE_DRIFT');
    const body = source.slice(a, b);
    assert.equal(body.split('return score;').length - 1, count, 'RETURN_SOURCE_DRIFT');
    source = source.slice(0, a) + body.replaceAll('return score;', 'return Math.trunc(score / 2);') + source.slice(b);
  }
  return source;
}
async function build(root, mode) {
  const moduleSource = port(fs.readFileSync(path.join(root, MODULE), 'utf8'), mode);
  const assembled = assembleProductionSource(root, { entry: path.join(root, ENTRY), moduleSourceOverrides: { [MODULE]: moduleSource } });
  const source = assembled.source, minified = await compile(source), repeat = await compile(source);
  assert.equal(minified, repeat, 'NONDETERMINISTIC_BUILD');
  const sourceFixture = executeSequence(source), minifiedFixture = executeSequence(minified);
  assert.deepEqual(sourceFixture.fingerprint, minifiedFixture.fingerprint, 'FIXTURE_DRIFT');
  assert.ok(Buffer.byteLength(minified) <= PLATFORM_CODE_LIMIT_BYTES, 'SIZE_LIMIT');
  return { moduleSource, source, minified, evidence: { deterministic: true, fixtureEquivalent: true,
    sourceFixture, minifiedFixture, bytes: Buffer.byteLength(minified), maximumBytes: PLATFORM_CODE_LIMIT_BYTES } };
}
module.exports = { MODULE, port, build };
