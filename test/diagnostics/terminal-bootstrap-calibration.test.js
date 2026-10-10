"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { FEATURE_NAMES, featureVector, train, select, evaluate, crossValidate } =
  require("../../tools/agentank/diagnostics/terminal-bootstrap-calibration");

function label(row, robustLower, outcome) {
  return { row, acceptable: true, dominated: false, robustLower,
    expectedValue: robustLower, worstValue: robustLower,
    tacticalValue: robustLower, horizonFatalMass: 0, unknownMass: 0,
    escapeSlack: 4, earliestFatalFrame: 255, purposeCompleteness: 10000,
    optionRollout: { physicalComplete: true, rootRestored: true,
      mobility: 4, enemyMobility: 4 },
    responseMatrix: { policies: ["V2"], cells: [{ ownPolicy: "V2",
      enemyPolicy: "V2", terminal: { outcome, candidateStars: 0,
        controlStars: 0 } }] } };
}

function root(fingerprint, low, high) {
  return { scenarioFingerprint: fingerprint, candidateSeat: 0,
    root: { selectedRow: 0, labels: [low, high] } };
}

test("feature vector uses only coarse action semantics and integer context", () => {
  const value = featureVector(label(0, 1234, "DRAW"));
  assert.equal(value.length, FEATURE_NAMES.length);
  assert.ok(Array.from(value).every(Number.isInteger));
  assert.equal(FEATURE_NAMES.includes("semanticFire"), true);
  assert.equal(FEATURE_NAMES.some(name => name.includes("Left") ||
    name.includes("Right") || name.includes("row")), false);
});

test("coarse resource interactions distinguish far and contact roots", () => {
  const resource = label(0, 0, "DRAW");
  resource.action = { type: "poison" };
  const far = featureVector(resource, { frame: 20, searchEvidence: {
    ownEnemyDistance: 12, clearLineToEnemy: false, source: "NONE" } });
  const contact = featureVector(resource, { frame: 20, searchEvidence: {
    ownEnemyDistance: 7, clearLineToEnemy: false, source: "PHYSICAL" } });
  assert.equal(far[FEATURE_NAMES.indexOf("resourceFar")], 64);
  assert.equal(far[FEATURE_NAMES.indexOf("resourceContact")], 0);
  assert.equal(far[FEATURE_NAMES.indexOf("resourceNoSearch")], 64);
  assert.equal(contact[FEATURE_NAMES.indexOf("resourceFar")], 0);
  assert.equal(contact[FEATURE_NAMES.indexOf("resourceContact")], 64);
  assert.equal(contact[FEATURE_NAMES.indexOf("resourceNoSearch")], 0);
});

test("pairwise terminal training learns a repeatable better ordering", () => {
  const roots = [root("a", label(0, -1000, "V1_WIN"),
    label(1, 1000, "V2_WIN")), root("b", label(0, -500, "V1_WIN"),
    label(1, 500, "V2_WIN"))];
  const first = train(roots, 8); const second = train(roots, 8);
  assert.deepEqual(Array.from(first.weights), Array.from(second.weights));
  assert.equal(select(roots[0].root, first.weights).row, 1);
  const report = evaluate(roots, first.weights);
  assert.equal(report.improvedRoots, 2);
  assert.equal(report.regressedRoots, 0);
});

test("risk eligibility remains outside the learned value model", () => {
  const rejected = label(1, 1000, "V2_WIN"); rejected.acceptable = false;
  const item = root("c", label(0, -1000, "V1_WIN"), rejected);
  const model = train([item], 4);
  assert.equal(select(item.root, model.weights).row, 0);
});

test("scenario folds keep every root in exactly one validation fold", () => {
  const roots = [];
  for (let index = 0; index < 16; index += 1)
    roots.push(root(`scenario-${index}`, label(0, -100, "V1_WIN"),
      label(1, 100, "V2_WIN")));
  const report = crossValidate(roots, 4, 4);
  assert.equal(report.testedRoots, roots.length);
  assert.equal(report.foldReports.reduce((sum, item) =>
    sum + item.validationRoots, 0), roots.length);
});

test("response-conditioned training can target the actual V3 policy column", () => {
  const low = label(0, 1000, "V2_WIN");
  const high = label(1, -1000, "V1_WIN");
  low.responseMatrix.cells.push({ ownPolicy: "V2", enemyPolicy: "V3",
    terminal: { outcome: "V1_WIN", candidateStars: 0, controlStars: 0 } });
  high.responseMatrix.cells.push({ ownPolicy: "V2", enemyPolicy: "V3",
    terminal: { outcome: "V2_WIN", candidateStars: 0, controlStars: 0 } });
  const roots = [root("v3-a", low, high), root("v3-b", low, high)];
  const model = train(roots, 8, "v3-only");
  assert.equal(select(roots[0].root, model.weights).row, 1);
  assert.equal(evaluate(roots, model.weights, "v3-only").improvedRoots, 2);
});
