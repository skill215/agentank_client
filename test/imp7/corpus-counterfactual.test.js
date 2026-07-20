"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { imp7Evidence } = require("./helpers");
const { appendEntries, makeHead, makeSnapshot, assignClosedCohorts, corpusPolicy,
  semanticValidateEntries } = require("../../tools/agentank/corpus/ledger");
const { DualTrackReplay, policyAction, divergence } = require("../../tools/agentank/corpus/dual-track");
const { positiveProtection } = require("../../tools/agentank/corpus/windows");
const { BidirectionalCounterfactualRunner } = require("../../tools/agentank/corpus/counterfactual");
const { InformationGraph } = require("../../engine-v2/src/search/graph");
const { VALUE_MIN, VALUE_MAX } = require("../../engine-v2/src/abi/search-codes");
const { validateSchemaObject } = require("../../tools/agentank/core/schema-validator");

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function graphFor(cells) { const graph = new InformationGraph(); const children = cells.map(value => graph.addTerminal(value));
  return { graph, root: graph.addSimultaneous(2, 2, new Uint16Array(children)) }; }

test("dynamic ledger count comes from artifacts and append duplicate late rebuild remains stable", () => {
  const first = imp7Evidence(); assert.equal(first.entries.length, first.source.artifactCount);
  assert.ok(first.entries.length > first.legacy.uniqueMatches); const duplicate = appendEntries(first.entries, [clone(first.entries[0])]);
  assert.equal(duplicate.entries.length, first.entries.length); assert.equal(duplicate.duplicates, 1);
  const late = clone(first.entries[0]); late.matchUrlId = "mat_imp7SyntheticLate";
  late.replayHash = "a".repeat(64); late.createdAt = "2020-01-01T00:00:00.000Z";
  late.entrySha256 = ""; const appended = appendEntries(first.entries, [late]);
  assert.equal(appended.entries.at(-1).matchUrlId, late.matchUrlId);
  assert.equal(appendEntries(appended.entries, [late]).entries.length, appended.entries.length);
  const policy = corpusPolicy("2026-07-16T07:06:52.703Z"); const firstSession = assignClosedCohorts(
    [first.entries[0]], policy, Date.parse(first.entries[0].createdAt) + policy.allowedLatenessMs + 1);
  const relatedLate = clone(first.entries[0]); relatedLate.matchUrlId = "mat_imp7RelatedLate";
  relatedLate.createdAt = new Date(Date.parse(first.entries[0].createdAt) + 1000).toISOString();
  const stable = assignClosedCohorts([first.entries[0], relatedLate], policy,
    Date.parse(relatedLate.createdAt) + policy.allowedLatenessMs + 1, firstSession);
  assert.deepEqual(stable[0], firstSession[0]); assert.deepEqual(stable[1].relatedClosedCohortIds, [firstSession[0].cohortId]);
});

test("subject profile identity isolates v1 v2 and future denominators", () => {
  const evidence = imp7Evidence(); assert.equal(evidence.snapshots.v1.matchUrlIds.length, evidence.entries.length);
  assert.equal(evidence.snapshots.v2.matchUrlIds.length, 0); assert.deepEqual(evidence.snapshots.v1.subjectTankProfileIds, ["v1"]);
  assert.deepEqual(evidence.snapshots.v2.subjectTankProfileIds, ["v2"]);
  assert.deepEqual(evidence.analysis.denominator.profileCounts, { v1: evidence.entries.length });
});

test("legacy roots remain immutable while missing skill runtime terminal facts stay UNKNOWN", () => {
  const evidence = imp7Evidence(); assert.equal(evidence.legacy.status, "PASS");
  assert.equal(evidence.legacy.artifactRoot, "c985073623505f9a463d97ca410fffea35e0ff5206593257bbfb7d1f65718f9a");
  const unknownSkills = evidence.entries.filter(entry => entry.enemySkill.skillId === "UNKNOWN");
  assert.ok(unknownSkills.length > 0); assert.ok(unknownSkills.every(entry => entry.enemySkill.provenance === "UNKNOWN"));
  assert.ok(evidence.entries.every(entry => entry.terminal.runtimeMs.every(value => value === null || value >= 0)));
});

test("L0 through L4 classify infrastructure before reproducible failure positive windows and metrics", () => {
  const { analysis } = imp7Evidence(); assert.equal(analysis.status, "PASS");
  for (const level of ["L0", "L1", "L2", "L3", "L4"]) assert.ok(analysis.levelCounts[level] > 0);
  assert.equal(analysis.levelCounts.L0, analysis.denominator.matchCount);
  assert.ok(analysis.windows.some(window => window.windowType === "FAILURE"));
  assert.ok(analysis.windows.some(window => window.windowType === "SKILL_VALUE"));
  assert.ok(analysis.windows.every(window => Number.isSafeInteger(window.metrics.moves)));
});

