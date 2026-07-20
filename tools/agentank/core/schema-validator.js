"use strict";

const fs = require("node:fs");
const path = require("node:path");
const Ajv2020 = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const { AgentankToolError, invariant } = require("./errors");
const { sanitizeForStorage } = require("./sanitize");
const { defaultWorkspaceRoot } = require("./paths");

const SCHEMAS = Object.freeze({
  "tank-registry": "dd10-tank-registry.schema.json",
  "platform-run": "dd10-platform-run.schema.json",
  "platform-capability": "dd10-platform-capability.schema.json",
  corpus: "dd10-corpus.schema.json",
  "imp0-fixture-manifest": "imp0-fixture-manifest.schema.json",
  "imp0-benchmark-plan": "imp0-benchmark-plan.schema.json",
  "imp0-production-policy": "imp0-production-policy.schema.json",
  "imp0-benchmark-report": "imp0-benchmark-report.schema.json",
  "imp0-differential-report": "imp0-differential-report.schema.json",
  "imp0-gate-report": "imp0-gate-report.schema.json",
  "imp1-gate-report": "imp1-gate-report.schema.json",
  "imp2-rule-probe-plan": "imp2-rule-probe-plan.schema.json",
  "imp2-gate-report": "imp2-gate-report.schema.json",
  "imp3-capacity-manifest": "imp3-capacity-manifest.schema.json",
  "imp3-gate-report": "imp3-gate-report.schema.json",
  "imp4-search-manifest": "imp4-search-manifest.schema.json",
  "imp4-gate-report": "imp4-gate-report.schema.json",
  "imp5-policy-manifest": "imp5-policy-manifest.schema.json",
  "imp5-gate-report": "imp5-gate-report.schema.json",
  "imp6-runtime-build-profile": "imp6-runtime-build-profile.schema.json",
  "imp6-build-manifest": "imp6-build-manifest.schema.json",
  "imp6-benchmark-report": "imp6-benchmark-report.schema.json",
  "imp6-gate-report": "imp6-gate-report.schema.json",
  "imp7-counterfactual-result": "imp7-counterfactual-result.schema.json",
  "imp7-analysis-report": "imp7-analysis-report.schema.json",
  "imp7-gate-report": "imp7-gate-report.schema.json",
  "imp8-test-plan": "imp8-test-plan.schema.json",
  "imp8-calibration-suite": "imp8-calibration-suite.schema.json",
  "imp8-calibration-report": "imp8-calibration-report.schema.json",
  "imp8-readiness-report": "imp8-readiness-report.schema.json",
  "imp8-candidate-manifest": "imp8-candidate-manifest.schema.json",
  "imp8-candidate-disposition": "imp8-candidate-disposition.schema.json",
  "imp8-g10a-report": "imp8-g10a-report.schema.json",
  "v1-v2-failure-diagnostic-plan": "v1-v2-failure-diagnostic-plan.schema.json",
  "v1-v2-failure-diagnostic-report": "v1-v2-failure-diagnostic-report.schema.json",
  "imp8-gate-report": "imp8-gate-report.schema.json",
  "discovery-skill-regression-suite": "discovery-skill-regression-suite.schema.json",
  "discovery-skill-regression-report": "discovery-skill-regression-report.schema.json",
  "imp9-readiness-report": "imp9-readiness-report.schema.json",
  "imp9-gate-report": "imp9-gate-report.schema.json",
  "fast-regression-run-manifest": "fast-regression-run-manifest.schema.json",
  "replay-capsule": "replay-capsule.schema.json",
  "imp-acceptance-report": "imp-acceptance-report.schema.json"
});

let compiledRoot = null;
let validators = null;

function schemaDirectory(workspaceRoot = defaultWorkspaceRoot()) {
  return path.join(workspaceRoot, "docs", "design");
}

function compileSchemas(workspaceRoot = defaultWorkspaceRoot()) {
  if (compiledRoot === path.resolve(workspaceRoot) && validators) return validators;
  const ajv = new Ajv2020({ allErrors: true, strictSchema: true, strictTypes: false,
    allowUnionTypes: true, validateFormats: true });
  addFormats(ajv);
  const output = new Map();
  for (const [name, filename] of Object.entries(SCHEMAS)) {
    const file = path.join(schemaDirectory(workspaceRoot), filename);
    invariant(fs.existsSync(file), "SCHEMA_FILE_NOT_FOUND", `schema file not found: ${filename}`);
    const schema = JSON.parse(fs.readFileSync(file, "utf8"));
    output.set(name, ajv.compile(schema));
  }
  compiledRoot = path.resolve(workspaceRoot);
  validators = output;
  return output;
}

function validateSchemaObject(schemaName, value, workspaceRoot = defaultWorkspaceRoot()) {
  const validate = compileSchemas(workspaceRoot).get(schemaName);
  invariant(validate, "UNKNOWN_SCHEMA_NAME", `unknown schema: ${schemaName}`);
  if (!validate(value)) {
    throw new AgentankToolError("SCHEMA_VALIDATION_FAILED", `${schemaName} schema validation failed`, {
      exitCode: 7,
      details: sanitizeForStorage(validate.errors || [])
    });
  }
  return value;
}

function validateSchemaFile(schemaName, file, workspaceRoot = defaultWorkspaceRoot()) {
  invariant(fs.existsSync(file), "SCHEMA_INPUT_NOT_FOUND", `schema input not found: ${file}`);
  return validateSchemaObject(schemaName, JSON.parse(fs.readFileSync(file, "utf8")), workspaceRoot);
}

module.exports = { SCHEMAS, schemaDirectory, compileSchemas, validateSchemaObject, validateSchemaFile };
