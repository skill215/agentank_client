"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { fingerprintObject } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");

function loadProductionPolicy(workspaceRoot = defaultWorkspaceRoot(), policyFile) {
  const root = path.resolve(workspaceRoot);
  const file = policyFile || contained(root, "config", "agentank", "production-policy.json");
  const policy = JSON.parse(fs.readFileSync(file, "utf8"));
  validateSchemaObject("imp0-production-policy", policy, root);
  const allowed = policy.allowedRoots.map(relative => contained(root, relative));
  const denied = policy.deniedRoots.map(relative => contained(root, relative));
  invariant(new Set(allowed).size === allowed.length, "DUPLICATE_PRODUCTION_ROOT",
    "production allowed roots must be unique");
  invariant(new Set(denied).size === denied.length, "DUPLICATE_DENIED_ROOT",
    "production denied roots must be unique");
  for (const allowedRoot of allowed) {
    invariant(!denied.some(deniedRoot => allowedRoot === deniedRoot ||
      allowedRoot.startsWith(`${deniedRoot}${path.sep}`)), "PRODUCTION_ROOT_DENIED",
    "an allowed production root is inside a denied root");
  }
  const patterns = policy.forbiddenPatterns.map(entry => ({ ...entry, regex: new RegExp(entry.source, "m") }));
  return { policy, allowed, denied, patterns, fingerprint: fingerprintObject(policy) };
}

function auditProductionText(source, loadedPolicy) {
  const findings = [];
  for (const pattern of loadedPolicy.patterns) {
    if (pattern.regex.test(source)) findings.push({ findingCode: "FORBIDDEN_PATTERN",
      patternId: pattern.patternId });
  }
  return findings;
}

function assertProductionText(source, loadedPolicy) {
  const findings = auditProductionText(source, loadedPolicy);
  invariant(findings.length === 0, "PRODUCTION_STRIP_AUDIT_FAILED",
    `production strip audit found ${findings.length} forbidden construct(s)`);
  return { ok: true, findings };
}

function collectJavaScript(directory, output) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) collectJavaScript(file, output);
    else if (entry.isFile() && entry.name.endsWith(".js")) output.push(file);
  }
}

function isInside(file, roots) {
  return roots.some(root => file === root || file.startsWith(`${root}${path.sep}`));
}

function auditImports(file, source, loadedPolicy) {
  const findings = [];
  const expression = /(?:require\s*\(\s*|from\s+|import\s*\(\s*)["']([^"']+)["']/g;
  for (const match of source.matchAll(expression)) {
    const target = match[1];
    if (!target.startsWith(".")) {
      findings.push({ findingCode: "EXTERNAL_RUNTIME_IMPORT", target });
      continue;
    }
    const resolved = path.resolve(path.dirname(file), target);
    if (!isInside(resolved, loadedPolicy.allowed)) {
      findings.push({ findingCode: "IMPORT_OUTSIDE_PRODUCTION_ROOTS", target });
    }
  }
  return findings;
}

function auditProductionTree(workspaceRoot = defaultWorkspaceRoot(), policyFile) {
  const root = path.resolve(workspaceRoot);
  const loaded = loadProductionPolicy(root, policyFile);
  const files = [];
  for (const allowedRoot of loaded.allowed) collectJavaScript(allowedRoot, files);
  const findings = [];
  for (const file of files.sort()) {
    const source = fs.readFileSync(file, "utf8");
    for (const finding of auditProductionText(source, loaded)) findings.push({
      relativePath: path.relative(root, file), ...finding });
    for (const finding of auditImports(file, source, loaded)) findings.push({
      relativePath: path.relative(root, file), ...finding });
  }
  const report = {
    schemaVersion: 1,
    policyId: loaded.policy.policyId,
    policyFingerprint: loaded.fingerprint,
    status: findings.length === 0 ? "PASS" : "FAIL",
    productionSourceStatus: files.length === 0 ? "NOT_RUN" :
      findings.length === 0 ? "PASS" : "FAIL",
    scannedFiles: files.length,
    findings,
    fingerprint: ""
  };
  report.fingerprint = fingerprintObject(report);
  return report;
}

module.exports = { loadProductionPolicy, auditProductionText, assertProductionText,
  auditProductionTree, auditImports };
