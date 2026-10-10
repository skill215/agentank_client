"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { compare, compareRuntimeWinnerMetadata, fingerprint, firstScenarios,
  reusableArena, zero } = require(
  "../../tools/agentank/build/native-base-policy-upload-qualification");

function match(scenario, seat, action = "AQ==") {
  return { scenarioFingerprint: scenario, candidateSeat: seat, frames: 2,
    candidate: { compactActionStream: action, compactArguments: [] },
    result: { winnerSeat: seat, winnerImplementation: "v2", reason: "CRASH" },
    counts: { stars: [0, 0], crashes: [0, 1] },
    analysisOutcome: "V2_WIN", terminalCategory: "CRASH" };
}

test("upload qualification comparison ignores runtime and detects semantics", () => {
  const left = match("a", 0); const right = structuredClone(left);
  left.candidate.totalRuntimeMicros = 10;
  right.candidate.totalRuntimeMicros = 999;
  assert.equal(zero(compare([left], [right])), true);
  right.result.winnerSeat = 1;
  right.result.winnerImplementation = "v1";
  assert.equal(zero(compare([left], [right])), true);
  assert.equal(compareRuntimeWinnerMetadata([left], [right]), 1);
  right.candidate.compactActionStream = "Ag==";
  assert.equal(compare([left], [right]).actionStream, 1);
});

test("terminal reason remains part of upload equivalence", () => {
  const left = match("a", 0); const right = structuredClone(left);
  right.result.reason = "frameLimit";
  assert.equal(compare([left], [right]).resultReason, 1);
});

test("upload qualification fingerprint is order independent", () => {
  const a = match("a", 0); const b = match("b", 1);
  assert.deepEqual(fingerprint([a, b]), fingerprint([b, a]));
});

test("fixed scenario prefix keeps both seats", () => {
  const matches = [match("a", 0), match("a", 1), match("b", 0),
    match("b", 1), match("c", 0), match("c", 1)];
  assert.deepEqual(firstScenarios(matches, 2).map(item =>
    `${item.scenarioFingerprint}:${item.candidateSeat}`),
  ["a:0", "a:1", "b:0", "b:1"]);
});

test("arena reuse requires exact role, count and source binding", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "native-upload-"));
  fs.writeFileSync(path.join(directory, "overview.json"), JSON.stringify({
    role: "DISCOVERY", scenarioCount: 64,
    source: { candidateCode: "code-hash" } }));
  fs.writeFileSync(path.join(directory, "matches.ndjson.gz"), "fixture");
  assert.equal(reusableArena(directory, "DISCOVERY", 64, "code-hash"), true);
  assert.equal(reusableArena(directory, "DISCOVERY", 32, "code-hash"), false);
  assert.equal(reusableArena(directory, "DISCOVERY", 64, "other"), false);
  fs.rmSync(directory, { recursive: true, force: true });
});
