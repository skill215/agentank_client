#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { build } = require("./native-base-policy-upload-builder");
const { sourceClosureSha256 } = require(
  "../diagnostics/native-base-policy-standalone-arena");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function option(argv, name, fallback) {
  const at = argv.indexOf(name);
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : fallback;
}

function loadArena(directory) {
  const overviewBytes = fs.readFileSync(path.join(directory, "overview.json"));
  const matchesBytes = fs.readFileSync(path.join(directory, "matches.ndjson.gz"));
  const text = zlib.gunzipSync(matchesBytes).toString("utf8").trim();
  return { overview: JSON.parse(overviewBytes),
    matches: text ? text.split("\n").map(JSON.parse) : [],
    hashes: { overview: sha256(overviewBytes), matches: sha256(matchesBytes) } };
}

function key(match) {
  return `${match.scenarioFingerprint}:${match.candidateSeat}`;
}

function semantic(match) {
  return { actionStream: match.candidate.compactActionStream,
    arguments: match.candidate.compactArguments,
    resultReason: match.result?.reason || "UNKNOWN",
    frames: match.frames, counts: match.counts,
    analysisOutcome: match.analysisOutcome,
    terminalCategory: match.terminalCategory };
}

function fingerprint(matches) {
  const rows = matches.map(match => `${key(match)}:${JSON.stringify(
    semantic(match))}`).sort();
  return { records: rows.length, sha256: sha256(rows.join("\n")) };
}

function compare(left, right) {
  const rightByKey = new Map(right.map(match => [key(match), match]));
  const differences = { missing: 0, actionStream: 0, arguments: 0,
    resultReason: 0, frames: 0, counts: 0, analysisOutcome: 0,
    terminalCategory: 0 };
  for (const match of left) {
    const other = rightByKey.get(key(match));
    if (!other) { differences.missing += 1; continue; }
    const a = semantic(match); const b = semantic(other);
    for (const field of Object.keys(differences)) {
      if (field !== "missing" && JSON.stringify(a[field]) !==
          JSON.stringify(b[field])) differences[field] += 1;
    }
    rightByKey.delete(key(match));
  }
  differences.missing += rightByKey.size;
  return differences;
}

function compareRuntimeWinnerMetadata(left, right) {
  const rightByKey = new Map(right.map(match => [key(match), match]));
  let differences = 0;
  for (const match of left) {
    const other = rightByKey.get(key(match));
    if (other && JSON.stringify(match.result) !== JSON.stringify(other.result))
      differences += 1;
  }
  return differences;
}

function zero(differences) {
  return Object.values(differences).every(value => value === 0);
}

function firstScenarios(matches, limit) {
  const fingerprints = [];
  const seen = new Set();
  for (const match of matches) {
    if (!seen.has(match.scenarioFingerprint)) {
      seen.add(match.scenarioFingerprint);
      fingerprints.push(match.scenarioFingerprint);
    }
    if (fingerprints.length === limit) break;
  }
  const accepted = new Set(fingerprints);
  return matches.filter(match => accepted.has(match.scenarioFingerprint));
}

function runArena(root, output, role, limit, candidateCode = "") {
  const script = path.join(root,
    "tools/agentank/diagnostics/native-base-policy-standalone-arena.js");
  const args = [script, "--role", role, "--limit", String(limit),
    "--output", output];
  if (candidateCode) args.push("--candidate-code", candidateCode);
  const result = spawnSync(process.execPath, args,
    { cwd: root, stdio: ["ignore", "ignore", "inherit"] });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`NATIVE_UPLOAD_ARENA_FAILED:${path.basename(output)}:${
      result.status}`);
}

function reusableArena(directory, role, limit, expectedCode = "",
    expectedClosure = "") {
  try {
    const overview = JSON.parse(fs.readFileSync(
      path.join(directory, "overview.json"), "utf8"));
    if (overview.role !== role || overview.scenarioCount !== limit ||
        !fs.existsSync(path.join(directory, "matches.ndjson.gz"))) return false;
    if (expectedCode)
      return overview.source?.candidateCode === expectedCode;
    return overview.source?.runtimeClosure === expectedClosure &&
      !overview.source?.candidateCode;
  } catch (_) { return false; }
}

function invariantSummary(arena) {
  let timeouts = 0; let errors = 0; let restore = 0; let allocations = 0;
  for (const match of arena.matches) {
    timeouts += match.candidate.timeoutCount || 0;
    errors += match.candidate.errorCount || 0;
    const engine = match.candidateEngine || {};
    restore += engine.rootRestoreFailures || 0;
    allocations += engine.hotAllocations || 0;
  }
  return { timeouts, errors, rootRestoreFailures: restore, hotAllocations: allocations };
}

