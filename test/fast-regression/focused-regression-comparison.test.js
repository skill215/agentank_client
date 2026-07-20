"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { compareFocusedReports } =
  require("../../tools/agentank/fast-regression/focused-regression-comparison");

function frame(number, dies, action = "GO", frameClass = "AVOIDABLE_UNDER_FIXED_CONTINUATION") {
  return { frame: number, distanceToTerminal: 0, currentSelectedDies: dies,
    currentSelectedAction: action, frameClass, rootDiagnostics: {},
    currentSelectedCandidate: { safety: "POSSIBLE_DEATH", robustLower: 0 }, branches: [] };
}

function report(source, primaryFrames, controlFrames) {
  return { cohort: { fingerprint: "cohort" }, execution: { workingSourceSha256: source },
    results: [{ fingerprint: "primary", matchId: "match-primary", role: "PRIMARY_LOSS",
      frames: primaryFrames }, { fingerprint: "control", matchId: "match-control",
      role: "STAR_WIN_CONTROL", frames: controlFrames }] };
}

test("focused comparison counts net rescue and exposes every survival regression", () => {
  const before = report("before", [frame(1, true), frame(2, false), frame(3, true)],
    [frame(4, false)]);
  const after = report("after", [frame(1, false, "TURN_LEFT"), frame(2, true, "FIRE"),
    frame(3, false, "TURN_RIGHT")], [frame(4, false)]);
  const result = compareFocusedReports(before, after);
  assert.equal(result.assessment, "NET_IMPROVEMENT_WITH_REGRESSIONS");
  assert.deepEqual(result.denominator, { frames: 4, primaryEntries: 1, primaryFrames: 3,
    controlFrames: 1, avoidablePrimaryFrames: 3 });
  assert.equal(result.primary.dieToSurvive, 2);
  assert.equal(result.primary.surviveToDie, 1);
  assert.equal(result.primary.netSurvivors, 1);
  assert.equal(result.controls.surviveToDie, 0);
  assert.equal(result.transitions.length, 3);
});

test("focused comparison uses role and match identity so repeated capsule frames do not collide", () => {
  const before = { cohort: { fingerprint: "cohort" }, results: [
    { fingerprint: "same", matchId: "loss", role: "PRIMARY_LOSS", frames: [frame(7, true)] },
    { fingerprint: "same", matchId: "control", role: "STAR_WIN_CONTROL", frames: [frame(7, false)] }
  ] };
  const after = structuredClone(before);
  const result = compareFocusedReports(before, after);
  assert.equal(result.denominator.frames, 2);
  assert.equal(result.primary.frames, 1);
  assert.equal(result.controls.frames, 1);
});
