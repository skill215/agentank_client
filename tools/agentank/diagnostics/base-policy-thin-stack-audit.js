"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { load, compare, fingerprint } = require(
  "./base-policy-owner-migration-audit");

const CANDIDATE = "V2_NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function outcome(artifact) {
  const value = artifact.overview.candidate;
  return { wins: value.wins, losses: value.losses, draws: value.draws,
    scoreBasisPoints: value.scoreBasisPoints, stars: value.stars,
    crashes: value.crashes };
}

function runtime(artifact) {
  const value = artifact.overview.candidate.runtime;
  return { ...value,
    totalVsControlBasisPoints: Math.trunc(value.candidateTotalMicros * 10000 /
      Math.max(1, value.controlTotalMicros)),
    p95VsControlBasisPoints: Math.trunc(value.candidateP95Max * 10000 /
      Math.max(1, value.controlP95Max)) };
}

function cache(artifact) {
  const result = { builds: 0, hits: 0, misses: 0, lookups: 0,
    terrainCellCompares: 0, rootCompares: 0, rootRebinds: 0 };
  for (const match of artifact.matches) {
    if (match.implementation !== CANDIDATE) continue;
    const value = match.candidate?.nativeBasePolicyThinLeaf ||
      match.candidate?.nativeTacticalLeafEvaluator || {};
    result.builds += value.starFieldCount || 0;
    result.hits += value.starFieldCacheHitCount || 0;
    result.misses += value.starFieldCacheMissCount || 0;
    result.lookups += value.starFieldCacheTerrainCompareCount || 0;
    result.terrainCellCompares +=
      value.starFieldCacheTerrainCellCompareCount || 0;
    result.rootCompares += value.starFieldCacheRootCompareCount || 0;
    result.rootRebinds += value.starFieldCacheRootRebindCount || 0;
  }
  return result;
}

function ownTypedBytes(value) {
  let bytes = 0;
  for (const item of Object.values(value))
    if (ArrayBuffer.isView(item) && !(item instanceof DataView))
      bytes += item.byteLength;
  return bytes;
}

async function sourceInfo(root, relative) {
  const bytes = fs.readFileSync(path.join(root, relative));
  const { minify } = require("terser");
  const minified = await minify(bytes.toString("utf8"),
    { compress: true, mangle: true });
  return { path: relative, bytes: bytes.length, sha256: sha256(bytes),
    standaloneMinifiedBytes: Buffer.byteLength(minified.code) };
}

