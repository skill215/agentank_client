"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { fingerprintObject } = require("../core/hash");

const NETWORK_MODULES = new Set(["http", "https", "net", "tls", "dgram", "dns", "undici",
  "node:http", "node:https", "node:net", "node:tls", "node:dgram", "node:dns"]);

function collectJavaScript(directory, output) {
  if (!fs.existsSync(directory)) return;
  const stat = fs.statSync(directory);
  if (stat.isFile()) {
    if (directory.endsWith(".js")) output.push(directory);
    return;
  }
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collectJavaScript(file, output);
    else if (entry.isFile() && entry.name.endsWith(".js")) output.push(file);
  }
}

function auditImp0Isolation(workspaceRoot = defaultWorkspaceRoot()) {
  const root = path.resolve(workspaceRoot);
  const files = [];
  for (const relative of ["tools/agentank/harness", "tools/agentank/benchmark",
    "tools/agentank/build", "tools/agentank/cli/imp0-ops.js"]) {
    collectJavaScript(contained(root, relative), files);
  }
  const imp0Files = files.filter(file => !/^imp(?:10|[1-9])-/.test(path.basename(file)));
  const forbiddenRoots = [contained(root, "tools", "agentank", "platform"),
    contained(root, "tools", "agentank", "profiles")];
  const findings = [];
  const requirePattern = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const file of imp0Files.sort()) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(requirePattern)) {
      const target = match[1];
      if (NETWORK_MODULES.has(target)) {
        findings.push({ relativePath: path.relative(root, file), findingCode: "NETWORK_MODULE",
          target });
      } else if (target.startsWith(".")) {
        const resolved = path.resolve(path.dirname(file), target);
        if (forbiddenRoots.some(forbidden => resolved === forbidden ||
          resolved.startsWith(`${forbidden}${path.sep}`))) {
          findings.push({ relativePath: path.relative(root, file),
            findingCode: "PLATFORM_CONTROL_DEPENDENCY", target });
        }
      }
    }
  }
  const wrapper = fs.readFileSync(contained(root, "tools", "imp0-toolchain.sh"), "utf8");
  if (/\bcurl\b|\bwget\b/.test(wrapper)) findings.push({ relativePath: "tools/imp0-toolchain.sh",
    findingCode: "NETWORK_COMMAND", target: null });
  const report = { schemaVersion: 1, status: findings.length === 0 ? "PASS" : "FAIL",
    scannedFiles: imp0Files.length + 1, findings, fingerprint: "" };
  report.fingerprint = fingerprintObject(report);
  return report;
}

module.exports = { NETWORK_MODULES, collectJavaScript, auditImp0Isolation };
