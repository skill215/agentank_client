"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function loadArtifact(root, relative) {
  const directory = path.join(root, relative);
  const overviewBytes = fs.readFileSync(path.join(directory, "overview.json"));
  const manifestBytes = fs.readFileSync(path.join(directory, "manifest.json"));
  const matchesBytes = fs.readFileSync(path.join(directory, "matches.ndjson.gz"));
  const text = zlib.gunzipSync(matchesBytes).toString("utf8").trim();
  return { relative, overview: JSON.parse(overviewBytes),
    matches: text ? text.split("\n").map(JSON.parse) : [], hashes: {
      manifestSha256: sha256(manifestBytes), overviewSha256: sha256(overviewBytes),
      matchesSha256: sha256(matchesBytes) } };
}

function matchKey(match) {
  return `${match.scenarioFingerprint}:${match.candidateSeat}`;
}

function implementationMatches(artifact, implementation) {
  return artifact.matches.filter(match => match.implementation === implementation);
}

function pairedTransitions(artifact, baseline, candidate) {
  const rows = new Map(); const transitions = {};
  for (const match of artifact.matches) {
    const key = matchKey(match); const row = rows.get(key) || {};
    row[match.implementation] = match; rows.set(key, row);
  }
  let paired = 0; let actionStreamDifferences = 0;
  for (const row of rows.values()) {
    const left = row[baseline]; const right = row[candidate];
    if (!left || !right) continue;
    paired += 1;
    const transition = `${left.analysisOutcome}->${right.analysisOutcome}`;
    transitions[transition] = (transitions[transition] || 0) + 1;
    if (left.candidate.compactActionStream !== right.candidate.compactActionStream ||
        JSON.stringify(left.candidate.compactArguments) !==
          JSON.stringify(right.candidate.compactArguments))
      actionStreamDifferences += 1;
  }
  return { paired, actionStreamDifferences, transitions };
}

function actionFingerprint(artifact, implementation) {
  const rows = implementationMatches(artifact, implementation).map(match =>
    `${matchKey(match)}:${match.candidate.compactActionStream}:${
      JSON.stringify(match.candidate.compactArguments)}`).sort();
  return { matches: rows.length, sha256: sha256(Buffer.from(rows.join("\n"))) };
}

function summary(value) {
  return { matches: value.matches, wins: value.wins, losses: value.losses,
    draws: value.draws, scorePercent: value.scorePercent, stars: value.stars,
    crashes: value.crashes, actions: value.actions, runtime: value.runtime,
    invariants: value.invariants, contactSearchFunnel: value.contactSearchFunnel,
    contactSupportCensus: value.contactSupportCensus, selective: value.selective };
}

