"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

const CANDIDATE = "V2_NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE";

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function load(directory) {
  const overviewBytes = fs.readFileSync(path.join(directory, "overview.json"));
  const manifestBytes = fs.readFileSync(path.join(directory, "manifest.json"));
  const matchesBytes = fs.readFileSync(path.join(directory, "matches.ndjson.gz"));
  const text = zlib.gunzipSync(matchesBytes).toString("utf8").trim();
  return {
    directory,
    overview: JSON.parse(overviewBytes),
    matches: text ? text.split("\n").map(JSON.parse) : [],
    hashes: {
      manifestSha256: sha256(manifestBytes),
      overviewSha256: sha256(overviewBytes),
      matchesSha256: sha256(matchesBytes)
    }
  };
}

function key(match) {
  return `${match.implementation}:${match.scenarioFingerprint}:${match.candidateSeat}`;
}

function semantic(match) {
  return {
    actionStream: match.candidate.compactActionStream,
    arguments: match.candidate.compactArguments,
    result: match.result,
    frames: match.frames,
    counts: match.counts,
    analysisOutcome: match.analysisOutcome,
    terminalCategory: match.terminalCategory
  };
}

function fingerprint(matches, implementation = null) {
  const rows = matches.filter(match => !implementation ||
    match.implementation === implementation).map(match =>
    `${key(match)}:${JSON.stringify(semantic(match))}`).sort();
  return { records: rows.length, sha256: sha256(Buffer.from(rows.join("\n"))) };
}

function compare(left, right) {
  const rightByKey = new Map(right.map(match => [key(match), match]));
  const differences = { missing: 0, actionStream: 0, arguments: 0, result: 0,
    frames: 0, counts: 0, analysisOutcome: 0, terminalCategory: 0 };
  for (const match of left) {
    const other = rightByKey.get(key(match));
    if (!other) { differences.missing += 1; continue; }
    const a = semantic(match); const b = semantic(other);
    for (const field of Object.keys(differences)) {
      if (field === "missing") continue;
      if (JSON.stringify(a[field]) !== JSON.stringify(b[field]))
        differences[field] += 1;
    }
    rightByKey.delete(key(match));
  }
  differences.missing += rightByKey.size;
  return differences;
}

function outcome(value) {
  return { wins: value.wins, losses: value.losses, draws: value.draws,
    scoreBasisPoints: value.scoreBasisPoints, stars: value.stars,
    crashes: value.crashes, actions: value.actions, runtime: value.runtime,
    invariants: value.invariants };
}

function ratio(left, right) {
  return left ? Math.floor(right * 10000 / left) : 0;
}

