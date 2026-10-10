"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { classifyAnalysisOutcome, pairCategory } = require("../analysis/analysis-outcome");

function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

function loadFixedCohort(root, baseline) {
  const summaryRelativePath = baseline.fixedCohort.summaryRelativePath;
  if (summaryRelativePath) {
    const summaryFile = contained(root, summaryRelativePath);
    const summaryBytes = fs.readFileSync(summaryFile); const summary = JSON.parse(summaryBytes);
    invariant(summary.fingerprint === fingerprintObject(summary), "SR0_SUMMARY_FINGERPRINT_INVALID",
      summaryRelativePath);
    const attestation = summary.acceptanceAttestation;
    const acceptanceFile = contained(root, attestation.relativePath);
    const acceptanceBytes = fs.readFileSync(acceptanceFile); const acceptance = JSON.parse(acceptanceBytes);
    invariant(sha256Bytes(acceptanceBytes) === attestation.sha256 &&
      acceptance.fingerprint === attestation.fingerprint &&
      acceptance.fingerprint === fingerprintObject(acceptance) &&
      acceptance.status === attestation.status,
    "SR0_ACCEPTANCE_ATTESTATION_INVALID", attestation.relativePath);
    return { summary, summaryFile, summarySha256: sha256Bytes(summaryBytes), matches: null };
  }
  const overviewFile = contained(root, baseline.fixedCohort.overviewRelativePath);
  const overviewBytes = fs.readFileSync(overviewFile); const overview = JSON.parse(overviewBytes);
  invariant(overview.fingerprint === fingerprintObject(overview), "SR0_OVERVIEW_FINGERPRINT_INVALID",
    baseline.fixedCohort.overviewRelativePath);
  const matches = [];
  for (const ref of overview.reports) {
    const reportFile = contained(root, ref.relativePath); const report = readJson(reportFile);
    invariant(report.fingerprint === ref.fingerprint && report.fingerprint === fingerprintObject(report),
      "SR0_ROLE_REPORT_FINGERPRINT_INVALID", ref.relativePath);
    matches.push(...report.matches);
  }
  return { overview, overviewFile, overviewSha256: sha256Bytes(overviewBytes), matches };
}

function rawPlatformFingerprint(matches) {
  return fingerprintObject({ matches: matches.map(match => ({ matchId: match.matchId,
    winnerSeat: match.result?.winnerSeat ?? null,
    winnerImplementation: match.result?.winnerImplementation ?? null,
    reason: match.result?.reason ?? null })) });
}

function analyzeFixedCohort(root, baseline) {
  const loaded = loadFixedCohort(root, baseline);
  if (loaded.summary) {
    const summary = loaded.summary;
    return { schemaVersion: 1, reportKind: "SR0_ANALYSIS_COHORT",
      cohort: { summaryRelativePath: baseline.fixedCohort.summaryRelativePath,
        summarySha256: loaded.summarySha256, overviewRelativePath: summary.prunedSource.relativePath,
        overviewFingerprint: summary.prunedSource.fingerprint, ...summary.cohort },
      analysisCounts: { ...summary.analysisCounts }, seatPairs: { ...summary.seatPairs },
      terminalCategories: { ...summary.terminalCategories },
      rawPlatform: { beforeFingerprint: null, afterFingerprint: null, unchanged: true,
        mutationCount: summary.verification.mutationCountAtAcceptance,
        verificationMode: summary.verification.mode,
        sourcePayloadRetained: summary.sourcePayloadRetained }, fingerprint: "" };
  }
  const before = rawPlatformFingerprint(loaded.matches);
  const counts = { V1_WIN: 0, V2_WIN: 0, DRAW: 0 }; const terminalCategories = {};
  const pairMembers = new Map();
  for (const match of loaded.matches) {
    const classified = classifyAnalysisOutcome(match); counts[classified.analysisOutcome] += 1;
    terminalCategories[classified.terminalCategory] =
      (terminalCategories[classified.terminalCategory] || 0) + 1;
    const key = `${match.historicalMatchUrlId}:${match.repetition}:${match.family}`;
    const pair = pairMembers.get(key) || []; pair.push(classified); pairMembers.set(key, pair);
  }
  const seatPairs = { V2_SWEEP: 0, V1_SWEEP: 0, SPLIT: 0, V2_WIN_DRAW: 0,
    V1_WIN_DRAW: 0, DOUBLE_DRAW: 0 };
  for (const [key, pair] of pairMembers) {
    invariant(pair.length === 2, "SR0_SEAT_PAIR_INCOMPLETE", key);
    seatPairs[pairCategory(pair[0], pair[1])] += 1;
  }
  const after = rawPlatformFingerprint(loaded.matches);
  return { schemaVersion: 1, reportKind: "SR0_ANALYSIS_COHORT",
    cohort: { overviewRelativePath: baseline.fixedCohort.overviewRelativePath,
      overviewSha256: loaded.overviewSha256, overviewFingerprint: loaded.overview.fingerprint,
      scenarioCount: loaded.overview.execution.scenarioCount,
      repetitions: loaded.overview.execution.repetitions,
      variants: 4, matchCount: loaded.matches.length, pairCount: pairMembers.size },
    analysisCounts: counts, seatPairs, terminalCategories,
    rawPlatform: { beforeFingerprint: before, afterFingerprint: after,
      unchanged: before === after, mutationCount: 0 }, fingerprint: "" };
}

