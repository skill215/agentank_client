#!/usr/bin/env node
"use strict";

const { AgentankToolError, invariant } = require("../core/errors");
const { redactText } = require("../core/sanitize");
const { runImp4Gate } = require("../harness/imp4-gate");

const HELP = `IMP4 Value, Matrix, Information Proof and Robust Risk toolchain

Usage:
  ./tools/imp4-toolchain.sh test
  ./tools/imp4-toolchain.sh verify
  ./tools/implementation-toolchain.sh accept --stage IMP4

The gate runs the complete IMP0-IMP4 regression plus exhaustive small-state,
strict proof, recursive risk, full best-response, capacity and hot-layout audits.
It performs no platform mutation and contains no IMP5 evaluation/opponent/Plan policy.
`;
function parseVerifyOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]; invariant(name === "--test-output" || name === "--test-exit-code",
      "UNKNOWN_IMP4_OPTION", `unknown IMP4 option: ${name}`);
    invariant(index + 1 < argv.length, "MISSING_IMP4_OPTION_VALUE", `${name} requires a value`);
    options[name.slice(2)] = argv[index + 1];
  }
  invariant(typeof options["test-output"] === "string", "TEST_OUTPUT_REQUIRED",
    "verify must be called through tools/imp4-toolchain.sh");
  const testExitCode = Number(options["test-exit-code"]);
  invariant(Number.isSafeInteger(testExitCode) && testExitCode >= 0, "INVALID_TEST_EXIT_CODE",
    "--test-exit-code must be a non-negative integer");
  return { testOutputFile: options["test-output"], testExitCode };
}
function printJson(value, stream = process.stdout) { stream.write(`${JSON.stringify(value, null, 2)}\n`); }
function execute(command, argv = []) {
  if (["help", "--help", "-h"].includes(command)) return { kind: "help", value: HELP };
  invariant(command === "verify", "UNKNOWN_IMP4_COMMAND", `unknown IMP4 command: ${command}`);
  const result = runImp4Gate(undefined, parseVerifyOptions(argv));
  return { kind: "json", value: { operation: "imp4-verify", ...result.gate,
    gateFile: result.gateFile }, exitCode: result.gate.status === "PASS" ? 0 : 8 };
}
function main(argv = process.argv.slice(2)) {
  try {
    const result = execute(argv[0] || "help", argv.slice(1));
    if (result.kind === "help") process.stdout.write(result.value); else printJson(result.value);
    process.exitCode = result.exitCode || 0; return result;
  } catch (error) {
    const typed = error instanceof AgentankToolError ? error :
      new AgentankToolError("UNEXPECTED_IMP4_ERROR", error?.message || "unexpected IMP4 error",
        { exitCode: 9 });
    printJson({ ok: false, errorCode: typed.code, message: redactText(typed.message) }, process.stderr);
    process.exitCode = typed.exitCode; return { kind: "error", error: typed };
  }
}
if (require.main === module) main();
module.exports = { HELP, parseVerifyOptions, execute, main };