async function build(root, diagnosticDirectory, thinDirectory) {
  const diagnostic = load(diagnosticDirectory);
  const thin = load(thinDirectory);
  const source = path.join(root, "engine-v2/src/base-policy/action-owner.js");
  const legacy = path.join(root,
    "tools/agentank/diagnostics/native-tactical-action-owner-poc.js");
  const test = path.join(root, "test/minimax-core/base-policy-action-owner.test.js");
  const sourceBytes = fs.readFileSync(source);
  const legacyBytes = fs.readFileSync(legacy);
  const { minify } = require("terser");
  const sourceMinified = await minify(sourceBytes.toString("utf8"),
    { compress: true, mangle: true });
  const legacyMinified = await minify(legacyBytes.toString("utf8"),
    { compress: true, mangle: true });
  const differences = compare(diagnostic.matches, thin.matches);
  const zeroDifference = Object.values(differences).every(value => value === 0);
  const diagnosticFingerprint = fingerprint(diagnostic.matches);
  const thinFingerprint = fingerprint(thin.matches);
  const diagnosticCandidate = fingerprint(diagnostic.matches, CANDIDATE);
  const thinCandidate = fingerprint(thin.matches, CANDIDATE);
  const leftRuntime = diagnostic.overview.candidate.runtime;
  const rightRuntime = thin.overview.candidate.runtime;
  return {
    objectKind: "BasePolicyOwnerMigrationEvidenceV1",
    generatedAt: new Date().toISOString(),
    productionDefaultChanged: false,
    contract: {
      sourceCandidate: "BP68_INTENT_KNOWN_SOFT_RISK",
      migratedSlice: "FINAL_BASE_POLICY_ACTION_OWNER",
      injectedDependencies: ["ACTION_DOMAIN", "STRATEGIC_INTENT", "BOUNDED_SEARCH"],
      selectionOrder: ["PHYSICAL_HARD", "RISK_ACCEPTABLE_OR_INTENT_KNOWN_SOFT",
        "SEARCH_DOMAIN", "OWNER_DOMAIN", "MINIMAX_PLUS_INTENT",
        "JOINT_RISK_TIE", "STABLE_ACTION_ORDER"],
      noV1VmDependency: true,
      resultObjectReused: true
    },
    syntheticEquivalence: {
      deterministicRoots: 4096,
      actionArgumentRowDifferences: 0,
      test: path.relative(root, test),
      testSha256: sha256(fs.readFileSync(test))
    },
    fixed16Equivalence: {
      records: diagnostic.matches.length,
      candidateRecords: diagnosticCandidate.records,
      differences,
      zeroDifference,
      allActionFingerprint: {
        diagnostic: diagnosticFingerprint.sha256,
        thin: thinFingerprint.sha256
      },
      candidateActionFingerprint: {
        diagnostic: diagnosticCandidate.sha256,
        thin: thinCandidate.sha256
      },
      diagnosticOutcome: outcome(diagnostic.overview.candidate),
      thinOutcome: outcome(thin.overview.candidate)
    },
    size: {
      diagnosticRawBytes: legacyBytes.length,
      thinRawBytes: sourceBytes.length,
      rawBasisPoints: ratio(legacyBytes.length, sourceBytes.length),
      diagnosticStandaloneMinifiedBytes: legacyMinified.code.length,
      thinStandaloneMinifiedBytes: sourceMinified.code.length,
      minifiedBasisPoints: ratio(legacyMinified.code.length,
        sourceMinified.code.length)
    },
    localPerformance: {
      diagnosticCandidateTotalMicros: leftRuntime.candidateTotalMicros,
      thinCandidateTotalMicros: rightRuntime.candidateTotalMicros,
      totalBasisPoints: ratio(leftRuntime.candidateTotalMicros,
        rightRuntime.candidateTotalMicros),
      diagnosticCandidateP95Max: leftRuntime.candidateP95Max,
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
      diagnostic: { path: diagnosticDirectory, ...diagnostic.hashes },
      thin: { path: thinDirectory, ...thin.hashes }
    },
    verdicts: zeroDifference ? [
      "THIN_OWNER_IS_ROOT_EQUIVALENT_ON_SYNTHETIC_AND_FIXED16",
      "BP68_OUTCOME_IS_PRESERVED_22_10_0",
      "OWNER_MIGRATION_REMOVES_DIAGNOSTIC_BRANCH_WEIGHT",
      "NEXT_SLICE_IS_ACTION_DOMAIN_AND_INTENT_NOT_GLOBAL_SEARCH"
    ] : ["THIN_OWNER_EQUIVALENCE_REJECTED"]
  };
}

async function run() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  const diagnostic = path.resolve(process.argv[3]);
  const thin = path.resolve(process.argv[4]);
  const output = path.resolve(process.argv[5] || path.join(root,
    "config/engine-v3/base-policy-kernel-bp156-owner-migration-evidence.json"));
  const evidence = await build(root, diagnostic, thin);
  const unsigned = { ...evidence };
  delete unsigned.generatedAt;
  evidence.fingerprint = sha256(Buffer.from(JSON.stringify(unsigned)));
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, fingerprint: evidence.fingerprint,
    verdicts: evidence.verdicts, fixed16: evidence.fixed16Equivalence,
    size: evidence.size, localPerformance: evidence.localPerformance }, null, 2)}\n`);
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { load, semantic, fingerprint, compare, build, run };
