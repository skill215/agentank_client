"use strict";

const crypto = require("node:crypto");

const SOURCE_AUTHORITY = Object.freeze({ GUIDE: "PLATFORM_AUTHORITY", UPDATE: "PLATFORM_AUTHORITY",
  PLATFORM_REPLAY: "PLATFORM_AUTHORITY", PLATFORM_SIM: "PLATFORM_AUTHORITY",
  EXTERNAL_SIMULATOR: "CANDIDATE_ONLY", FRAMEWORK: "CANDIDATE_ONLY",
  GENERATED: "GENERATED_EXPLICIT" });

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function createSourceRecord(kind, identity, payload, loaded) {
  const authority = SOURCE_AUTHORITY[kind];
  if (!authority) throw new TypeError(`unknown source kind ${kind}`);
  if (kind === "EXTERNAL_SIMULATOR" && identity.commit !== loaded.corpus.evidence.externalSimulatorCommit) {
    throw new TypeError("external simulator commit is not frozen");
  }
  if (kind === "FRAMEWORK" && identity.commit !== loaded.corpus.evidence.frameworkCommit) {
    throw new TypeError("framework commit is not frozen");
  }
  return Object.freeze({ sourceKind: kind, authority, identity: structuredClone(identity),
    payloadHash: stableHash(payload), admissibleAsStrictTruth: authority === "PLATFORM_AUTHORITY" });
}

function assertStrictSource(record) {
  if (!record.admissibleAsStrictTruth) {
    const error = new Error(`${record.sourceKind} is candidate-only and cannot establish strict truth`);
    error.code = "CANDIDATE_SOURCE_PROMOTION_REJECTED"; throw error;
  }
  return record;
}

module.exports = { SOURCE_AUTHORITY, stableHash, createSourceRecord, assertStrictSource };
