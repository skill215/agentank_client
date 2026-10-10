#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const terser = require("terser");
const terserPackage = require("terser/package.json");
const { assembleProductionSource, typedArrayBytes } = require("./imp6-builder");
const { ProductionRootEngine } = require(
  "../../../engine-v2/src/runtime/production-root");
const { NativeBasePolicyRoot } = require(
  "../../../engine-v2/src/base-policy");
const { PLATFORM_CODE_LIMIT_BYTES, PLATFORM_CODE_WARNING_BYTES } = require(
  "../platform/code-size-policy");

const ENTRY = "engine-v2/src/runtime/native-base-policy-entry.js";
const SOURCE_OPTIONS = Object.freeze({ ecma: 2020, compress: false,
  mangle: false, format: Object.freeze({ comments: false, ascii_only: true,
    beautify: false }) });
const CONSERVATIVE_OPTIONS = Object.freeze({ ecma: 2020,
  compress: Object.freeze({ passes: 2 }), mangle: false,
  format: Object.freeze({ comments: false, ascii_only: true }) });
const MANGLED_OPTIONS = Object.freeze({ ecma: 2020,
  compress: Object.freeze({ passes: 3 }),
  mangle: Object.freeze({ toplevel: true }),
  format: Object.freeze({ comments: false, ascii_only: true }) });

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(key =>
    [key, stable(value[key])]));
}

function safeMath() {
  return Object.freeze({ abs: Math.abs, floor: Math.floor, max: Math.max,
    min: Math.min, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
    sign: Math.sign });
}

function mapFor(seed) {
  const size = 7;
  return Array.from({ length: size }, (_, x) => Array.from({ length: size },
    (_, y) => x === 0 || y === 0 || x === size - 1 || y === size - 1 ? "x" :
      ((x * 17 + y * 31 + seed) % 23 === 0 ? "#" : ".")));
}

function tankSnapshot(id, position, direction, skill) {
  return { tank: { id, position, direction, crashed: false }, stars: 0,
    bullet: null, skill: { type: skill, remainingCooldownFrames: 0 },
    effects: { self: null, debuff: null }, status: { shielded: false,
      cloaked: false, boosted: false, overloaded: false, frozen: false,
      stunned: false, poisoned: false, fireLocked: false,
      bombCooldownFrames: 0, bombActive: false, canActThisFrame: true,
      actionSpeed: 1 } };
}

function actionProxy(snapshot, emitted) {
  return { ...snapshot,
    go() { emitted.push([1, 0]); },
    turn(side) { emitted.push([side === "left" ? 2 : 3, 0]); },
    fire() { emitted.push([4, 0]); },
    throwBomb() { emitted.push([5, 0]); },
    poison() { emitted.push([10, 0]); } };
}

function executeSequence(source) {
  const sandbox = { Math: safeMath() };
  vm.createContext(sandbox); vm.runInContext(source, sandbox, { timeout: 4000 });
  if (typeof sandbox.onIdle !== "function" ||
      typeof sandbox.__agentankFixture !== "function")
    throw new Error("NATIVE_BASE_POLICY_CANDIDATE_ENTRY_MISSING");
  const fixture = Array.from(sandbox.__agentankFixture(0x13579));
  const decisions = [];
  const directions = ["up", "right", "down", "left"];
  for (let index = 0; index < 32; index += 1) {
    const frame = index % 8 + 1; const match = (index / 8) | 0;
    const emitted = [];
    const own = tankSnapshot(`own-${match}`,
      [1 + (index % 2), 1 + ((index >>> 1) % 2)],
      directions[(index + match) & 3], "poison");
    const enemy = tankSnapshot(`enemy-${match}`,
      [5 - (index % 2), 5 - ((index >>> 1) % 2)],
      directions[(index + match + 2) & 3], "stun");
    const game = { frame, frames: frame, map: mapFor(match),
      star: [3, 3], bombs: [] };
    const returned = sandbox.onIdle(actionProxy(own, emitted), enemy, game);
    decisions.push([returned, emitted]);
  }
  const semantic = JSON.stringify([fixture, decisions]);
  return { fixture, decisions, fingerprint: sha256(Buffer.from(semantic)) };
}

