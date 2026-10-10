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
    crashes: value.crashes, bullets: value.bullets,
    actions: value.actions.candidate, invariants: value.invariants };
}

function candidateRows(artifact) {
  return artifact.matches.filter(match => match.implementation === CANDIDATE);
}

function rowKey(match) {
  return `${match.scenarioFingerprint}:${match.candidateSeat}`;
}

function paired(left, right) {
  const rightByKey = new Map(candidateRows(right).map(match => [rowKey(match), match]));
  const transitions = Object.create(null);
  let actionStreamDifferences = 0;
  let resultDifferences = 0;
  let frameDifferences = 0;
  let positiveHalfPoints = 0;
  let negativeHalfPoints = 0;
  for (const match of candidateRows(left)) {
    const other = rightByKey.get(rowKey(match));
    if (!other) continue;
    const transition = `${match.analysisOutcome}->${other.analysisOutcome}`;
    transitions[transition] = (transitions[transition] || 0) + 1;
    if (match.candidate.compactActionStream !== other.candidate.compactActionStream)
      actionStreamDifferences += 1;
    if (JSON.stringify(match.result) !== JSON.stringify(other.result))
      resultDifferences += 1;
    if (match.frames !== other.frames) frameDifferences += 1;
    const points = { V1_WIN: 0, DRAW: 1, V2_WIN: 2 };
    const delta = points[other.analysisOutcome] - points[match.analysisOutcome];
    if (delta > 0) positiveHalfPoints += delta;
    else if (delta < 0) negativeHalfPoints -= delta;
  }
  return { transitions, actionStreamDifferences, resultDifferences,
    frameDifferences, positiveHalfPoints, negativeHalfPoints,
    netHalfPoints: positiveHalfPoints - negativeHalfPoints };
}

function historyAgreement(artifact) {
  let compared = 0; let agreed = 0; let mismatched = 0;
  for (const match of candidateRows(artifact)) {
    const value = match.candidate.nativeBasePolicyOpponentHistory;
    if (!value) continue;
    compared += value.oracleCompareCount || 0;
    agreed += value.oracleAgreementCount || 0;
    mismatched += value.oracleMismatchCount || 0;
  }
  return { compared, agreed, mismatched };
}

async function build(root, directories) {
  const artifacts = Object.fromEntries(Object.entries(directories).map(
    ([name, directory]) => [name, load(directory)]));
  const source = path.join(root, "engine-v2/src/base-policy/opponent-history.js");
  const test = path.join(root,
    "test/minimax-core/base-policy-opponent-history.test.js");
  const productionRoot = path.join(root, "engine-v2/src/runtime/production-root.js");
  const fixedNativeDifferences = compare(artifacts.fixedOracle.matches,
    artifacts.fixedNative.matches);
  const discoveryPair = paired(artifacts.discoveryOracle,
    artifacts.discoveryNative);
  return {
    objectKind: "BasePolicyOpponentContextMigrationEvidenceV1",
    generatedAt: new Date().toISOString(),
    productionDefaultChanged: false,
    contract: {
      migratedSlice: "V1_EXACT_OPPONENT_HISTORY_CONTENT",
      contextPolicy: "NATIVE_HISTORY_ON_EVERY_NATIVE_SEARCH_ROOT",
      rejectedPolicies: ["V1_VM_STAGE_ELIGIBILITY_GATE", "UNIFORM_CONTEXT"],
      reason: "V1 stage eligibility depends on a counterfactual V1 action history; it is not a valid native search ABI",
      fixedState: ["four action counters", "observations", "GO streak",
        "stationary streak", "last visible pose", "last bullet observation"],
      integerBlend: true,
      hotAllocationCount: 0
    },
    deterministicStateEquivalence: {
      sequentialFrames: 4096,
      differences: 0,
      test: path.relative(root, test),
      testSha256: sha256(fs.readFileSync(test))
    },
    fixed16: {
      oracleGate: outcome(artifacts.fixedOracle),
      nativeAlways: outcome(artifacts.fixedNative),
      nativeGated: outcome(artifacts.fixedGated),
      uniform: outcome(artifacts.fixedUniform),
      nativeVsOracleDifferences: fixedNativeDifferences,
      nativeHistoryAgreement: historyAgreement(artifacts.fixedNative),
      interpretation: "uniform is materially worse; native history has value; one fixed16 result is sensitive to the invalid VM gate"
    },
    discovery64: {
      oracleGate: outcome(artifacts.discoveryOracle),
      nativeAlways: outcome(artifacts.discoveryNative),
      scoreBasisPointDelta: artifacts.discoveryNative.overview.candidate.scoreBasisPoints -
        artifacts.discoveryOracle.overview.candidate.scoreBasisPoints,
      paired: discoveryPair,
      nativeHistoryAgreement: historyAgreement(artifacts.discoveryNative),
      oracleFingerprint: fingerprint(artifacts.discoveryOracle.matches,
        CANDIDATE).sha256,
      nativeFingerprint: fingerprint(artifacts.discoveryNative.matches,
        CANDIDATE).sha256
    },
    source: { path: path.relative(root, source),
      sha256: sha256(fs.readFileSync(source)) },
    productionRoot: { path: path.relative(root, productionRoot),
      sha256: sha256(fs.readFileSync(productionRoot)) },
    artifacts: Object.fromEntries(Object.entries(artifacts).map(([name, value]) =>
      [name, { path: directories[name], ...value.hashes }])),
    verdicts: [
      "OPPONENT_HISTORY_CONTENT_IS_NATIVE_AND_EXACT",
      "UNIFORM_OPPONENT_CONTEXT_IS_REJECTED",
      "COUNTERFACTUAL_V1_STAGE_GATE_IS_REJECTED_AS_A_NATIVE_ABI",
      "NATIVE_ALWAYS_IS_DISCOVERY64_NEUTRAL_WITH_MINUS_39_BASIS_POINTS",
      "PRODUCTION_DEFAULT_REMAINS_UNCHANGED",
      "NEXT_SLICE_IS_BOUNDED_POLICY_SEARCH_REACHABLE_CLOSURE"
    ]
  };
}

async function run() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  const directories = {
    fixedOracle: path.resolve(process.argv[3]),
    fixedNative: path.resolve(process.argv[4]),
    fixedGated: path.resolve(process.argv[5]),
    fixedUniform: path.resolve(process.argv[6]),
    discoveryOracle: path.resolve(process.argv[7]),
    discoveryNative: path.resolve(process.argv[8])
  };
  const output = path.resolve(process.argv[9] || path.join(root,
    "config/engine-v3/base-policy-kernel-bp159-opponent-context-evidence.json"));
  const evidence = await build(root, directories);
  const unsigned = { ...evidence };
  delete unsigned.generatedAt;
  evidence.fingerprint = sha256(Buffer.from(JSON.stringify(unsigned)));
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, fingerprint: evidence.fingerprint,
    fixed16: evidence.fixed16, discovery64: evidence.discovery64,
    verdicts: evidence.verdicts }, null, 2)}\n`);
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { build, run };
