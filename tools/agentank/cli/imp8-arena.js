#!/usr/bin/env node
"use strict";

const { runPairedArena } = require("../simulation/paired-arena");
const { AgentankToolError } = require("../core/errors");

function options(argv) {
  const output = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!["--role", "--limit", "--repetitions", "--timeout-ms"].includes(key))
      throw new AgentankToolError("UNKNOWN_IMP8_ARENA_OPTION", key);
    output[key.slice(2)] = argv[++index];
  }
  return output;
}

async function main() {
  try {
    const parsed = options(process.argv.slice(2));
    const { report, directory } = await runPairedArena({ role: parsed.role || "CALIBRATION",
      limit: parsed.limit, repetitions: parsed.repetitions, timeoutMs: parsed["timeout-ms"] });
    process.stdout.write(`${JSON.stringify({ status: report.status, gateEligible: report.gateEligible,
      role: report.role, matches: report.summary.matchCount, scenarios: report.summary.scenarioCount,
      fingerprint: report.fingerprint, directory }, null, 2)}\n`);
    process.exitCode = report.status === "PASS" ? 0 : 1;
  } catch (error) {
    const known = error instanceof AgentankToolError;
    process.stderr.write(`${JSON.stringify({ error: known ? error.code : "UNEXPECTED_IMP8_ARENA_ERROR",
      message: error.message }, null, 2)}\n`);
    process.exitCode = known ? error.exitCode : 1;
  }
}

main();
