#!/usr/bin/env node
"use strict";

const { AgentankToolError, invariant } = require("../core/errors");
const { redactText } = require("../core/sanitize");
const { runImp2ReferenceGate } = require("../harness/imp2-gate");
const { runOfficialRuleProbe, runOfficialRuleProbeSuite, reconcileOfficialRuleProbe,
  reconcileOfficialRuleProbeSuite } = require("../platform/rule-probe");
const { assertSafeArgv } = require("../profiles/secret-ref");
const { reconcileRuntimeCapability } = require("../platform/capability-store");

const HELP = `IMP2 Reference Oracle toolchain

Usage:
  ./tools/imp2-toolchain.sh verify
  ./tools/imp2-toolchain.sh test
  ./tools/imp2-toolchain.sh probe --probe-id P2-FAILED-CAST --profile v2 --authorize-official-simulate
  ./tools/imp2-toolchain.sh probe-suite --authorize-official-simulate
  ./tools/imp2-toolchain.sh probe-reconcile --probe-id P2-FAILED-CAST
  ./tools/imp2-toolchain.sh probe-reconcile-suite
  ./tools/imp2-toolchain.sh probe-capability-reconcile --profile v2

The verify gate runs the complete local regression, validates the independent
ReferenceKernel, RuleCorpus, canonical traces, skill evidence and external-source
boundary. Missing official simulate probes remain NOT_RUN in the gate and BLOCKED
in stage acceptance; they are never replaced by guessed rules.
`;

function parseVerifyOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    invariant(name === "--test-output" || name === "--test-exit-code", "UNKNOWN_IMP2_OPTION",
      `unknown IMP2 option: ${name}`);
    invariant(index + 1 < argv.length, "MISSING_IMP2_OPTION_VALUE", `${name} requires a value`);
    options[name.slice(2)] = argv[index + 1];
  }
  invariant(typeof options["test-output"] === "string", "TEST_OUTPUT_REQUIRED",
    "verify must be called through tools/imp2-toolchain.sh");
  const testExitCode = Number(options["test-exit-code"]);
  invariant(Number.isSafeInteger(testExitCode) && testExitCode >= 0, "INVALID_TEST_EXIT_CODE",
    "--test-exit-code must be a non-negative integer");
  return { testOutputFile: options["test-output"], testExitCode };
}

function printJson(value, stream = process.stdout) { stream.write(`${JSON.stringify(value, null, 2)}\n`); }

function parseProbeOptions(argv) {
  assertSafeArgv(argv); const options = { authorized: false };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--authorize-official-simulate") { options.authorized = true; continue; }
    invariant(name === "--probe-id" || name === "--profile", "UNKNOWN_IMP2_PROBE_OPTION",
      `unknown IMP2 probe option: ${name}`);
    invariant(index + 1 < argv.length, "MISSING_IMP2_PROBE_OPTION_VALUE", `${name} requires a value`);
    options[name === "--probe-id" ? "probeId" : "profileId"] = argv[index + 1]; index += 1;
  }
  invariant(typeof options.probeId === "string" && typeof options.profileId === "string",
    "IMP2_PROBE_OPTIONS_REQUIRED", "probe requires --probe-id and --profile");
  return options;
}

async function execute(command, argv = []) {
  if (["help", "--help", "-h"].includes(command)) return { kind: "help", value: HELP };
  if (command === "probe") {
    const result = await runOfficialRuleProbe({ ...parseProbeOptions(argv), environment: process.env });
    return { kind: "json", value: { operation: "imp2-official-rule-probe", ...result.evidence,
      evidenceFile: result.evidenceFile } };
  }
  if (command === "probe-suite") {
    assertSafeArgv(argv);
    invariant(argv.length === 1 && argv[0] === "--authorize-official-simulate",
      "INVALID_PROBE_SUITE_OPTIONS",
      "probe-suite requires exactly --authorize-official-simulate");
    const result = await runOfficialRuleProbeSuite({ authorized: true, environment: process.env });
    return { kind: "json", value: { operation: "imp2-official-rule-probe-suite", ...result } };
  }
  if (command === "probe-reconcile") {
    invariant(argv.length === 2 && argv[0] === "--probe-id", "INVALID_PROBE_RECONCILE_OPTIONS",
      "probe-reconcile requires exactly --probe-id");
    const result = reconcileOfficialRuleProbe({ probeId: argv[1] });
    return { kind: "json", value: { operation: "imp2-rule-probe-reconcile", ...result.evidence,
      evidenceFile: result.evidenceFile } };
  }
  if (command === "probe-reconcile-suite") {
    invariant(argv.length === 0, "INVALID_PROBE_RECONCILE_SUITE_OPTIONS",
      "probe-reconcile-suite takes no options");
    const result = reconcileOfficialRuleProbeSuite();
    return { kind: "json", value: { operation: "imp2-rule-probe-reconcile-suite", ...result } };
  }
  if (command === "probe-capability-reconcile") {
    invariant(argv.length === 2 && argv[0] === "--profile",
      "INVALID_PROBE_CAPABILITY_RECONCILE_OPTIONS",
      "probe-capability-reconcile requires exactly --profile");
    const result = reconcileRuntimeCapability({ profileId: argv[1] });
    return { kind: "json", value: { operation: "imp2-runtime-capability-reconcile",
      profileId: result.profile.profileId, fingerprint: result.profile.fingerprint,
      relativePath: result.relativePath } };
  }
  invariant(command === "verify", "UNKNOWN_IMP2_COMMAND", `unknown IMP2 command: ${command}`);
  const result = runImp2ReferenceGate(undefined, parseVerifyOptions(argv));
  return { kind: "json", value: { operation: "imp2-verify", ...result.gate,
    gateFile: result.gateFile, officialProbeStatus: result.probes.status },
  exitCode: result.gate.status === "PASS" ? 0 : 8 };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const result = await execute(argv[0] || "help", argv.slice(1));
    if (result.kind === "help") process.stdout.write(result.value); else printJson(result.value);
    process.exitCode = result.exitCode || 0; return result;
  } catch (error) {
    const typed = error instanceof AgentankToolError ? error :
      new AgentankToolError("UNEXPECTED_IMP2_ERROR", error?.message || "unexpected IMP2 error",
        { exitCode: 9 });
    printJson({ ok: false, errorCode: typed.code, message: redactText(typed.message) }, process.stderr);
    process.exitCode = typed.exitCode; return { kind: "error", error: typed };
  }
}

if (require.main === module) main();
module.exports = { HELP, parseVerifyOptions, parseProbeOptions, execute, main };
