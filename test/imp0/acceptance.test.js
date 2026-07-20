"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { sha256Bytes } = require("../../tools/agentank/core/hash");
const { verifyEvidenceArtifact, assertTapTitles, evaluateCriterion } =
  require("../../tools/agentank/acceptance/imp0");
const { parseStage, execute } = require("../../tools/agentank/cli/implementation-ops");

test("acceptance evidence rehash rejects a tampered manifest entry", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-acceptance-"));
  const directory = path.join(root, "artifacts", "reports", "imp0", "history");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "sample.txt");
  fs.writeFileSync(file, "evidence");
  const entry = { artifactId: "sample", relativePath:
    path.relative(root, file), sha256: sha256Bytes(Buffer.from("evidence")) };
  assert.equal(verifyEvidenceArtifact(root, entry).bytes.toString("utf8"), "evidence");
  assert.throws(() => verifyEvidenceArtifact(root, { ...entry, sha256: "0".repeat(64) }),
    { code: "ACCEPTANCE_EVIDENCE_SHA_MISMATCH" });
});

test("acceptance requires both TAP declaration and passing result", () => {
  const title = "negative control";
  assert.equal(assertTapTitles(`# Subtest: ${title}\nok 1 - ${title}\n`, [title]), 1);
  assert.throws(() => assertTapTitles(`# Subtest: ${title}\nnot ok 1 - ${title}\n`, [title]),
    { code: "ACCEPTANCE_REQUIRED_TEST_NOT_PASS" });
});

test("criterion exceptions become explicit FAIL rather than disappearing", () => {
  const result = evaluateCriterion("A0-01", () => {
    const error = new Error("broken");
    error.code = "EXPECTED_BREAK";
    throw error;
  });
  assert.deepEqual(result, { criterionId: "A0-01", status: "FAIL",
    evidence: { errorCode: "EXPECTED_BREAK" } });
});

test("stage parser is closed and the next unsupported future adapter fails closed", () => {
  assert.equal(parseStage(["--stage", "IMP0"]), "IMP0");
  assert.throws(() => parseStage(["--stage", "IMP11"]), { code: "INVALID_ACCEPTANCE_STAGE" });
  assert.throws(() => execute("accept", ["--stage", "IMP10"]),
    { code: "STAGE_ACCEPTANCE_NOT_IMPLEMENTED" });
});

test("one implementation acceptance entrypoint reruns the stage gate", () => {
  const root = path.resolve(__dirname, "../..");
  const source = fs.readFileSync(path.join(root, "tools", "implementation-toolchain.sh"), "utf8");
  assert.match(source, /imp0-toolchain\.sh" verify/);
  assert.match(source, /imp1-toolchain\.sh" verify/);
  assert.match(source, /imp2-toolchain\.sh" verify/);
  assert.match(source, /imp3-toolchain\.sh" verify/);
  assert.match(source, /imp4-toolchain\.sh" verify/);
  assert.match(source, /imp5-toolchain\.sh" verify/);
  assert.match(source, /imp6-toolchain\.sh" verify/);
  assert.match(source, /imp7-toolchain\.sh" verify/);
  assert.match(source, /imp8-toolchain\.sh" verify/);
  assert.match(source, /imp9-toolchain\.sh" verify/);
  assert.match(source, /implementation-ops\.js/);
  assert.match(source, /accept --stage/);
});
