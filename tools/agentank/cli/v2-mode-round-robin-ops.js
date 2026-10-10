#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { runRoundRobin } = require("../diagnostics/v2-mode-round-robin");

function parse(argv) {
  const options = { workspaceRoot: defaultWorkspaceRoot() };
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--scenario-offset") options.scenarioOffset = Number(argv[++index]);
    else if (argument === "--scenario-count") options.scenarioCount = Number(argv[++index]);
    else if (argument === "--pool") options.pool = String(argv[++index]);
    else if (argument === "--repetition") options.repetition = Number(argv[++index]);
    else if (argument === "--repetitions") options.repetitions = Number(argv[++index]);
    else if (argument === "--progress-every") options.progressEvery = Number(argv[++index]);
    else if (argument === "--timeout-ms") options.timeoutMs = Number(argv[++index]);
    else if (argument === "--output") options.output = path.resolve(argv[++index]);
    else throw new Error(`V2_ROUND_ROBIN_UNKNOWN_ARGUMENT:${argument}`);
  }
  return { command: argv[2], options };
}

async function main() {
  const { command, options } = parse(process.argv);
  if (command !== "run") throw new Error("Usage: v2-mode-round-robin-toolchain run " +
    "[--pool discovery|fixed-all|rolling-all] [--scenario-count N] [--scenario-offset N] " +
    "[--repetitions N]");
  options.onProgress = value => process.stderr.write(`[V2 round-robin] ${value.completed}/` +
    `${value.total} ${value.pairId} ${value.leg}\n`);
  const result = await runRoundRobin(options);
  const sample = result.overview.sample;
  process.stdout.write(`${JSON.stringify({ status: result.overview.status,
    output: result.output, sample: { pool: sample.pool,
      scenarioCount: sample.scenarioCount, scenarioOffset: sample.scenarioOffset,
      repetitionStart: sample.repetitionStart, repetitions: sample.repetitions,
      scenarioFingerprint: sample.scenarioFingerprint,
      expectedMatches: sample.expectedMatches },
    totalBytes: result.manifest.totalBytes, summary: result.overview.summary }, null, 2)}\n`);
}

main().catch(error => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
