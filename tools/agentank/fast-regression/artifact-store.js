"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const { invariant } = require("../core/errors");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } =
  require("../core/atomic-file");
const { canonicalJson } = require("../core/canonical-json");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { contained } = require("../core/paths");
const { validateSchemaObject } = require("../core/schema-validator");
const { artifactPaths, propertiesManifest, SCHEMA_VERSION, ARTIFACT_PROPERTY } =
  require("./properties");

const STREAMS = Object.freeze(["matches", "step-traces", "decision-traces",
  "replay-events", "selected-windows"]);

function utcToken() {
  return new Date().toISOString().replaceAll(":", "").replaceAll("-", "")
    .replace(".", "-");
}

function canonicalLine(value) { return `${canonicalJson(value)}\n`; }
function validateWhenSchemasPresent(store, name, value) {
  if (fs.existsSync(path.join(store.workspaceRoot, "docs", "design")))
    validateSchemaObject(name, value, store.workspaceRoot);
}

class EvidenceRunWriter {
  constructor(store, descriptor) {
    invariant(descriptor && typeof descriptor === "object" && !Array.isArray(descriptor),
      "FAST_REGRESSION_DESCRIPTOR_INVALID", "run descriptor must be an object");
    this.store = store; this.descriptor = descriptor;
    this.sessionId = `${utcToken()}-${process.pid}-${crypto.randomUUID()}`;
    this.directory = path.join(store.paths.work, this.sessionId); ensureDirectory(this.directory);
    this.counts = Object.fromEntries(STREAMS.map(name => [name, 0]));
    this.closed = false; this.startedAt = new Date().toISOString();
  }

  append(stream, value) {
    invariant(!this.closed, "FAST_REGRESSION_RUN_CLOSED", this.sessionId);
    invariant(STREAMS.includes(stream), "FAST_REGRESSION_STREAM_INVALID", stream);
    fs.appendFileSync(path.join(this.directory, `${stream}.jsonl`), canonicalLine(value),
      { encoding: "utf8", mode: 0o600 });
    this.counts[stream] += 1; return this.counts[stream];
  }

  finalize(summary = {}, completion = "COMPLETE") {
    invariant(!this.closed, "FAST_REGRESSION_RUN_CLOSED", this.sessionId);
    invariant(completion === "COMPLETE" || completion === "PARTIAL",
      "FAST_REGRESSION_COMPLETION_INVALID", completion);
    this.closed = true; const artifacts = {};
    for (const name of STREAMS) {
      const rawFile = path.join(this.directory, `${name}.jsonl`);
      const raw = fs.existsSync(rawFile) ? fs.readFileSync(rawFile) : Buffer.alloc(0);
      const compressed = zlib.gzipSync(raw, { level: 9, mtime: 0 });
      const fileName = `${name}.jsonl.gz`; fs.writeFileSync(path.join(this.directory, fileName), compressed);
      if (fs.existsSync(rawFile)) fs.unlinkSync(rawFile);
      artifacts[name] = { file: fileName, records: this.counts[name],
        uncompressedBytes: raw.byteLength, compressedBytes: compressed.byteLength,
        sha256: sha256Bytes(compressed) };
    }
    const identity = { descriptor: this.descriptor, completion, artifacts, summary };
    const runId = `run-${fingerprintObject(identity)}`;
    const manifest = {
      schemaVersion: SCHEMA_VERSION.RUN_MANIFEST,
      artifactKind: "BATTLE_EVIDENCE_RUN",
      runId,
      properties: [ARTIFACT_PROPERTY.IMMUTABLE, ARTIFACT_PROPERTY.CONTENT_ADDRESSED,
        ARTIFACT_PROPERTY.APPEND_ONLY, ARTIFACT_PROPERTY.SOURCE_BOUND,
        completion === "COMPLETE" ? ARTIFACT_PROPERTY.COMPLETE : ARTIFACT_PROPERTY.PARTIAL],
      completion,
      startedAt: this.startedAt,
      finalizedAt: new Date().toISOString(),
      descriptor: this.descriptor,
      artifacts,
      summary,
      fingerprint: ""
    };
    manifest.fingerprint = fingerprintObject(manifest);
    validateWhenSchemasPresent(this.store, "fast-regression-run-manifest", manifest);
    writeJsonAtomic(path.join(this.directory, "manifest.json"), manifest, { mode: 0o644 });
    const finalDirectory = path.join(this.store.paths.runs, runId);
    let acceptedManifest = manifest;
    if (fs.existsSync(finalDirectory)) {
      const prior = JSON.parse(fs.readFileSync(path.join(finalDirectory, "manifest.json"), "utf8"));
      invariant(prior.runId === runId && prior.completion === completion,
        "FAST_REGRESSION_RUN_CONTENT_CONFLICT", runId);
      acceptedManifest = prior;
      fs.rmSync(this.directory, { recursive: true, force: true });
    } else fs.renameSync(this.directory, finalDirectory);
    writeJsonImmutable(path.join(this.store.paths.history, "run-manifests",
      `${acceptedManifest.fingerprint}.json`), acceptedManifest, { mode: 0o644 });
    return { manifest: acceptedManifest, directory: finalDirectory };
  }

