#!/usr/bin/env node
"use strict";

const { AgentankToolError, invariant } = require("../core/errors");
const { redactText } = require("../core/sanitize");
const { runImp3Gate } = require("../harness/imp3-gate");

const HELP = `IMP3 FastKernel, Hazard and HardGate toolchain

Usage:
  ./tools/imp3-toolchain.sh test
  ./tools/imp3-toolchain.sh verify
  ./tools/implementation-toolchain.sh accept --stage IMP3

The gate runs the complete IMP0-IMP3 regression, Reference/Fast differential,
root restore, committed hazard, per-action Hard, overflow and hot-structure audits.
It performs no platform mutation and contains no IMP4 value/risk search.
`;

function parseVerifyOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]; invariant(name === "--test-output" || name === "--test-exit-code",
      "UNKNOWN_IMP3_OPTION", `unknown IMP3 option: ${name}`);
    invariant(index + 1 < argv.length, "MISSING_IMP3_OPTION_VALUE", `${name} requires a value`);
    options[name.slice(2)] = argv[index + 1];
  }
  invariant(typeof options["test-output"] === "string", "TEST_OUTPUT_REQUIRED",
    "verify must be called through tools/imp3-toolchain.sh");
  const testExitCode = Number(options["test-exit-code"]);
  invariant(Number.isSafeInteger(testExitCode) && testExitCode >= 0, "INVALID_TEST_EXIT_CODE",
    "--test-exit-code must be a non-negative integer");
  return { testOutputFile: options["test-output"], testExitCode };
}
function printJson(value, stream = process.stdout) { stream.write(`${JSON.stringify(value, null, 2)}\n`); }
function execute(command, argv = []) {
  if (["help", "--help", "-h"].includes(command)) return { kind: "help", value: HELP };
  invariant(command === "verify", "UNKNOWN_IMP3_COMMAND", `unknown IMP3 command: ${command}`);
  const result = runImp3Gate(undefined, parseVerifyOptions(argv));
  return { kind: "json", value: { operation: "imp3-verify", ...result.gate,
    gateFile: result.gateFile }, exitCode: result.gate.status === "PASS" ? 0 : 8 };
}
function main(argv = process.argv.slice(2)) {
  try {
    const result = execute(argv[0] || "help", argv.slice(1));
    if (result.kind === "help") process.stdout.write(result.value); else printJson(result.value);
    process.exitCode = result.exitCode || 0; return result;
  } catch (error) {
    const typed = error instanceof AgentankToolError ? error :
      new AgentankToolError("UNEXPECTED_IMP3_ERROR", error?.message || "unexpected IMP3 error",
        { exitCode: 9 });
    printJson({ ok: false, errorCode: typed.code, message: redactText(typed.message) }, process.stderr);
    process.exitCode = typed.exitCode; return { kind: "error", error: typed };
  }
}
if (require.main === module) main();
module.exports = { HELP, parseVerifyOptions, execute, main };
