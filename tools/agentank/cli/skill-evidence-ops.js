#!/usr/bin/env node
"use strict";

const { AgentankToolError, invariant } = require("../core/errors");
const { redactText } = require("../core/sanitize");
const { parseOptions, onlyOptions } = require("./args");
const { collectPublicSkillEvidence, reanalyzeStoredSkillEvidence } =
  require("../discovery/public-skill-evidence");
const { runDiscoverySkillRegression } = require("../discovery/skill-regression-corpus");

const HELP = `AgenTank public skill evidence toolchain

Usage:
  ./tools/skill-evidence-toolchain.sh collect --skill <skill> --tank-name <name> \\
    [--limit 10] [--known-matches mat_a,mat_b] [--run-id <id>]
  ./tools/skill-evidence-toolchain.sh analyze --skill <skill> --tank-url-id <tnk_id> --run-id <id>
  ./tools/skill-evidence-toolchain.sh regress [--suite <relative-suite-path>]

The command performs public GET requests only. It writes summary/events/raw replay artifacts into
battle-records/discovery/skills and never publishes, simulates, challenges, or changes a tank.
`;

async function main(argv = process.argv.slice(2)) {
  try {
    const command = argv[0] || "help"; const options = parseOptions(argv.slice(1));
    if (["help", "-h", "--help"].includes(command)) { process.stdout.write(HELP); return; }
    invariant(command === "collect" || command === "analyze" || command === "regress", "UNKNOWN_COMMAND",
      `unknown command: ${command}`);
    onlyOptions(options, ["skill", "tank-name", "tank-url-id", "limit", "known-matches", "run-id", "suite"]);
    if (command === "regress") {
      const result = runDiscoverySkillRegression({ suitePath: options.suite });
      process.stdout.write(`${JSON.stringify({ operation: "regress-public-skill-evidence",
        status: result.report.status, coverage: result.report.coverage,
        fingerprint: result.report.fingerprint, reportFile: result.current }, null, 2)}\n`);
      process.exitCode = result.report.status === "PASS" ? 0 : 9; return;
    }
    const result = command === "collect" ? await collectPublicSkillEvidence({ skill: options.skill,
      tankName: options["tank-name"], limit: options.limit === undefined ? 10 : Number(options.limit),
      knownMatchIds: options["known-matches"] ? String(options["known-matches"])
        .split(",").filter(Boolean) : [], runId: options["run-id"] }) :
      reanalyzeStoredSkillEvidence({ skill: options.skill, tankUrlId: options["tank-url-id"],
        runId: options["run-id"] });
    process.stdout.write(`${JSON.stringify({ operation: command === "collect" ?
      "collect-public-skill-evidence" : "analyze-public-skill-evidence",
      runDirectory: result.runDirectory, manifest: result.manifest,
      analysis: result.analysis }, null, 2)}\n`);
  } catch (error) {
    const typed = error instanceof AgentankToolError ? error :
      new AgentankToolError("UNEXPECTED_TOOL_ERROR", error?.message || "unexpected error", { exitCode: 9 });
    process.stderr.write(`${JSON.stringify({ ok: false, errorCode: typed.code,
      retryClass: typed.retryClass, message: redactText(typed.message) }, null, 2)}\n`);
    process.exitCode = typed.exitCode;
  }
}

if (require.main === module) main();
module.exports = { main, HELP };
