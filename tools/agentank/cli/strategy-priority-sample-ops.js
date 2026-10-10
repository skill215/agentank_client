#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { runSample } = require("../diagnostics/strategy-priority-sample");

function usage() {
  return `Usage:
  strategy-priority-sample-toolchain run [--output DIR] [--progress-every N]
    [--scenario-count N] [--scenario-offset N] [--repetitions N]
    [--sample-salt TEXT] [--modes MODE,...]
`;
}

function parse(argv) {
  const command = argv[2];
  const options = { workspaceRoot: defaultWorkspaceRoot() };
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output") options.output = path.resolve(argv[++index]);
    else if (argument === "--progress-every")
      options.progressEvery = Math.max(1, Math.floor(Number(argv[++index]) || 16));
    else if (argument === "--timeout-ms")
      options.timeoutMs = Math.max(20, Math.floor(Number(argv[++index]) || 200));
    else if (argument === "--scenario-count")
      options.scenarioCount = Math.max(1, Math.floor(Number(argv[++index]) || 1));
    else if (argument === "--scenario-offset")
      options.scenarioOffset = Math.max(0, Math.floor(Number(argv[++index]) || 0));
    else if (argument === "--repetitions")
      options.repetitions = Math.max(1, Math.floor(Number(argv[++index]) || 1));
    else if (argument === "--sample-salt") options.sampleSalt = String(argv[++index]);
    else if (argument === "--modes")
      options.modes = String(argv[++index]).split(",").filter(Boolean);
    else throw new Error(`STRAT2_SAMPLE_UNKNOWN_ARGUMENT:${argument}`);
  }
  return { command, options };
}

async function main() {
  const { command, options } = parse(process.argv);
  if (command !== "run") {
    process.stderr.write(usage());
    process.exitCode = 2;
    return;
  }
  options.onProgress = progress =>
    process.stderr.write(`[STRAT2 sample] ${progress.mode} ${progress.completed}/` +
      `${progress.total} ${progress.scenario} ${progress.variant}\n`);
  const result = await runSample(options);
  process.stdout.write(`${JSON.stringify({
    status: result.overview.status,
    conclusion: result.overview.conclusion,
    output: result.output,
    matches: result.overview.sample.totalMatches,
    totalBytes: result.manifest.totalBytes,
    fingerprint: result.manifest.fingerprint
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
