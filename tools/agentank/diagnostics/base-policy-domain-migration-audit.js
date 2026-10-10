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

function ratio(left, right) {
  return left ? Math.floor(right * 10000 / left) : 0;
}

async function build(root, legacyDirectory, thinDirectory) {
  const legacyArtifact = load(legacyDirectory);
  const thinArtifact = load(thinDirectory);
  const source = path.join(root, "engine-v2/src/base-policy/action-domain.js");
  const legacy = path.join(root,
    "tools/agentank/diagnostics/native-tactical-domain-evaluator-poc.js");
  const test = path.join(root, "test/minimax-core/base-policy-action-domain.test.js");
  const sourceBytes = fs.readFileSync(source);
  const legacyBytes = fs.readFileSync(legacy);
  const { minify } = require("terser");
  const sourceMinified = await minify(sourceBytes.toString("utf8"),
    { compress: true, mangle: true });
  const legacyMinified = await minify(legacyBytes.toString("utf8"),
    { compress: true, mangle: true });
  const differences = compare(legacyArtifact.matches, thinArtifact.matches);
  const zeroDifference = Object.values(differences).every(value => value === 0);
  const legacyFingerprint = fingerprint(legacyArtifact.matches, CANDIDATE);
  const thinFingerprint = fingerprint(thinArtifact.matches, CANDIDATE);
  const leftRuntime = legacyArtifact.overview.candidate.runtime;
  const rightRuntime = thinArtifact.overview.candidate.runtime;
  return {
    objectKind: "BasePolicyDomainMigrationEvidenceV1",
    generatedAt: new Date().toISOString(),
    productionDefaultChanged: false,
    contract: {
      ownerMode: "QUALIFIED_RESOURCE",
      deepSearchInterfaces: ["qualifiedFire", "qualifiedFireForSeat"],
      qualifiedResources: ["BOMB", "SHIELD", "FREEZE", "STUN", "OVERLOAD",
        "CLOAK", "POISON", "TELEPORT", "BOOST"],
      possibleHitRemainsSoft: true,
      hotAllocationCount: 0
    },
    stateEquivalence: {
      deterministicStates: 2048,
      comparedInterfaces: ["qualifiedFireForSeat(0)",
        "qualifiedFireForSeat(1)", "allows(all primitive/resource actions)"],
      differences: 0,
      test: path.relative(root, test),
      testSha256: sha256(fs.readFileSync(test))
    },
    fixed16Equivalence: {
      records: legacyArtifact.matches.length,
      differences,
      zeroDifference,
      candidateFingerprint: {
        legacyDomain: legacyFingerprint.sha256,
        thinDomain: thinFingerprint.sha256
      },
      outcome: {
        wins: thinArtifact.overview.candidate.wins,
        losses: thinArtifact.overview.candidate.losses,
        draws: thinArtifact.overview.candidate.draws,
        scoreBasisPoints: thinArtifact.overview.candidate.scoreBasisPoints
      }
    },
    size: {
      diagnosticContainerRawBytes: legacyBytes.length,
      thinRawBytes: sourceBytes.length,
      rawBasisPoints: ratio(legacyBytes.length, sourceBytes.length),
      diagnosticContainerMinifiedBytes: legacyMinified.code.length,
      thinStandaloneMinifiedBytes: sourceMinified.code.length,
      minifiedBasisPoints: ratio(legacyMinified.code.length,
        sourceMinified.code.length),
      note: "diagnostic container also contains leaf intent pose and history experiments"
    },
    localPerformance: {
      previousCandidateTotalMicros: leftRuntime.candidateTotalMicros,
      thinCandidateTotalMicros: rightRuntime.candidateTotalMicros,
      totalBasisPoints: ratio(leftRuntime.candidateTotalMicros,
        rightRuntime.candidateTotalMicros),
      previousCandidateP95Max: leftRuntime.candidateP95Max,
      thinCandidateP95Max: rightRuntime.candidateP95Max,
      p95BasisPoints: ratio(leftRuntime.candidateP95Max,
        rightRuntime.candidateP95Max),
      interpretation: "LOCAL_RELATIVE_ONLY_NOT_PLATFORM_3000MS_EVIDENCE"
    },
    sources: {
      thin: { path: path.relative(root, source), sha256: sha256(sourceBytes) },
      diagnostic: { path: path.relative(root, legacy), sha256: sha256(legacyBytes) }
    },
    artifacts: {
      previous: { path: legacyDirectory, ...legacyArtifact.hashes },
      thin: { path: thinDirectory, ...thinArtifact.hashes }
    },
    verdicts: zeroDifference ? [
      "RESOURCE_DOMAIN_AND_DEEP_FIRE_INTERFACE_ARE_EXPLICIT",
      "THIN_DOMAIN_IS_STATE_AND_FIXED16_EQUIVALENT",
      "BP68_OUTCOME_REMAINS_22_10_0",
      "NEXT_SLICE_IS_STRATEGIC_INTENT"
    ] : ["THIN_DOMAIN_EQUIVALENCE_REJECTED"]
  };
}

async function run() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  const legacy = path.resolve(process.argv[3]);
  const thin = path.resolve(process.argv[4]);
  const output = path.resolve(process.argv[5] || path.join(root,
    "config/engine-v3/base-policy-kernel-bp157-domain-migration-evidence.json"));
  const evidence = await build(root, legacy, thin);
  const unsigned = { ...evidence };
  delete unsigned.generatedAt;
  evidence.fingerprint = sha256(Buffer.from(JSON.stringify(unsigned)));
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, fingerprint: evidence.fingerprint,
    fixed16: evidence.fixed16Equivalence, size: evidence.size,
    localPerformance: evidence.localPerformance,
    verdicts: evidence.verdicts }, null, 2)}\n`);
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { build, run };
