#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { inventory, compact, verify, prune } =
  require("../retention/artifact-retention");

function flag(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
function progress(prefix, done, total, item) {
  process.stdout.write(`[${prefix}] ${done}/${total} ${item}\n`);
}
async function main() {
  const command = process.argv[2];
  if (command === "inventory") {
    const result = await inventory({ onProgress(done, total, item) {
      progress("inventory", done, total, item);
    } });
    process.stdout.write(`${JSON.stringify({ status: result.report.status,
      fingerprint: result.report.fingerprint, files: result.report.fileCount,
      keepBytes: result.report.keepBytes, pruneBytes: result.report.pruneBytes,
      manifest: result.file }, null, 2)}\n`);
    return;
  }
  if (command === "compact") {
    const result = await compact({ onProgress(id, done, total) {
      progress(id, done, total, "matches");
    } });
    process.stdout.write(`${JSON.stringify({ status: "COMPACTED",
      baselines: result.manifests.map(item => ({ id: item.baselineId,
        records: item.extractedRecords, bytes: item.compact.size,
        sha256: item.compact.sha256 })) }, null, 2)}\n`);
    return;
  }
  if (command === "verify") {
    const result = await verify();
    process.stdout.write(`${JSON.stringify({ status: result.report.status,
      fingerprint: result.report.fingerprint, baselines: result.report.baselines,
      expectedFreedBytes: result.report.expectedFreedBytes,
      manifest: result.file }, null, 2)}\n`);
    return;
  }
  if (command === "prune") {
    const manifestPath = flag("--manifest");
    if (!manifestPath) throw new Error("prune requires --manifest <verified-manifest>");
    const result = await prune({ manifestPath: path.resolve(manifestPath),
      onProgress(done, total, item) { progress("prune", done, total, item); } });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  throw new Error("usage: artifact-retention-toolchain inventory|compact|verify|" +
    "prune --manifest <verified-manifest>");
}

if (require.main === module) main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});

module.exports = { main };
