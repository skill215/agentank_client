"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { commitRunRevision, loadLatestRun, verifyRunChain, revisionFile } =
  require("../../tools/agentank/platform/run-store");
const { minimalRunManifest } = require("./fixtures");

test("RunManifest commits immutable linked revisions and a latest pointer", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-run-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const first = commitRunRevision(directory, minimalRunManifest(), {
    now: "2026-07-16T00:00:00.000Z", expectedRevision: 0 });
  assert.equal(first.manifest.revision, 0);
  assert.equal(first.manifest.previousRevisionSha256, null);
  const next = { ...first.manifest, state: "LOCAL_VALIDATED" };
  next.stages = structuredClone(first.manifest.stages);
  next.stages.localValidation.status = "PASS";
  next.stages.localValidation.attempts = 1;
  const second = commitRunRevision(directory, next, {
    now: "2026-07-16T00:01:00.000Z", expectedRevision: 1 });
  assert.equal(second.manifest.revision, 1);
  assert.match(second.manifest.previousRevisionSha256, /^[0-9a-f]{64}$/);
  assert.equal(loadLatestRun(directory).state, "LOCAL_VALIDATED");
  assert.deepEqual(verifyRunChain(directory), {
    ok: true,
    revisions: 2,
    latestRevision: 1,
    latestSha256: second.revisionSha256
  });
});

test("RunManifest chain verification detects an altered immutable revision", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-run-tamper-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  commitRunRevision(directory, minimalRunManifest(), { now: "2026-07-16T00:00:00.000Z" });
  const file = revisionFile(directory, 0);
  const value = JSON.parse(fs.readFileSync(file, "utf8"));
  value.state = "FAILED";
  fs.writeFileSync(file, JSON.stringify(value));
  assert.throws(() => verifyRunChain(directory), { code: "RUN_FINGERPRINT_MISMATCH" });
});
