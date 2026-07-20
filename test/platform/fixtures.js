"use strict";

function minimalRunManifest(overrides = {}) {
  const hash = "0".repeat(64);
  const stage = () => ({ status: "NOT_RUN", attempts: 0, startedAt: null, completedAt: null,
    evidenceArtifactIds: [] });
  return {
    schemaVersion: 1,
    runId: "run_test",
    purpose: "DISCOVERY",
    state: "DRAFT",
    createdAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z",
    revision: 0,
    previousRevisionSha256: null,
    tankProfile: {
      tankProfileId: "v2",
      tankId: 77,
      tankUrlId: "tnk_v2",
      ownerScopeId: "same-owner",
      keyGenerationId: "g1",
      skillId: "boost",
      branch: "main"
    },
    candidate: {
      candidateId: "cand_test",
      candidateFingerprint: hash,
      buildManifestSha256: hash,
      targetTankProfileId: "v2",
      targetTankId: 77,
      targetSkillId: "boost",
      sourceSha256: hash,
      minifiedSha256: hash,
      publishArtifactKind: "PRODUCTION_MINIFIED",
      publishArtifactSha256: hash,
      branch: "main",
      basePublishedCodeHash: null,
      basePublishedVersion: null,
      rollbackMode: "FIRST_PUBLISH_NO_ROLLBACK",
      publishedCodeHash: null,
      publishedVersion: null,
      ownSkillId: "boost",
      capabilityProfileSha256: hash,
      corpusSnapshotSha256: null,
      profiles: { ruleset: "r1", feature: "f1", search: "s1", runtime: "rt1",
        memory: "m1", capability: "c1" }
    },
    toolVersions: { opsRunner: "0.1.0", artifactSchema: "1", analyzer: "0", ledger: "0",
      terminalClassifier: null, counterfactual: null },
    corpusSnapshot: null,
    forwardBatchId: null,
    stages: { context: stage(), localValidation: stage(), simulation: stage(), publish: stage(),
      challenge: stage(), download: stage(), analysis: stage(), ingestion: stage() },
    simulationAttestation: null,
    matchUrlIds: [],
    mutations: [],
    artifacts: [],
    errors: [],
    secretMaterialPersisted: false,
    fingerprint: hash,
    ...overrides
  };
}

module.exports = { minimalRunManifest };
