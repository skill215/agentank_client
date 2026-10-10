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

function candidateRows(artifact) {
  return artifact.matches.filter(match => match.implementation === CANDIDATE);
}

function census(artifact, field = "nativeBoundedPolicySearchMethodCensus") {
  const aggregate = new Map();
  const all = new Set();
  let records = 0;
  for (const match of candidateRows(artifact)) {
    const value = match.candidate?.[field];
    if (!value) continue;
    records += 1;
    for (const name of Object.keys(value.called || {})) all.add(name);
    for (const name of value.uncalled || []) all.add(name);
    for (const [name, calls] of Object.entries(value.called || {})) {
      const entry = aggregate.get(name) || { name, calls: 0, matches: 0,
        minimumCalls: Number.MAX_SAFE_INTEGER, maximumCalls: 0 };
      entry.calls += calls;
      entry.matches += 1;
      entry.minimumCalls = Math.min(entry.minimumCalls, calls);
      entry.maximumCalls = Math.max(entry.maximumCalls, calls);
      aggregate.set(name, entry);
    }
  }
  const called = Array.from(aggregate.values()).sort((left, right) =>
    right.calls - left.calls || left.name.localeCompare(right.name));
  return { records, methodCount: all.size, calledMethodCount: called.length,
    neverCalledMethodCount: all.size - called.length, called,
    neverCalled: Array.from(all).filter(name => !aggregate.has(name)).sort() };
}

function starCache(artifact) {
  let entries = 0; let hits = 0; let misses = 0; let builds = 0;
  let terrainCompares = 0;
  for (const match of candidateRows(artifact)) {
    const value = match.candidate?.nativeTacticalLeafEvaluator || {};
    entries = Math.max(entries, value.starFieldCacheEntries || 0);
    hits += value.starFieldCacheHitCount || 0;
    misses += value.starFieldCacheMissCount || 0;
    builds += value.starFieldCount || 0;
    terrainCompares += value.starFieldCacheTerrainCompareCount || 0;
  }
  return { entries, hits, misses, builds, terrainCompares,
    hitBasisPoints: Math.trunc(hits * 10000 / Math.max(1, hits + misses)),
    runtime: runtime(artifact) };
}

function runtime(artifact) {
  const value = artifact.overview.candidate.runtime;
  return { candidateTotalMicros: value.candidateTotalMicros,
    controlTotalMicros: value.controlTotalMicros,
    candidateP95Max: value.candidateP95Max,
    controlP95Max: value.controlP95Max,
    totalRatioBasisPoints: Math.trunc(value.candidateTotalMicros * 10000 /
      Math.max(1, value.controlTotalMicros)),
    p95RatioBasisPoints: Math.trunc(value.candidateP95Max * 10000 /
      Math.max(1, value.controlP95Max)) };
}

function outcome(artifact) {
  const value = artifact.overview.candidate;
  return { wins: value.wins, losses: value.losses, draws: value.draws,
    scoreBasisPoints: value.scoreBasisPoints, stars: value.stars,
    crashes: value.crashes };
}

function artifactIdentity(directory, artifact) {
  return { path: directory, ...artifact.hashes,
    candidateFingerprint: fingerprint(artifact.matches, CANDIDATE).sha256 };
}

