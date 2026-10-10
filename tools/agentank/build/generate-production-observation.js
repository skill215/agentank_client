#!/usr/bin/env node
"use strict";

// Mechanically extracts the accepted observation/entity slice from the large
// ProductionRoot source. The generated module lets a thin candidate reuse the
// exact parser and lifecycle rules without importing the legacy decision root.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const acorn = require("acorn");

const FUNCTION_NAMES = Object.freeze([
  "integer", "hasProjectile", "positionCell", "directionCode",
  "terrainCode", "observedActionCode", "mix",
  "productionValueSupportComplete"
]);
const CLASS_NAMES = Object.freeze([
  "ProductionEntityTracker", "ProductionObservationAdapter"
]);
const CONSTANT_NAMES = Object.freeze([
  "ROOT_STATUS", "ENEMY_CAPABILITY_REASON", "INFORMATION_GAP",
  "EFFECT_ARRAY", "STATUS_EFFECT", "STATUS_FIELDS"
]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function declarationName(node) {
  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration")
    return node.id?.name;
  if (node.type === "VariableDeclaration" && node.declarations.length === 1)
    return node.declarations[0].id?.name;
  return null;
}

function generate(root) {
  const sourceFile = path.join(root,
    "engine-v2/src/runtime/production-root.js");
  const outputFile = path.join(root,
    "engine-v2/src/runtime/production-observation.js");
  const source = fs.readFileSync(sourceFile, "utf8");
  const program = acorn.parse(source, { ecmaVersion: "latest",
    sourceType: "script" });
  const wanted = new Set([...FUNCTION_NAMES, ...CLASS_NAMES, ...CONSTANT_NAMES]);
  const selected = [];
  for (const node of program.body) {
    const name = declarationName(node);
    if (name && wanted.has(name)) selected.push({ name, text: source.slice(
      node.start, node.end) });
  }
  const found = new Set(selected.map(item => item.name));
  const missing = Array.from(wanted).filter(name => !found.has(name));
  if (missing.length) throw new Error(`PRODUCTION_OBSERVATION_SLICE_MISSING:${
    missing.join(",")}`);
  const imports = `"use strict";\n\n` +
    `// Generated from production-root.js. Do not edit by hand.\n` +
    `const { CAPACITY, RULE } = require("../generated/fast-config");\n` +
    `const { FastState, ARRAY, SCALAR, DIRECTION_BY_NAME, SKILL_BY_NAME } =\n` +
    `  require("../state/fast-state");\n` +
    `const { FastKernel } = require("../fast/kernel");\n` +
    `const { HazardKernel } = require("../fast/hazard");\n` +
    `const { HardGate } = require("../fast/hard-gate");\n` +
    `const { ACTION, SKILL, TERRAIN, NONE_FRAME, NONE_CELL, UNKNOWN_RUNTIME,\n` +
    `  DX, DY } = require("../abi/fast-codes");\n` +
    `const { ProjectileTrackPool } = require("./projectile-track-pool");\n\n`;
  const exports = `\nmodule.exports = { ROOT_STATUS, ENEMY_CAPABILITY_REASON,\n` +
    `  INFORMATION_GAP, integer, hasProjectile, positionCell, directionCode,\n` +
    `  terrainCode, observedActionCode, mix, productionValueSupportComplete,\n` +
    `  ProductionEntityTracker, ProductionObservationAdapter };\n`;
  const generated = `${imports}${selected.map(item => item.text).join(
    "\n\n")}${exports}`;
  fs.writeFileSync(outputFile, generated);
  return { sourceFile, outputFile, sourceSha256: sha256(source),
    outputSha256: sha256(generated), outputBytes: Buffer.byteLength(generated),
    declarations: selected.map(item => item.name) };
}

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  process.stdout.write(`${JSON.stringify(generate(root), null, 2)}\n`);
}

module.exports = { FUNCTION_NAMES, CLASS_NAMES, CONSTANT_NAMES, generate };
