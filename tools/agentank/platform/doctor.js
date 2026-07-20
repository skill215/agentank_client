"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { workspacePaths } = require("../core/paths");
const { loadRegistry, publicProfile } = require("../profiles/registry");
const { validateSchemaObject, compileSchemas } = require("../core/schema-validator");

function runDoctor(workspaceRoot) {
  const paths = workspacePaths(workspaceRoot);
  const release = os.release();
  const registry = loadRegistry(paths.registry, { allowMissing: true });
  let schemaCompilation = true;
  let registrySchema = registry !== null;
  try {
    compileSchemas(workspaceRoot);
    if (registry) validateSchemaObject("tank-registry", registry, workspaceRoot);
  } catch {
    schemaCompilation = false;
    registrySchema = false;
  }
  const expectedNode = fs.readFileSync(path.join(workspaceRoot, ".nvmrc"), "utf8").trim();
  const checks = {
    processPlatformLinux: process.platform === "linux",
    wslKernel: /microsoft/i.test(release),
    nativeLinuxNode: process.execPath.startsWith("/") && !/\.exe$/i.test(process.execPath),
    expectedNodeVersion: process.version === `v${expectedNode}`,
    bootstrapConfigExists: fs.existsSync(paths.bootstrapConfig),
    registryExists: registry !== null,
    dd10SchemasCompile: schemaCompilation,
    registrySchemaValid: registrySchema,
    profileDirectoriesSeparated: registry ? registry.profiles.every(profile =>
      fs.existsSync(path.join(paths.tanks, profile.tankProfileId))) : false
  };
  return {
    ok: Object.values(checks).every(Boolean),
    runtime: { node: process.version, execPath: process.execPath, platform: process.platform, release },
    checks,
    registry: registry ? {
      registryId: registry.registryId,
      fingerprint: registry.fingerprint,
      profiles: registry.profiles.map(publicProfile)
    } : null
  };
}

module.exports = { runDoctor };
