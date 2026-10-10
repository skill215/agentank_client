"use strict";

// Same-process, alternating-order calibration for the BP170 leaf algorithms.
// Full per-match artifacts exist only long enough to verify action identity;
// the persisted output is one compact summary.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const arena = require("../diagnostics/v2-native-initiative-arena");
const { load, compare, fingerprint } = require(
  "../diagnostics/base-policy-owner-migration-audit");

const CANDIDATE = "V2_NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function median(values) {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[(sorted.length / 2) | 0];
}

function runtime(artifact) {
  const value = artifact.overview.candidate.runtime;
  return { candidateTotalMicros: value.candidateTotalMicros,
    candidateP95Max: value.candidateP95Max,
    controlTotalMicros: value.controlTotalMicros,
    controlP95Max: value.controlP95Max };
}

function outcome(artifact) {
  const value = artifact.overview.candidate;
  return { wins: value.wins, losses: value.losses, draws: value.draws,
    scoreBasisPoints: value.scoreBasisPoints };
}

function stripArguments(arguments_) {
  const valued = new Set(["--output", "--limit",
    "--bounded-policy-search-implementation",
    "--bounded-policy-leaf-implementation",
    "--bounded-policy-path-implementation",
    "--bounded-policy-star-field-cache",
    "--bounded-policy-leaf-geometry"]);
  const result = [];
  for (let index = 0; index < arguments_.length; index += 1) {
    if (valued.has(arguments_[index])) { index += 1; continue; }
    result.push(arguments_[index]);
  }
  return result;
}

async function execute(root, baseArguments, working, label, limit,
    starFieldCacheEntries, geometry) {
  const output = path.join(working, label);
  const arguments_ = [...baseArguments,
    "--limit", String(limit),
    "--output", output,
    "--bounded-policy-search-implementation", "thin",
    "--bounded-policy-leaf-implementation", "thin",
    "--bounded-policy-path-implementation", "thin",
    "--bounded-policy-star-field-cache", String(starFieldCacheEntries),
    "--bounded-policy-leaf-geometry", geometry];
  const savedArgv = process.argv;
  const savedWrite = process.stdout.write;
  process.argv = [process.execPath,
    path.join(root, "tools/agentank/diagnostics/v2-native-initiative-arena.js"),
    ...arguments_];
  process.stdout.write = () => true;
  try { await arena.run(root); }
  finally { process.argv = savedArgv; process.stdout.write = savedWrite; }
  const artifact = load(output);
  fs.rmSync(output, { recursive: true, force: true });
  if (global.gc) global.gc();
  return artifact;
}

