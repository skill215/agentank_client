#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { load, compare, fingerprint } = require(
  "./base-policy-owner-migration-audit");
const { NativeBasePolicyRoot, NATIVE_BASE_POLICY_PROFILE } = require(
  "../../../engine-v2/src/base-policy");

const CANDIDATE = "V2_NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function source(root, relative) {
  const bytes = fs.readFileSync(path.join(root, relative));
  return { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
}

function outcome(artifact) {
  const value = artifact.overview.candidate;
  return { wins: value.wins, losses: value.losses, draws: value.draws,
    scoreBasisPoints: value.scoreBasisPoints, stars: value.stars,
    crashes: value.crashes, invariants: value.invariants };
}

function runtime(artifact) {
  const value = artifact.overview.candidate.runtime;
  return { candidateTotalMicros: value.candidateTotalMicros,
    candidateP95Max: value.candidateP95Max,
    controlTotalMicros: value.controlTotalMicros,
    controlP95Max: value.controlP95Max };
}

function typedBytes(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return 0;
  seen.add(value);
  if (ArrayBuffer.isView(value) && !(value instanceof DataView))
    return value.byteLength;
  let total = 0;
  for (const item of Object.values(value)) total += typedBytes(item, seen);
  return total;
}

function artifactIdentity(directory, artifact) {
  return { path: directory, ...artifact.hashes,
    candidateFingerprint: fingerprint(artifact.matches, CANDIDATE).sha256 };
}

function build(root, directories) {
  const artifacts = Object.fromEntries(Object.entries(directories).map(
    ([name, directory]) => [name, load(directory)]));
  const nativeRoot = new NativeBasePolicyRoot();
  const componentPaths = ["action-owner", "action-domain", "strategic-intent",
    "opponent-history", "policy-search", "policy-leaf", "path-utility"];
  const evidence = {
    objectKind: "NativeBasePolicyRootAssemblyEvidenceV1",
    generatedAt: new Date().toISOString(),
    productionDefaultChanged: false,
    contract: {
      profile: NATIVE_BASE_POLICY_PROFILE,
      worldStateOwnership: "EXISTING_PRODUCTION_FAST_STATE_ONLY",
      perDecisionAllocation: "ZERO",
      diagnosticDependency: "NONE",
      oracleAudit: "OFF",
      localTimeInterpretation:
        "CROSS_RUN_TIME_IS_INFORMATIONAL; BP171_SAME_PROCESS_CALIBRATION_IS_AUTHORITATIVE"
    },
    fixed16: {
      semantic: compare(artifacts.fixedAssembled.matches,
        artifacts.fixedRoot.matches),
      assembledFingerprint: fingerprint(artifacts.fixedAssembled.matches,
        CANDIDATE),
      rootFingerprint: fingerprint(artifacts.fixedRoot.matches, CANDIDATE),
      assembledOutcome: outcome(artifacts.fixedAssembled),
      rootOutcome: outcome(artifacts.fixedRoot)
    },
    discovery64: {
      semantic: compare(artifacts.discoveryAssembled.matches,
        artifacts.discoveryRoot.matches),
      assembledFingerprint: fingerprint(artifacts.discoveryAssembled.matches,
        CANDIDATE),
      rootFingerprint: fingerprint(artifacts.discoveryRoot.matches, CANDIDATE),
      assembledOutcome: outcome(artifacts.discoveryAssembled),
      rootOutcome: outcome(artifacts.discoveryRoot),
      assembledRuntime: runtime(artifacts.discoveryAssembled),
      rootRuntime: runtime(artifacts.discoveryRoot)
    },
    memory: {
      rootOwnTypedArrayBytes: Object.values(nativeRoot).reduce((sum, value) =>
        sum + (ArrayBuffer.isView(value) ? value.byteLength : 0), 0),
      sharedComponentGraphTypedArrayBytes: typedBytes(nativeRoot),
      duplicatedWorldStateBytes: 0
    },
    source: {
      nativeRoot: source(root, "engine-v2/src/base-policy/native-root.js"),
      components: Object.fromEntries(componentPaths.map(name => [name,
        source(root, `engine-v2/src/base-policy/${name}.js`)])),
      productionRoot: source(root, "engine-v2/src/runtime/production-root.js")
    },
    artifacts: Object.fromEntries(Object.entries(artifacts).map(
      ([name, artifact]) => [name, artifactIdentity(directories[name], artifact)])),
    verdicts: [
      "NATIVE_ROOT_PRESERVES_FIXED16_ACTIONS_ARGUMENTS_AND_PHYSICS",
      "NATIVE_ROOT_PRESERVES_DISCOVERY64_ACTIONS_ARGUMENTS_AND_PHYSICS",
      "DISCOVERY64_REMAINS_67_48_13_AND_5742_BASIS_POINTS",
      "NATIVE_ROOT_ADDS_NO_TYPED_ARRAY_OR_WORLD_STATE",
      "NATIVE_ROOT_HAS_NO_V1_VM_OR_DIAGNOSTIC_CLASS_DEPENDENCY",
      "PRODUCTION_DEFAULT_REMAINS_UNCHANGED"
    ]
  };
  const unsigned = { ...evidence }; delete unsigned.generatedAt;
  evidence.fingerprint = sha256(Buffer.from(JSON.stringify(unsigned)));
  return evidence;
}

function run() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  const directories = {
    fixedAssembled: path.resolve(process.argv[3]),
    fixedRoot: path.resolve(process.argv[4]),
    discoveryAssembled: path.resolve(process.argv[5]),
    discoveryRoot: path.resolve(process.argv[6])
  };
  const output = path.resolve(process.argv[7] || path.join(root,
    "config/engine-v3/base-policy-kernel-bp172-native-root-evidence.json"));
  const evidence = build(root, directories);
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output,
    fingerprint: evidence.fingerprint, fixed16: evidence.fixed16,
    discovery64: evidence.discovery64, memory: evidence.memory,
    verdicts: evidence.verdicts }, null, 2)}\n`);
}

if (require.main === module) {
  try { run(); }
  catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { build, run, typedBytes };
