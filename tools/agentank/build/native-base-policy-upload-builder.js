#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const terser = require("terser");
const terserPackage = require("terser/package.json");
const { assembleProductionSource } = require("./imp6-builder");
const { executeSequence } = require("./base-policy-candidate-builder");
const { PLATFORM_CODE_LIMIT_BYTES } = require("../platform/code-size-policy");

const ENTRY = "engine-v2/src/runtime/native-base-policy-production-entry.js";

// These names are owned by the AgenTank callback boundary or are selected by
// a platform string at runtime. Everything else belongs to the closed engine
// graph and may be renamed consistently by Terser.
const PLATFORM_RESERVED_PROPERTIES = Object.freeze([
  "onIdle", "__agentankFixture", "runProductionFixture", "exports",
  "tank", "id", "position", "pos", "direction", "crashed", "stars",
  "bullet", "skill", "type", "side", "remainingCooldownFrames",
  "remainingFrames", "framesRemaining", "effects", "self", "debuff",
  "status", "shielded", "cloaked", "boosted", "overloaded", "frozen",
  "stunned", "poisoned", "fireLocked", "bombCooldownFrames", "bombActive",
  "canActThisFrame", "actionSpeed", "frame", "frames", "map", "star",
  "bombs", "explodeFrame", "explodesAtFrame", "placedFrame", "ownerId",
  "tankId", "owner", "by", "go", "turn", "fire", "throwBomb", "shield",
  "freeze", "stun", "overload", "cloak", "teleport", "poison", "boost",
  "up", "right", "down", "left", "x", "m", "o", "CAST_SHIELD",
  "CAST_FREEZE", "CAST_STUN", "CAST_OVERLOAD", "CAST_CLOAK",
  "CAST_TELEPORT", "CAST_POISON", "CAST_BOOST"
]);

const UPLOAD_OPTIONS = Object.freeze({ ecma: 2020,
  compress: Object.freeze({ passes: 5 }),
  mangle: Object.freeze({ toplevel: true,
    properties: Object.freeze({ builtins: false,
      reserved: PLATFORM_RESERVED_PROPERTIES }) }),
  format: Object.freeze({ comments: false, ascii_only: true }) });

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function compile(source) {
  const result = await terser.minify(source,
    JSON.parse(JSON.stringify(UPLOAD_OPTIONS)));
  if (result.error || typeof result.code !== "string")
    throw result.error || new Error("NATIVE_UPLOAD_MINIFY_FAILED");
  return `${result.code}\n`;
}

async function build(root, outputDirectory) {
  const assembled = assembleProductionSource(root,
    { entry: path.join(root, ENTRY) });
  const source = assembled.source;
  const minified = await compile(source);
  const repeated = await compile(source);
  const sourceFixture = executeSequence(source);
  const minifiedFixture = executeSequence(minified);
  const sourceBytes = Buffer.byteLength(source);
  const minifiedBytes = Buffer.byteLength(minified);
  const deterministic = sha256(minified) === sha256(repeated);
  const fixtureEquivalent = sourceFixture.fingerprint ===
    minifiedFixture.fingerprint;
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "source.js"), source);
  fs.writeFileSync(path.join(outputDirectory, "minified.js"), minified);
  const manifest = { objectKind: "NativeBasePolicyUploadBuildV1",
    entry: ENTRY, terserVersion: terserPackage.version,
    options: UPLOAD_OPTIONS, moduleCount: assembled.modules.length,
    source: { bytes: sourceBytes, sha256: sha256(source) },
    minified: { bytes: minifiedBytes, sha256: sha256(minified),
      headroomBytes: PLATFORM_CODE_LIMIT_BYTES - minifiedBytes,
      withinPlatformLimit: minifiedBytes <= PLATFORM_CODE_LIMIT_BYTES },
    fixture: { callbacks: sourceFixture.decisions.length,
      sourceFingerprint: sourceFixture.fingerprint,
      minifiedFingerprint: minifiedFixture.fingerprint,
      equivalent: fixtureEquivalent },
    deterministic,
    status: deterministic && fixtureEquivalent &&
      minifiedBytes <= PLATFORM_CODE_LIMIT_BYTES ? "BUILD_PASS" : "BUILD_REJECTED" };
  manifest.fingerprint = sha256(JSON.stringify(manifest));
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function run() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  const output = path.resolve(process.argv[3] ||
    "/tmp/agentank-native-base-policy-upload");
  const manifest = await build(root, output);
  process.stdout.write(`${JSON.stringify({ output, manifest }, null, 2)}\n`);
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { ENTRY, PLATFORM_RESERVED_PROPERTIES, UPLOAD_OPTIONS,
  compile, build };
