"use strict";

const path = require("node:path");
const { contained } = require("../core/paths");

const SCHEMA_VERSION = Object.freeze({
  PROPERTIES: 1,
  RUN_MANIFEST: 1,
  REPLAY_CAPSULE: 1,
  COHORT_MANIFEST: 1,
  VERIFICATION_REPORT: 1
});

const ARTIFACT_PROPERTY = Object.freeze({
  IMMUTABLE: "IMMUTABLE",
  CONTENT_ADDRESSED: "CONTENT_ADDRESSED",
  APPEND_ONLY: "APPEND_ONLY",
  DETERMINISTIC: "DETERMINISTIC",
  REHYDRATABLE: "REHYDRATABLE",
  SOURCE_BOUND: "SOURCE_BOUND",
  RULE_BOUND: "RULE_BOUND",
  COMPLETE: "COMPLETE",
  PARTIAL: "PARTIAL",
  DISCOVERY_ONLY: "DISCOVERY_ONLY",
  REGRESSION_GATE: "REGRESSION_GATE"
});

const AUTHORITY = Object.freeze({
  PLATFORM_REPLAY: "PLATFORM_REPLAY",
  PINNED_SIMULATOR: "PINNED_SIMULATOR",
  LOCAL_DIAGNOSTIC: "LOCAL_DIAGNOSTIC",
  SYNTHETIC_ORACLE: "SYNTHETIC_ORACLE"
});

const ROOT_RELATIVE = Object.freeze({
  root: "artifacts/fast-regression",
  runs: "artifacts/fast-regression/battle-runs",
  capsules: "artifacts/fast-regression/replay-capsules",
  cohorts: "artifacts/fast-regression/cohorts",
  history: "artifacts/fast-regression/history",
  reports: "artifacts/fast-regression/reports",
  work: "artifacts/fast-regression/.work"
});

function artifactPaths(workspaceRoot) {
  const root = contained(path.resolve(workspaceRoot), "artifacts", "fast-regression");
  return Object.freeze({
    root,
    runs: path.join(root, "battle-runs"),
    capsules: path.join(root, "replay-capsules"),
    cohorts: path.join(root, "cohorts"),
    history: path.join(root, "history"),
    reports: path.join(root, "reports"),
    work: path.join(root, ".work")
  });
}

function propertiesManifest() {
  return {
    schemaVersion: SCHEMA_VERSION.PROPERTIES,
    artifactKind: "FAST_REGRESSION_PROPERTIES",
    physicalRoot: ROOT_RELATIVE.root,
    sourceRoot: "tools/agentank/fast-regression",
    testRoot: "test/fast-regression",
    isolation: {
      independentFromImpArtifacts: true,
      independentFromSrArtifacts: true,
      neverOverwritesHistoricalReports: true,
      workingDirectoriesAreNotEvidence: true
    },
    evidence: {
      immutableAfterFinalize: true,
      contentAddressed: true,
      appendOnlyRuns: true,
      canonicalIntegerJson: true,
      compressedJsonLines: true,
      partialRunsRemainExplicit: true
    },
    replay: {
      persistedTruth: "INITIAL_SCENARIO_PLUS_SCHEDULED_ACTION_PREFIX",
      opaqueEngineDumpForbidden: true,
      deterministicStepRehydration: true,
      simulatorCommitRequired: true,
      v1SourceHashRequired: true,
      v2SourceHashRequired: true,
      plansRestored: false,
      cachesRestored: false,
      factMemoryRestoredByObserveOnly: true
    },
    assertions: {
      universalActionEqualityRequired: false,
      hardSafetyInvariant: true,
      proofSoundnessInvariant: true,
      incompleteNeverExact: true,
      rootRestoreInvariant: true,
      behavioralPartialOrder: true
    },
    lanes: ["MINIMAX_ORACLE", "ROOT", "WINDOW", "SMOKE", "MINIMAX_IMPACTED",
      "TERMINAL_ALL", "CAPSULE_ALL", "ARENA_SMALL", "ARENA_FULL"]
  };
}

module.exports = { SCHEMA_VERSION, ARTIFACT_PROPERTY, AUTHORITY, ROOT_RELATIVE,
  artifactPaths, propertiesManifest };
