"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const terser = require("terser");
const terserPackage = require("terser/package.json");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sha256Bytes, sha256Text, fingerprintObject } = require("../core/hash");
const { canonicalJson } = require("../core/canonical-json");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory, writeFileAtomic, writeFileImmutable, writeJsonAtomic,
  writeJsonImmutable } = require("../core/atomic-file");
const { loadProductionPolicy, auditProductionText } = require("./production-policy");
const { PLATFORM_CODE_LIMIT_BYTES, PLATFORM_CODE_WARNING_BYTES } =
  require("../platform/code-size-policy");
const { CacheBank } = require("../../../engine-v2/src/cache");
const { EmergencyReserve } = require("../../../engine-v2/src/runtime");
const { ProductionRootEngine } = require("../../../engine-v2/src/runtime/production-root");

const ENTRY = "engine-v2/src/runtime/production-entry.js";
const SOURCE_TERSER_OPTIONS = Object.freeze({ ecma: 2020, compress: false, mangle: false,
  format: Object.freeze({ comments: false, ascii_only: true, beautify: false }) });
const TERSER_OPTIONS = Object.freeze({ ecma: 2020, compress: Object.freeze({ passes: 2 }),
  mangle: false, format: Object.freeze({ comments: false, ascii_only: true }) });

function resolveModule(root, owner, request) {
  invariant(request.startsWith("."), "PRODUCTION_EXTERNAL_IMPORT", `external import ${request}`);
  let target = path.resolve(path.dirname(owner), request);
  if (!path.extname(target)) {
    if (fs.existsSync(`${target}.js`)) target = `${target}.js`;
    else target = path.join(target, "index.js");
  }
  const sourceRoot = contained(root, "engine-v2", "src");
  invariant(target.startsWith(`${sourceRoot}${path.sep}`) && fs.existsSync(target),
    "PRODUCTION_IMPORT_OUTSIDE_ENGINE", `invalid production import ${request}`); return target;
}
function collectModules(root, entry = contained(root, ENTRY), sourceOverrides = {}) {
  const modules = []; const byFile = new Map(); const expression = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
  function visit(file) { if (byFile.has(file)) return byFile.get(file); const id = modules.length;
    byFile.set(file, id); const relative = path.relative(root, file).replaceAll("\\", "/");
    const source = Object.prototype.hasOwnProperty.call(sourceOverrides, relative) ?
      String(sourceOverrides[relative]) : fs.readFileSync(file, "utf8"); const requests = [];
    for (const match of source.matchAll(expression)) requests.push(match[1]);
    const record = { id, file, source, requests, dependencies: [] }; modules.push(record);
    for (const request of requests) record.dependencies.push(visit(resolveModule(root, file, request)));
    return id; }
  visit(entry); return modules;
}
function assembleProductionSource(root, options = {}) {
  const modules = collectModules(root, options.entry || contained(root, ENTRY),
    options.moduleSourceOverrides || {});
  const expression = /require\s*\(\s*["']([^"']+)["']\s*\)/g;
  const bodies = modules.map(record => { let dependency = 0;
    const body = record.source.replace(expression, () => `__r(${record.dependencies[dependency++]})`);
    return `function(module,exports,__r){\n${body}\n}`; });
  const source = `(function(g){"use strict";var __m=[${bodies.join(",\n")}],__c=[];` +
    `function __r(i){var m=__c[i];if(m)return m.exports;m=__c[i]={exports:{}};` +
    `__m[i](m,m.exports,__r);return m.exports}var e=__r(0);g.onIdle=e.onIdle;` +
    `g.__agentankFixture=e.runProductionFixture})(globalThis);\n`;
  return { modules, source };
}
function safeMath() { return Object.freeze({ abs: Math.abs, floor: Math.floor, max: Math.max,
  min: Math.min, ceil: Math.ceil, round: Math.round, trunc: Math.trunc, sign: Math.sign }); }