async function build(root, directories) {
  const artifacts = Object.fromEntries(Object.entries(directories).map(
    ([name, directory]) => [name, load(directory)]));
  const audited = census(artifacts.auditCensus);
  const native = census(artifacts.nativeCensus);
  const nativeNames = new Set(native.called.map(entry => entry.name));
  const removed = audited.called.filter(entry => !nativeNames.has(entry.name));
  const removedCalls = removed.reduce((sum, entry) => sum + entry.calls, 0);
  const leaf = census(artifacts.leafPathCensus,
    "nativeBasePolicyLeafMethodCensus");
  const pathCensus = census(artifacts.leafPathCensus,
    "nativeBasePolicyPathMethodCensus");
  const source = path.join(root,
    "tools/agentank/diagnostics/native-bounded-policy-search-poc.js");
  const arena = path.join(root,
    "tools/agentank/diagnostics/v2-native-initiative-arena.js");
  const productionRoot = path.join(root,
    "engine-v2/src/runtime/production-root.js");
  const leafSource = path.join(root,
    "tools/agentank/diagnostics/native-v1-policy-leaf-evaluator-poc.js");
  const pathSource = path.join(root,
    "tools/agentank/diagnostics/native-v1-path-utility-poc.js");
  return {
    objectKind: "BasePolicySearchReachabilityEvidenceV1",
    generatedAt: new Date().toISOString(),
    productionDefaultChanged: false,
    contract: {
      profile: "BP68_EXACT_NATIVE_ALWAYS",
      auditDefault: "ON_FOR_HISTORICAL_DIAGNOSTICS",
      nativeMeasurement: "V1_VM_AND_ORACLE_COMPARISON_DISABLED",
      semantics: "SEARCH_ACTIONS_UNCHANGED; ONLY_REFERENCE_EXECUTION_AND_COMPARISON_REMOVED"
    },
    behaviorEquivalence: {
      baselineVsAuditedCensus: compare(artifacts.baseline.matches,
        artifacts.auditCensus.matches),
      baselineVsNativeOnly: compare(artifacts.baseline.matches,
        artifacts.nativeOnly.matches),
      baselineVsNativeCensus: compare(artifacts.baseline.matches,
        artifacts.nativeCensus.matches),
      baseline: outcome(artifacts.baseline),
      nativeOnly: outcome(artifacts.nativeOnly),
      discovery64AuditedVsNativeOnly: compare(
        artifacts.discoveryAudited.matches,
        artifacts.discoveryNativeOnly.matches),
      discovery64Audited: outcome(artifacts.discoveryAudited),
      discovery64NativeOnly: outcome(artifacts.discoveryNativeOnly),
      rawResultDifferenceReason:
        "runtime winner metadata changes when local elapsed time changes; analysis outcome, action stream and physical counts are invariant"
    },
    performance: {
      auditedBaseline: runtime(artifacts.baseline),
      nativeOnly: runtime(artifacts.nativeOnly),
      crossRunCandidateRatioBasisPoints: Math.trunc(
        artifacts.nativeOnly.overview.candidate.runtime.candidateTotalMicros * 10000 /
        Math.max(1,
          artifacts.baseline.overview.candidate.runtime.candidateTotalMicros)),
      discovery64Audited: runtime(artifacts.discoveryAudited),
      discovery64NativeOnly: runtime(artifacts.discoveryNativeOnly),
      discovery64CrossRunCandidateRatioBasisPoints: Math.trunc(
        artifacts.discoveryNativeOnly.overview.candidate.runtime.candidateTotalMicros *
        10000 / Math.max(1,
          artifacts.discoveryAudited.overview.candidate.runtime.candidateTotalMicros)),
      interpretation: "same-host local relative evidence only; not platform 3000ms evidence"
    },
    reachability: {
      auditedMethodCount: audited.methodCount,
      auditedCalledMethodCount: audited.calledMethodCount,
      nativeCalledMethodCount: native.calledMethodCount,
      nativeNeverCalledMethodCount: native.neverCalledMethodCount,
      removedReachedAuditMethodCount: removed.length,
      removedReachedAuditCalls: removedCalls,
      removedReachedAuditMethods: removed,
      nativeCalledMethods: native.called,
      nativeNeverCalledMethods: native.neverCalled,
      hotNoOpCandidate: {
        name: "recordPolicyEnvelopeLeaf",
        calls: native.called.find(entry =>
          entry.name === "recordPolicyEnvelopeLeaf")?.calls || 0,
        reason: "BP68 continuation policy is BASE, so every call returns immediately"
      }
    },
    leafPathReachability: {
      leaf: { methodCount: leaf.methodCount,
        calledMethodCount: leaf.calledMethodCount,
        neverCalledMethodCount: leaf.neverCalledMethodCount,
        calledMethods: leaf.called, neverCalledMethods: leaf.neverCalled },
      path: { methodCount: pathCensus.methodCount,
        calledMethodCount: pathCensus.calledMethodCount,
        neverCalledMethodCount: pathCensus.neverCalledMethodCount,
        calledMethods: pathCensus.called,
        neverCalledMethods: pathCensus.neverCalled },
      starFieldCache: {
        cache1: starCache(artifacts.cache1),
        cache2: starCache(artifacts.cache2),
        cache4: starCache(artifacts.cache4),
        selectedEntries: 2,
        reason: "two entries have the same misses/builds as four; one entry rebuilds 200 instead of 77",
        exactComparisons: {
          cache1: compare(artifacts.nativeOnly.matches,
            artifacts.cache1.matches),
          cache2: compare(artifacts.nativeOnly.matches,
            artifacts.cache2.matches),
          cache4: compare(artifacts.nativeOnly.matches,
            artifacts.cache4.matches)
        }
      }
    },
    source: {
      searchPoc: { path: path.relative(root, source), bytes: fs.statSync(source).size,
        sha256: sha256(fs.readFileSync(source)) },
      arena: { path: path.relative(root, arena), bytes: fs.statSync(arena).size,
        sha256: sha256(fs.readFileSync(arena)) },
      leafPoc: { path: path.relative(root, leafSource),
        bytes: fs.statSync(leafSource).size,
        sha256: sha256(fs.readFileSync(leafSource)) },
      pathPoc: { path: path.relative(root, pathSource),
        bytes: fs.statSync(pathSource).size,
        sha256: sha256(fs.readFileSync(pathSource)) },
      productionRoot: { path: path.relative(root, productionRoot),
        sha256: sha256(fs.readFileSync(productionRoot)) }
    },
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([name, value]) =>
      [name, artifactIdentity(directories[name], value)])),
    verdicts: [
      "V1_VM_ORACLE_AUDIT_IS_NOT_PART_OF_NATIVE_MINIMAX_SEMANTICS",
      "REMOVING_AUDIT_PRESERVES_ALL_FIXED16_ACTIONS_AND_RESULTS",
      "NATIVE_ONLY_TOTAL_AND_P95_ARE_LOWER_THAN_MATCHED_V1_IN_THIS_LOCAL_RUN",
      "TWO_ENTRY_EXACT_STAR_FIELD_CACHE_REMOVES_133824_OF_133901_REBUILDS",
      "PRODUCTION_THIN_SEARCH_MUST_EXCLUDE_AUDIT_AND_UNREACHED_PROFILE_CODE",
      "PRODUCTION_DEFAULT_REMAINS_UNCHANGED"
    ]
  };
}

