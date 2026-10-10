#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const terser = require("terser");
const terserPackage = require("terser/package.json");
const { assembleProductionSource } = require("./imp6-builder");
const { PLATFORM_CODE_LIMIT_BYTES } = require(
  "../platform/code-size-policy");
const { load, compare, fingerprint } = require(
  "../diagnostics/base-policy-owner-migration-audit");
const { generate } = require("./generate-specialized-base-policy");

const ACTION_KIND = "V2_NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE";
const MINIFY_OPTIONS = Object.freeze({ ecma: 2020,
  compress: Object.freeze({ passes: 5 }),
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

async function footprint(root, label, policy, extras = []) {
  const entry = path.join(root,
    "engine-v2/src/runtime/native-base-policy-entry.js");
  const relative = "engine-v2/src/runtime/native-base-policy-entry.js";
  const requires = [
    `const {NativeBasePolicyRoot}=require("../${policy}/native-root");`,
    ...extras.map((request, index) =>
      `const Dependency${index}=require(${JSON.stringify(request)});`)
  ].join("\n");
  const override = `"use strict";\n${requires}\n` +
    `const root=new NativeBasePolicyRoot();\n` +
    `function onIdle(){return 0}\n` +
    `function runProductionFixture(){return new Int32Array([root?1:0])}\n` +
    `module.exports={onIdle,runProductionFixture};\n`;
  const assembled = assembleProductionSource(root, { entry,
    moduleSourceOverrides: { [relative]: override } });
  const result = await terser.minify(assembled.source,
    JSON.parse(JSON.stringify(MINIFY_OPTIONS)));
  if (result.error || typeof result.code !== "string")
    throw result.error || new Error("BP_FOOTPRINT_MINIFY_FAILED");
  const bytes = Buffer.byteLength(result.code);
  return { label, modules: assembled.modules.length, bytes,
    headroomBytes: PLATFORM_CODE_LIMIT_BYTES - bytes,
    withinPlatformLimit: bytes <= PLATFORM_CODE_LIMIT_BYTES,
    sha256: sha256(result.code) };
}

function equivalence(acceptedDirectory, candidateDirectory) {
  const accepted = load(acceptedDirectory);
  const candidate = load(candidateDirectory);
  const summary = candidate.overview.candidate;
  return { acceptedDirectory, candidateDirectory,
    physicalMatches: summary.matches,
    result: { wins: summary.wins, losses: summary.losses,
      draws: summary.draws, scoreBasisPoints: summary.scoreBasisPoints },
    invariants: summary.invariants,
    actionFingerprint: fingerprint(candidate.matches, ACTION_KIND),
    differences: compare(accepted.matches, candidate.matches) };
}

function zeroDifferences(value) {
  return Object.values(value).every(item => item === 0);
}

async function audit(root, outputFile, options = {}) {
  const generation = generate(root);
  const footprints = [
    await footprint(root, "COMPACT_BASE_POLICY", "base-policy-compact"),
    await footprint(root, "SPECIALIZED_BASE_POLICY",
      "base-policy-specialized"),
    await footprint(root, "COMPACT_PLUS_OBSERVATION", "base-policy-compact",
      ["./production-observation"]),
    await footprint(root, "SPECIALIZED_PLUS_OBSERVATION",
      "base-policy-specialized", ["./production-observation"]),
    await footprint(root, "SPECIALIZED_PLUS_OBSERVATION_PLUS_RISK_SAFETY",
      "base-policy-specialized", ["./production-observation",
        "../search/risk-acceptance-controller"])
  ];
  const fixed16 = equivalence(options.fixedAccepted ||
    "/tmp/agentank-bp176-compact-root-fixed16", options.fixedCandidate ||
      "/tmp/agentank-bp178-self-contained-search-fixed16");
  const discovery64 = equivalence(options.discoveryAccepted ||
    "/tmp/agentank-bp176-compact-root-discovery64",
    options.discoveryCandidate ||
      "/tmp/agentank-bp178-self-contained-search-discovery64");
  const largest = footprints[footprints.length - 1];
  const pass = zeroDifferences(fixed16.differences) &&
    zeroDifferences(discovery64.differences) && largest.withinPlatformLimit;
  const report = {
    objectKind: "BasePolicyClosedProfileFootprintEvidenceV1",
    generatedAt: new Date().toISOString(),
    stage: "BP178",
    status: pass ? "ACCEPTED_COMPONENT" : "REJECTED",
    semantics: { targetDepth: 3, nodeBudget: 128,
      note: "Closed-profile partial evaluation; no search depth, budget, value, action-domain or risk semantics changed." },
    platformMaximumBytes: PLATFORM_CODE_LIMIT_BYTES,
    terser: { version: terserPackage.version, options: MINIFY_OPTIONS },
    generation,
    footprints,
    equivalence: { fixed16, discovery64 },
    conclusion: largest.withinPlatformLimit ?
      "BasePolicy, exact observation and the existing Risk/Safety closure fit together; a thin native decision root is still required before this is an upload candidate." :
      "The closed profile still exceeds the platform limit.",
    fingerprint: ""
  };
  const unsigned = stable({ ...report, generatedAt: undefined,
    fingerprint: undefined });
  report.fingerprint = sha256(JSON.stringify(unsigned));
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

async function run() {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  const output = path.resolve(process.argv[3] || path.join(root,
    "config/engine-v3/base-policy-kernel-bp178-footprint-evidence.json"));
  const report = await audit(root, output);
  process.stdout.write(`${JSON.stringify({ output, status: report.status,
    footprints: report.footprints, equivalence: report.equivalence,
    fingerprint: report.fingerprint }, null, 2)}\n`);
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { ACTION_KIND, MINIFY_OPTIONS, footprint, equivalence, audit };
