"use strict";

const { fingerprintObject } = require("../core/hash");
const { compareSnapshots, semanticFingerprint } = require("./semantic");
const { validateSchemaObject } = require("../core/schema-validator");

function createDifferentialReport(input, workspaceRoot) {
  const missing = input.reference === undefined || input.fast === undefined ||
    input.rootBefore === undefined || input.rootAfter === undefined;
  let report;
  if (missing) {
    report = {
      schemaVersion: 1,
      fixtureId: input.fixtureId,
      status: "NOT_RUN",
      referenceFingerprint: null,
      fastFingerprint: null,
      semanticEqual: null,
      rootRestored: null,
      firstDifference: null,
      fingerprint: ""
    };
  } else {
    const semantic = compareSnapshots(input.reference, input.fast);
    const root = compareSnapshots(input.rootBefore, input.rootAfter);
    report = {
      schemaVersion: 1,
      fixtureId: input.fixtureId,
      status: semantic.equal && root.equal ? "PASS" : "FAIL",
      referenceFingerprint: semanticFingerprint(input.reference),
      fastFingerprint: semanticFingerprint(input.fast),
      semanticEqual: semantic.equal,
      rootRestored: root.equal,
      firstDifference: semantic.firstDifference || root.firstDifference,
      fingerprint: ""
    };
  }
  report.fingerprint = fingerprintObject(report);
  validateSchemaObject("imp0-differential-report", report, workspaceRoot);
  return report;
}

module.exports = { createDifferentialReport };