function verifyExpectedCohort(report, expected) {
  const checks = [];
  const add = (id, actual, wanted) => checks.push({ checkId: id,
    status: actual === wanted ? "PASS" : "FAIL", evidence: { actual, expected: wanted } });
  add("MATCH_DENOMINATOR", report.cohort.matchCount, expected.matchCount);
  add("PAIR_DENOMINATOR", report.cohort.pairCount, expected.pairCount);
  for (const key of ["V1_WIN", "V2_WIN", "DRAW"])
    add(`ANALYSIS_${key}`, report.analysisCounts[key], expected.expectedAnalysis[key]);
  for (const key of ["V2_SWEEP", "V1_SWEEP", "SPLIT", "V2_WIN_DRAW", "V1_WIN_DRAW", "DOUBLE_DRAW"])
    add(`PAIR_${key}`, report.seatPairs[key], expected.expectedAnalysis[key]);
  add("FRAME_LIMIT_EQUAL_STAR_DRAW", report.terminalCategories.FRAME_LIMIT_EQUAL_STARS || 0,
    expected.expectedAnalysis.FRAME_LIMIT_EQUAL_STAR_DRAW);
  add("MUTUAL_CRASH_EQUAL_STAR_DRAW", report.terminalCategories.MUTUAL_CRASH_EQUAL_STARS || 0,
    expected.expectedAnalysis.MUTUAL_CRASH_EQUAL_STAR_DRAW);
  add("RAW_PLATFORM_IMMUTABLE", report.rawPlatform.unchanged, true);
  return checks;
}

function verifyHistoricalCandidate(root, baseline) {
  const spec = baseline.historicalCandidate; const manifestFile = contained(root, spec.manifestRelativePath);
  const manifestBytes = fs.readFileSync(manifestFile); const manifest = JSON.parse(manifestBytes);
  const candidateRoot = path.dirname(manifestFile);
  const sourceFile = contained(root, manifest.build.sourceRelativePath);
  const minifiedFile = contained(root, manifest.build.minifiedRelativePath);
  const actual = { manifestSha256: sha256Bytes(manifestBytes), sourceSha256:
    sha256Bytes(fs.readFileSync(sourceFile)), minifiedSha256: sha256Bytes(fs.readFileSync(minifiedFile)) };
  const immutable = actual.manifestSha256 === spec.manifestSha256 &&
    actual.sourceSha256 === spec.sourceSha256 && actual.minifiedSha256 === spec.minifiedSha256;
  return { candidateId: manifest.candidateId, candidateRootRelativePath: path.relative(root, candidateRoot),
    status: immutable ? "PASS" : "FAIL", immutable, publishEligible: false,
    historicalImp9Status: "REJECTED", actual, expected: { manifestSha256: spec.manifestSha256,
      sourceSha256: spec.sourceSha256, minifiedSha256: spec.minifiedSha256 } };
}

module.exports = { loadFixedCohort, rawPlatformFingerprint, analyzeFixedCohort,
  verifyExpectedCohort, verifyHistoricalCandidate };
