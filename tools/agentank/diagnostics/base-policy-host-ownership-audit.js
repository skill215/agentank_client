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

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
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

function summarize(rows) {
  let wins = 0; let losses = 0; let draws = 0; let fire = 0; let skills = 0;
  const owner = { proposals: 0, overrides: 0, budgetBlocked: 0,
    exactBlocked: 0, budgetCompleteRoots: 0, exactRoots: 0,
    hotAllocationCount: 0 };
  for (const row of rows) {
    if (row.analysisOutcome === "V2_WIN") wins += 1;
    else if (row.analysisOutcome === "V1_WIN") losses += 1;
    else draws += 1;
    fire += row.candidate?.actionCounts?.fire || 0;
    skills += row.counts?.skills?.[row.candidateSeat] || 0;
    const current = row.candidate?.nativeTacticalActionOwner || {};
    const search = current.policySearch || {};
    owner.proposals += current.proposalCount || 0;
    owner.overrides += current.overrideCount || 0;
    owner.budgetBlocked += current.policySearchStrictSupportBlockedCount || 0;
    owner.exactBlocked += current.policySearchExactSupportBlockedCount || 0;
    owner.budgetCompleteRoots += search.strictOwnershipRootCount || 0;
    owner.exactRoots += search.exactOwnershipRootCount || 0;
    owner.hotAllocationCount += (current.hotAllocationCount || 0) +
      (search.hotAllocationCount || 0);
  }
  const total = wins + losses + draws;
  return { matches: total, wins, losses, draws,
    scoreBasisPoints: total ? Math.round(
      (wins * 10000 + draws * 5000) / total) : 0,
    fire, skills, owner };
}

function compare(baseRows, candidateRows) {
  const rank = { V1_WIN: 0, DRAW: 1, V2_WIN: 2 };
  const base = new Map(baseRows.map(row => [key(row), row]));
  let common = 0; let actionDifferent = 0; let positive = 0; let negative = 0;
  const transitions = {}; const changed = [];
  for (const row of candidateRows) {
    const before = base.get(key(row)); if (!before) continue;
    common += 1;
    const actionChanged = before.candidate.compactActionStream !==
      row.candidate.compactActionStream;
    if (actionChanged) actionDifferent += 1;
    const transition = `${before.analysisOutcome}->${row.analysisOutcome}`;
    transitions[transition] = (transitions[transition] || 0) + 1;
    if (rank[row.analysisOutcome] > rank[before.analysisOutcome]) positive += 1;
    else if (rank[row.analysisOutcome] < rank[before.analysisOutcome]) negative += 1;
    if (actionChanged || before.analysisOutcome !== row.analysisOutcome)
      changed.push({ matchUrlId: row.matchUrlId,
        scenarioFingerprint: row.scenarioFingerprint,
        candidateSeat: row.candidateSeat, transition, actionChanged });
  }
  return { common, actionDifferent, positiveTransitions: positive,
    negativeTransitions: negative, transitions, changed };
}

function build(v3, budget, exact) {
  return { objectKind: "BASE_POLICY_HOST_OWNERSHIP_AUDIT_V1",
    modes: { V3_ONLY: summarize(v3.rows),
      BUDGET_COMPLETE_OVERRIDE: summarize(budget.rows),
      VALUE_EXACT_OVERRIDE: summarize(exact.rows) },
    relativeToV3: { BUDGET_COMPLETE_OVERRIDE: compare(v3.rows, budget.rows),
      VALUE_EXACT_OVERRIDE: compare(v3.rows, exact.rows) } };
}

function run() {
  const output = path.resolve(option("--output", "/tmp/agentank-bp13-audit"));
  const v3 = read(option("--v3")); const budget = read(option("--budget"));
  const exact = read(option("--exact")); const overview = build(v3, budget, exact);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "overview.json"),
    `${JSON.stringify(overview, null, 2)}\n`);
  fs.writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify({
    objectKind: "BASE_POLICY_HOST_OWNERSHIP_MANIFEST_V1",
    sources: { V3_ONLY: v3.sha256, BUDGET_COMPLETE_OVERRIDE: budget.sha256,
      VALUE_EXACT_OVERRIDE: exact.sha256 },
    sourceSha256: sha256(fs.readFileSync(__filename))
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, overview }, null, 2)}\n`);
  return overview;
}

if (require.main === module) run();

module.exports = { build, compare, summarize };
