"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject } = require("../core/hash");

function readPackageVersion(root, packageName) {
  const file = path.join(root, "node_modules", ...packageName.split("/"), "package.json");
  return JSON.parse(fs.readFileSync(file, "utf8")).version;
}

function inspectToolVersions(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const expectedNode = fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
  const actual = {
    node: process.version,
    npm: packageJson.packageManager,
    ajv: readPackageVersion(root, "ajv"),
    ajvFormats: readPackageVersion(root, "ajv-formats"),
    terser: readPackageVersion(root, "terser")
  };
  const checks = {
    linux: process.platform === "linux",
    wsl2: /microsoft.*wsl2/i.test(os.release()),
    nodePinned: actual.node === `v${expectedNode}`,
    npmPinned: actual.npm === "npm@11.13.0",
    ajvPinned: actual.ajv === packageJson.devDependencies.ajv,
    ajvFormatsPinned: actual.ajvFormats === packageJson.devDependencies["ajv-formats"],
    terserPinned: actual.terser === packageJson.devDependencies.terser,
    lockfileVersionPinned: lock.lockfileVersion === 3
  };
  const report = {
    schemaVersion: 1,
    status: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
    runtime: { platform: process.platform, arch: process.arch, release: os.release(),
      execPath: process.execPath },
    expected: { node: expectedNode, npm: "npm@11.13.0", ajv: packageJson.devDependencies.ajv,
      ajvFormats: packageJson.devDependencies["ajv-formats"], terser: packageJson.devDependencies.terser,
      lockfileVersion: 3 },
    actual,
    checks,
    fingerprint: ""
  };
  report.fingerprint = fingerprintObject(report);
  return report;
}

module.exports = { readPackageVersion, inspectToolVersions };
