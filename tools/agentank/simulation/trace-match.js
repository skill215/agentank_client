"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, contained } = require("../core/paths");
const { invariant } = require("../core/errors");
const { fingerprintObject, sha256Bytes } = require("../core/hash");
const { ensureDirectory, writeJsonAtomic, writeJsonImmutable } = require("../core/atomic-file");
const { readPlan, candidateOptions } = require("../calibration/imp8-candidate-comparison");
const { loadDd9Assignment, idsForRole } = require("./dd9-assignment");
const { scenariosForIds } = require("./historical-scenarios");
const { VARIANTS, loadSimulator, runMatch } = require("./paired-arena");

async function traceMatch(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const loaded = readPlan(root, options.planPath); const { plan } = loaded;
  const candidateId = options.candidateProfileId || plan.candidates[1].candidateProfileId;
  const candidate = plan.candidates.find(item => item.candidateProfileId === candidateId);
  invariant(candidate, "IMP8_TRACE_CANDIDATE_UNKNOWN", candidateId);
  const variantId = options.variantId || "NATIVE_V2_SEAT0";
  const variant = VARIANTS.find(item => item.variantId === variantId);
  invariant(variant, "IMP8_TRACE_VARIANT_UNKNOWN", variantId);
  const { assignment, manifest } = loadDd9Assignment(root);
  const ids = [...idsForRole(assignment, "CALIBRATION"), ...idsForRole(assignment, "FROZEN_REGRESSION")];
  const matchUrlId = options.matchUrlId || ids[0];
  invariant(ids.includes(matchUrlId), "IMP8_TRACE_MATCH_NOT_ASSIGNED", matchUrlId);
  const scenario = scenariosForIds(manifest, [matchUrlId], root)[0];
  const simulator = await loadSimulator(root);
  const v1File = contained(root, options.v1File || plan.v1Baseline);
  const v1Code = fs.readFileSync(v1File, "utf8");
  const v2Options = candidateOptions(plan, candidate); v2Options.captureAllFrames = true;
  const match = await runMatch(simulator.module, scenario, variant, options.repetition || 0,
    v1Code, options.timeoutMs || plan.timeoutMs || 200, v2Options, { includeReplay: true });
  const report = { schemaVersion: 1, reportKind: "IMP8_V1_V2_MATCH_TRACE",
    experimentId: plan.experimentId, plan: { relativePath: loaded.relativePath, sha256: loaded.sha256 },
    candidateProfileId: candidateId, historicalMatchUrlId: matchUrlId, variantId,
    v1Baseline: { relativePath: path.relative(root, v1File), sha256: sha256Bytes(v1Code) },
    localTimingSemantics: "SAME_HOST_RELATIVE_DIAGNOSTIC_ONLY_NOT_PLATFORM_TIME",
    match, fingerprint: "" };
  report.fingerprint = fingerprintObject(report);
  const directory = path.resolve(options.outputDirectory || contained(root, "artifacts", "imp8",
    "diagnostics", "match-traces", candidateId.toLowerCase(), matchUrlId, variantId.toLowerCase()));
  ensureDirectory(directory); writeJsonAtomic(path.join(directory, "trace-report.json"), report,
    { mode: 0o644 });
  writeJsonImmutable(path.join(directory, "history", `trace-${report.fingerprint}.json`), report,
    { mode: 0o644 });
  return { report, directory };
}

module.exports = { traceMatch };
