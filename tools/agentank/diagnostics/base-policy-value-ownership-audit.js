"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const IMPLEMENTATION = "V2_NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE";

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function read(directory) {
  const file = path.join(path.resolve(directory), "matches.ndjson.gz");
  const bytes = fs.readFileSync(file);
  const text = zlib.gunzipSync(bytes).toString("utf8").trim();
  return { directory: path.resolve(directory), sha256: sha256(bytes), rows:
    (text ? text.split("\n").map(JSON.parse) : []).filter(row =>
      row.implementation === IMPLEMENTATION) };
}

function key(row) {
  return `${row.scenarioFingerprint}:${row.candidateSeat}`;
}

function actionDifference(left, right) {
  return left.candidate.compactActionStream !== right.candidate.compactActionStream;
}

function summarize(rows) {
  let wins = 0; let losses = 0; let draws = 0; let stars = 0; let crashes = 0;
  let fire = 0; let runtime = 0; let decisions = 0; let nodes = 0;
  let nominalTieBreaks = 0; let hotAllocations = 0;
  let pathEvidenceMode = "unknown";
  for (const row of rows) {
    if (row.analysisOutcome === "V2_WIN") wins += 1;
    else if (row.analysisOutcome === "V1_WIN") losses += 1;
    else draws += 1;
    const seat = row.candidateSeat;
    stars += row.counts?.stars?.[seat] || 0;
    crashes += row.counts?.crashes?.[seat] || 0;
    fire += row.candidate?.actionCounts?.fire ||
      row.candidate?.actionCounts?.FIRE || 0;
    runtime += row.candidate?.totalRuntimeMicros || 0;
    decisions += row.candidate?.decisionCount || 0;
    const owner = row.candidate?.nativeTacticalActionOwner || {};
    const search = owner.policySearch || {};
    nodes += search.totalNodes || 0;
    nominalTieBreaks += owner.pathNominalTieBreakCount || 0;
    hotAllocations += (owner.hotAllocationCount || 0) +
      (search.hotAllocationCount || 0);
    if (search.pathEvidenceMode) pathEvidenceMode = search.pathEvidenceMode;
  }
  const total = wins + losses + draws;
  return { matches: total, wins, losses, draws,
    scoreBasisPoints: total ? Math.round((wins * 10000 + draws * 5000) / total) : 0,
    stars, crashes, fire, decisions, runtimeMicros: runtime,
    averageRuntimeMicros: decisions ? Math.trunc(runtime / decisions) : 0,
    totalNodes: nodes, pathNominalTieBreaks: nominalTieBreaks,
    hotAllocationCount: hotAllocations, pathEvidenceMode };
}

function compare(baseRows, candidateRows) {
  const base = new Map(baseRows.map(row => [key(row), row]));
  const transitions = {}; let common = 0; let actionDifferent = 0;
  let positive = 0; let negative = 0;
  const rank = { V1_WIN: 0, DRAW: 1, V2_WIN: 2 };
  for (const row of candidateRows) {
    const before = base.get(key(row)); if (!before) continue;
    common += 1;
    if (actionDifference(before, row)) actionDifferent += 1;
    const transition = `${before.analysisOutcome}->${row.analysisOutcome}`;
    transitions[transition] = (transitions[transition] || 0) + 1;
    if (rank[row.analysisOutcome] > rank[before.analysisOutcome]) positive += 1;
    else if (rank[row.analysisOutcome] < rank[before.analysisOutcome]) negative += 1;
  }
  return { common, actionDifferent, positiveTransitions: positive,
    negativeTransitions: negative, transitions };
}

function build(base, softRobust, softNominal) {
  return { objectKind: "BASE_POLICY_VALUE_OWNERSHIP_AUDIT_V1",
    modes: { ROBUST_BASE: summarize(base.rows),
      SOFT_IN_ROBUST: summarize(softRobust.rows),
      SOFT_NOMINAL_ONLY: summarize(softNominal.rows) },
    relativeToRobustBase: {
      SOFT_IN_ROBUST: compare(base.rows, softRobust.rows),
      SOFT_NOMINAL_ONLY: compare(base.rows, softNominal.rows)
    },
    directComparison: { SOFT_IN_ROBUST_TO_NOMINAL_ONLY:
      compare(softRobust.rows, softNominal.rows) } };
}

function run() {
  const output = path.resolve(option("--output", "/tmp/agentank-bp12-audit"));
  const base = read(option("--base"));
  const softRobust = read(option("--soft-robust"));
  const softNominal = read(option("--soft-nominal"));
  const overview = build(base, softRobust, softNominal);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "overview.json"),
    `${JSON.stringify(overview, null, 2)}\n`);
  const manifest = { objectKind: "BASE_POLICY_VALUE_OWNERSHIP_MANIFEST_V1",
    sources: { ROBUST_BASE: base.sha256, SOFT_IN_ROBUST: softRobust.sha256,
      SOFT_NOMINAL_ONLY: softNominal.sha256 },
    sourceSha256: sha256(fs.readFileSync(__filename)) };
  fs.writeFileSync(path.join(output, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, overview }, null, 2)}\n`);
  return overview;
}

if (require.main === module) run();

module.exports = { build, compare, summarize };
