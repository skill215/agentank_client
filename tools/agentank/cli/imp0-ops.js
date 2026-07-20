#!/usr/bin/env node
"use strict";

const { AgentankToolError, invariant } = require("../core/errors");
const { redactText } = require("../core/sanitize");
const { runBenchmarkPlan } = require("../benchmark/runner");
const { auditProductionTree } = require("../build/production-policy");
const { loadFixtureSet } = require("../harness/fixture-loader");
const { runImp0FoundationGate } = require("../harness/foundation-gate");
const { auditWorkspaceStructure } = require("../harness/structure-audit");
const { inspectToolVersions } = require("../harness/tool-versions");

const HELP = `IMP0 engineering foundation toolchain

Usage:
  ./tools/imp0-toolchain.sh verify
  ./tools/imp0-toolchain.sh benchmark
  ./tools/imp0-toolchain.sh fixtures
  ./tools/imp0-toolchain.sh audit-structure
  ./tools/imp0-toolchain.sh audit-production
  ./tools/imp0-toolchain.sh toolchain
  ./tools/imp0-toolchain.sh test

The verify command is the only supported IMP0 gate. It makes no network request
and performs no AgentTank platform mutation. Zero-sample benchmark layers return
NOT_RUN, never PASS.
`;

function printJson(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function parseVerifyOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    invariant(name === "--test-output" || name === "--test-exit-code", "UNKNOWN_IMP0_OPTION",
      `unknown IMP0 option: ${name}`);
    invariant(index + 1 < argv.length, "MISSING_IMP0_OPTION_VALUE", `${name} requires a value`);
    options[name.slice(2)] = argv[index + 1];
  }
  invariant(typeof options["test-output"] === "string", "TEST_OUTPUT_REQUIRED",
    "verify must be called through tools/imp0-toolchain.sh");
  const testExitCode = Number(options["test-exit-code"]);
  invariant(Number.isSafeInteger(testExitCode) && testExitCode >= 0, "INVALID_TEST_EXIT_CODE",
    "--test-exit-code must be a non-negative integer");
  return { testOutputFile: options["test-output"], testExitCode };
}

function execute(command, argv = []) {
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      return { kind: "help", value: HELP };
    case "verify": {
      const result = runImp0FoundationGate(undefined, parseVerifyOptions(argv));
      return { kind: "json", value: { operation: "imp0-verify", ...result.gate,
        gateFile: result.gateFile }, exitCode: result.gate.status === "PASS" ? 0 : 8 };
    }
    case "benchmark":
      return { kind: "json", value: runBenchmarkPlan() };
    case "fixtures": {
      const loaded = loadFixtureSet();
      return { kind: "json", value: { ...loaded.summary, fingerprint: loaded.fingerprint } };
    }
    case "audit-structure":
      return { kind: "json", value: auditWorkspaceStructure() };
    case "audit-production":
      return { kind: "json", value: auditProductionTree() };
    case "toolchain":
      return { kind: "json", value: inspectToolVersions() };
    default:
      throw new AgentankToolError("UNKNOWN_IMP0_COMMAND", `unknown IMP0 command: ${command}`);
  }
}

function main(argv = process.argv.slice(2)) {
  try {
    const result = execute(argv[0] || "help", argv.slice(1));
    if (result.kind === "help") process.stdout.write(result.value);
    else printJson(result.value);
    process.exitCode = result.exitCode || 0;
    return result;
  } catch (error) {
    const typed = error instanceof AgentankToolError ? error :
      new AgentankToolError("UNEXPECTED_IMP0_ERROR", error?.message || "unexpected IMP0 error",
        { exitCode: 9 });
    printJson({ ok: false, errorCode: typed.code, message: redactText(typed.message) }, process.stderr);
    process.exitCode = typed.exitCode;
    return { kind: "error", error: typed };
  }
}

if (require.main === module) main();

module.exports = { HELP, parseVerifyOptions, execute, main };
