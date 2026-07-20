"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { FastRegressionStore } = require("../../tools/agentank/fast-regression/artifact-store");

test("fast regression evidence is physically isolated, immutable, compressed, and content addressed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-fast-regression-"));
  const store = new FastRegressionStore(root); const properties = store.initialize();
  assert.equal(properties.physicalRoot, "artifacts/fast-regression");
  assert.equal(properties.isolation.independentFromImpArtifacts, true);
  const writer = store.startRun({ purpose: "UNIT_TEST", sourceSha256: "abc" });
  writer.append("matches", { id: 1 }); writer.append("step-traces", { id: 1, frames: [] });
  const finalized = writer.finalize({ passed: 1 });
  assert.match(finalized.manifest.runId, /^run-[a-f0-9]{64}$/);
  const stream = finalized.manifest.artifacts.matches;
  const compressed = fs.readFileSync(path.join(finalized.directory, stream.file));
  assert.equal(zlib.gunzipSync(compressed).toString("utf8"), '{"id":1}\n');
  assert.equal(finalized.manifest.properties.includes("IMMUTABLE"), true);
  assert.equal(fs.existsSync(path.join(root, "artifacts", "imp8")), false);
});

test("identical finalized evidence deduplicates to the same content-addressed run", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-fast-regression-dedup-"));
  const store = new FastRegressionStore(root);
  const write = () => { const writer = store.startRun({ purpose: "DEDUP" });
    writer.append("matches", { value: 7 }); return writer.finalize({ value: 7 }); };
  const first = write(); const second = write();
  assert.equal(second.manifest.runId, first.manifest.runId);
  assert.equal(second.directory, first.directory);
});

test("one store instance initializes immutable properties only once for capsule batches", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-fast-regression-init-"));
  const store = new FastRegressionStore(root);
  const first = store.initialize(); const propertiesFile = path.join(root,
    "artifacts/fast-regression/properties.json");
  const before = fs.statSync(propertiesFile).mtimeMs;
  const second = store.initialize(); const after = fs.statSync(propertiesFile).mtimeMs;
  assert.equal(second, first); assert.equal(after, before);
});

test("full capsule fingerprints resolve directly without scanning the capsule tree", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-fast-regression-direct-"));
  const store = new FastRegressionStore(root);
  const written = store.writeCapsule({ payload: { value: 17 } });
  store.listCapsules = () => { throw new Error("capsule tree scan is forbidden"); };
  const direct = store.readCapsule(written.capsule.fingerprint);
  assert.equal(direct.capsule.fingerprint, written.capsule.fingerprint);
  assert.equal(direct.file, written.file);
});

test("cohort relative paths resolve directly and cannot escape the artifact root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-fast-regression-relative-"));
  const store = new FastRegressionStore(root);
  const written = store.writeCapsule({ payload: { value: 23 } });
  const relativePath = path.relative(store.paths.root, written.file);
  store.listCapsules = () => { throw new Error("capsule tree scan is forbidden"); };
  assert.equal(store.readCapsule({ fingerprint: written.capsule.fingerprint,
    relativePath }).capsule.payload.value, 23);
  assert.throws(() => store.readCapsule({ fingerprint: written.capsule.fingerprint,
    relativePath: "../../outside.json" }), error => error.code === "PATH_ESCAPE");
});
