#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { discover, validate, verify } =
  require("../diagnostics/soft-stack-ablation");

function usage() {
  return `Usage:
  soft-stack-ablation-toolchain discover [--output DIR] [--progress-every N]
  soft-stack-ablation-toolchain validate --output DIR [--progress-every N]
  soft-stack-ablation-toolchain verify --output DIR
`;
}

function parse(argv) {
  const command = argv[2];
  const options = { workspaceRoot: defaultWorkspaceRoot() };
  for (let index = 3; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--output") options.output = path.resolve(argv[++index]);
    else if (argument === "--progress-every")
      options.progressEvery = Math.max(1, Math.floor(Number(argv[++index]) || 32));
    else if (argument === "--timeout-ms")
      options.timeoutMs = Math.max(20, Math.floor(Number(argv[++index]) || 200));
    else throw new Error(`SS_A0_UNKNOWN_ARGUMENT:${argument}`);
  }
  return { command, options };
}

async function main() {
  const { command, options } = parse(process.argv);
  if (!["discover", "validate", "verify"].includes(command)) {
    process.stderr.write(usage());
    process.exitCode = 2;
    return;
  }
  if ((command === "validate" || command === "verify") && !options.output)
    throw new Error("SS_A0_OUTPUT_REQUIRED");
  options.onProgress = progress =>
    process.stderr.write(`[SS-A0] ${progress.phase} ${progress.mode} ` +
      `${progress.completed}/${progress.total} ${progress.scenario} ${progress.variant}\n`);
  const result = command === "discover" ? await discover(options) :
    command === "validate" ? await validate(options) : await verify(options);
  process.stdout.write(`${JSON.stringify({
    command,
    status: result.overview?.status || result.status,
    output: result.output,
    winner: result.overview?.discovery?.winner || null,
    fingerprint: result.manifest?.fingerprint || result.fingerprint,
    matches: result.matches,
    samples: result.samples,
    totalBytes: result.totalBytes
  }, null, 2)}\n`);
}

main().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
