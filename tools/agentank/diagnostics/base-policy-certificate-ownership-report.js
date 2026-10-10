"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const IMPLEMENTATION = "V2_NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE";

function option(name) {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : null;
}

function load(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory,
    "manifest.json"), "utf8"));
  const rows = zlib.gunzipSync(fs.readFileSync(path.join(directory,
    "matches.ndjson.gz"))).toString("utf8").trim().split("\n")
    .filter(Boolean).map(JSON.parse)
    .filter(row => row.implementation === IMPLEMENTATION);
  return { directory, manifest, rows };
}

function key(row) {
  return [row.matchUrlId, row.scenarioFingerprint, row.candidateSeat,
    row.seatSkills.join(",")].join("|");
}

function summary(run) {
  const result = { matches: run.rows.length, wins: 0, losses: 0, draws: 0,
    fire: 0, skills: 0, starDifference: 0, candidateDeaths: 0,
    opponentDeaths: 0, proofChecks: 0, proven: 0, exactDominance: 0,
    restoreFailures: 0 };
  for (const row of run.rows) {
    if (row.analysisOutcome === "V2_WIN") result.wins += 1;
    else if (row.analysisOutcome === "V1_WIN") result.losses += 1;
    else result.draws += 1;
    const seat = row.candidateSeat;
    result.fire += row.candidate.actionCounts.fire || 0;
    result.skills += row.counts.skills[seat] || 0;
    result.starDifference += (row.counts.stars[seat] || 0) -
      (row.counts.stars[seat ^ 1] || 0);
    result.candidateDeaths += row.counts.crashes[seat] || 0;
    result.opponentDeaths += row.counts.crashes[seat ^ 1] || 0;
    const owner = row.candidate.nativeCandidateForcedWin || {};
    result.proofChecks += owner.proofCheckCount || 0;
    result.proven += owner.provenCount || 0;
    result.exactDominance += owner.exactDominanceCount || 0;
    result.restoreFailures += owner.restoreFailureCount || 0;
  }
  result.scoreBasisPoints = Math.round(
    (result.wins + result.draws / 2) * 10000 / result.matches);
  return result;
}

function compare(baseline, candidate) {
  const base = new Map(baseline.rows.map(row => [key(row), row]));
  const transitions = {}; const differences = [];
  for (const row of candidate.rows) {
    const prior = base.get(key(row));
    if (!prior) throw new Error(`BP17_BASELINE_ROW_MISSING:${key(row)}`);
    const left = Buffer.from(prior.candidate.compactActionStream, "base64");
    const right = Buffer.from(row.candidate.compactActionStream, "base64");
    const actions = [];
    for (let frame = 0; frame < Math.max(left.length, right.length); frame += 1)
      if (left[frame] !== right[frame]) actions.push(
        [frame, left[frame] ?? -1, right[frame] ?? -1]);
    if (!actions.length && prior.analysisOutcome === row.analysisOutcome) continue;
    const transition = `${prior.analysisOutcome}->${row.analysisOutcome}`;
    transitions[transition] = (transitions[transition] || 0) + 1;
    differences.push({ matchUrlId: row.matchUrlId,
      scenarioFingerprint: row.scenarioFingerprint,
      candidateSeat: row.candidateSeat, transition,
      reason: [prior.result.reason, row.result.reason],
      frames: [prior.frames, row.frames],
      stars: [prior.counts.stars, row.counts.stars],
      actionDifferences: actions });
  }
  return { streamDifferenceMatches: differences.length, transitions, differences };
}

function main() {
  const shadow = load(option("--shadow"));
  const forced = load(option("--forced"));
  const exact = load(option("--exact"));
  const fingerprint = shadow.manifest.cohortFingerprint;
  for (const run of [forced, exact])
    if (run.manifest.cohortFingerprint !== fingerprint)
      throw new Error("BP17_COHORT_FINGERPRINT_MISMATCH");
  const report = { objectKind: "BASE_POLICY_CERTIFICATE_OWNERSHIP_REPORT_V1",
    cohortFingerprint: fingerprint,
    source: shadow.manifest.source,
    shadow: summary(shadow), forcedWin: summary(forced),
    policyExact: summary(exact),
    forcedWinComparison: compare(shadow, forced),
    policyExactComparison: compare(shadow, exact),
    conclusion: {
      directRootCertificateImprovesScore: false,
      forcedWinRole: "SPARSE_TERMINAL_INSURANCE",
      policyExactRole: "SPARSE_FINITE_POLICY_EVIDENCE",
      nextBoundary: "MINIMAX_RESPONSE_ENVELOPE_FOR_LONG_HORIZON_PROPOSALS"
    } };
  const output = option("--output");
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, text);
  } else process.stdout.write(text);
}

if (require.main === module) main();

module.exports = { load, summary, compare };
