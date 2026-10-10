"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, NONE_CELL } = require("../../engine-v2/src/abi/fast-codes");
const { FastState, ARRAY, SCALAR } = require(
  "../../engine-v2/src/state/fast-state");
const { actionCode, responseQuality, qualityCompare, bestSamePolicy, entriesFor,
  TerminalOracleInterventionPoc } =
  require("../../tools/agentank/diagnostics/terminal-oracle-intervention-poc");

function label(row, action, outcome, extra = {}) {
  return { row, action, acceptable: true, dominated: false, ...extra,
    responseMatrix: { policies: ["V2"], cells: [{ ownPolicy: "V2",
      enemyPolicy: "V2", terminal: { outcome, candidateStars: 0,
        controlStars: 0 } }] } };
}

test("terminal oracle chooses only strict same-policy improvement", () => {
  const root = { selectedRow: 0, labels: [
    label(0, { type: "poison" }, "V1_WIN"),
    label(1, { type: "go" }, "V2_WIN") ] };
  assert.equal(bestSamePolicy(root).row, 1);
  root.labels[1].acceptable = false;
  assert.equal(bestSamePolicy(root), null);
});

test("epsilon backup keeps one percent worst-response contamination", () => {
  const value = label(0, { type: "go" }, "V2_WIN");
  value.responseMatrix.cells.push({ ownPolicy: "V2", enemyPolicy: "V3",
    terminal: { outcome: "V1_WIN", candidateStars: 0, controlStars: 0 } });
  const expected = responseQuality(value, "expected");
  const epsilon = responseQuality(value, "epsilon-1");
  assert.deepEqual(expected.values.slice(0, 2), [2, 0]);
  assert.deepEqual(epsilon.values.slice(0, 2), [198, 0]);
  assert.equal(qualityCompare(epsilon, expected), 1);
});

test("terminal oracle entries preserve exact scenario seat and hashes", () => {
  const root = { frame: 7, hashLo: 11, hashHi: 13, selectedRow: 0,
    labels: [label(0, { type: "turn", side: "left" }, "V1_WIN"),
      label(1, { type: "fire" }, "V2_WIN")] };
  const documents = [{ matches: [{ scenarioFingerprint: "wanted",
    candidateSeat: 1, roots: [root] }, { scenarioFingerprint: "other",
    candidateSeat: 1, roots: [root] }] }];
  assert.deepEqual(entriesFor(documents, "wanted", 1), [{ frame: 7,
    hashLo: 11, hashHi: 13, action: ACTION.FIRE, argument: NONE_CELL,
    selectedRow: 0, oracleRow: 1 }]);
});

test("exact hash intervention still passes the current final gate", () => {
  const state = new FastState(7, 7); state.hashLo = 11; state.hashHi = 13;
  state.arrays[ARRAY.SCALAR][SCALAR.FRAME] = 7;
  const documents = [{ matches: [{ scenarioFingerprint: "wanted",
    candidateSeat: 0, roots: [{ frame: 7, hashLo: 11, hashHi: 13,
      selectedRow: 0, labels: [label(0, { type: "poison" }, "V1_WIN"),
        label(1, { type: "fire" }, "V2_WIN")] }] }] }];
  const oracle = new TerminalOracleInterventionPoc(documents, "wanted", 0);
  const engine = { adapter: { state, bundle: {} }, ourCount: 2,
    ourActions: new Uint8Array([ACTION.CAST_POISON, ACTION.FIRE]),
    ourArguments: new Uint16Array([NONE_CELL, NONE_CELL]),
    finalGate: { finalAllows() { return true; } } };
  assert.deepEqual(oracle.selectOverride(engine, ACTION.CAST_POISON, NONE_CELL),
    { action: ACTION.FIRE, argument: NONE_CELL });
  assert.equal(oracle.summary().overrideCount, 1);
  assert.equal(oracle.selectOverride(engine, ACTION.CAST_POISON, NONE_CELL), null);
});

test("action code conversion is semantic and does not use row identity", () => {
  assert.equal(actionCode({ type: "turn", side: "right" }), ACTION.TURN_RIGHT);
  assert.equal(actionCode({ type: "throwBomb" }), ACTION.THROW_BOMB);
  assert.equal(actionCode({ type: "unknown" }), -1);
});