function productionRootFixture() {
  const calls = []; const map = Array.from({ length: 5 }, (_, x) => Array.from({ length: 5 }, (_, y) =>
    x === 0 || y === 0 || x === 4 || y === 4 ? "x" : "."));
  const me = { go: () => calls.push("GO"), turn: value => calls.push(`TURN:${value}`),
    fire: () => calls.push("FIRE"), throwBomb: () => calls.push("BOMB"),
    poison: () => calls.push("POISON"),
    tank: { id: "own", position: [1, 1], direction: "right", crashed: false },
    stars: 0, bullet: null, skill: { type: "poison", remainingCooldownFrames: 0 },
    effects: { self: null, debuff: null }, status: { shielded: false, cloaked: false,
      boosted: false, overloaded: false, frozen: false, stunned: false, poisoned: false,
      fireLocked: false, bombCooldownFrames: 0, bombActive: false,
      canActThisFrame: true, actionSpeed: 1 } };
  const enemy = { tank: { id: "enemy", position: [3, 1], direction: "left", crashed: false },
    stars: 0, bullet: null, skill: { type: "stun", remainingCooldownFrames: 0 },
    effects: { self: null, debuff: null }, status: { shielded: false, cloaked: false,
      boosted: false, overloaded: false, frozen: false, stunned: false, poisoned: false,
      fireLocked: false, bombCooldownFrames: 0, bombActive: false,
      canActThisFrame: true, actionSpeed: 1 } };
  return { me, enemy, game: { frame: 1, frames: 1, map, star: [2, 2], bombs: [] }, calls };
}
function maximumMemoryFixture() {
  const fixture = productionRootFixture(); const size = 32;
  fixture.game.map = Array.from({ length: size }, (_, x) => Array.from({ length: size }, (_, y) =>
    x === 0 || y === 0 || x === size - 1 || y === size - 1 ? "x" : "."));
  fixture.game.star = [size - 2, size - 2]; return fixture;
}
function typedArrayBytes(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return 0;
  seen.add(value); if (ArrayBuffer.isView(value)) return value.byteLength;
  let bytes = 0; for (const key of Object.keys(value)) bytes += typedArrayBytes(value[key], seen);
  return bytes;
}
function executeBundle(source, seed = 1) {
  const sandbox = { Math: safeMath() }; vm.createContext(sandbox);
  const start = process.hrtime.bigint(); vm.runInContext(source, sandbox, { timeout: 2000 });
  const initMicros = Number((process.hrtime.bigint() - start) / 1000n);
  invariant(typeof sandbox.__agentankFixture === "function" && typeof sandbox.onIdle === "function",
    "PRODUCTION_ENTRY_MISSING", "production entry was not exported");
  const fixtureStart = process.hrtime.bigint(); const raw = sandbox.__agentankFixture(seed);
  const fixtureMicros = Number((process.hrtime.bigint() - fixtureStart) / 1000n);
  const values = Array.from(raw); const fixture = productionRootFixture();
  const callbackStart = process.hrtime.bigint();
  const action = sandbox.onIdle(fixture.me, fixture.enemy, fixture.game);
  const callbackMicros = Number((process.hrtime.bigint() - callbackStart) / 1000n);
  return { values, semanticFingerprint: sha256Text(canonicalJson(values)), initMicros,
    fixtureMicros, callbackMicros, action, emittedCalls: fixture.calls };
}
function inputFingerprints(root, moduleSourceOverrides = {}) {
  const files = ["config/engine-v2/imp3-capacity-manifest.json",
    "config/engine-v2/imp4-search-manifest.json", "config/engine-v2/imp5-policy-manifest.json",
    "config/engine-v2/imp6-runtime-build-profile.json", "docs/design/dd8-cache-inventory.json"];
  const output = {}; for (const file of files) output[file] = sha256Bytes(fs.readFileSync(contained(root, file)));
  for (const [relativePath, source] of Object.entries(moduleSourceOverrides))
    output[`override:${relativePath}`] = sha256Text(String(source));
  return output;
}
async function buildImp6Production(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const outputDirectory = path.resolve(options.outputDirectory || contained(root, "artifacts", "build", "imp6"));
  const profile = JSON.parse(fs.readFileSync(contained(root, "config", "engine-v2",
    "imp6-runtime-build-profile.json"), "utf8")); validateSchemaObject("imp6-runtime-build-profile", profile, root);
  invariant(profile.build.platformMaximumCodeBytes === PLATFORM_CODE_LIMIT_BYTES &&
    profile.build.platformWarningCodeBytes === PLATFORM_CODE_WARNING_BYTES,
  "PLATFORM_CODE_POLICY_DRIFT", "build profile and platform code-size policy differ");
  invariant(terserPackage.version === profile.build.terserVersion, "TERSER_VERSION_MISMATCH",
    "pinned terser version mismatch"); const assembled = assembleProductionSource(root,
    { moduleSourceOverrides: options.moduleSourceOverrides || {} });
  const sourceOptions = { ecma: SOURCE_TERSER_OPTIONS.ecma, compress: false, mangle: false,
    format: { comments: false, ascii_only: true, beautify: false } };
  const sourceResult = await terser.minify(assembled.source, sourceOptions);
  invariant(!sourceResult.error && typeof sourceResult.code === "string",
    "SOURCE_NORMALIZATION_FAILED", "terser source normalization failed");
  const source = `${sourceResult.code}\n`; const minifyOptions = { ecma: TERSER_OPTIONS.ecma,
    compress: { passes: TERSER_OPTIONS.compress.passes }, mangle: TERSER_OPTIONS.mangle,
    format: { comments: TERSER_OPTIONS.format.comments, ascii_only: TERSER_OPTIONS.format.ascii_only } };
  const minifiedResult = await terser.minify(source, minifyOptions);
  invariant(!minifiedResult.error && typeof minifiedResult.code === "string", "MINIFY_FAILED", "terser failed");
  const minified = `${minifiedResult.code}\n`; const loadedPolicy = loadProductionPolicy(root);
  const sourceFindings = auditProductionText(source, loadedPolicy); const minifiedFindings =
    auditProductionText(minified, loadedPolicy); const sourceRun = executeBundle(source, 0x13579);
  const minifiedRun = executeBundle(minified, 0x13579); let mismatchCount = 0;
  if (sourceRun.semanticFingerprint !== minifiedRun.semanticFingerprint ||
      sourceRun.action !== minifiedRun.action ||
      canonicalJson(sourceRun.emittedCalls) !== canonicalJson(minifiedRun.emittedCalls)) mismatchCount += 1;
  const moduleFingerprints = {}; for (const module of assembled.modules)
    moduleFingerprints[path.relative(root, module.file).replaceAll("\\", "/")] = sha256Text(module.source);
  const cacheBank = new CacheBank(); const emergency = new EmergencyReserve();
  const rootEngine = new ProductionRootEngine(); const rootFixture = maximumMemoryFixture();
  rootEngine.adapter.adapt(rootFixture.me, rootFixture.enemy, rootFixture.game);
  const productionRootBytes = typedArrayBytes(rootEngine); let enableMask = 0;
  for (let index = 0; index < profile.cache.enabled.length; index += 1)
    if (profile.cache.enabled[index]) enableMask |= 1 << index;
  const sourceBytes = Buffer.byteLength(source, "utf8");
  const minifiedBytes = Buffer.byteLength(minified, "utf8");
  const platformWithinLimit = minifiedBytes <= profile.build.platformMaximumCodeBytes;
  const blockers = profile.platformBlockers.slice();
  if (!platformWithinLimit) blockers.push("PLATFORM_SCRIPT_BYTE_LIMIT_EXCEEDED");
  const manifest = {
    schemaVersion: 1, buildId: "imp6-poison-generated-v1",
    status: sourceFindings.length === 0 && minifiedFindings.length === 0 && mismatchCount === 0 ? "PASS" : "FAIL",
    profileId: profile.profileId, ownSkillId: profile.build.ownSkillId,
    evaluatorMode: profile.build.evaluatorMode, sourceHash: sha256Text(source),
    minifiedHash: sha256Text(minified), sourceBytes,
    minifiedBytes, moduleCount: assembled.modules.length,
    moduleFingerprints, inputFingerprints: inputFingerprints(root,
      options.moduleSourceOverrides || {}),
    terser: { version: terserPackage.version, optionsFingerprint: fingerprintObject({
      source: SOURCE_TERSER_OPTIONS, minified: TERSER_OPTIONS }) },
    cache: { canonicalCount: profile.cache.entryCount.length, enableMask,
      optionalDefaultOff: profile.cache.enabled.filter(value => !value).length },
    memory: { cacheBytes: cacheBank.totalBytes(), emergencyBytes: emergency.bytes(),
      productionRootBytes, totalTypedArrayBytes: productionRootBytes,
      measuredMapCells: rootEngine.adapter.state.cells, independentEmergency: true },
    strip: { status: sourceFindings.length + minifiedFindings.length === 0 ? "PASS" : "FAIL",
      findingCount: sourceFindings.length + minifiedFindings.length },
    differential: { status: mismatchCount === 0 ? "PASS" : "FAIL", mismatchCount,
      sourceFingerprint: sourceRun.semanticFingerprint, minifiedFingerprint: minifiedRun.semanticFingerprint },
    sandbox: { status: mismatchCount === 0 ? "PASS" : "FAIL", mathImulAvailable: false,
      parseInitFixturePassed: mismatchCount === 0 },
    artifactFiles: { source: "production-source.js", minified: "production-minified.js" },
    platformCode: { measurement: "UTF8_BYTES", artifactKind: "PRODUCTION_MINIFIED",
      bytes: minifiedBytes, maximumBytes: profile.build.platformMaximumCodeBytes,
      warningBytes: profile.build.platformWarningCodeBytes,
      headroomBytes: profile.build.platformMaximumCodeBytes - minifiedBytes,
      withinLimit: platformWithinLimit,
      warning: minifiedBytes >= profile.build.platformWarningCodeBytes },
    platformStatus: platformWithinLimit ? "PLATFORM_LIMIT_SATISFIED" :
      "PLATFORM_LIMIT_EXCEEDED",
    releaseEligibility: false, blockers, fingerprint: ""
  };
  manifest.fingerprint = fingerprintObject(manifest); validateSchemaObject("imp6-build-manifest", manifest, root);
  ensureDirectory(outputDirectory); const sourceFile = path.join(outputDirectory, "production-source.js");
  const minifiedFile = path.join(outputDirectory, "production-minified.js");
  const manifestFile = path.join(outputDirectory, "build-manifest.json");
  writeFileAtomic(sourceFile, source, { mode: 0o644 }); writeFileAtomic(minifiedFile, minified, { mode: 0o644 });
  writeJsonAtomic(manifestFile, manifest, { mode: 0o644 }); const history = path.join(outputDirectory, "history");
  const immutableSource = path.join(history, `production-source-${manifest.sourceHash}.js`);
  const immutableMinified = path.join(history, `production-minified-${manifest.minifiedHash}.js`);
  writeFileImmutable(immutableSource, source, { mode: 0o644 });
  writeFileImmutable(immutableMinified, minified, { mode: 0o644 });
  const immutableManifest = path.join(history, `build-manifest-${manifest.fingerprint}.json`);
  writeJsonImmutable(immutableManifest, manifest, { mode: 0o644 });
  const verification = { schemaVersion: 1, status: manifest.status, source: sourceRun,
    minified: minifiedRun, localGates: { sourceBytes: manifest.sourceBytes <= profile.build.localMaximumSourceBytes,
      typedArrayBytes: manifest.memory.totalTypedArrayBytes <=
        profile.build.localMaximumTypedArrayBytes,
      coldInit: Math.max(sourceRun.initMicros, minifiedRun.initMicros) <= profile.build.localMaximumColdInitMicros,
      callback: Math.max(sourceRun.callbackMicros, minifiedRun.callbackMicros) <=
        profile.build.localMaximumCallbackMicros },
    platformGates: { minifiedCodeBytes: manifest.platformCode.withinLimit }, fingerprint: "" };
  verification.fingerprint = fingerprintObject(verification);
  return { manifest, verification, sourceFile, minifiedFile, manifestFile,
    immutableSource, immutableMinified, immutableManifest };
}

module.exports = { ENTRY, SOURCE_TERSER_OPTIONS, TERSER_OPTIONS, resolveModule, collectModules,
  assembleProductionSource, productionRootFixture, maximumMemoryFixture, typedArrayBytes, executeBundle,
  buildImp6Production };