  abort(reason) {
    return this.finalize({ aborted: true, reason: String(reason || "UNSPECIFIED") }, "PARTIAL");
  }
}

class FastRegressionStore {
  constructor(workspaceRoot) { this.workspaceRoot = path.resolve(workspaceRoot);
    this.paths = artifactPaths(this.workspaceRoot); this.initializedProperties = null; }

  initialize() {
    if (this.initializedProperties) return this.initializedProperties;
    for (const directory of Object.values(this.paths)) ensureDirectory(directory);
    const properties = propertiesManifest(); properties.fingerprint = fingerprintObject(properties);
    writeJsonAtomic(path.join(this.paths.root, "properties.json"), properties, { mode: 0o644 });
    writeJsonImmutable(path.join(this.paths.history, "properties",
      `${properties.fingerprint}.json`), properties, { mode: 0o644 });
    this.initializedProperties = properties; return properties;
  }

  startRun(descriptor) { this.initialize(); return new EvidenceRunWriter(this, descriptor); }

  writeCapsule(capsule) {
    this.initialize();
    const value = { ...capsule, schemaVersion: SCHEMA_VERSION.REPLAY_CAPSULE,
      artifactKind: "REPLAY_CAPSULE", fingerprint: "" };
    value.fingerprint = fingerprintObject(value);
    validateWhenSchemasPresent(this, "replay-capsule", value);
    const directory = path.join(this.paths.capsules, value.fingerprint.slice(0, 2));
    const file = path.join(directory, `${value.fingerprint}.json`);
    writeJsonImmutable(file, value, { mode: 0o644 });
    return { capsule: value, file };
  }

  writeCohort(manifest, name = "current") {
    this.initialize(); const value = { ...manifest, schemaVersion: SCHEMA_VERSION.COHORT_MANIFEST,
      artifactKind: "FAST_REGRESSION_COHORT", fingerprint: "" };
    value.fingerprint = fingerprintObject(value);
    const historyFile = path.join(this.paths.cohorts, "history", `${value.fingerprint}.json`);
    writeJsonImmutable(historyFile, value, { mode: 0o644 });
    writeJsonAtomic(path.join(this.paths.cohorts, `${name}.json`), value, { mode: 0o644 });
    return { manifest: value, file: historyFile };
  }

  writeReport(report, name) {
    this.initialize(); const value = { ...report,
      schemaVersion: report.schemaVersion || SCHEMA_VERSION.VERIFICATION_REPORT,
      fingerprint: "" };
    value.fingerprint = fingerprintObject(value);
    const directory = path.join(this.paths.reports, name);
    const file = path.join(directory, `${value.fingerprint}.json`);
    writeJsonImmutable(file, value, { mode: 0o644 });
    writeJsonAtomic(path.join(directory, "latest.json"), value, { mode: 0o644 });
    return { report: value, file };
  }

  listCapsules() {
    if (!fs.existsSync(this.paths.capsules)) return [];
    const files = [];
    for (const prefix of fs.readdirSync(this.paths.capsules).sort()) {
      const directory = path.join(this.paths.capsules, prefix);
      if (!fs.statSync(directory).isDirectory()) continue;
      for (const name of fs.readdirSync(directory).sort()) if (name.endsWith(".json"))
        files.push(path.join(directory, name));
    }
    return files;
  }

  readCapsule(reference) {
    const descriptor = reference && typeof reference === "object" ? reference : null;
    const value = descriptor ? String(descriptor.fingerprint || "") : String(reference || "");
    const fullFingerprint = /^[a-f0-9]{64}$/.test(value);
    let file = descriptor?.relativePath ? contained(this.paths.root, descriptor.relativePath) :
      fullFingerprint ? path.join(this.paths.capsules, value.slice(0, 2), `${value}.json`) :
        path.resolve(value);
    if (!fs.existsSync(file) && !fullFingerprint && !descriptor?.relativePath) {
      const matches = this.listCapsules().filter(item => path.basename(item).startsWith(value));
      invariant(matches.length === 1, "FAST_REGRESSION_CAPSULE_REFERENCE_AMBIGUOUS",
        `${value}:${matches.length}`); file = matches[0];
    }
    invariant(fs.existsSync(file), "FAST_REGRESSION_CAPSULE_NOT_FOUND", file);
    const capsule = JSON.parse(fs.readFileSync(file, "utf8"));
    invariant(fingerprintObject(capsule) === capsule.fingerprint,
      "FAST_REGRESSION_CAPSULE_FINGERPRINT_MISMATCH", file);
    if (fullFingerprint) invariant(capsule.fingerprint === value,
      "FAST_REGRESSION_CAPSULE_REFERENCE_MISMATCH", file);
    return { capsule, file };
  }
}

module.exports = { STREAMS, EvidenceRunWriter, FastRegressionStore, canonicalLine };
