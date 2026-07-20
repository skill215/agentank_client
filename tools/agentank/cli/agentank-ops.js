#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { defaultWorkspaceRoot, workspacePaths, assertProfileId, assertBranch } = require("../core/paths");
const { AgentankToolError, invariant } = require("../core/errors");
const { redactText } = require("../core/sanitize");
const { scanForSecrets } = require("../core/secret-scan");
const { SCHEMAS, validateSchemaFile } = require("../core/schema-validator");
const { assertSafeArgv } = require("../profiles/secret-ref");
const { loadRegistry, publicProfile } = require("../profiles/registry");
const { bootstrapPlatform } = require("../platform/bootstrap");
const { runDoctor } = require("../platform/doctor");
const { registerTankProfile, verifyTankContext, verifyTankProfile, rotateTankKey,
  planReadOnlyOperation } = require("../platform/context-service");
const { parseOptions, onlyOptions } = require("./args");

const HELP = `AgenTank multi-profile platform toolchain

Usage:
  ./tools/platform-toolchain.sh bootstrap
  ./tools/platform-toolchain.sh doctor
  ./tools/platform-toolchain.sh profiles
  ./tools/platform-toolchain.sh register-tank --tank-profile v2 --expected-tank-id <id> [--branch main]
  ./tools/platform-toolchain.sh context --tank-profile v2 [--branch main]
  ./tools/platform-toolchain.sh verify-profile --tank-profile v2 [--branch main]
  ./tools/platform-toolchain.sh rotate-key --tank-profile v2 --secret-ref-env <ENV> \
    --key-generation <new> --expected-key-generation <current> [--branch main]
  Add --dry-run to any of the four commands above to inspect a zero-I/O plan.
  ./tools/platform-toolchain.sh scan-secrets
  ./tools/platform-toolchain.sh validate-schema --schema tank-registry --file <path>
  ./tools/platform-toolchain.sh test
  ./tools/platform-toolchain.sh verify

Security:
  Tank Key values are never accepted as arguments. Set the environment variable
  named by the TankProfile secretRef, for example AGENTANK_KEY_V2.

External effects:
  register-tank/context/verify-profile/rotate-key perform authenticated GET only.
  rotate-key changes only the local non-secret reference after identity verification. Simulation, publish and
  ranked challenge are intentionally not enabled in this first toolchain slice.

Automation:
  Repeated workflows must be implemented behind this entrypoint. Use verify for
  the complete local foundation gate; do not reconstruct it as ad-hoc commands.
`;

function printJson(value, stream = process.stdout) {
  stream.write(`${JSON.stringify(value, null, 2)}\n`);
}

function requiredString(options, name) {
  invariant(typeof options[name] === "string" && options[name].length > 0,
    "MISSING_REQUIRED_OPTION", `--${name} is required`);
  return options[name];
}