test("policy reads only side ObservedTrack and divergence consumes zero historical suffix", () => {
  const records = [[{ type: "tank", action: "go", objectId: "ours", position: [1, 1] },
    { type: "skill", action: "cast", by: 1, skillType: "cloak", secret: 1 }]];
  const left = new DualTrackReplay(1).ingest(records, ["ours", "enemy"]);
  const changed = clone(records); changed[0][1].secret = 999;
  const right = new DualTrackReplay(1).ingest(changed, ["ours", "enemy"]);
  assert.notDeepEqual(left.truth(0), right.truth(0)); assert.deepEqual(left.observation(0, 0), right.observation(0, 0));
  assert.equal(policyAction(left.observation(0, 0)), policyAction(right.observation(0, 0)));
  assert.equal(divergence(left.truth(0), right.truth(0), 0).historicalSuffixConsumedFrames, 0);
  assert.throws(() => policyAction(left.truth(0)), /policy cannot receive TruthTrack/);
});

test("bidirectional counterfactual uses symmetric quantifiers assumptions and independent observations", () => {
  const runner = new BidirectionalCounterfactualRunner(); const observations = [
    { signatureLo: 1, signatureHi: 2, unknownMask: 0 }, { signatureLo: 3, signatureHi: 4, unknownMask: 0 }];
  const checkpoint = { checkpointId: "synthetic-symmetric", frame: 2, baselineObservations: observations,
    candidateObservations: observations, supportComplete: true, observationComplete: true,
    ruleComplete: true, assumptionMask: 0, graphBySide: [graphFor([VALUE_MAX, VALUE_MIN, VALUE_MAX, VALUE_MAX]),
      graphFor([VALUE_MIN, VALUE_MIN, VALUE_MIN, VALUE_MIN])] };
  const result = runner.runBoth(checkpoint); assert.equal(result[0].label, "ROBUST_AVOIDABLE");
  assert.equal(result[1].label, "STRICT_UNAVOIDABLE"); assert.deepEqual(result[0].quantifiers, result[1].quantifiers);
  assert.notEqual(result[0].observationSignature, result[1].observationSignature);
  for (const item of result) validateSchemaObject("imp7-counterfactual-result", item);
  const trap = { ...checkpoint, checkpointId: "matrix-trap", graphBySide: [
    graphFor([VALUE_MIN, VALUE_MAX, VALUE_MAX, VALUE_MIN]), checkpoint.graphBySide[1]] };
  assert.equal(runner.run(trap, 0).label, "UNKNOWN");
});

test("positive kill escape bomb skill and endgame windows block systematic safety regression", () => {
  const types = ["KILL", "ESCAPE", "BOMB_ESCAPE", "SKILL_VALUE", "TERMINAL_TRADE", "STAR_DEADLINE"];
  const baseline = types.map(windowType => ({ windowType })); assert.equal(positiveProtection(baseline, baseline).status, "PASS");
  const candidate = baseline.filter(item => item.windowType !== "KILL"); const result = positiveProtection(baseline, candidate);
  assert.equal(result.status, "FAIL"); assert.deepEqual(result.regressions[0], { windowType: "KILL", before: 1, after: 0 });
});

test("duplicate conflict partial schema and provenance faults fail closed", () => {
  const evidence = imp7Evidence(); const conflict = clone(evidence.entries[0]); conflict.artifacts.raw.sha256 = "b".repeat(64);
  assert.throws(() => appendEntries(evidence.entries, [conflict]), error => error.code === "LEDGER_CONFLICT");
  const invalid = clone(evidence.entries); invalid[0].enemySkill = { skillId: "UNKNOWN", provenance: "OBSERVED_CAST", evidenceArtifactIds: [] };
  invalid[0].entrySha256 = "0".repeat(64);
  assert.throws(() => semanticValidateEntries(invalid, process.cwd(), { verifyArtifacts: false }));
  const partial = clone(evidence.entries[0]); delete partial.artifacts.raw;
  assert.throws(() => validateSchemaObject("corpus", partial));
  assert.ok(fs.existsSync(evidence.files.ledgerFile));
});

test("G5 G6 denominators trace every result to immutable snapshot and cohort", () => {
  const evidence = imp7Evidence(); const { analysis } = evidence;
  assert.equal(analysis.snapshotRef.snapshotId, evidence.snapshots.v1.snapshotId);
  assert.equal(analysis.denominator.matchCount, evidence.snapshots.v1.matchUrlIds.length);
  const cohortIds = new Set(["legacy-dd9", ...evidence.cohorts.map(cohort => cohort.cohortId)]);
  assert.ok(analysis.windows.every(window => window.snapshotId === evidence.snapshots.v1.snapshotId && cohortIds.has(window.cohortId)));
  assert.ok(evidence.cohorts.length > 0); assert.ok(evidence.cohorts.every(cohort => cohort.matchUrlIds.length > 0));
  const policy = corpusPolicy(evidence.source.generatedAt); const head = makeHead(evidence.entries, policy, evidence.source.generatedAt);
  const snapshot = makeSnapshot(evidence.entries, head, policy, "v1");
  assert.equal(snapshot.matchSetRoot, evidence.snapshots.v1.matchSetRoot);
  assert.ok(assignClosedCohorts(evidence.entries.slice(-22), policy, Date.parse(evidence.source.generatedAt)).length > 0);
});
