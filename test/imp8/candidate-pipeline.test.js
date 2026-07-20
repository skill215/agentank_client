"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { defaultOutputDirectory } =
  require("../../tools/agentank/calibration/imp8-candidate-comparison");
const { candidateParameters, moduleOverrides, frozenJavascript } =
  require("../../tools/agentank/candidate/imp8-freeze");
const { buildImp6Production } = require("../../tools/agentank/build/imp6-builder");

const root = path.resolve(__dirname, "../..");
const plan = JSON.parse(fs.readFileSync(path.join(root,
  "config/engine-v2/imp8-candidate-comparison-v6.json"), "utf8"));

test("candidate comparison versions write isolated experiment directories", () => {
  assert.equal(defaultOutputDirectory(root,
    "config/engine-v2/imp8-candidate-comparison-v5.json"),
  path.join(root, "artifacts/imp8/calibration/candidate-comparison-v5"));
  assert.equal(defaultOutputDirectory(root,
    "config/engine-v2/imp8-candidate-comparison-v6.json"),
  path.join(root, "artifacts/imp8/calibration/candidate-comparison-v6"));
});

test("candidate configuration serialization is integer-only and deeply frozen", () => {
  const candidate = plan.candidates.find(item => item.candidateProfileId === "PATH_BASELINE_D2_V6");
  const parameters = candidateParameters(plan, candidate); const overrides = moduleOverrides(parameters);
  assert.equal(parameters.tacticalConfig.PATH_CONTROL, 1);
  assert.equal(parameters.searchBudget.DECISION_DEPTH[0], 2);
  assert.equal(parameters.runtimeConfig.WORK_CHARGES[0], 8);
  assert.match(overrides["engine-v2/src/generated/runtime-config.js"], /Object\.freeze/);
  assert.match(overrides["engine-v2/src/generated/tactical-config.js"], /PATH_CONTROL/);
  assert.throws(() => frozenJavascript(0.5), { code: "IMP8_CANDIDATE_NON_INTEGER_CONFIG" });
});

test("specialized candidate production build is byte reproducible without editing generated files", async () => {
  const candidate = plan.candidates.find(item => item.candidateProfileId === "PATH_BASELINE_D2_V6");
  const overrides = moduleOverrides(candidateParameters(plan, candidate));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-imp8-candidate-build-"));
  const left = await buildImp6Production({ workspaceRoot: root,
    outputDirectory: path.join(directory, "a"), moduleSourceOverrides: overrides });
  const right = await buildImp6Production({ workspaceRoot: root,
    outputDirectory: path.join(directory, "b"), moduleSourceOverrides: overrides });
  assert.equal(left.manifest.status, "PASS"); assert.equal(right.manifest.status, "PASS");
  assert.equal(left.manifest.sourceHash, right.manifest.sourceHash);
  assert.equal(left.manifest.minifiedHash, right.manifest.minifiedHash);
  assert.equal(left.manifest.fingerprint, right.manifest.fingerprint);
  assert.match(fs.readFileSync(left.sourceFile, "utf8"), /IMP8_PATH_BASELINE_V6/);
});
