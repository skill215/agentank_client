#!/usr/bin/env node
"use strict";

const { AgentankToolError, invariant } = require("../core/errors");
const { redactText } = require("../core/sanitize");
const { runImp7Gate } = require("../harness/imp7-gate");

const HELP = `IMP7 dynamic corpus, dual-track replay and counterfactual toolchain

Usage:
  ./tools/imp7-toolchain.sh test
  ./tools/imp7-toolchain.sh verify
  ./tools/implementation-toolchain.sh accept --stage IMP7

The gate is offline-only. It dynamically rebuilds MatchLedger from local
artifacts and performs no platform request, publish, challenge or mutation.
`;
function parse(argv) { const options = {}; for (let i = 0; i < argv.length; i += 2) {
  invariant(["--test-output", "--test-exit-code"].includes(argv[i]) && i + 1 < argv.length,
    "UNKNOWN_IMP7_OPTION", argv[i]); options[argv[i].slice(2)] = argv[i + 1]; }
  const code = Number(options["test-exit-code"]); invariant(options["test-output"] && Number.isSafeInteger(code),
    "IMP7_TEST_OUTPUT_REQUIRED", "use tools/imp7-toolchain.sh"); return { testOutputFile: options["test-output"], testExitCode: code }; }
async function main(argv = process.argv.slice(2)) { try { const command = argv[0] || "help";
  if (["help", "-h", "--help"].includes(command)) { process.stdout.write(HELP); return; }
  invariant(command === "verify", "UNKNOWN_IMP7_COMMAND", command); const result = await runImp7Gate(undefined, parse(argv.slice(1)));
  process.stdout.write(`${JSON.stringify({ operation: "imp7-verify", ...result.gate, gateFile: result.gateFile }, null, 2)}\n`);
  process.exitCode = result.gate.status === "PASS" ? 0 : 8;
} catch (error) { const typed = error instanceof AgentankToolError ? error : new AgentankToolError("UNEXPECTED_IMP7_ERROR", error.message);
  process.stderr.write(`${JSON.stringify({ ok: false, errorCode: typed.code, message: redactText(typed.message) })}\n`); process.exitCode = typed.exitCode || 9; } }
if (require.main === module) main();
module.exports = { HELP, parse, main };
