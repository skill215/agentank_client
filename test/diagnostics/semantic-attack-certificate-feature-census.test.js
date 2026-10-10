"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { proofLabel, splitRoots, atomicPredicates, predicateMatches,
  evaluateRule, discoverRules, crossTab } = require(
  "../../tools/agentank/diagnostics/semantic-attack-certificate-feature-census");

function item(key, sourceClass, executable, doomed = false, incomplete = false) {
  return { proof: { key, sourceClass, goals: [
    { name: "SAFE_THREAT_FIRE", executable,
      classification: incomplete ? "INCOMPLETE" : executable ?
        "PROVEN_ALL_WORLDS" : "NOT_PROVEN" },
    { name: "DOOMED_TARGET_FIRE", executable: doomed,
      classification: doomed ? "PROVEN_ALL_WORLDS" : "NOT_PROVEN" }
  ] } };
}

function record(key, positive, features) {
  return { key, label: { safeThreat: positive ? 1 : 0,
    doomedTarget: 0, incomplete: 0 }, sourceClass: "TEST",
    selectedAction: 1, features };
}

test("BP147 proof labels keep safe, doomed and incomplete facts separate", () => {
  assert.deepEqual(proofLabel(item("a", "X", true, true).proof),
    { safeThreat: 1, doomedTarget: 1, incomplete: 0 });
  assert.deepEqual(proofLabel(item("b", "X", false, false, true).proof),
    { safeThreat: 0, doomedTarget: 0, incomplete: 1 });
});

test("BP147 deterministic split is disjoint, exhaustive and stratum balanced", () => {
  const items = [];
  for (let index = 0; index < 12; index += 1)
    items.push(item("p" + index, "A", true));
  for (let index = 0; index < 14; index += 1)
    items.push(item("n" + index, "A", false));
  const first = splitRoots(items, "fixed"); const second = splitRoots(items, "fixed");
  assert.deepEqual([...first.discovery].sort(), [...second.discovery].sort());
  assert.equal(first.discovery.size + first.holdout.size, items.length);
  assert.equal([...first.discovery].filter(key => first.holdout.has(key)).length, 0);
  assert.equal([...first.discovery].filter(key => key[0] === "p").length, 6);
  assert.equal([...first.holdout].filter(key => key[0] === "p").length, 6);
});

test("BP147 rule metrics are exact and fail closed on omitted positives", () => {
  const records = [record("a", 1, { x: 2 }), record("b", 1, { x: 4 }),
    record("c", 0, { x: 5 }), record("d", 0, { x: 1 })];
  const rule = { predicates: [{ key: "x", operator: ">=", threshold: 2 }] };
  assert.equal(predicateMatches(records[0], rule.predicates[0]), true);
  assert.deepEqual(evaluateRule(records, rule), { truePositive: 2,
    falsePositive: 1, falseNegative: 0, trueNegative: 1, triggered: 3,
    recallPermille: 1000, precisionPermille: 666, reductionPermille: 250 });
});

test("BP147 discovery prefers a full-recall conjunction with fewer invocations", () => {
  const records = [record("p1", 1, { a: 1, b: 1 }),
    record("p2", 1, { a: 1, b: 1 }), record("n1", 0, { a: 1, b: 0 }),
    record("n2", 0, { a: 0, b: 1 }), record("n3", 0, { a: 0, b: 0 })];
  // The production feature list is fixed, so pad absent fields with zeros.
  const keys = require(
    "../../tools/agentank/diagnostics/semantic-attack-certificate-feature-census")
    .FEATURE_KEYS;
  for (const row of records) for (const key of keys)
    if (!Number.isSafeInteger(row.features[key])) row.features[key] = 0;
  records[0].features.enemyVisible = records[1].features.enemyVisible = 1;
  records[2].features.enemyVisible = 1;
  records[0].features.clearLineToEnemy = records[1].features.clearLineToEnemy = 1;
  records[3].features.clearLineToEnemy = 1;
  const discovered = discoverRules(records, 24);
  assert.equal(discovered.selected.metrics.recallPermille, 1000);
  assert.equal(discovered.selected.metrics.triggered, 2);
  assert.equal(discovered.selected.predicates.length, 2);
});

test("BP147 cross-tab reconciles proof and source denominators", () => {
  const records = [record("a", 1, {}), record("b", 0, {})];
  records[0].label.doomedTarget = 1; records[1].label.incomplete = 1;
  records[0].sourceClass = "KILL"; records[1].sourceClass = "MISS";
  const output = crossTab(records);
  assert.equal(output.rootCount, 2); assert.equal(output.positiveCount, 1);
  assert.equal(output.doomedCount, 1); assert.equal(output.incompleteCount, 1);
  assert.deepEqual(output.sourceClasses, { KILL: 1, MISS: 1 });
});

test("BP147 atomic predicates contain only integer feature comparisons", () => {
  const records = [record("a", 1, {}), record("b", 0, {})];
  const keys = require(
    "../../tools/agentank/diagnostics/semantic-attack-certificate-feature-census")
    .FEATURE_KEYS;
  for (const row of records) for (const key of keys) row.features[key] =
    key === "distance" ? (row.key === "a" ? 2 : 7) : 0;
  const predicates = atomicPredicates(records);
  assert.ok(predicates.some(item => item.key === "distance" &&
    item.operator === "<=" && item.threshold === 2));
  assert.ok(predicates.every(item => Number.isSafeInteger(item.threshold)));
});
