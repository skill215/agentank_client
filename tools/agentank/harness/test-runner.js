"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { ensureDirectory, writeFileAtomic, writeJsonAtomic } = require("../core/atomic-file");
const { sha256Text, fingerprintObject } = require("../core/hash");
const { invariant } = require("../core/errors");

function collectTests(directory, output) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collectTests(file, output);
    else if (entry.isFile() && entry.name.endsWith(".test.js")) output.push(file);
  }
}

function parseTapCount(output, name) {
  const match = output.match(new RegExp(`^# ${name} (\\d+)$`, "m"));
  return match ? Number(match[1]) : 0;
}

function summarizeTestOutput(workspaceRoot = defaultWorkspaceRoot(), rawOutputFile, exitCode,
  outputDirectory, options = {}) {
  const root = path.resolve(workspaceRoot);
  const tests = [];
  for (const directoryName of options.testDirectories || ["imp0", "platform"]) {
    collectTests(path.join(root, "test", directoryName), tests);
  }
  tests.sort();
  const directory = outputDirectory || path.join(root, "artifacts", "reports", "imp0");
  ensureDirectory(directory);
  invariant(typeof rawOutputFile === "string", "TEST_OUTPUT_REQUIRED",
    "stage verify requires test output produced by its wrapper");
  const inputFile = path.resolve(rawOutputFile);
  invariant(inputFile === directory || inputFile.startsWith(`${directory}${path.sep}`),
    "TEST_OUTPUT_PATH_INVALID", "test output must be inside the stage report directory");
  invariant(fs.existsSync(inputFile), "TEST_OUTPUT_NOT_FOUND", "test output file does not exist");
  invariant(Number.isSafeInteger(exitCode) && exitCode >= 0, "INVALID_TEST_EXIT_CODE",
    "test exit code must be a non-negative integer");
  const output = fs.readFileSync(inputFile, "utf8");
  const tapFile = path.join(directory, "test-output.tap");
  writeFileAtomic(tapFile, output, { mode: 0o644 });
  if (inputFile !== tapFile && fs.existsSync(inputFile)) fs.unlinkSync(inputFile);
  const count = parseTapCount(output, "tests");
  const pass = parseTapCount(output, "pass");
  const fail = parseTapCount(output, "fail");
  const report = {
    schemaVersion: 1,
    status: exitCode === 0 && tests.length > 0 && count > 0 && pass > 0 && fail === 0 ? "PASS" : "FAIL",
    testFileCount: tests.length,
    tests: count,
    pass,
    fail,
    skipped: parseTapCount(output, "skipped"),
    exitCode,
    rawOutputSha256: sha256Text(output),
    fingerprint: ""
  };
  report.fingerprint = fingerprintObject(report);
  writeJsonAtomic(path.join(directory, "test-report.json"), report, { mode: 0o644 });
  return { report, output, tapFile };
}

module.exports = { collectTests, parseTapCount, summarizeTestOutput };
