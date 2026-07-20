#!/usr/bin/env node
"use strict";

const { AgentankToolError, invariant } = require("../core/errors");
const { redactText } = require("../core/sanitize");
const { runImp1ControlPlaneGate } = require("../harness/imp1-gate");

const HELP = `IMP1 multi-TankProfile control-plane toolchain

Usage:
  ./tools/imp1-toolchain.sh verify
  ./tools/imp1-toolchain.sh test

The verify gate runs local fault tests and attempts authenticated GET context only
for ACTIVE/READ_ONLY profiles. Missing rotated environment keys or unavailable
platform evidence remain NOT_RUN in the implementation gate and BLOCKED in stage
acceptance. No platform mutation endpoint is reachable.
`;

function printJson(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseVerifyOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    invariant(name === "--test-output" || name === "--test-exit-code", "UNKNOWN_IMP1_OPTION",
      `unknown IMP1 option: ${name}`);
    invariant(index + 1 < argv.length, "MISSING_IMP1_OPTION_VALUE", `${name} requires a value`);
    options[name.slice(2)] = argv[index + 1];
  }
  invariant(typeof options["test-output"] === "string", "TEST_OUTPUT_REQUIRED",
    "verify must be called through tools/imp1-toolchain.sh");
  const testExitCode = Number(options["test-exit-code"]);
  invariant(Number.isSafeInteger(testExitCode) && testExitCode >= 0, "INVALID_TEST_EXIT_CODE",
    "--test-exit-code must be a non-negative integer");
  return { testOutputFile: options["test-output"], testExitCode, environment: process.env };
}

async function execute(command, argv = []) {
  if (["help", "--help", "-h"].includes(command)) return { kind: "help", value: HELP };
  invariant(command === "verify", "UNKNOWN_IMP1_COMMAND", `unknown IMP1 command: ${command}`);
  const result = await runImp1ControlPlaneGate(undefined, parseVerifyOptions(argv));
  return { kind: "json", value: { operation: "imp1-verify", ...result.gate,
    gateFile: result.gateFile }, exitCode: result.gate.status === "PASS" ? 0 : 8 };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await execute(argv[0] || "help", argv.slice(1));
    if (result.kind === "help") process.stdout.write(result.value);
    else printJson(result.value);
    process.exitCode = result.exitCode || 0;
    return result;
  } catch (error) {
    const typed = error instanceof AgentankToolError ? error :
      new AgentankToolError("UNEXPECTED_IMP1_ERROR", error?.message || "unexpected IMP1 error",
        { exitCode: 9 });
    printJson({ ok: false, errorCode: typed.code, message: redactText(typed.message) }, process.stderr);
    process.exitCode = typed.exitCode;
    return { kind: "error", error: typed };
  }
}

if (require.main === module) main();

module.exports = { HELP, parseVerifyOptions, execute, main };
