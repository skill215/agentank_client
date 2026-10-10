#!/usr/bin/env node
"use strict";

const { fast, physical, tank, boxedMap } = require(
  "../../../test/imp3/helpers");
const { ATTACK_POLICY_GOAL, AttackPolicyReachabilitySearch } = require(
  "../diagnostics/attack-policy-reachability-shadow");
const { AttackEventPolicySearch, AttackEventPolicySnapshot } = require(
  "../../../engine-v2/src/search/attack-event-policy-search");
const { typedArrayBytes } = require("../build/imp6-builder");

function integer(index, fallback) {
  const value = Number(process.argv[index]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function fixture(mobile = false) {
  const map = boxedMap(8, 7);
  return fast.createFastPhysical(physical({
    map: { width: 8, height: 7, terrainColumnMajor: map },
    tanks: [tank(0, [1, 3], "up", { skillReadyFrame: 255 }),
      tank(1, [3, 3], "up", {
        frozenUntilFrame: mobile ? null : 10,
        skillReadyFrame: 255
      })]
  }));
}

function diagnostic(budget) {
  return new AttackPolicyReachabilitySearch(budget, {
    allowDebuffGoal: false,
    allowedGoalMask: ATTACK_POLICY_GOAL.ENEMY_CRASH,
    completeRootEnemyDomain: true
  });
}

function evaluate(search, built, depth, budget) {
  return search.evaluateCandidate(built, fast.ACTION.TURN_RIGHT,
    fast.NONE_CELL, ENEMY_ACTIONS, ENEMY_ARGUMENTS, 1, depth, budget);
}

function batch(search, cases, iterations, depth, budget) {
  let fingerprint = 0; let nodes = 0;
  const started = process.hrtime.bigint();
  for (let iteration = 0; iteration < iterations; iteration += 1)
    for (let index = 0; index < cases.length; index += 1) {
      const status = evaluate(search, cases[index], depth, budget);
      fingerprint = Math.imul(fingerprint ^ status ^ search.completedDepth,
        0x45d9f3b) ^ search.nodes;
      nodes += search.nodes;
    }
  return { micros: Number((process.hrtime.bigint() - started) / 1000n),
    fingerprint: fingerprint >>> 0, nodes };
}

function percentile(values, numerator, denominator) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1,
    Math.floor((sorted.length - 1) * numerator / denominator))];
}

const ENEMY_ACTIONS = Uint8Array.from([fast.ACTION.NONE]);
const ENEMY_ARGUMENTS = Uint16Array.from([fast.NONE_CELL]);
const batches = integer(2, 5); const iterations = integer(3, 100);
const warmup = integer(4, 30); const depth = integer(5, 4);
const budget = integer(6, 2048);
const cases = [fixture(false), fixture(true)];
const reference = diagnostic(budget); const lean = new AttackEventPolicySearch(budget);

batch(reference, cases, warmup, depth, budget);
batch(lean, cases, warmup, depth, budget);
const referenceMicros = []; const leanMicros = [];
let referenceNodes = 0; let leanNodes = 0; let fingerprint = 0;
for (let index = 0; index < batches; index += 1) {
  const first = index & 1 ? lean : reference;
  const second = index & 1 ? reference : lean;
  const firstResult = batch(first, cases, iterations, depth, budget);
  const secondResult = batch(second, cases, iterations, depth, budget);
  const referenceResult = index & 1 ? secondResult : firstResult;
  const leanResult = index & 1 ? firstResult : secondResult;
  if (referenceResult.fingerprint !== leanResult.fingerprint ||
      referenceResult.nodes !== leanResult.nodes)
    throw new Error("ATTACK_EVENT_POLICY_BENCHMARK_SEMANTIC_MISMATCH");
  referenceMicros.push(referenceResult.micros);
  leanMicros.push(leanResult.micros);
  referenceNodes += referenceResult.nodes; leanNodes += leanResult.nodes;
  fingerprint ^= referenceResult.fingerprint;
}
const referenceTotal = referenceMicros.reduce((sum, value) => sum + value, 0);
const leanTotal = leanMicros.reduce((sum, value) => sum + value, 0);
const result = {
  objectKind: "ATTACK_EVENT_POLICY_SEARCH_BENCHMARK_V1",
  nodeVersion: process.version, batches, iterations, warmup, depth, budget,
  cases: cases.length, semanticFingerprint: fingerprint >>> 0,
  reference: { typedArrayBytes: typedArrayBytes(reference),
    batchMicros: referenceMicros, totalMicros: referenceTotal,
    p95BatchMicros: percentile(referenceMicros, 95, 100), nodes: referenceNodes },
  lean: { typedArrayBytes: typedArrayBytes(lean),
    snapshotBytes: typedArrayBytes(new AttackEventPolicySnapshot(64)),
    batchMicros: leanMicros, totalMicros: leanTotal,
    p95BatchMicros: percentile(leanMicros, 95, 100), nodes: leanNodes },
  ratioBasisPoints: Math.floor(leanTotal * 10000 / Math.max(1, referenceTotal)),
  p95RatioBasisPoints: Math.floor(
    percentile(leanMicros, 95, 100) * 10000 /
    Math.max(1, percentile(referenceMicros, 95, 100)))
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

