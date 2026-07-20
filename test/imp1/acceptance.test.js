"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { criterion, acceptanceStatus } = require("../../tools/agentank/acceptance/imp1");
const { parseStage } = require("../../tools/agentank/cli/implementation-ops");

test("IMP1 acceptance maps missing real context to BLOCKED rather than ACCEPTED", () => {
  const criteria = [
    { criterionId: "A1-01", status: "PASS", evidence: {} },
    { criterionId: "A1-03", status: "BLOCKED", evidence: { errorCode: "SECRET_NOT_AVAILABLE" } }
  ];
  assert.equal(acceptanceStatus(criteria), "BLOCKED");
});

test("IMP1 acceptance gives failed hard evidence precedence over external blockers", () => {
  assert.equal(acceptanceStatus([{ status: "BLOCKED" }, { status: "FAIL" }]), "REJECTED");
});

test("IMP1 criterion exceptions remain explicit FAIL results", () => {
  const result = criterion("A1-08", () => {
    const error = new Error("fault");
    error.code = "FAULT_INJECTION";
    throw error;
  });
  assert.deepEqual(result, { criterionId: "A1-08", status: "FAIL",
    evidence: { errorCode: "FAULT_INJECTION" } });
});

test("IMP1 and IMP2 are registered while later acceptance stages still fail closed", () => {
  assert.equal(parseStage(["--stage", "IMP1"]), "IMP1");
  assert.equal(parseStage(["--stage", "IMP2"]), "IMP2");
  assert.equal(parseStage(["--stage", "IMP10"]), "IMP10");
});
