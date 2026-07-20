"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeJsonAtomic, writeFileImmutable } = require("../../tools/agentank/core/atomic-file");
const { summarizeTestOutput } = require("../../tools/agentank/harness/test-runner");

const ROOT = path.resolve(__dirname, "../..");

test("atomic JSON write is idempotent for identical bytes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-imp0-atomic-"));
  const file = path.join(directory, "artifact.json");
  assert.equal(writeJsonAtomic(file, { b: 2, a: 1 }).changed, true);
  assert.equal(writeJsonAtomic(file, { b: 2, a: 1 }).changed, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { b: 2, a: 1 });
});

test("content-addressed evidence cannot be overwritten with different bytes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-imp0-immutable-"));
  const file = path.join(directory, "evidence-hash.json");
  assert.equal(writeFileImmutable(file, "first").changed, true);
  assert.equal(writeFileImmutable(file, "first").changed, false);
  assert.throws(() => writeFileImmutable(file, "second"),
    { code: "IMMUTABLE_ARTIFACT_CONFLICT" });
  assert.equal(fs.readFileSync(file, "utf8"), "first");
});

test("zero-test output is a hard failure even with exit code zero", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-imp0-tests-"));
  const raw = path.join(directory, "pending.tap");
  fs.writeFileSync(raw, "TAP version 13\n1..0\n# tests 0\n# pass 0\n# fail 0\n");
  const result = summarizeTestOutput(ROOT, raw, 0, directory);
  assert.equal(result.report.status, "FAIL");
  assert.equal(result.report.tests, 0);
});