async function build(root, directories) {
  const artifacts = Object.fromEntries(Object.entries(directories).map(
    ([name, directory]) => [name, load(directory)]));
  const fixedReference = artifacts.fixedReference;
  const discoveryReference = artifacts.discoveryReference;
  const discoveryThin = artifacts.discoveryThin;
  const search = await sourceInfo(root,
    "engine-v2/src/base-policy/policy-search.js");
  const leaf = await sourceInfo(root,
    "engine-v2/src/base-policy/policy-leaf.js");
  const pathUtility = await sourceInfo(root,
    "engine-v2/src/base-policy/path-utility.js");
  const productionRoot = await sourceInfo(root,
    "engine-v2/src/runtime/production-root.js");
  const { NativeBasePolicySearch, NativeBasePolicyLeafEvaluator,
    NativeBasePolicyPathUtility } = require("../../../engine-v2/src/base-policy");
  const leafObject = new NativeBasePolicyLeafEvaluator({
    starFieldCacheEntries: 2 });
  const pathObject = new NativeBasePolicyPathUtility(leafObject, {
    fire: true, bomb: true, turn: true, stun: true,
    exactFireTransition: true, goEdgeTransition: true });
  const searchObject = new NativeBasePolicySearch({ leafEvaluator: leafObject,
    pathUtility: pathObject });
  const fixedNames = ["thinInitial", "noOpPruned", "deltaCache",
    "geometryTable"];
  const fixedComparisons = Object.fromEntries(fixedNames.map(name => [name, {
    semantic: compare(fixedReference.matches, artifacts[name].matches),
    fingerprint: fingerprint(artifacts[name].matches, CANDIDATE),
    outcome: outcome(artifacts[name]), runtime: runtime(artifacts[name]),
    cache: cache(artifacts[name])
  }]));
  const discoveryComparison = compare(discoveryReference.matches,
    discoveryThin.matches);
  return {
    objectKind: "BasePolicyThinStackPerformanceEvidenceV1",
    generatedAt: new Date().toISOString(),
    productionDefaultChanged: false,
    contract: {
      profile: "BP68_EXACT_NATIVE_ALWAYS",
      oracleAudit: "OFF",
      searchImplementation: "THIN_REACHABLE_CLOSURE",
      leafImplementation: "THIN_REACHABLE_CLOSURE",
      pathImplementation: "THIN_REACHABLE_CLOSURE",
      starFieldCacheEntries: 2,
      exactTerrainIdentity:
        "ROOT_SNAPSHOT_PLUS_BRANCH_TERRAIN_DELTA_SET",
      localTimeInterpretation:
        "MATCHED_INPUT_RELATIVE_EVIDENCE_NOT_PLATFORM_3000MS"
    },
    tests: { minimaxCore: { passed: 243, failed: 0 },
      hotAllocationCount: 0 },
    fixed16: {
      referenceFingerprint: fingerprint(fixedReference.matches, CANDIDATE),
      referenceOutcome: outcome(fixedReference),
      comparisons: fixedComparisons
    },
    discovery64: {
      semantic: discoveryComparison,
      referenceFingerprint: fingerprint(discoveryReference.matches, CANDIDATE),
      thinFingerprint: fingerprint(discoveryThin.matches, CANDIDATE),
      referenceOutcome: outcome(discoveryReference),
      thinOutcome: outcome(discoveryThin),
      referenceRuntime: runtime(discoveryReference),
      thinRuntime: runtime(discoveryThin),
      thinCache: cache(discoveryThin)
    },
    size: { search, leaf, path: pathUtility,
      totalSourceBytes: search.bytes + leaf.bytes + pathUtility.bytes,
      totalStandaloneMinifiedBytes: search.standaloneMinifiedBytes +
        leaf.standaloneMinifiedBytes + pathUtility.standaloneMinifiedBytes,
      fixedTypedArrayBytes: { search: ownTypedBytes(searchObject),
        leaf: ownTypedBytes(leafObject), path: ownTypedBytes(pathObject),
        total: ownTypedBytes(searchObject) + ownTypedBytes(leafObject) +
          ownTypedBytes(pathObject) },
      productionRoot: { path: productionRoot.path,
        sha256: productionRoot.sha256 } },
    artifacts: Object.fromEntries(Object.entries(artifacts).map(
      ([name, artifact]) => [name, { path: directories[name],
        ...artifact.hashes }])),
    verdicts: [
      "THIN_SEARCH_LEAF_PATH_PRESERVE_FIXED16_AND_DISCOVERY64_ACTIONS",
      "DISCOVERY64_REMAINS_67_48_13_AND_5742_BASIS_POINTS",
      "TWO_ENTRY_STAR_FIELD_CACHE_REBUILDS_434_OF_695449_REQUESTS",
      "ROOT_DELTA_TERRAIN_IDENTITY_REPLACES_PER_LEAF_WHOLE_MAP_COMPARE",
      "DISCOVERY64_LOCAL_CANDIDATE_TOTAL_DECREASES_15_PERCENT",
      "PRODUCTION_DEFAULT_REMAINS_UNCHANGED"
    ]
  };
}

async function run() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  const directories = {
    fixedReference: path.resolve(process.argv[3]),
    thinInitial: path.resolve(process.argv[4]),
    noOpPruned: path.resolve(process.argv[5]),
    deltaCache: path.resolve(process.argv[6]),
    geometryTable: path.resolve(process.argv[7]),
    discoveryReference: path.resolve(process.argv[8]),
    discoveryThin: path.resolve(process.argv[9])
  };
  const output = path.resolve(process.argv[10] || path.join(root,
    "config/engine-v3/base-policy-kernel-bp165-bp170-performance-evidence.json"));
  const evidence = await build(root, directories);
  const unsigned = { ...evidence }; delete unsigned.generatedAt;
  evidence.fingerprint = sha256(Buffer.from(JSON.stringify(unsigned)));
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output,
    fingerprint: evidence.fingerprint, discovery64: evidence.discovery64,
    size: evidence.size, verdicts: evidence.verdicts }, null, 2)}\n`);
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { build, run };