async function qualify(root, output, options = {}) {
  const role = String(options.role || "DISCOVERY").toUpperCase();
  const limit = Math.max(16, Number(options.limit || 64) | 0);
  fs.mkdirSync(output, { recursive: true });
  const buildA = path.join(output, "build-a");
  const buildB = path.join(output, "build-b");
  const manifestA = await build(root, buildA);
  const manifestB = await build(root, buildB);
  const deterministicBuild = manifestA.source.sha256 === manifestB.source.sha256 &&
    manifestA.minified.sha256 === manifestB.minified.sha256 &&
    manifestA.fingerprint === manifestB.fingerprint;
  const lanes = { direct: path.join(output, "arena-direct"),
    source: path.join(output, "arena-source"),
    minified: path.join(output, "arena-minified") };
  const closure = sourceClosureSha256(root);
  const reuse = options.reuseArenas === true;
  if (!reuse || !reusableArena(lanes.direct, role, limit, "", closure))
    runArena(root, lanes.direct, role, limit);
  if (!reuse || !reusableArena(lanes.source, role, limit,
      manifestA.source.sha256))
    runArena(root, lanes.source, role, limit, path.join(buildA, "source.js"));
  if (!reuse || !reusableArena(lanes.minified, role, limit,
      manifestA.minified.sha256))
    runArena(root, lanes.minified, role, limit, path.join(buildA, "minified.js"));
  const arenas = { direct: loadArena(lanes.direct),
    source: loadArena(lanes.source), minified: loadArena(lanes.minified) };
  const full = { directVsSource: compare(arenas.direct.matches,
      arenas.source.matches),
    sourceVsMinified: compare(arenas.source.matches, arenas.minified.matches) };
  const fixed16 = { directVsSource: compare(
      firstScenarios(arenas.direct.matches, 16),
      firstScenarios(arenas.source.matches, 16)),
    sourceVsMinified: compare(firstScenarios(arenas.source.matches, 16),
      firstScenarios(arenas.minified.matches, 16)) };
  const runtimeWinnerMetadata = {
    fixed16: { directVsSource: compareRuntimeWinnerMetadata(
      firstScenarios(arenas.direct.matches, 16),
      firstScenarios(arenas.source.matches, 16)),
    sourceVsMinified: compareRuntimeWinnerMetadata(
      firstScenarios(arenas.source.matches, 16),
      firstScenarios(arenas.minified.matches, 16)) },
    full: { directVsSource: compareRuntimeWinnerMetadata(arenas.direct.matches,
      arenas.source.matches),
    sourceVsMinified: compareRuntimeWinnerMetadata(arenas.source.matches,
      arenas.minified.matches) } };
  const invariants = invariantSummary(arenas.direct);
  const status = manifestA.status === "BUILD_PASS" && deterministicBuild &&
    zero(full.directVsSource) && zero(full.sourceVsMinified) &&
    zero(fixed16.directVsSource) && zero(fixed16.sourceVsMinified) &&
    Object.values(invariants).every(value => value === 0) ? "QUALIFIED" : "REJECTED";
  const report = { objectKind: "NativeBasePolicyUploadQualificationV1",
    status, role, scenarioCount: limit, matchCount: arenas.direct.matches.length,
    build: { deterministic: deterministicBuild, manifest: manifestA },
    gameplay: { direct: arenas.direct.overview.candidate,
      source: arenas.source.overview.candidate,
      minified: arenas.minified.overview.candidate },
    equivalence: { fixed16, full, runtimeWinnerMetadata,
      runtimeWinnerMetadataExcludedFromQualification: true,
      fingerprints: { direct: fingerprint(arenas.direct.matches),
        source: fingerprint(arenas.source.matches),
        minified: fingerprint(arenas.minified.matches) } },
    invariants,
    artifacts: { lanes, hashes: { direct: arenas.direct.hashes,
      source: arenas.source.hashes, minified: arenas.minified.hashes } } };
  report.fingerprint = sha256(JSON.stringify(report));
  fs.writeFileSync(path.join(output, "qualification.json"),
    `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function run(argv = process.argv.slice(2)) {
  const root = path.resolve(option(argv, "--root", path.join(__dirname,
    "../../..")));
  const output = path.resolve(option(argv, "--output",
    "/tmp/agentank-native-base-policy-upload-qualification"));
  const report = await qualify(root, output, {
    role: option(argv, "--role", "DISCOVERY"),
    limit: option(argv, "--limit", "64"),
    reuseArenas: option(argv, "--reuse-arenas", "false") === "true" });
  process.stdout.write(`${JSON.stringify({ output, status: report.status,
    fingerprint: report.fingerprint, gameplay: report.gameplay,
    equivalence: report.equivalence, invariants: report.invariants }, null, 2)}\n`);
  if (report.status !== "QUALIFIED") process.exitCode = 1;
  return report;
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { compare, compareRuntimeWinnerMetadata, fingerprint,
  firstScenarios, loadArena, qualify, reusableArena, semantic, zero };