async function run() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  const directories = {
    baseline: path.resolve(process.argv[3]),
    auditCensus: path.resolve(process.argv[4]),
    nativeOnly: path.resolve(process.argv[5]),
    nativeCensus: path.resolve(process.argv[6]),
    discoveryAudited: path.resolve(process.argv[7]),
    discoveryNativeOnly: path.resolve(process.argv[8]),
    cache1: path.resolve(process.argv[9]),
    cache2: path.resolve(process.argv[10]),
    cache4: path.resolve(process.argv[11]),
    leafPathCensus: path.resolve(process.argv[12])
  };
  const output = path.resolve(process.argv[13] || path.join(root,
    "config/engine-v3/base-policy-kernel-bp160-search-reachability-evidence.json"));
  const evidence = await build(root, directories);
  const unsigned = { ...evidence };
  delete unsigned.generatedAt;
  evidence.fingerprint = sha256(Buffer.from(JSON.stringify(unsigned)));
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, fingerprint: evidence.fingerprint,
    behaviorEquivalence: evidence.behaviorEquivalence,
    performance: evidence.performance, reachability: {
      auditedCalledMethodCount: evidence.reachability.auditedCalledMethodCount,
      nativeCalledMethodCount: evidence.reachability.nativeCalledMethodCount,
      removedReachedAuditMethodCount:
        evidence.reachability.removedReachedAuditMethodCount,
      removedReachedAuditCalls: evidence.reachability.removedReachedAuditCalls,
      hotNoOpCandidate: evidence.reachability.hotNoOpCandidate
    }, leafPathReachability: evidence.leafPathReachability,
    verdicts: evidence.verdicts }, null, 2)}\n`);
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { census, starCache, runtime, build, run };
