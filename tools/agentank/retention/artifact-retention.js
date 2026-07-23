"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const readline = require("node:readline");
const { once } = require("node:events");
const { pipeline } = require("node:stream/promises");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { classifyAnalysisOutcome } = require("../analysis/analysis-outcome");
const { loadFrozenCandidate } = require("../candidate/imp8-g10a");

const RETENTION_ROOT = "artifacts/retention/gr0";
const INVENTORY_FILE = `${RETENTION_ROOT}/inventory.json`;
const VERIFIED_FILE = `${RETENTION_ROOT}/verified-prune-manifest.json`;
const SELECTED_CANDIDATE = "imp8-v2-a5ce6f8ef59abb61";
const WORKING_ROOT = "artifacts/diagnostics/v1-v2-working/" +
  "0ed5c5b27938bf3e-r2-discovery-calibration-frozen-p080aa18a0f3f-rolling-f8b22c94";
const WORKING_LANES = Object.freeze([
  `${WORKING_ROOT}/frozen_regression/paired-arena-report.json`,
  `${WORKING_ROOT}/calibration/paired-arena-report.json`,
  `${WORKING_ROOT}/discovery/paired-arena-report.json`,
  `${WORKING_ROOT}/rolling_discovery/paired-arena-report.json`
]);
const IMP8_EXACT = "artifacts/diagnostics/v1-v2/imp8-v2-a5ce6f8ef59abb61/" +
  "v1_v2_exact_paired_failure_diagnostic_v1/exact-match-report.json";
const BASELINES = Object.freeze([
  Object.freeze({ baselineId: "imp8-common-1952", expectedRecords: 1952,
    sources: [IMP8_EXACT] }),
  Object.freeze({ baselineId: "working-0ed5c5-common-5936", expectedRecords: 5936,
    sources: WORKING_LANES.slice() }),
  Object.freeze({ baselineId: "sr3-final-2128", expectedRecords: 2128,
    sources: ["artifacts/reports/structural-repair/SR3/sr3-fixed-arena.json"] }),
  Object.freeze({ baselineId: "sr4-final-2128", expectedRecords: 2128,
    sources: ["artifacts/reports/structural-repair/SR4/sr4-fixed-arena.json"] })
]);
const SUMMARY_55_6 = Object.freeze({
  baselineId: "historical-55-6-summary",
  sourceBytesAvailable: false,
  sourceFingerprint: "d2a2221f",
  denominator: 2392,
  v2Wins: 1330,
  v1Wins: 905,
  draws: 157,
  scoreUnits: 2817,
  scoreRatePer10000: 5888,
  sourceDocs: [
    "docs/implementation/initial-full-historical-regression.md",
    "docs/implementation/fast-regression-initial-full-validation.md"
  ]
});

