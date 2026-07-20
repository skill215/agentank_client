"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, workspacePaths, tankPaths } = require("../core/paths");
const { fingerprintObject } = require("../core/hash");
const { scanForSecrets } = require("../core/secret-scan");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory } = require("../core/atomic-file");
const { bootstrapPlatform, readBootstrapConfig } = require("../platform/bootstrap");
const { verifyTankProfile } = require("../platform/context-service");
const { loadRegistry } = require("../profiles/registry");
const { summarizeTestOutput } = require("./test-runner");
const { writeReport, writeImmutableJsonEvidence, writeImmutableRawEvidence,
  artifactEntry, check } = require("./foundation-gate");

const EXTERNAL_BLOCKERS = new Set(["SECRET_NOT_AVAILABLE", "PLATFORM_TIMEOUT",
  "PLATFORM_NETWORK_ERROR"]);

function directoryAudit(root, registry, config) {
  const owners = ["runs", "baselines", "standing", "imports"];
  const expected = new Set(config.profiles.map(item => item.tankProfileId));
  const profileResults = registry.profiles.map(profile => {
    const paths = tankPaths(root, profile.tankProfileId);
    const directories = Object.fromEntries(owners.map(owner => [owner,
      fs.existsSync(paths[owner]) && fs.statSync(paths[owner]).isDirectory()]));
    return { tankProfileId: profile.tankProfileId, expected: expected.has(profile.tankProfileId),
      directories };
  });
  const roots = registry.profiles.map(profile => tankPaths(root, profile.tankProfileId).tank);
  const isolated = new Set(roots).size === roots.length;
  const value = { schemaVersion: 1,
    status: profileResults.every(item => item.expected && Object.values(item.directories).every(Boolean)) &&
      isolated ? "PASS" : "FAIL",
    registryFingerprint: registry.fingerprint,
    configuredProfileIds: [...expected].sort(), profileResults, isolated, fingerprint: "" };
  value.fingerprint = fingerprintObject(value);
  return value;
}

function readOnlyAudit(root) {
  const cli = fs.readFileSync(path.join(root, "tools", "agentank", "cli", "agentank-ops.js"), "utf8");
  const client = fs.readFileSync(path.join(root, "tools", "agentank", "platform", "client.js"), "utf8");
  const forbiddenCases = [...cli.matchAll(/case\s+"(simulate|publish|challenge)"/g)].map(item => item[1]);
  const checks = {
    dryRunImplemented: cli.includes('"dry-run"') && cli.includes("planReadOnlyOperation"),
    clientGetOnly: client.includes('method === "GET"') &&
      client.includes("IMP1_READ_ONLY_METHOD_REJECTED"),
    mutationCommandsReachable: forbiddenCases.length > 0,
    platformMutationsDuringGate: 0
  };
  const value = { schemaVersion: 1,
    status: checks.dryRunImplemented && checks.clientGetOnly && !checks.mutationCommandsReachable ?
      "PASS" : "FAIL", checks, forbiddenCases, fingerprint: "" };
  value.fingerprint = fingerprintObject(value);
  return value;
}

function externalResultStatus(error) {
  if (EXTERNAL_BLOCKERS.has(error?.code)) return "BLOCKED";
  if (error?.code === "PLATFORM_HTTP_ERROR" && (error.status === 429 || error.status >= 500)) {
    return "BLOCKED";
  }
  return "FAIL";
}

async function collectExternalEvidence(root, registry, environment, options = {}) {
  const paths = workspacePaths(root);
  const results = [];
  for (const profile of registry.profiles) {
    if (profile.status !== "ACTIVE" && profile.status !== "READ_ONLY") {
      results.push({ tankProfileId: profile.tankProfileId, status: "BLOCKED",
        errorCode: "PROFILE_NOT_ACTIVE", verifiedBranches: [] });
      continue;
    }
    try {
      const verified = await verifyTankProfile({ workspaceRoot: root, registryFile: paths.registry,
        profileId: profile.tankProfileId, branch: "main", environment,
        fetchImpl: options.fetchImpl, clientFactory: options.clientFactory,
        now: options.now || new Date().toISOString() });
      results.push({ tankProfileId: profile.tankProfileId, status: "PASS", errorCode: null,
        tankId: verified.identity.tankId, tankName: verified.identity.tankName,
        tankUrlId: verified.identity.tankUrlId,
        skillId: verified.identity.skillId, verifiedBranches: [verified.identity.branch],
        contextArtifactId: verified.artifact.artifactId,
        baselineFingerprint: verified.baseline.fingerprint,
        capabilityFingerprint: verified.capability.fingerprint });
    } catch (error) {
      results.push({ tankProfileId: profile.tankProfileId, status: externalResultStatus(error),
        errorCode: error?.code || "UNEXPECTED_EXTERNAL_ERROR", verifiedBranches: [] });
    }
  }
  const status = results.some(item => item.status === "FAIL") ? "FAIL" :
    results.some(item => item.status === "BLOCKED") ? "BLOCKED" : "PASS";
  const value = { schemaVersion: 1, status, authenticatedGetOnly: true,
    platformMutationCount: 0, profileResults: results, fingerprint: "" };
  value.fingerprint = fingerprintObject(value);
  return value;
}

