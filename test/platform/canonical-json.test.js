"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { canonicalJson } = require("../../tools/agentank/core/canonical-json");
const { fingerprintObject, fingerprintObjectOmitting } = require("../../tools/agentank/core/hash");

test("canonical JSON sorts object keys and preserves array order", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, b: [3, 1] } }),
    '{"a":{"b":[3,1],"y":2},"z":1}');
});

test("canonical JSON rejects fractional and unsafe numbers", () => {
  assert.throws(() => canonicalJson({ value: 0.5 }), { code: "NON_CANONICAL_NUMBER" });
  assert.throws(() => canonicalJson({ value: Number.MAX_SAFE_INTEGER + 1 }),
    { code: "NON_CANONICAL_NUMBER" });
});

test("fingerprint ignores only the top-level fingerprint field", () => {
  const first = fingerprintObject({ a: 1, fingerprint: "old" });
  const second = fingerprintObject({ fingerprint: "new", a: 1 });
  assert.equal(first, second);
});

test("derived manifest ids can be omitted without creating a hash cycle", () => {
  const first = fingerprintObjectOmitting({ candidateId: "cand_old", value: 1,
    fingerprint: "old" }, ["candidateId"]);
  const second = fingerprintObjectOmitting({ fingerprint: "new", value: 1,
    candidateId: "cand_new" }, ["candidateId"]);
  assert.equal(first, second);
  assert.notEqual(first, fingerprintObject({ candidateId: "cand_new", value: 1 }));
});
