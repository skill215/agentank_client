#!/usr/bin/env node
"use strict";

const { AgentankToolError, invariant } = require("../core/errors");
const { redactText } = require("../core/sanitize");
const { runImp5Gate } = require("../harness/imp5-gate");

const HELP = `IMP5 integer evaluation, strategy, opponent, skill and Plan toolchain

Usage:
  ./tools/imp5-toolchain.sh test
  ./tools/imp5-toolchain.sh verify
  ./tools/implementation-toolchain.sh accept --stage IMP5

The gate reruns IMP0-IMP5 regression, strict-isolation fixtures and per-feature,
per-opponent-event and per-Plan P95/P99 inventories. It performs no platform mutation.
`;
function parseVerifyOptions(argv) { const options = {};
  for (let index = 0; index < argv.length; index += 2) { const name = argv[index];
    invariant(name === "--test-output" || name === "--test-exit-code", "UNKNOWN_IMP5_OPTION",
      `unknown IMP5 option: ${name}`); invariant(index + 1 < argv.length,
      "MISSING_IMP5_OPTION_VALUE", `${name} requires a value`); options[name.slice(2)] = argv[index + 1]; }
  invariant(typeof options["test-output"] === "string", "TEST_OUTPUT_REQUIRED",
    "verify must be called through tools/imp5-toolchain.sh"); const testExitCode = Number(options["test-exit-code"]);
  invariant(Number.isSafeInteger(testExitCode) && testExitCode >= 0, "INVALID_TEST_EXIT_CODE",
    "--test-exit-code must be a non-negative integer"); return { testOutputFile: options["test-output"], testExitCode };
}
function printJson(value, stream = process.stdout) { stream.write(`${JSON.stringify(value, null, 2)}\n`); }
function execute(command, argv = []) { if (["help", "--help", "-h"].includes(command))
    return { kind: "help", value: HELP }; invariant(command === "verify", "UNKNOWN_IMP5_COMMAND",
    `unknown IMP5 command: ${command}`); const result = runImp5Gate(undefined, parseVerifyOptions(argv));
  return { kind: "json", value: { operation: "imp5-verify", ...result.gate,
    gateFile: result.gateFile }, exitCode: result.gate.status === "PASS" ? 0 : 8 }; }
function main(argv = process.argv.slice(2)) { try { const result = execute(argv[0] || "help", argv.slice(1));
    if (result.kind === "help") process.stdout.write(result.value); else printJson(result.value);
    process.exitCode = result.exitCode || 0; return result; } catch (error) {
    const typed = error instanceof AgentankToolError ? error : new AgentankToolError(
      "UNEXPECTED_IMP5_ERROR", error?.message || "unexpected IMP5 error", { exitCode: 9 });
    printJson({ ok: false, errorCode: typed.code, message: redactText(typed.message) }, process.stderr);
    process.exitCode = typed.exitCode; return { kind: "error", error: typed }; } }
if (require.main === module) main();
module.exports = { HELP, parseVerifyOptions, execute, main };
