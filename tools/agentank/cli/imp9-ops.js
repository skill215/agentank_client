#!/usr/bin/env node
"use strict";

const { AgentankToolError, invariant } = require("../core/errors");
const { redactText } = require("../core/sanitize");
const { runImp9Preflight } = require("../release/imp9-preflight");
const { runImp9Gate } = require("../harness/imp9-gate");
const { runOfficialSimulationSuite, reconcileOfficialSimulationAttempt, runOfficialPublish } =
  require("../release/imp9-runner");
const { assertSafeArgv } = require("../profiles/secret-ref");

const HELP = `IMP9 official simulation and controlled canary gate

Usage:
  ./tools/imp9-toolchain.sh preflight
  ./tools/imp9-toolchain.sh test
  ./tools/imp9-toolchain.sh verify
  ./tools/imp9-toolchain.sh simulate --authorize-simulation
  ./tools/imp9-toolchain.sh reconcile-simulation
  ./tools/imp9-toolchain.sh publish --authorize-publish --authorization-id <id> --submitted-by <name>
  ./tools/implementation-toolchain.sh accept --stage IMP9

Preflight is offline and resolves no secret. Verify is fail-closed: it cannot
simulate or publish while IMP8 is not ACCEPTED and the Candidate is not frozen.
No IMP9 command exposes a challenge endpoint.
`;

function parseMutation(argv, command) {
  assertSafeArgv(argv); const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--authorize-simulation" || key === "--authorize-publish") {
      options[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = true; continue;
    }
    invariant(["--authorization-id", "--submitted-by", "--notes"].includes(key) && index + 1 < argv.length,
      "UNKNOWN_IMP9_MUTATION_OPTION", key);
    options[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++index];
  }
  if (command === "simulate") invariant(options.authorizeSimulation === true &&
    Object.keys(options).length === 1, "IMP9_SIMULATION_AUTHORIZATION_REQUIRED",
  "simulate requires only --authorize-simulation");
  else invariant(options.authorizePublish === true, "IMP9_PUBLISH_AUTHORIZATION_REQUIRED",
    "publish requires --authorize-publish");
  return options;
}

function parse(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    invariant(["--test-output", "--test-exit-code"].includes(argv[index]) && index + 1 < argv.length,
      "UNKNOWN_IMP9_OPTION", argv[index]);
    options[argv[index].slice(2)] = argv[index + 1];
  }
  const code = Number(options["test-exit-code"]);
  invariant(options["test-output"] && Number.isSafeInteger(code), "IMP9_TEST_OUTPUT_REQUIRED",
    "use tools/imp9-toolchain.sh");
  return { testOutputFile: options["test-output"], testExitCode: code };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const command = argv[0] || "help";
    if (["help", "-h", "--help"].includes(command)) { process.stdout.write(HELP); return; }
    if (command === "preflight") {
      invariant(argv.length === 1, "UNKNOWN_IMP9_OPTION", argv.slice(1).join(" "));
      const result = runImp9Preflight(); process.stdout.write(`${JSON.stringify({
        operation: "imp9-preflight", status: result.report.status, blockers: result.report.blockers,
        operationAudit: result.report.operationAudit, fingerprint: result.report.fingerprint,
        reportFile: result.immutable }, null, 2)}\n`); process.exitCode = result.report.status === "PASS" ? 0 : 8; return;
    }
    if (command === "simulate") {
      const result = await runOfficialSimulationSuite(parseMutation(argv.slice(1), command));
      process.stdout.write(`${JSON.stringify({ operation: "imp9-official-simulate", ...result.report,
        attestationFile: result.attestationFile }, null, 2)}\n`); return;
    }
    if (command === "reconcile-simulation") {
      invariant(argv.length === 1, "UNKNOWN_IMP9_OPTION", argv.slice(1).join(" "));
      const result = reconcileOfficialSimulationAttempt();
      process.stdout.write(`${JSON.stringify({ operation: "imp9-reconcile-simulation",
        ...result.report, reportFile: result.reportFile }, null, 2)}\n`);
      process.exitCode = result.report.status === "PASS" ? 0 : 8; return;
    }
    if (command === "publish") {
      const result = await runOfficialPublish(parseMutation(argv.slice(1), command));
      process.stdout.write(`${JSON.stringify({ operation: "imp9-official-publish", status: result.status,
        intentFingerprint: result.intent.fingerprint, reconciliation: result.reconciliation,
        responseLost: result.responseLost, challengePostCount: result.challengePostCount }, null, 2)}\n`); return;
    }
    invariant(command === "verify", "UNKNOWN_IMP9_COMMAND", command);
    const result = await runImp9Gate(undefined, parse(argv.slice(1)));
    process.stdout.write(`${JSON.stringify({ operation: "imp9-verify", ...result.gate,
      gateFile: result.gateFile }, null, 2)}\n`);
    process.exitCode = result.gate.status === "PASS" ? 0 : 8;
  } catch (error) {
    const typed = error instanceof AgentankToolError ? error :
      new AgentankToolError("UNEXPECTED_IMP9_ERROR", error.message);
    process.stderr.write(`${JSON.stringify({ ok: false, errorCode: typed.code,
      message: redactText(typed.message) })}\n`); process.exitCode = typed.exitCode || 9;
  }
}

if (require.main === module) main();
module.exports = { HELP, parse, parseMutation, main };
