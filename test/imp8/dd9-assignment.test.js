"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadDd9Assignment, idsForRole, EXPECTED_ASSIGNMENT_FINGERPRINT } =
  require("../../tools/agentank/simulation/dd9-assignment");
const { scenariosForIds } = require("../../tools/agentank/simulation/historical-scenarios");

test("DD9 membership is derived from the manifest-selected frozen corpus with the locked fingerprint", () => {
  const { assignment } = loadDd9Assignment();
  assert.equal(assignment.assignmentFingerprint, EXPECTED_ASSIGNMENT_FINGERPRINT);
  assert.equal(assignment.groupCount, 162);
  assert.deepEqual(assignment.counts,
    { FROZEN_REGRESSION: 63, DISCOVERY: 125, CALIBRATION: 56 });
  assert.equal(idsForRole(assignment, "FROZEN_REGRESSION").length, 63);
});

test("historical scenarios preserve map, starts and the recorded star sequence", () => {
  const { assignment, manifest } = loadDd9Assignment();
  const id = idsForRole(assignment, "CALIBRATION")[0];
  const [scenario] = scenariosForIds(manifest, [id]);
  assert.equal(scenario.matchUrlId, id);
  assert.equal(scenario.starts.length, 2);
  assert.ok(scenario.map.length > 0);
  assert.ok(scenario.stars.length > 0);
  assert.equal(scenario.stars[0].frame, 0);
});
