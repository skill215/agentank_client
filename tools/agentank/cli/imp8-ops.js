#!/usr/bin/env node
"use strict";

const { AgentankToolError, invariant } = require("../core/errors");
const { redactText } = require("../core/sanitize");
const { runImp8Gate } = require("../harness/imp8-gate");
const { runImp8Calibration } = require("../calibration/imp8-runner");

const HELP = `IMP8 calibration, reproducible build and Candidate preflight toolchain

Usage:
  ./tools/imp8-toolchain.sh test
  ./tools/imp8-toolchain.sh calibrate
  ./tools/imp8-toolchain.sh verify
  ./tools/implementation-toolchain.sh accept --stage IMP8

Calibration and the gate are offline-only and fail-closed. BLOCKED is expected
while parameter selection, Candidate freeze and Frozen execution are incomplete.
It performs no platform request, simulation, publish, challenge or mutation.
`;

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    invariant(["--test-output", "--test-exit-code"].includes(argv[index]) && index + 1 < argv.length,
      "UNKNOWN_IMP8_OPTION", argv[index]);
    options[argv[index].slice(2)] = argv[index + 1];
  }
  const code = Number(options["test-exit-code"]);
  invariant(options["test-output"] && Number.isSafeInteger(code), "IMP8_TEST_OUTPUT_REQUIRED",
    "use tools/imp8-toolchain.sh");
  return { testOutputFile: options["test-output"], testExitCode: code };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const command = argv[0] || "help";
    if (["help", "-h", "--help"].includes(command)) { process.stdout.write(HELP); return; }
    if (command === "calibrate") { invariant(argv.length === 1,
      "UNKNOWN_IMP8_CALIBRATION_OPTION", argv.slice(1).join(" "));
      const result = await runImp8Calibration(); process.stdout.write(`${JSON.stringify({
        operation: "imp8-calibrate", status: result.report.status,
        calibrationStatus: result.report.calibrationStatus,
        candidateCount: result.report.candidateMatrix.length,
        invariants: result.report.invariants, selection: result.report.selection,
        fingerprint: result.report.fingerprint, reportFile: result.reportFile
      }, null, 2)}\n`); process.exitCode = result.report.status === "PASS" ? 0 : 9; return; }
    invariant(command === "verify", "UNKNOWN_IMP8_COMMAND", command);
    const result = await runImp8Gate(undefined, parse(argv.slice(1)));
    process.stdout.write(`${JSON.stringify({ operation: "imp8-verify", ...result.gate,
      gateFile: result.gateFile }, null, 2)}\n`);
    process.exitCode = result.gate.status === "PASS" ? 0 : 8;
  } catch (error) {
    const typed = error instanceof AgentankToolError ? error :
      new AgentankToolError("UNEXPECTED_IMP8_ERROR", error.message);
    process.stderr.write(`${JSON.stringify({ ok: false, errorCode: typed.code,
      message: redactText(typed.message) })}\n`);
    process.exitCode = typed.exitCode || 9;
  }
}

if (require.main === module) main();
module.exports = { HELP, parse, main };