function build(root) {
  const paths = {
    census: "artifacts/v2-native-initiative/bp154-minimax-contact-support-census-discovery64",
    broad: "artifacts/v2-native-initiative/bp154-refuted-possible-physical-search-fixed16",
    zeroGate: "artifacts/v2-native-initiative/bp154-refuted-possible-physical-combat-search-fixed16",
    safeFire16: "artifacts/v2-native-initiative/bp154b-refuted-possible-safe-fire-search-fixed16",
    safeFire64: "artifacts/v2-native-initiative/bp154b-refuted-possible-safe-fire-search-discovery64",
    verifier16: "artifacts/v2-native-initiative/bp155-refuted-possible-fire-verifier-fixed16"
  };
  const artifact = Object.fromEntries(Object.entries(paths).map(([key, value]) =>
    [key, loadArtifact(root, value)]));
  const broadPair = pairedTransitions(artifact.broad, "V2_WORKING_CURRENT",
    "V2_REFUTED_POSSIBLE_PHYSICAL_SEARCH");
  const safeFire16Pair = pairedTransitions(artifact.safeFire16, "V2_WORKING_CURRENT",
    "V2_REFUTED_POSSIBLE_PHYSICAL_COMBAT_SEARCH");
  const safeFire64Pair = pairedTransitions(artifact.safeFire64, "V2_WORKING_CURRENT",
    "V2_REFUTED_POSSIBLE_PHYSICAL_COMBAT_SEARCH");
  const verifierPair = pairedTransitions(artifact.verifier16, "V2_WORKING_CURRENT",
    "V2_REFUTED_POSSIBLE_FIRE_VERIFIER");
  const census = artifact.census.overview.baseline.contactSupportCensus;
  const inexact = artifact.census.overview.baseline.contactSearchFunnel.inexact;
  const fixed16Fingerprints = {
    broad: actionFingerprint(artifact.broad, "V2_WORKING_CURRENT"),
    zeroGate: actionFingerprint(artifact.zeroGate, "V2_WORKING_CURRENT"),
    safeFire: actionFingerprint(artifact.safeFire16, "V2_WORKING_CURRENT"),
    verifier: actionFingerprint(artifact.verifier16, "V2_WORKING_CURRENT")
  };
  const baselineHashes = new Set(Object.values(fixed16Fingerprints).map(item => item.sha256));
  return {
    objectKind: "MinimaxSupportRestorationEvidenceV1",
    generatedAt: new Date().toISOString(),
    contract: {
      restoredPhysicalSupport:
        "gap == POSSIBLE_ENEMY_PROJECTILE && pool.complete && possibleCount == 0",
      futureEnemyFire: "remains an EnemyAction in Physical Minimax",
      defaultProductionBehavior: "unchanged; every candidate is diagnostic-only"
    },
    census: { roots: census.roots, exact: census.exact, inexact,
      recoverablePhysical: census.recoverablePhysical,
      recoverableOfInexactBasisPoints: inexact ?
        Math.floor(census.recoverablePhysical * 10000 / inexact) : 0,
      possibleOnlyTracked: census.possibleOnlyTracked,
      possibleWithOther: census.possibleWithOther, otherGap: census.otherGap,
      possibleCount: census.possibleCount, gapBitCount: census.gapBitCount },
    experiments: {
      broadPhysicalFixed16: { baseline: summary(artifact.broad.overview.baseline),
        candidate: summary(artifact.broad.overview.candidate),
        comparison: artifact.broad.overview.comparison, paired: broadPair },
      combatGateZeroFixed16: {
        baseline: summary(artifact.zeroGate.overview.baseline),
        candidate: summary(artifact.zeroGate.overview.candidate),
        comparison: artifact.zeroGate.overview.comparison },
      safeFireGateFixed16: { baseline: summary(artifact.safeFire16.overview.baseline),
        candidate: summary(artifact.safeFire16.overview.candidate),
        comparison: artifact.safeFire16.overview.comparison, paired: safeFire16Pair },
      safeFireGateDiscovery64: { baseline: summary(artifact.safeFire64.overview.baseline),
        candidate: summary(artifact.safeFire64.overview.candidate),
        comparison: artifact.safeFire64.overview.comparison, paired: safeFire64Pair },
      exactFireVerifierFixed16: { baseline: summary(artifact.verifier16.overview.baseline),
        candidate: summary(artifact.verifier16.overview.candidate),
        comparison: artifact.verifier16.overview.comparison, paired: verifierPair }
    },
    baselineIdentity: { fixed16Fingerprints,
      uniqueActionFingerprintCount: baselineHashes.size,
      defaultActionIdentity: baselineHashes.size === 1 },
    artifacts: Object.fromEntries(Object.entries(artifact).map(([key, value]) =>
      [key, { path: value.relative, ...value.hashes,
        productionRootSha256: value.overview.source.productionRootSha256 }])),
    verdicts: [
      "REFUTED_POSSIBLE_GAP_CAN_RESTORE_PHYSICAL_SUPPORT",
      "SUPPORT_RESTORATION_DOES_NOT_AUTHORIZE_GLOBAL_SEARCH",
      "BROAD_RESTORED_PHYSICAL_SEARCH_REGRESSES_OUTCOME_AND_RUNTIME",
      "SAFE_FIRE_GATE_REDUCES_WORK_BUT_STAGE_MATRIX_OWNERSHIP_REGRESSES_DISCOVERY64",
      "FINITE_DEPTH_CELLWISE_FIRE_DOMINANCE_PRODUCES_ZERO_PROPOSALS",
      "SEARCH_WITHOUT_CONSUMER_PERTURBS_RUNTIME_FALLBACK",
      "NEXT_OWNER_IS_NATIVE_BASE_POLICY_INCUMBENT_WITH_GATED_TACTICAL_REFUTATION"
    ]
  };
}

function run() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  const output = path.resolve(process.argv[3] || path.join(root,
    "config/engine-v3/base-policy-kernel-bp154-bp155-support-restoration-evidence.json"));
  const evidence = build(root); evidence.fingerprint = sha256(Buffer.from(
    JSON.stringify({ ...evidence, generatedAt: undefined, fingerprint: undefined })));
  fs.writeFileSync(output, `${JSON.stringify(evidence, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, fingerprint: evidence.fingerprint,
    verdicts: evidence.verdicts }, null, 2)}\n`);
  return evidence;
}

if (require.main === module) run();

module.exports = { loadArtifact, pairedTransitions, actionFingerprint, summary, build, run };
