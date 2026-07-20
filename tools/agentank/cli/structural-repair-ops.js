#!/usr/bin/env node
"use strict";

const { AgentankToolError, invariant } = require("../core/errors");
const { redactText } = require("../core/sanitize");
const { STAGES, verifyStage, acceptStage } = require("../structural/stage-runner");

const HELP = `V2 structural repair toolchain\n\nUsage:\n  ./tools/structural-repair-toolchain.sh verify --stage SR0\n  ./tools/structural-repair-toolchain.sh accept --stage SR0\n`;
function parse(argv, verify) {
  const options = {}; for (let index = 0; index < argv.length; index += 2) {
    invariant(index + 1 < argv.length, "STRUCTURAL_OPTION_VALUE_MISSING", argv[index]);
    const key = argv[index]; const value = argv[index + 1];
    invariant(["--stage", "--test-output", "--test-exit-code"].includes(key),
      "STRUCTURAL_OPTION_INVALID", key); options[key.slice(2)] = value;
  }
  invariant(STAGES.includes(options.stage), "STRUCTURAL_STAGE_INVALID", options.stage || "missing");
  if (verify) {
    invariant(options["test-output"], "STRUCTURAL_TEST_OUTPUT_REQUIRED", "use wrapper");
    options.testOutputFile = options["test-output"];
    options.testExitCode = Number(options["test-exit-code"]);
  }
  return options;
}
async function execute(command, argv) {
  if (["help", "--help", "-h"].includes(command)) return { help: HELP, exitCode: 0 };
  invariant(command === "verify" || command === "accept", "STRUCTURAL_COMMAND_INVALID", command);
  const options = parse(argv, command === "verify");
  const result = command === "verify" ? await verifyStage(options.stage, options) :
    acceptStage(options.stage);
  const report = result.report;
  return { value: { operation: `structural-${command}`, stageId: report.stageId,
    status: report.status, fingerprint: report.fingerprint,
    testDenominator: report.testDenominator,
    checks: Array.isArray(report.checks) ? report.checks.map(item => ({
      checkId: item.checkId, status: item.status })) : undefined,
    gateReport: `artifacts/reports/structural-repair/${report.stageId}/${
      report.stageId.toLowerCase()}-gate-report.json`,
    acceptanceReport: command === "accept" ? `artifacts/reports/structural-repair/${
      report.stageId}/${report.stageId.toLowerCase()}-acceptance-report.json` : undefined },
    exitCode: report.status === "ACCEPTED" ? 0 : 8 };
}
async function main(argv = process.argv.slice(2)) {
  try { const result = await execute(argv[0] || "help", argv.slice(1));
    if (result.help) process.stdout.write(result.help); else process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`);
    process.exitCode = result.exitCode; return result;
  } catch (error) { const typed = error instanceof AgentankToolError ? error :
    new AgentankToolError("STRUCTURAL_UNEXPECTED", error?.message || "unexpected error", { exitCode: 9 });
    process.stderr.write(`${JSON.stringify({ ok: false, errorCode: typed.code,
      message: redactText(typed.message) })}\n`); process.exitCode = typed.exitCode; return { error: typed }; }
}
if (require.main === module) main();
module.exports = { HELP, parse, execute, main };
