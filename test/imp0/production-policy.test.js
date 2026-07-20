"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { loadProductionPolicy, assertProductionText, auditProductionTree, auditImports } =
  require("../../tools/agentank/build/production-policy");
const { auditWorkspaceStructure } = require("../../tools/agentank/harness/structure-audit");
const { auditImp0Isolation } = require("../../tools/agentank/harness/imp0-isolation");
const { inspectToolVersions } = require("../../tools/agentank/harness/tool-versions");

const ROOT = path.resolve(__dirname, "../..");

test("production policy accepts a minimal synchronous integer entry", () => {
  const policy = loadProductionPolicy(ROOT);
  assert.equal(assertProductionText("function onIdle(){return 0;}", policy).ok, true);
});

test("an intentionally unstripped source is rejected", () => {
  const policy = loadProductionPolicy(ROOT);
  assert.throws(() => assertProductionText("function onIdle(){console.log(ReferenceKernel);}", policy),
    { code: "PRODUCTION_STRIP_AUDIT_FAILED" });
});

test("production imports cannot escape to Reference or offline tools", () => {
  const policy = loadProductionPolicy(ROOT);
  const file = path.join(ROOT, "engine-v2", "src", "fast", "example.js");
  assert.equal(auditImports(file, "require('../state/layout')", policy).length, 0);
  assert.equal(auditImports(file, "require('../reference/oracle')", policy)[0].findingCode,
    "IMPORT_OUTSIDE_PRODUCTION_ROOTS");
  assert.equal(auditImports(file, "require('node:fs')", policy)[0].findingCode,
    "EXTERNAL_RUNTIME_IMPORT");
});

test("current IMP4 production tree passes the frozen import and strip policy", () => {
  const report = auditProductionTree(ROOT);
  assert.equal(report.status, "PASS");
  assert.equal(report.productionSourceStatus, "PASS");
  assert.ok(report.scannedFiles >= 6);
});

test("workspace structure is compatible and historical counts stay dynamic", () => {
  const report = auditWorkspaceStructure(ROOT);
  assert.equal(report.status, "PASS");
  assert.equal(report.legacyLayoutStatus, "MIGRATION_INPUT");
  assert.equal(report.hardcodedLegacyCountFiles.length, 0);
  assert.ok(report.recordCounts.summaries > 0);
});

test("IMP0 dependency graph cannot reach platform network or mutation modules", () => {
  const report = auditImp0Isolation(ROOT);
  assert.equal(report.status, "PASS");
  assert.deepEqual(report.findings, []);
});

test("WSL Node, package manager, schema tools and minifier are exactly pinned", () => {
  const report = inspectToolVersions(ROOT);
  assert.equal(report.status, "PASS");
  assert.equal(report.actual.terser, report.expected.terser);
});
