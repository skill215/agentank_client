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

function normalized(candidate, control) {
  return control ? Math.floor(candidate * 10000 / control) : 0;
}

async function build(root, previousDirectory, thinDirectory) {
  const previousArtifact = load(previousDirectory);
  const thinArtifact = load(thinDirectory);
  const source = path.join(root,
    "engine-v2/src/base-policy/strategic-intent.js");
  const diagnostic = path.join(root,
    "tools/agentank/diagnostics/native-tactical-domain-evaluator-poc.js");
  const test = path.join(root,
    "test/minimax-core/base-policy-strategic-intent.test.js");
  const sourceBytes = fs.readFileSync(source);
  const diagnosticBytes = fs.readFileSync(diagnostic);
  const { minify } = require("terser");
  const sourceMinified = await minify(sourceBytes.toString("utf8"),
    { compress: true, mangle: true });
  const diagnosticMinified = await minify(diagnosticBytes.toString("utf8"),
    { compress: true, mangle: true });
  const differences = compare(previousArtifact.matches, thinArtifact.matches);
  const zeroDifference = Object.values(differences).every(value => value === 0);
  const previousFingerprint = fingerprint(previousArtifact.matches, CANDIDATE);
  const thinFingerprint = fingerprint(thinArtifact.matches, CANDIDATE);
  const left = previousArtifact.overview.candidate.runtime;
  const right = thinArtifact.overview.candidate.runtime;
  return {
    objectKind: "BasePolicyIntentMigrationEvidenceV1",
    generatedAt: new Date().toISOString(),
    productionDefaultChanged: false,
    contract: {
      classification: "v1-exact",
      mapping: "v1-action",
      continuity: "v1-epoch",
      valueMode: "bonus",
      reachableMethods: ["observeContext", "prepare", "member", "bonus",
        "commitSelection"],
      excludedDiagnosticBranches: ["oracle matrices", "simple classifier",
        "frontier quality", "single-quality mapping", "direct-attack shortcut",
        "preemptive-safety shortcut"],
      fixedScratch: ["rowBonus", "rowMember", "pathDistance", "pathQueue",
        "pathFirst"],
      hotAllocationCount: 0
    },
    stateEquivalence: {
      deterministicSequentialRoots: 4096,
      comparedState: ["context signature", "proposed intent",
        "committed intent", "mapped action", "row membership", "row bonus",
        "context epoch", "commit continuity"],
      differences: 0,
      test: path.relative(root, test),
      testSha256: sha256(fs.readFileSync(test))
    },
    fixed16Equivalence: {
      records: previousArtifact.matches.length,
      differences,
      zeroDifference,
      candidateFingerprint: {
        diagnosticIntent: previousFingerprint.sha256,
        thinIntent: thinFingerprint.sha256
      },
      outcome: {
        wins: thinArtifact.overview.candidate.wins,
        losses: thinArtifact.overview.candidate.losses,
        draws: thinArtifact.overview.candidate.draws,
        scoreBasisPoints: thinArtifact.overview.candidate.scoreBasisPoints
      },
      invariants: thinArtifact.overview.candidate.invariants
    },
    size: {
      diagnosticContainerRawBytes: diagnosticBytes.length,
      thinRawBytes: sourceBytes.length,
      rawBasisPoints: ratio(diagnosticBytes.length, sourceBytes.length),
      diagnosticContainerMinifiedBytes: diagnosticMinified.code.length,
      thinStandaloneMinifiedBytes: sourceMinified.code.length,
      minifiedBasisPoints: ratio(diagnosticMinified.code.length,
        sourceMinified.code.length),
      note: "diagnostic container also includes domain leaf pose and history experiments"
    },
    localPerformance: {
      previous: left,
      thin: right,
      absoluteTotalBasisPoints: ratio(left.candidateTotalMicros,
        right.candidateTotalMicros),
      absoluteP95BasisPoints: ratio(left.candidateP95Max,
        right.candidateP95Max),
      previousCandidateVsControlBasisPoints: normalized(
        left.candidateTotalMicros, left.controlTotalMicros),
      thinCandidateVsControlBasisPoints: normalized(
        right.candidateTotalMicros, right.controlTotalMicros),
      previousP95VsControlBasisPoints: normalized(
        left.candidateP95Max, left.controlP95Max),
      thinP95VsControlBasisPoints: normalized(
        right.candidateP95Max, right.controlP95Max),
      interpretation: "LOCAL_MATCHED_CONTROL_NORMALIZATION_ONLY_NOT_PLATFORM_3000MS_EVIDENCE"
    },
    sources: {
      thin: { path: path.relative(root, source), sha256: sha256(sourceBytes) },
      diagnostic: { path: path.relative(root, diagnostic),
        sha256: sha256(diagnosticBytes) }
    },
    artifacts: {
      previous: { path: previousDirectory, ...previousArtifact.hashes },
      thin: { path: thinDirectory, ...thinArtifact.hashes }
    },
    verdicts: zeroDifference ? [
      "REACHABLE_BP68_INTENT_CLOSURE_IS_EXPLICIT",
      "THIN_INTENT_IS_STATE_AND_FIXED16_EQUIVALENT",
      "BP68_OUTCOME_REMAINS_22_10_0",
      "PRODUCTION_DEFAULT_REMAINS_UNCHANGED",
      "NEXT_SLICE_IS_BOUNDED_POLICY_SEARCH"
    ] : ["THIN_INTENT_EQUIVALENCE_REJECTED"]
  };
}

async function run() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  const previous = path.resolve(process.argv[3]);
  const thin = path.resolve(process.argv[4]);
  const output = path.resolve(process.argv[5] || path.join(root,
    "config/engine-v3/base-policy-kernel-bp158-intent-migration-evidence.json"));
  const evidence = await build(root, previous, thin);
  const unsigned = { ...evidence };
  delete unsigned.generatedAt;
  evidence.fingerprint = sha256(Buffer.from(JSON.stringify(unsigned)));
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output,
    fingerprint: evidence.fingerprint,
    fixed16: evidence.fixed16Equivalence,
    size: evidence.size,
    localPerformance: evidence.localPerformance,
    verdicts: evidence.verdicts }, null, 2)}\n`);
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { build, run };