function slash(file) { return file.replaceAll("\\", "/"); }
function relative(root, file) { return slash(path.relative(root, file)); }
function ensureDirectory(directory) { fs.mkdirSync(directory, { recursive: true }); }
function atomicJson(file, value) {
  ensureDirectory(path.dirname(file));
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o644 });
  fs.renameSync(temp, file);
}
function walk(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file, output);
    else if (entry.isFile()) output.push(file);
  }
  return output;
}
async function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(file);
  stream.on("data", chunk => hash.update(chunk));
  await once(stream, "end");
  return hash.digest("hex");
}
function fileSize(file) { return fs.statSync(file).size; }
function currentStageEvidence(relativePath, size) {
  if (relativePath.includes("/history/")) return false;
  if (/^artifacts\/reports\/acceptance\/IMP\d+\/imp\d+-acceptance-report\.json$/.test(relativePath))
    return true;
  if (/^artifacts\/reports\/structural-repair\/SR\d+\/sr\d+-(acceptance-report|overview)\.json$/
      .test(relativePath)) return true;
  if (/^artifacts\/reports\/imp\d+\//.test(relativePath) && size <= 262144 &&
      /(acceptance|overview|attestation|context|summary|report)\.json$/.test(relativePath))
    return true;
  return false;
}
function selectedCandidateDependency(relativePath, selectedManifest) {
  const direct = new Set([
    "artifacts/imp8/frozen/candidate-manifest.json",
    `artifacts/imp8/frozen/candidates/${SELECTED_CANDIDATE}/candidate-manifest.json`,
    selectedManifest.selection.frozenV1RelativePath,
    selectedManifest.build.sourceRelativePath,
    selectedManifest.build.minifiedRelativePath,
    selectedManifest.build.buildManifestRelativePath,
    selectedManifest.testPlan.relativePath,
    selectedManifest.discoveryRegression.relativePath,
    "artifacts/imp8/frozen/g10a-report.json",
    `artifacts/imp8/frozen/candidates/${SELECTED_CANDIDATE}/g10a/g10a-report.json`
  ]);
  return direct.has(relativePath);
}
function keepArtifact(relativePath, size, selectedManifest) {
  if (relativePath.startsWith(`${RETENTION_ROOT}/`)) return true;
  if (relativePath.startsWith("artifacts/platform/")) return true;
  if (relativePath.startsWith("artifacts/vendor/")) return true;
  if (selectedCandidateDependency(relativePath, selectedManifest)) return true;
  if (currentStageEvidence(relativePath, size)) return true;
  if (relativePath.startsWith("artifacts/benchmarks/") &&
      !relativePath.includes("/history/") && !relativePath.includes("/gameplay/") &&
      size <= 524288 && /(summary|report)\.json$/.test(relativePath)) return true;
  return false;
}
function requiredCandidatePaths(manifest) {
  return [
    "artifacts/imp8/frozen/candidate-manifest.json",
    `artifacts/imp8/frozen/candidates/${manifest.candidateId}/candidate-manifest.json`,
    manifest.selection.frozenV1RelativePath,
    manifest.build.sourceRelativePath,
    manifest.build.minifiedRelativePath,
    manifest.build.buildManifestRelativePath,
    manifest.testPlan.relativePath,
    manifest.discoveryRegression.relativePath
  ];
}
async function describeFile(root, file) {
  return { relativePath: relative(root, file), size: fileSize(file), sha256: await sha256File(file) };
}
async function inventory(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const frozen = loadFrozenCandidate(root);
  invariant(frozen.manifest.candidateId === SELECTED_CANDIDATE,
    "RETENTION_SELECTED_CANDIDATE_CHANGED", frozen.manifest.candidateId);
  const artifactRoot = contained(root, "artifacts");
  const files = walk(artifactRoot).sort();
  const keep = []; const prune = []; let keepBytes = 0; let pruneBytes = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index]; const rel = relative(root, file); const size = fileSize(file);
    const entry = { relativePath: rel, size, sha256: await sha256File(file) };
    if (keepArtifact(rel, size, frozen.manifest)) { keep.push(entry); keepBytes += size; }
    else { prune.push(entry); pruneBytes += size; }
    if (typeof options.onProgress === "function" && (index === 0 || (index + 1) % 256 === 0 ||
        index + 1 === files.length)) options.onProgress(index + 1, files.length, rel);
  }
  const sources = [];
  const uniqueSources = new Set(BASELINES.flatMap(item => item.sources));
  for (const rel of [...uniqueSources].sort()) {
    const entry = prune.find(item => item.relativePath === rel) ||
      keep.find(item => item.relativePath === rel);
    invariant(entry, "RETENTION_BASELINE_SOURCE_MISSING", rel); sources.push(entry);
  }
  const required = [];
  for (const rel of requiredCandidatePaths(frozen.manifest)) {
    const entry = keep.find(item => item.relativePath === rel);
    invariant(entry, "RETENTION_CANDIDATE_DEPENDENCY_NOT_KEPT", rel); required.push(entry);
  }
  const report = {
    schemaVersion: 1,
    objectKind: "ArtifactRetentionInventoryV1",
    status: "INVENTORIED",
    selectedCandidateId: frozen.manifest.candidateId,
    artifactBytesBefore: keepBytes + pruneBytes,
    keepBytes,
    pruneBytes,
    fileCount: files.length,
    keepCount: keep.length,
    pruneCount: prune.length,
    baselines: BASELINES,
    sourceFiles: sources,
    requiredCandidateFiles: required,
    keep,
    prune,
    fingerprint: ""
  };
  report.fingerprint = fingerprintObject(report);
  const file = contained(root, INVENTORY_FILE);
  atomicJson(file, report);
  return { report, file };
}