async function minify(source, options) {
  // Terser normalizes its options in place. Keep the frozen evidence profile
  // immutable and hand the compiler a private mechanical copy.
  const result = await terser.minify(source,
    JSON.parse(JSON.stringify(options)));
  if (result.error || typeof result.code !== "string")
    throw result.error || new Error("NATIVE_BASE_POLICY_MINIFY_FAILED");
  return `${result.code}\n`;
}

async function build(root, outputDirectory) {
  const entry = path.join(root, ENTRY);
  const assembled = assembleProductionSource(root, { entry });
  const normalized = await minify(assembled.source, SOURCE_OPTIONS);
  const conservative = await minify(normalized, CONSERVATIVE_OPTIONS);
  const mangled = await minify(normalized, MANGLED_OPTIONS);
  const mangledRepeat = await minify(normalized, MANGLED_OPTIONS);
  const runs = { source: executeSequence(normalized),
    conservative: executeSequence(conservative), mangled: executeSequence(mangled) };
  const semanticEquivalent = runs.source.fingerprint === runs.conservative.fingerprint &&
    runs.source.fingerprint === runs.mangled.fingerprint;
  const deterministic = sha256(mangled) === sha256(mangledRepeat);
  const graph = new NativeBasePolicyRoot();
  const engine = new ProductionRootEngine({ nativeBasePolicyRoot: graph });
  const files = { source: normalized, conservative, mangled };
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const [name, value] of Object.entries(files))
    fs.writeFileSync(path.join(outputDirectory, `${name}.js`), value);
  const sizes = Object.fromEntries(Object.entries(files).map(([name, value]) =>
    [name, { bytes: Buffer.byteLength(value), sha256: sha256(value),
      withinLimit: Buffer.byteLength(value) <= PLATFORM_CODE_LIMIT_BYTES,
      headroomBytes: PLATFORM_CODE_LIMIT_BYTES - Buffer.byteLength(value) }]));
  const moduleFingerprints = Object.fromEntries(assembled.modules.map(module => {
    const relative = path.relative(root, module.file).replaceAll("\\", "/");
    return [relative, sha256(Buffer.from(module.source))];
  }));
  const manifest = {
    objectKind: "NativeBasePolicyCandidateBuildV1",
    generatedAt: new Date().toISOString(),
    entry: ENTRY,
    profile: "BP68_EXACT_NATIVE_CACHE2",
    terserVersion: terserPackage.version,
    options: { source: SOURCE_OPTIONS, conservative: CONSERVATIVE_OPTIONS,
      mangled: MANGLED_OPTIONS },
    modules: { count: assembled.modules.length, fingerprints: moduleFingerprints },
    sizes,
    platform: { maximumBytes: PLATFORM_CODE_LIMIT_BYTES,
      warningBytes: PLATFORM_CODE_WARNING_BYTES,
      eligibleArtifact: sizes.mangled.withinLimit ? "mangled.js" : null },
    differential: { semanticEquivalent, deterministic,
      fingerprints: Object.fromEntries(Object.entries(runs).map(([name, value]) =>
        [name, value.fingerprint])), callbacks: runs.source.decisions.length },
    memory: { engineAndSharedGraphTypedArrayBytes: typedArrayBytes(engine),
      rootOwnTypedArrayBytes: Object.values(graph).reduce((sum, value) =>
        sum + (ArrayBuffer.isView(value) ? value.byteLength : 0), 0) },
    status: semanticEquivalent && deterministic ?
      (sizes.mangled.withinLimit ? "BUILD_AND_PLATFORM_SIZE_PASS" :
        "BUILD_PASS_PLATFORM_SIZE_BLOCKED") : "BUILD_REJECTED",
    fingerprint: ""
  };
  const unsigned = stable({ ...manifest, generatedAt: undefined, fingerprint: undefined });
  manifest.fingerprint = sha256(Buffer.from(JSON.stringify(unsigned)));
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

async function run() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  const output = path.resolve(process.argv[3] ||
    "/tmp/agentank-bp174-native-base-policy-candidate");
  const manifest = await build(root, output);
  process.stdout.write(`${JSON.stringify({ output, status: manifest.status,
    sizes: manifest.sizes, differential: manifest.differential,
    memory: manifest.memory, fingerprint: manifest.fingerprint }, null, 2)}\n`);
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { ENTRY, SOURCE_OPTIONS, CONSERVATIVE_OPTIONS,
  MANGLED_OPTIONS, executeSequence, build, run };