async function runImp1ControlPlaneGate(workspaceRoot = defaultWorkspaceRoot(), options = {}) {
  const root = path.resolve(workspaceRoot);
  const outputDirectory = path.join(root, "artifacts", "reports", "imp1");
  ensureDirectory(outputDirectory);
  bootstrapPlatform(root);
  const paths = workspacePaths(root);
  const config = readBootstrapConfig(paths.bootstrapConfig);
  const registry = loadRegistry(paths.registry);
  validateSchemaObject("tank-registry", registry, root);
  const directories = directoryAudit(root, registry, config);
  const exactSecrets = registry.profiles.map(profile => options.environment?.[profile.secretRef.name])
    .filter(value => typeof value === "string" && value.length > 0);
  const rawSecretScan = scanForSecrets(root, undefined, exactSecrets);
  const secrets = { schemaVersion: 1, status: rawSecretScan.findings.length === 0 ? "PASS" : "FAIL",
    ...rawSecretScan, fingerprint: "" };
  secrets.fingerprint = fingerprintObject(secrets);
  const readOnly = readOnlyAudit(root);
  const tests = summarizeTestOutput(root, options.testOutputFile, options.testExitCode,
    outputDirectory, { testDirectories: ["platform", "imp1"] });
  const external = options.verifyExternal === false ? {
    schemaVersion: 1, status: "BLOCKED", authenticatedGetOnly: true, platformMutationCount: 0,
    profileResults: registry.profiles.map(profile => ({ tankProfileId: profile.tankProfileId,
      status: "BLOCKED", errorCode: "EXTERNAL_VERIFICATION_DISABLED", verifiedBranches: [] })),
    fingerprint: ""
  } : await collectExternalEvidence(root, registry, options.environment || process.env, options);
  if (!external.fingerprint) external.fingerprint = fingerprintObject(external);

  const evidenceFiles = [
    ["registry-directories", writeImmutableJsonEvidence(outputDirectory,
      "registry-directories", directories)],
    ["secret-scan", writeImmutableJsonEvidence(outputDirectory, "secret-scan", secrets)],
    ["read-only", writeImmutableJsonEvidence(outputDirectory, "read-only", readOnly)],
    ["external-context", writeImmutableJsonEvidence(outputDirectory, "external-context", external)],
    ["tests", writeImmutableJsonEvidence(outputDirectory, "tests", tests.report)],
    ["test-output", writeImmutableRawEvidence(outputDirectory, "test-output", "tap", tests.output)]
  ];
  const testStatus = tests.report.status;
  const checks = [
    check("REGISTRY_DIRECTORIES", directories.status, { fingerprint: directories.fingerprint,
      profileCount: registry.profiles.length }),
    check("SECRET_BOUNDARY", secrets.status, { fingerprint: secrets.fingerprint,
      scannedFiles: secrets.scannedFiles, findingCount: secrets.findings.length }),
    check("IDENTITY_ROTATION_FAULTS", testStatus, { tests: tests.report.tests,
      rawOutputSha256: tests.report.rawOutputSha256 }),
    check("OWNER_SCOPE_RATE_LIMIT", testStatus, { ownerScopeIds:
      [...new Set(registry.profiles.map(profile => profile.ownerScopeId))].length }),
    check("BASELINE_CAPABILITY_IMPLEMENTATION", testStatus,
      { schema: "dd10-platform-capability.schema.json" }),
    check("READ_ONLY_BOUNDARY", readOnly.status, { fingerprint: readOnly.fingerprint,
      platformMutationCount: 0 }),
    check("RECOVERY_FAULTS", testStatus, { tests: tests.report.tests,
      fail: tests.report.fail }),
    check("REAL_CONTEXT_EVIDENCE", external.status === "BLOCKED" ? "NOT_RUN" : external.status,
      { fingerprint: external.fingerprint, profileResults: external.profileResults })
  ];
  const localBlockers = checks.filter(item => item.status === "FAIL").map(item => item.checkId);
  const gate = { schemaVersion: 1, reportId: "imp1-control-plane-gate-v1",
    status: localBlockers.length === 0 ? "PASS" : "FAIL", checks,
    artifacts: evidenceFiles.map(([id, file]) => artifactEntry(root, id, file)),
    blockers: localBlockers, fingerprint: "" };
  gate.fingerprint = fingerprintObject(gate);
  validateSchemaObject("imp1-gate-report", gate, root);
  writeReport(outputDirectory, "imp1-gate-report.json", gate);
  const gateFile = writeImmutableJsonEvidence(outputDirectory, "imp1-gate", gate);
  return { gate, gateFile, external };
}

module.exports = { EXTERNAL_BLOCKERS, directoryAudit, readOnlyAudit, externalResultStatus,
  collectExternalEvidence, runImp1ControlPlaneGate };
