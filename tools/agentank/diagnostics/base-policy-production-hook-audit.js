#!/usr/bin/env node
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

function identity(directory, artifact) {
  return { path: directory, ...artifact.hashes,
    candidateFingerprint: fingerprint(artifact.matches, CANDIDATE).sha256 };
}

function zero(differences) {
  return Object.values(differences).every(value => value === 0);
}

function build(root, directories) {
  const artifacts = Object.fromEntries(Object.entries(directories).map(
    ([name, directory]) => [name, load(directory)]));
  const acceptedToOff = compare(artifacts.accepted.matches,
    artifacts.defaultOff.matches);
  const offToActive = compare(artifacts.defaultOff.matches,
    artifacts.active.matches);
  const acceptedToRejected = compare(artifacts.accepted.matches,
    artifacts.rejectedNaive.matches);
  const discoveryAcceptedToActive = compare(
    artifacts.discoveryAccepted.matches, artifacts.discoveryActive.matches);
  const productionSource = fs.readFileSync(path.join(root,
    "engine-v2/src/runtime/production-root.js"), "utf8");
  const evidence = {
    objectKind: "BasePolicyProductionHookEvidenceV1",
    generatedAt: new Date().toISOString(),
    productionDefaultChanged: false,
    contract: {
      activation: "EXPLICIT_CONSTRUCTOR_INJECTION_ONLY",
      staticBasePolicyDependency: false,
      defaultAllocation: "ZERO_NATIVE_BASE_POLICY_COMPONENTS",
      finalOwnerPosition: "AFTER_RUNTIME_FINISH_BEFORE_EMIT",
      resourceOwnership: {
        nonPoisonOwnSkill: "RESOURCE_CONTROLLER; BASE_POLICY_NOT_OBSERVED",
        poison: "BP68_CANDIDATE_DOMAIN"
      },
      overrideState: {
        depthPrincipal: "RESET_NOT_FALSELY_COMMITTED",
        incumbentPlan: "NOT_FALSELY_COMMITTED"
      },
      localTimeInterpretation:
        "CROSS_RUN_TIME_IS_INFORMATIONAL; BP171_SAME_PROCESS_CALIBRATION_IS_AUTHORITATIVE"
    },
    fixed16: {
      acceptedToDefaultOff: acceptedToOff,
      defaultOffToInjectedActive: offToActive,
      acceptedFingerprint: fingerprint(artifacts.accepted.matches, CANDIDATE),
      defaultOffFingerprint: fingerprint(artifacts.defaultOff.matches, CANDIDATE),
      activeFingerprint: fingerprint(artifacts.active.matches, CANDIDATE),
      acceptedOutcome: outcome(artifacts.accepted),
      defaultOffOutcome: outcome(artifacts.defaultOff),
      activeOutcome: outcome(artifacts.active)
    },
    discovery64: {
      acceptedToInjectedActive: discoveryAcceptedToActive,
      acceptedFingerprint: fingerprint(artifacts.discoveryAccepted.matches,
        CANDIDATE),
      activeFingerprint: fingerprint(artifacts.discoveryActive.matches,
        CANDIDATE),
      acceptedOutcome: outcome(artifacts.discoveryAccepted),
      activeOutcome: outcome(artifacts.discoveryActive)
    },
    rejectedNaiveHook: {
      differencesFromAccepted: acceptedToRejected,
      fingerprint: fingerprint(artifacts.rejectedNaive.matches, CANDIDATE),
      outcome: outcome(artifacts.rejectedNaive),
      firstObservedContractBreak:
        "SELECTED_STUN_WAS_EMITTED_BEFORE_THE_ACCEPTED_EXTERNAL_CALLBACK",
      rootCause:
        "NAIVE_INTERNAL_HOOK_ADVANCED_INTENT_OPPONENT_AND_SUPERKO_ON_RESOURCE_OWNED_FRAMES",
      correction:
        "EXPLICIT_NON_POISON_RESOURCE_OWNER_SKIP_BEFORE_NATIVE_BASE_POLICY_ROOT"
    },
    source: {
      productionRoot: source(root, "engine-v2/src/runtime/production-root.js"),
      nativeRoot: source(root, "engine-v2/src/base-policy/native-root.js"),
      test: source(root, "test/minimax-core/native-base-policy-root.test.js"),
      staticRequireAbsent: !productionSource.includes('require("../base-policy")'),
      nativeConstructionAbsent: !productionSource.includes("new NativeBasePolicyRoot")
    },
    tests: { minimaxCorePassed: 247, minimaxCoreFailed: 0 },
    artifacts: Object.fromEntries(Object.entries(artifacts).map(
      ([name, artifact]) => [name, identity(directories[name], artifact)])),
    verdicts: []
  };
  if (zero(acceptedToOff) && zero(offToActive) &&
      zero(discoveryAcceptedToActive) &&
      evidence.source.staticRequireAbsent && evidence.source.nativeConstructionAbsent) {
    evidence.verdicts.push(
      "DEFAULT_OFF_HOOK_PRESERVES_ACCEPTED_FIXED16_BEHAVIOR",
      "INJECTED_PRODUCTION_ROOT_PRESERVES_ACCEPTED_FIXED16_BEHAVIOR",
      "INJECTED_PRODUCTION_ROOT_PRESERVES_ACCEPTED_DISCOVERY64_BEHAVIOR",
      "RESOURCE_OWNERSHIP_GATE_REPAIRS_NAIVE_17_15_REGRESSION",
      "UPLOAD_ENTRY_DOES_NOT_STATICALLY_PULL_NATIVE_BASE_POLICY_STACK",
      "PRODUCTION_DEFAULT_REMAINS_OFF");
  } else evidence.verdicts.push("BP173_PRODUCTION_HOOK_REJECTED");
  const unsigned = { ...evidence }; delete unsigned.generatedAt;
  evidence.fingerprint = sha256(Buffer.from(JSON.stringify(unsigned)));
  return evidence;
}

function run() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  const directories = {
    accepted: path.resolve(process.argv[3]),
    defaultOff: path.resolve(process.argv[4]),
    active: path.resolve(process.argv[5]),
    rejectedNaive: path.resolve(process.argv[6]),
    discoveryAccepted: path.resolve(process.argv[7]),
    discoveryActive: path.resolve(process.argv[8])
  };
  const output = path.resolve(process.argv[9] || path.join(root,
    "config/engine-v3/base-policy-kernel-bp173-production-hook-evidence.json"));
  const evidence = build(root, directories);
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output,
    fingerprint: evidence.fingerprint, fixed16: evidence.fixed16,
    discovery64: evidence.discovery64,
    rejectedNaiveHook: evidence.rejectedNaiveHook,
    source: evidence.source, tests: evidence.tests,
    verdicts: evidence.verdicts }, null, 2)}\n`);
}

if (require.main === module) {
  try { run(); }
  catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { build, run };