async function *streamMatchObjects(file) {
  const stream = fs.createReadStream(file, { encoding: "utf8", highWaterMark: 256 * 1024 });
  let phase = 0; let marker = ""; let depth = 0; let string = false; let escaped = false;
  let object = "";
  for await (const chunk of stream) {
    for (let index = 0; index < chunk.length; index += 1) {
      const char = chunk[index];
      if (phase === 0) {
        marker = (marker + char).slice(-64);
        // All retained source reports are canonical pretty JSON. Requiring the
        // top-level two-space indentation avoids summary fields also named
        // "matches" (for example repetition-stability buckets).
        if (/\n  "matches"\s*:\s*\[$/.test(marker)) phase = 2;
        continue;
      }
      if (phase === 3) continue;
      if (depth === 0) {
        if (char === "]") { phase = 3; continue; }
        if (char !== "{") continue;
        depth = 1; object = "{";
        string = false; escaped = false; continue;
      }
      object += char;
      if (string) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === "\"") string = false;
      } else if (char === "\"") string = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          yield JSON.parse(object);
          object = "";
        }
      }
    }
  }
  invariant(phase === 3 && depth === 0, "RETENTION_MATCH_STREAM_INCOMPLETE", file);
}
function compactMatch(match, source) {
  const classified = classifyAnalysisOutcome(match);
  const layer = match.v2?.layerTotals || {};
  return {
    schemaVersion: 1,
    objectKind: "LegacyArenaBaselineV1",
    matchId: match.matchId,
    historicalMatchUrlId: match.historicalMatchUrlId,
    scenarioFingerprint: match.scenarioFingerprint,
    variantId: match.variantId,
    family: match.family,
    repetition: match.repetition,
    seatImplementations: match.seatImplementations,
    seatSkills: match.seatSkills,
    v2Seat: match.v2Seat,
    analysisOutcome: classified.analysisOutcome,
    terminalCategory: classified.terminalCategory,
    rawWinnerImplementation: classified.rawWinnerImplementation,
    rawWinnerSeat: classified.rawWinnerSeat,
    rawReason: classified.rawReason,
    stars: classified.stars,
    crashes: classified.crashes,
    frames: match.frames,
    bullets: match.counts?.bullets || [0, 0],
    bombs: match.counts?.bombs || [0, 0],
    skills: match.counts?.skills || [0, 0],
    v1ActionCounts: match.v1?.actionCounts || {},
    v2ActionCounts: match.v2?.actionCounts || {},
    layerCounts: {
      selectedHardRejects: layer.selectedHardRejects || 0,
      avoidableHardRejects: layer.avoidableHardRejects || 0,
      riskDominatedSelections: layer.riskDominatedSelections || 0,
      rootRestoreFailures: layer.depthRootRestoreFailures || 0,
      proofWins: layer.proofWins || 0,
      noAcceptableActions: layer.noAcceptableActions || 0,
      stageMatrixSolves: layer.stageMatrixSolves || 0,
      fallbacks: layer.fallbacks || 0
    },
    sourceReportRelativePath: source.relativePath,
    sourceReportSha256: source.sha256,
    sourceReportFingerprint: source.fingerprint || null
  };
}
function emptySummary() {
  return { records: 0, v1Wins: 0, v2Wins: 0, draws: 0, singleCrashV2Wins: 0,
    singleCrashV2Losses: 0, terminalCategories: {}, variants: {} };
}
function addSummary(summary, record) {
  summary.records += 1;
  if (record.analysisOutcome === "V2_WIN") summary.v2Wins += 1;
  else if (record.analysisOutcome === "V1_WIN") summary.v1Wins += 1;
  else summary.draws += 1;
  summary.terminalCategories[record.terminalCategory] =
    (summary.terminalCategories[record.terminalCategory] || 0) + 1;
  const variant = summary.variants[record.variantId] ||
    (summary.variants[record.variantId] = { records: 0, v1Wins: 0, v2Wins: 0, draws: 0 });
  variant.records += 1;
  if (record.analysisOutcome === "V2_WIN") variant.v2Wins += 1;
  else if (record.analysisOutcome === "V1_WIN") variant.v1Wins += 1;
  else variant.draws += 1;
  if (record.terminalCategory === "SINGLE_CRASH") {
    if (record.analysisOutcome === "V2_WIN") summary.singleCrashV2Wins += 1;
    else if (record.analysisOutcome === "V1_WIN") summary.singleCrashV2Losses += 1;
  }
}
async function sourceMetadata(root, entry, inventoryReport) {
  const expected = inventoryReport.sourceFiles.find(item => item.relativePath === entry);
  invariant(expected, "RETENTION_SOURCE_NOT_IN_INVENTORY", entry);
  const file = contained(root, entry);
  invariant(fs.existsSync(file) && fileSize(file) === expected.size,
    "RETENTION_SOURCE_SIZE_DRIFT", entry);
  invariant(await sha256File(file) === expected.sha256, "RETENTION_SOURCE_HASH_DRIFT", entry);
  const size = fileSize(file); const tailLength = Math.min(size, 4096);
  const descriptor = fs.openSync(file, "r"); const tail = Buffer.allocUnsafe(tailLength);
  try { fs.readSync(descriptor, tail, 0, tailLength, size - tailLength); }
  finally { fs.closeSync(descriptor); }
  const match = tail.toString("utf8").match(/"fingerprint"\s*:\s*"([0-9a-f]{64})"/);
  return { ...expected, fingerprint: match ? match[1] : null };
}
async function compactOne(root, spec, inventoryReport, onProgress) {
  const outputDirectory = contained(root, RETENTION_ROOT, "baselines", spec.baselineId);
  ensureDirectory(outputDirectory);
  const output = path.join(outputDirectory, "matches.ndjson.gz");
  const temp = `${output}.tmp-${process.pid}`;
  const gzip = zlib.createGzip({ level: 9 });
  const sink = fs.createWriteStream(temp, { mode: 0o644 });
  const piping = pipeline(gzip, sink);
  const summary = emptySummary(); const sources = [];
  for (const sourcePath of spec.sources) {
    const source = await sourceMetadata(root, sourcePath, inventoryReport);
    sources.push(source);
    for await (const match of streamMatchObjects(contained(root, sourcePath))) {
      const record = compactMatch(match, source);
      addSummary(summary, record);
      if (!gzip.write(`${JSON.stringify(record)}\n`)) await once(gzip, "drain");
      if (typeof onProgress === "function" && (summary.records === 1 ||
          summary.records % 256 === 0)) onProgress(spec.baselineId, summary.records,
            spec.expectedRecords);
    }
  }
  gzip.end(); await piping;
  invariant(summary.records === spec.expectedRecords, "RETENTION_BASELINE_DENOMINATOR",
    `${spec.baselineId}:${summary.records}/${spec.expectedRecords}`);
  fs.renameSync(temp, output);
  const manifest = {
    schemaVersion: 1,
    objectKind: "LegacyArenaBaselineManifestV1",
    status: "COMPACTED",
    baselineId: spec.baselineId,
    expectedRecords: spec.expectedRecords,
    extractedRecords: summary.records,
    sourceFiles: sources,
    compact: { relativePath: relative(root, output), size: fileSize(output),
      sha256: await sha256File(output) },
    summary,
    allowedDeletionPaths: sources.map(item => item.relativePath),
    irreversibleFieldLoss: [
      "per-frame state",
      "candidate rows",
      "replay events",
      "exceptionalFrames",
      "raw action logs",
      "duplicate maps and star sequences"
    ],
    fingerprint: ""
  };
  manifest.fingerprint = fingerprintObject(manifest);
  atomicJson(path.join(outputDirectory, "manifest.json"), manifest);
  return manifest;
}
async function compact(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const inventoryReport = JSON.parse(fs.readFileSync(contained(root, INVENTORY_FILE), "utf8"));
  invariant(inventoryReport.objectKind === "ArtifactRetentionInventoryV1" &&
    inventoryReport.status === "INVENTORIED", "RETENTION_INVENTORY_INVALID", INVENTORY_FILE);
  const manifests = [];
  for (const spec of BASELINES)
    manifests.push(await compactOne(root, spec, inventoryReport, options.onProgress));
  const docs = [];
  for (const rel of SUMMARY_55_6.sourceDocs) {
    const file = contained(root, rel);
    docs.push({ relativePath: rel, size: fileSize(file), sha256: await sha256File(file) });
  }
  const summary = { ...SUMMARY_55_6, sourceDocs: docs, fingerprint: "" };
  summary.fingerprint = fingerprintObject(summary);
  atomicJson(contained(root, RETENTION_ROOT, "baselines", SUMMARY_55_6.baselineId,
    "summary.json"), summary);
  return { manifests, summary };
}
async function readCompactSummary(root, manifest) {
  const file = contained(root, manifest.compact.relativePath);
  invariant(fs.existsSync(file) && fileSize(file) === manifest.compact.size,
    "RETENTION_COMPACT_SIZE_DRIFT", manifest.baselineId);
  invariant(await sha256File(file) === manifest.compact.sha256,
    "RETENTION_COMPACT_HASH_DRIFT", manifest.baselineId);
  const input = fs.createReadStream(file).pipe(zlib.createGunzip());
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const summary = emptySummary();
  for await (const line of lines) {
    if (!line) continue;
    const record = JSON.parse(line);
    invariant(record.objectKind === "LegacyArenaBaselineV1",
      "RETENTION_COMPACT_RECORD_INVALID", manifest.baselineId);
    addSummary(summary, record);
  }
  return summary;
}
async function verifyCandidate(root, inventoryReport) {
  const frozen = loadFrozenCandidate(root);
  invariant(frozen.manifest.candidateId === inventoryReport.selectedCandidateId,
    "RETENTION_CANDIDATE_ID_DRIFT", frozen.manifest.candidateId);
  for (const expected of inventoryReport.requiredCandidateFiles) {
    const file = contained(root, expected.relativePath);
    invariant(fs.existsSync(file) && fileSize(file) === expected.size,
      "RETENTION_CANDIDATE_SIZE_DRIFT", expected.relativePath);
    invariant(await sha256File(file) === expected.sha256,
      "RETENTION_CANDIDATE_HASH_DRIFT", expected.relativePath);
  }
  return { candidateId: frozen.manifest.candidateId,
    v1Sha256: frozen.manifest.selection.v1Sha256,
    sourceSha256: frozen.manifest.build.sourceSha256,
    minifiedSha256: frozen.manifest.build.minifiedSha256 };
}
async function verify(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const inventoryReport = JSON.parse(fs.readFileSync(contained(root, INVENTORY_FILE), "utf8"));
  const verifiedBaselines = [];
  for (const spec of BASELINES) {
    const manifestFile = contained(root, RETENTION_ROOT, "baselines", spec.baselineId,
      "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
    invariant(manifest.fingerprint === fingerprintObject(manifest),
      "RETENTION_BASELINE_MANIFEST_FINGERPRINT", spec.baselineId);
    const summary = await readCompactSummary(root, manifest);
    invariant(JSON.stringify(summary) === JSON.stringify(manifest.summary),
      "RETENTION_BASELINE_SUMMARY_DRIFT", spec.baselineId);
    invariant(summary.records === spec.expectedRecords,
      "RETENTION_BASELINE_VERIFY_DENOMINATOR", spec.baselineId);
    for (const source of manifest.sourceFiles) {
      const file = contained(root, source.relativePath);
      invariant(fs.existsSync(file) && fileSize(file) === source.size,
        "RETENTION_SOURCE_SIZE_DRIFT", source.relativePath);
      invariant(await sha256File(file) === source.sha256,
        "RETENTION_SOURCE_HASH_DRIFT", source.relativePath);
    }
    verifiedBaselines.push({ baselineId: spec.baselineId, records: summary.records,
      v1Wins: summary.v1Wins, v2Wins: summary.v2Wins, draws: summary.draws,
      compact: manifest.compact, manifestFingerprint: manifest.fingerprint });
  }
  const candidate = await verifyCandidate(root, inventoryReport);
  const report = {
    schemaVersion: 1,
    objectKind: "ArtifactRetentionVerifiedPruneManifestV1",
    status: "VERIFIED",
    inventoryFingerprint: inventoryReport.fingerprint,
    candidate,
    baselines: verifiedBaselines,
    prune: inventoryReport.prune,
    expectedFreedBytes: inventoryReport.pruneBytes,
    fingerprint: ""
  };
  report.fingerprint = fingerprintObject(report);
  const file = contained(root, VERIFIED_FILE);
  atomicJson(file, report);
  return { report, file };
}
async function prune(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const manifestFile = path.resolve(options.manifestPath || contained(root, VERIFIED_FILE));
  const report = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  invariant(report.objectKind === "ArtifactRetentionVerifiedPruneManifestV1" &&
    report.status === "VERIFIED" && report.fingerprint === fingerprintObject(report),
  "RETENTION_PRUNE_MANIFEST_INVALID", manifestFile);
  await verifyCandidate(root, JSON.parse(fs.readFileSync(contained(root, INVENTORY_FILE), "utf8")));
  let deletedBytes = 0; let deletedFiles = 0;
  for (const entry of report.prune) {
    const file = contained(root, entry.relativePath);
    if (!fs.existsSync(file)) continue;
    invariant(fileSize(file) === entry.size, "RETENTION_PRUNE_SIZE_DRIFT", entry.relativePath);
    invariant(await sha256File(file) === entry.sha256,
      "RETENTION_PRUNE_HASH_DRIFT", entry.relativePath);
    fs.unlinkSync(file); deletedFiles += 1; deletedBytes += entry.size;
    if (typeof options.onProgress === "function" && (deletedFiles === 1 ||
        deletedFiles % 256 === 0 || deletedFiles === report.prune.length))
      options.onProgress(deletedFiles, report.prune.length, entry.relativePath);
  }
  const directories = walkDirectories(contained(root, "artifacts")).sort((a, b) => b.length - a.length);
  for (const directory of directories) {
    if (directory === contained(root, "artifacts")) continue;
    try { fs.rmdirSync(directory); } catch (error) {
      if (error.code !== "ENOTEMPTY" && error.code !== "EEXIST") throw error;
    }
  }
  const candidate = await verifyCandidate(root,
    JSON.parse(fs.readFileSync(contained(root, INVENTORY_FILE), "utf8")));
  const artifactBytesAfter = walk(contained(root, "artifacts"))
    .reduce((sum, file) => sum + fileSize(file), 0);
  invariant(artifactBytesAfter <= 32 * 1024 * 1024,
    "RETENTION_ARTIFACT_BUDGET_EXCEEDED", String(artifactBytesAfter));
  const receipt = { schemaVersion: 1, objectKind: "ArtifactRetentionPruneReceiptV1",
    status: "PRUNED", verifiedManifestFingerprint: report.fingerprint,
    deletedFiles, deletedBytes, artifactBytesAfter, candidate, fingerprint: "" };
  receipt.fingerprint = fingerprintObject(receipt);
  atomicJson(contained(root, RETENTION_ROOT, "prune-receipt.json"), receipt);
  return receipt;
}
function walkDirectories(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  output.push(directory);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }))
    if (entry.isDirectory()) walkDirectories(path.join(directory, entry.name), output);
  return output;
}

module.exports = { RETENTION_ROOT, INVENTORY_FILE, VERIFIED_FILE, BASELINES, SUMMARY_55_6,
  streamMatchObjects, compactMatch, inventory, compact, verify, prune };