async function run() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  const referenceManifest = path.resolve(process.argv[3] ||
    "/tmp/agentank-bp170-leaf-geometry-table-fixed16/manifest.json");
  const output = path.resolve(process.argv[4] || path.join(root,
    "config/engine-v3/base-policy-kernel-bp171-runtime-calibration.json"));
  const batches = Math.max(1, Math.min(9, Number(process.argv[5] || 5) | 0));
  const limit = Math.max(1, Math.min(16, Number(process.argv[6] || 8) | 0));
  const working = path.join("/tmp", `agentank-bp171-calibration-${process.pid}`);
  fs.mkdirSync(working, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(referenceManifest, "utf8"));
  const baseArguments = stripArguments(manifest.arguments);
  process.stderr.write("[BP171] warmup arithmetic\n");
  await execute(root, baseArguments, working, "warmup-arithmetic", 2, 0,
    "arithmetic");
  process.stderr.write("[BP171] warmup table-cache2\n");
  await execute(root, baseArguments, working, "warmup-optimized", 2, 2,
    "table");
  const results = [];
  for (let batch = 0; batch < batches; batch += 1) {
    const order = batch & 1 ? ["optimized", "arithmetic"] :
      ["arithmetic", "optimized"];
    const artifacts = {};
    for (const mode of order) {
      process.stderr.write(`[BP171] batch ${batch + 1}/${batches} ${mode}\n`);
      artifacts[mode] = mode === "optimized" ?
        await execute(root, baseArguments, working,
          `batch-${batch + 1}-optimized`, limit, 2, "table") :
        await execute(root, baseArguments, working,
          `batch-${batch + 1}-arithmetic`, limit, 0, "arithmetic");
    }
    const arithmeticRuntime = runtime(artifacts.arithmetic);
    const optimizedRuntime = runtime(artifacts.optimized);
    results.push({ batch: batch + 1, order,
      semantic: compare(artifacts.arithmetic.matches,
        artifacts.optimized.matches),
      arithmeticFingerprint: fingerprint(artifacts.arithmetic.matches,
        CANDIDATE),
      optimizedFingerprint: fingerprint(artifacts.optimized.matches,
        CANDIDATE),
      arithmeticOutcome: outcome(artifacts.arithmetic),
      optimizedOutcome: outcome(artifacts.optimized),
      arithmetic: arithmeticRuntime, optimized: optimizedRuntime,
      totalBasisPoints: Math.trunc(optimizedRuntime.candidateTotalMicros *
        10000 / Math.max(1, arithmeticRuntime.candidateTotalMicros)),
      p95BasisPoints: Math.trunc(optimizedRuntime.candidateP95Max * 10000 /
        Math.max(1, arithmeticRuntime.candidateP95Max)) });
  }
  fs.rmSync(working, { recursive: true, force: true });
  const semanticExact = results.every(result =>
    Object.values(result.semantic).every(value => value === 0) &&
    result.arithmeticFingerprint.sha256 === result.optimizedFingerprint.sha256);
  const report = {
    objectKind: "BasePolicyRuntimeCalibrationV1",
    generatedAt: new Date().toISOString(),
    productionDefaultChanged: false,
    contract: { process: "SAME_PROCESS", warmupRunsPerMode: 1,
      order: "ALTERNATING", batches, scenarioLimit: limit,
      arithmetic: { starFieldCacheEntries: 0, geometry: "ARITHMETIC" },
      optimized: { starFieldCacheEntries: 2, geometry: "PRECOMPUTED_TABLE" },
      fullArtifactsRetained: false,
      interpretation: "LOCAL_RELATIVE_ONLY_NOT_PLATFORM_3000MS_EVIDENCE" },
    semanticExact, batches: results,
    aggregate: {
      medianTotalBasisPoints: median(results.map(result =>
        result.totalBasisPoints)),
      medianP95BasisPoints: median(results.map(result =>
        result.p95BasisPoints)),
      optimizedTotalWins: results.filter(result =>
        result.totalBasisPoints < 10000).length,
      optimizedP95Wins: results.filter(result =>
        result.p95BasisPoints < 10000).length
    },
    source: {
      referenceManifest,
      productionRootSha256: sha256(fs.readFileSync(path.join(root,
        "engine-v2/src/runtime/production-root.js"))),
      searchSha256: sha256(fs.readFileSync(path.join(root,
        "engine-v2/src/base-policy/policy-search.js"))),
      leafSha256: sha256(fs.readFileSync(path.join(root,
        "engine-v2/src/base-policy/policy-leaf.js"))),
      pathSha256: sha256(fs.readFileSync(path.join(root,
        "engine-v2/src/base-policy/path-utility.js")))
    }
  };
  const unsigned = { ...report }; delete unsigned.generatedAt;
  report.fingerprint = sha256(Buffer.from(JSON.stringify(unsigned)));
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output,
    fingerprint: report.fingerprint, semanticExact,
    aggregate: report.aggregate, batches: results.map(result => ({
      batch: result.batch, order: result.order,
      totalBasisPoints: result.totalBasisPoints,
      p95BasisPoints: result.p95BasisPoints })) }, null, 2)}\n`);
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { run };