async function execute(command, options, environment = process.env,
  workspaceRoot = defaultWorkspaceRoot()) {
  const paths = workspacePaths(workspaceRoot);
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      return { kind: "help", value: HELP };
    case "bootstrap": {
      onlyOptions(options, []);
      return { kind: "json", value: { operation: "bootstrap", ...bootstrapPlatform(workspaceRoot) } };
    }
    case "doctor": {
      onlyOptions(options, []);
      const value = runDoctor(workspaceRoot);
      return { kind: "json", value, exitCode: value.ok ? 0 : 9 };
    }
    case "profiles": {
      onlyOptions(options, []);
      const registry = loadRegistry(paths.registry);
      return { kind: "json", value: {
        registryId: registry.registryId,
        fingerprint: registry.fingerprint,
        profiles: registry.profiles.map(publicProfile)
      } };
    }
    case "register-tank":
    case "context":
    case "verify-profile":
    case "rotate-key": {
      onlyOptions(options, ["tank-profile", "branch", "expected-tank-id", "dry-run",
        "secret-ref-env", "key-generation", "expected-key-generation"]);
      const profileId = assertProfileId(requiredString(options, "tank-profile"));
      const branch = assertBranch(options.branch || "main");
      const expectedTankId = options["expected-tank-id"] === undefined ? undefined :
        Number(options["expected-tank-id"]);
      if (expectedTankId !== undefined) {
        invariant(Number.isSafeInteger(expectedTankId) && expectedTankId >= 0,
          "INVALID_EXPECTED_TANK_ID", "--expected-tank-id must be a non-negative integer");
      }
      invariant(fs.existsSync(paths.registry), "TANK_REGISTRY_NOT_FOUND",
        "run bootstrap before accessing a TankProfile");
      const dryRun = options["dry-run"] === true;
      invariant(options["dry-run"] === undefined || dryRun, "INVALID_DRY_RUN",
        "--dry-run is a flag and does not take a value");
      let rotation = null;
      if (command === "rotate-key") {
        rotation = {
          secretRefEnv: requiredString(options, "secret-ref-env"),
          keyGenerationId: requiredString(options, "key-generation"),
          expectedKeyGenerationId: requiredString(options, "expected-key-generation")
        };
      }
      if (dryRun) {
        const plan = planReadOnlyOperation({ operation: command, workspaceRoot,
          registryFile: paths.registry, profileId, branch });
        return { kind: "json", value: { ...plan, ...(rotation ? {
          nextSecretRef: { provider: "ENV", name: rotation.secretRefEnv,
            keyGenerationId: rotation.keyGenerationId },
          expectedKeyGenerationId: rotation.expectedKeyGenerationId
        } : {}) } };
      }
      const shared = { workspaceRoot, registryFile: paths.registry, profileId, branch, environment };
      const value = command === "register-tank" ?
        await registerTankProfile({ ...shared, expectedTankId }) :
        command === "context" ? await verifyTankContext(shared) :
        command === "verify-profile" ? await verifyTankProfile(shared) :
        await rotateTankKey({ ...shared, ...rotation });
      return { kind: "json", value: { operation: command, ...value } };
    }
    case "scan-secrets": {
      onlyOptions(options, []);
      const registry = loadRegistry(paths.registry, { allowMissing: true });
      const exactSecrets = registry ? registry.profiles
        .map(profile => environment[profile.secretRef.name])
        .filter(value => typeof value === "string" && value.length > 0) : [];
      const result = scanForSecrets(workspaceRoot, undefined, exactSecrets);
      return { kind: "json", value: { ok: result.findings.length === 0, ...result },
        exitCode: result.findings.length === 0 ? 0 : 7 };
    }
    case "validate-schema": {
      onlyOptions(options, ["schema", "file"]);
      const schema = requiredString(options, "schema");
      invariant(Object.hasOwn(SCHEMAS, schema), "UNKNOWN_SCHEMA_NAME",
        `--schema must be one of ${Object.keys(SCHEMAS).join(", ")}`);
      const file = requiredString(options, "file");
      validateSchemaFile(schema, file, workspaceRoot);
      return { kind: "json", value: { ok: true, schema, file } };
    }
    default:
      throw new AgentankToolError("UNKNOWN_COMMAND", `unknown command: ${command || "(missing)"}`);
  }
}

async function main(argv = process.argv.slice(2), environment = process.env) {
  try {
    assertSafeArgv(argv);
    const command = argv[0] || "help";
    const options = parseOptions(argv.slice(1));
    const result = await execute(command, options, environment);
    if (result.kind === "help") process.stdout.write(result.value);
    else printJson(result.value);
    process.exitCode = result.exitCode || 0;
    return result;
  } catch (error) {
    const typed = error instanceof AgentankToolError ? error :
      new AgentankToolError("UNEXPECTED_TOOL_ERROR", error?.message || "unexpected error", { exitCode: 9 });
    printJson({ ok: false, errorCode: typed.code, retryClass: typed.retryClass,
      message: redactText(typed.message) }, process.stderr);
    process.exitCode = typed.exitCode;
    return { kind: "error", error: typed };
  }
}

if (require.main === module) main();

module.exports = { HELP, execute, main, requiredString };
