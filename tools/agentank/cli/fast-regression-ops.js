#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { defaultWorkspaceRoot } = require("../core/paths");
const { parseOptions, onlyOptions } = require("./args");
const { FastRegressionStore } = require("../fast-regression/artifact-store");
const { buildHistorySnapshot, buildLegacyEvidenceIndex } = require("../fast-regression/history");
const { captureBattleEvidence, materializeCapsuleSpool } = require("../fast-regression/capture");
const { buildCohort } = require("../fast-regression/cohort");
const { verifyFastRegression, loadCohort, laneEntries } = require("../fast-regression/verify");
const { preloadReplayCorpus, writeCompiledReplayCorpus, loadCompiledReplayCorpus } =
  require("../fast-regression/preloaded-corpus");
const { analyzeFullRun } = require("../fast-regression/analyze-run");
const { buildFocusedCohort } = require("../fast-regression/focused-cohort");
const { diagnoseFocusedCohort } = require("../fast-regression/focused-diagnostic");
const { analyzeDominatedRescues } =
  require("../fast-regression/dominated-rescue-analysis");
const { analyzePolicyContinuations } =
  require("../fast-regression/policy-continuation-analysis");
const { probeDeathCategories } =
  require("../fast-regression/death-category-probe");
const { scanFactLayer } =
  require("../fast-regression/fact-layer-scan");
const { analyzeValueDepth } =
  require("../fast-regression/value-depth-probe");
const { compareFocusedRegression } =
  require("../fast-regression/focused-regression-comparison");
const { buildSafetyDefectCorpus } = require("../fast-regression/safety-defect-corpus");
const { verifySafetyRepair } = require("../fast-regression/safety-repair-verification");
const { verifyCapabilityRepair } =
  require("../fast-regression/capability-repair-verification");
const { verifyObservationFrontier } =
  require("../fast-regression/observation-frontier-verification");
const { classifyPhysicalSafety } = require("../fast-regression/physical-safety-classifier");
const { benchmarkReplay } = require("../fast-regression/replay-benchmark");

function help() {
  process.stdout.write(`fast-regression-toolchain

  init
  history-index
  sync-history [--output DIRECTORY]
  legacy-index
  capture [--delta-only] [--limit N] [--offset N] [--repetitions N] [--maximum-per-match N]
  materialize-spool --spool DIRECTORY --run-id RUN_ID
  analyze-run --run-id RUN_ID
  build-cohort [--maximum N] [--name NAME]
  build-focused --run-id RUN_ID [--source-cohort NAME] [--maximum-losses N] [--control-count N]
  diagnose-focused [--cohort NAME] [--primary-limit N] [--skip-controls]
  analyze-dominated-rescues [--report-name NAME] [--report PATH] [--output-name NAME]
  analyze-policy-continuations [--joint-source PATH] [--target-analysis PATH]
    [--focused-report PATH] [--selection-bucket BUCKET] [--output-name NAME]
  probe-death-categories [--focused-report PATH] [--limit N] [--seed N]
    [--output-name NAME] [--allow-source-drift] [--prior-report PATH]
    [--category-filter NAME] [--replay-prior] [--no-check-survival]
  scan-fact-layer [--focused-report PATH] [--verify-limit N] [--output-name NAME]
  probe-value-depth [--dominated-report PATH] [--focused-report PATH] [--output-name NAME]
  compare-focused [--before-name NAME|--before PATH] [--after-name NAME|--after PATH]
    [--verification-name NAME|--verification PATH] [--output-name NAME]
  build-safety-corpus [--report-name NAME] [--report PATH]
  verify-safety-repair [--report-name NAME] [--report PATH] [--corpus PATH]
  verify-capability-repair [--report-name NAME] [--report PATH]
    [--classification-name NAME] [--classification PATH] [--before-name NAME]
  verify-observation-frontier [--report-name NAME] [--report PATH]
    [--capability-name NAME] [--capability PATH] [--output-name NAME]
  classify-physical-safety [--report-name NAME] [--report PATH] [--corpus PATH]
    [--transition-budget N] [--node-budget N] [--maximum-belief-worlds N]
  benchmark-replay [--cohort NAME] [--maximum-matches N] [--report-name NAME]
  compile-replay [--cohort NAME]
  verify [--cohort NAME] [--lane minimax|root|window|smoke|minimax-impacted|terminal-all|capsule-all|all]
  explain --capsule FINGERPRINT_OR_PATH

All evidence is physically isolated under artifacts/fast-regression/.\n`);
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0] || "help"; const options = parseOptions(argv.slice(1));
  const root = path.resolve(options.root || defaultWorkspaceRoot());
  if (command === "help" || command === "-h" || command === "--help") return help();
  if (command === "init") {
    onlyOptions(options, ["root"]); const properties = new FastRegressionStore(root).initialize();
    process.stdout.write(`${JSON.stringify({ status: "INITIALIZED", physicalRoot:
      "artifacts/fast-regression", fingerprint: properties.fingerprint }, null, 2)}\n`); return;
  }
  if (command === "history-index") {
    onlyOptions(options, ["root"]); const result = buildHistorySnapshot(root);
    process.stdout.write(`${JSON.stringify({ status: "INDEXED", file: result.file,
      denominator: result.snapshot.denominator, delta: { added: result.delta.addedMatchUrlIds.length,
        removed: result.delta.removedMatchUrlIds.length, fingerprint: result.delta.fingerprint },
      fingerprint: result.snapshot.fingerprint }, null, 2)}\n`); return;
  }
  if (command === "sync-history") {
    onlyOptions(options, ["root", "output"]);
    const script = path.join(root, "tools", "matches", "update-matches.sh");
    const result = spawnSync(script, options.output ? [path.resolve(options.output)] : [],
      { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`history sync failed with exit ${result.status}`);
    const indexed = buildHistorySnapshot(root);
    process.stdout.write(`${JSON.stringify({ status: "SYNCED", denominator: indexed.snapshot.denominator,
      delta: { added: indexed.delta.addedMatchUrlIds.length,
        removed: indexed.delta.removedMatchUrlIds.length },
      fingerprint: indexed.snapshot.fingerprint }, null, 2)}\n`); return;
  }
  if (command === "legacy-index") {
    onlyOptions(options, ["root"]); const result = buildLegacyEvidenceIndex(root);
    process.stdout.write(`${JSON.stringify({ status: "INDEXED", denominator: result.denominator,
      fingerprint: result.fingerprint }, null, 2)}\n`); return;
  }
  if (command === "capture") {
    onlyOptions(options, ["root", "limit", "offset", "repetitions", "timeout-ms",
      "maximum-per-match", "default-radius", "purpose", "manifest", "delta-only"]);
    const result = await captureBattleEvidence({ workspaceRoot: root, limit: options.limit,
      offset: options.offset, repetitions: options.repetitions, timeoutMs: options["timeout-ms"],
      maximumPerMatch: options["maximum-per-match"], defaultRadius: options["default-radius"],
      purpose: options.purpose, manifestPath: options.manifest,
      deltaOnly: Boolean(options["delta-only"]),
      onProgress(done, total, matchId, capsules) {
        process.stderr.write(`\rfast-regression capture ${done}/${total} ${matchId} capsules=${capsules}`);
        if (done === total) process.stderr.write("\n");
      }, onMaterializeProgress(done, total) {
        if (done % 100 === 0 || done === total)
          process.stderr.write(`\rfast-regression materialize ${done}/${total}`);
        if (done === total) process.stderr.write("\n");
      } });
    process.stdout.write(`${JSON.stringify({ status: "CAPTURED", runId: result.run.manifest.runId,
      matches: result.summary.matchCount,
      capsules: result.capsuleCount ?? result.capsules.length }, null, 2)}\n`); return;
  }
  if (command === "materialize-spool") {
    onlyOptions(options, ["root", "spool", "run-id"]);
    if (!options.spool || !options["run-id"])
      throw new Error("materialize-spool requires --spool and --run-id");
    const result = materializeCapsuleSpool(root, options.spool, options["run-id"], {
      onProgress(done, total) {
        if (done % 100 === 0 || done === total)
          process.stderr.write(`\rfast-regression materialize ${done}/${total}`);
        if (done === total) process.stderr.write("\n");
      }
    });
    process.stdout.write(`${JSON.stringify({ status: "MATERIALIZED", runId: result.runId,
      capsules: result.count }, null, 2)}\n`); return;
  }
  if (command === "analyze-run") {
    onlyOptions(options, ["root", "run-id"]);
    if (!options["run-id"]) throw new Error("analyze-run requires --run-id");
    const result = await analyzeFullRun(root, options["run-id"]);
    process.stdout.write(`${JSON.stringify({ status: result.report.status, file: result.file,
      fingerprint: result.report.fingerprint, gates: result.report.gates }, null, 2)}\n`);
    if (result.report.status !== "ACCEPTED") process.exitCode = 1; return;
  }
  if (command === "build-cohort") {
    onlyOptions(options, ["root", "maximum", "name"]); const result = buildCohort(root,
      { maximum: options.maximum, name: options.name });
    process.stdout.write(`${JSON.stringify({ status: "BUILT", file: result.file,
      coverage: result.manifest.coverage, fingerprint: result.manifest.fingerprint }, null, 2)}\n`); return;
  }
  if (command === "build-focused") {
    onlyOptions(options, ["root", "run-id", "source-cohort", "maximum-losses",
      "control-count", "name"]);
    if (!options["run-id"]) throw new Error("build-focused requires --run-id");
    const result = await buildFocusedCohort(root, { runId: options["run-id"],
      sourceCohort: options["source-cohort"], maximumLosses: options["maximum-losses"],
      controlCount: options["control-count"], name: options.name });
    process.stdout.write(`${JSON.stringify({ status: "BUILT", file: result.file,
      coverage: result.manifest.coverage, fingerprint: result.manifest.fingerprint }, null, 2)}\n`);
    return;
  }
  if (command === "diagnose-focused") {
    onlyOptions(options, ["root", "cohort", "manifest", "report-name", "primary-limit",
      "skip-controls"]);
    const result = await diagnoseFocusedCohort(root, { cohort: options.cohort,
      manifestPath: options.manifest, reportName: options["report-name"],
      primaryLimit: options["primary-limit"], skipControls: Boolean(options["skip-controls"]),
      onProgress(done, total, matchId, status) {
        process.stderr.write(`\rfast-regression focused ${done}/${total} ${matchId} ${status}`);
        if (done === total) process.stderr.write("\n");
      } });
    process.stdout.write(`${JSON.stringify({ status: result.report.status, file: result.file,
      fingerprint: result.report.fingerprint, primary: result.report.primary,
      controls: result.report.controls, failures: result.report.failures.length }, null, 2)}\n`);
    if (result.report.status !== "COMPLETED") process.exitCode = 1; return;
  }
  if (command === "analyze-dominated-rescues") {
    onlyOptions(options, ["root", "report-name", "report", "output-name"]);
    const result = analyzeDominatedRescues(root, { reportName: options["report-name"],
      reportPath: options.report, outputName: options["output-name"] });
    process.stdout.write(`${JSON.stringify({ status: result.report.status, file: result.file,
      fingerprint: result.report.fingerprint, denominator: result.report.denominator,
      selectionBuckets: result.report.selectionBuckets,
      rootCauses: result.report.rootCauses }, null, 2)}\n`); return;
  }
  if (command === "analyze-policy-continuations") {
    onlyOptions(options, ["root", "joint-source", "target-analysis", "focused-report",
      "selection-bucket", "output-name"]);
    const result = await analyzePolicyContinuations(root, {
      jointSourcePath: options["joint-source"], targetAnalysisPath: options["target-analysis"],
      focusedReportPath: options["focused-report"], selectionBucket: options["selection-bucket"],
      outputName: options["output-name"],
      onProgress(done, total, fingerprint, frame, defect) {
        process.stderr.write(`\rpolicy continuation ${done}/${total} ${fingerprint.slice(0, 12)}:${frame} ` +
          `${defect ? "DEFECT" : "CONTROL"}`);
        if (done === total) process.stderr.write("\n");
      } });
    process.stdout.write(`${JSON.stringify({ status: result.report.status, file: result.file,
      fingerprint: result.report.fingerprint, denominator: result.report.denominator }, null, 2)}\n`);
    return;
  }
  if (command === "probe-death-categories") {
    onlyOptions(options, ["root", "focused-report", "limit", "seed", "output-name",
      "allow-source-drift", "prior-report", "category-filter", "replay-prior",
      "no-check-survival"]);
    const result = await probeDeathCategories(root, {
      focusedReportPath: options["focused-report"],
      limit: options.limit, seed: options.seed, outputName: options["output-name"],
      allowSourceDrift: Boolean(options["allow-source-drift"]),
      priorReportPath: options["prior-report"],
      categoryFilter: options["category-filter"] || null,
      replayPrior: Boolean(options["replay-prior"]),
      checkSurvival: !options["no-check-survival"],
      onProgress(done, total, fingerprint, frame, category) {
        process.stderr.write(`\rdeath-category ${done}/${total} ${String(fingerprint).slice(0, 12)}:${frame}` +
          (category ? ` ${category}` : ""));
        if (done === total) process.stderr.write("\n");
      }
    });
    process.stdout.write(`${JSON.stringify({ status: result.report.status, file: result.file,
      fingerprint: result.report.fingerprint, sampling: result.report.sampling,
      denominator: result.report.denominator }, null, 2)}\n`);
    return;
  }
  if (command === "scan-fact-layer") {
    onlyOptions(options, ["root", "focused-report", "verify-limit", "output-name"]);
    const result = await scanFactLayer(root, {
      focusedReportPath: options["focused-report"],
      verifyLimit: options["verify-limit"], outputName: options["output-name"]
    });
    process.stdout.write(`${JSON.stringify({ status: result.report.status, file: result.file,
      fingerprint: result.report.fingerprint, denominator: result.report.denominator }, null, 2)}\n`);
    return;
  }
  if (command === "probe-value-depth") {
    onlyOptions(options, ["root", "dominated-report", "focused-report", "output-name"]);
    const result = analyzeValueDepth(root, {
      dominatedReportPath: options["dominated-report"],
      focusedReportPath: options["focused-report"],
      outputName: options["output-name"]
    });
    process.stdout.write(`${JSON.stringify({ status: result.report.status, file: result.file,
      fingerprint: result.report.fingerprint, denominator: result.report.denominator }, null, 2)}\n`);
    return;
  }
  if (command === "compare-focused") {
    onlyOptions(options, ["root", "before-name", "before", "after-name", "after",
      "verification-name", "verification", "output-name"]);
    const result = compareFocusedRegression(root, { beforeName: options["before-name"],
      beforePath: options.before, afterName: options["after-name"], afterPath: options.after,
      verificationName: options["verification-name"], verificationPath: options.verification,
      outputName: options["output-name"] });
    process.stdout.write(`${JSON.stringify({ status: result.report.status, file: result.file,
      fingerprint: result.report.fingerprint, assessment: result.report.assessment,
      denominator: result.report.denominator, primary: result.report.primary,
      controls: result.report.controls }, null, 2)}\n`); return;
  }
  if (command === "build-safety-corpus") {
    onlyOptions(options, ["root", "report-name", "report"]);
    const result = buildSafetyDefectCorpus(root, { reportName: options["report-name"],
      reportPath: options.report });
    process.stdout.write(`${JSON.stringify({ status: "BUILT", file: result.file,
      counts: result.artifact.counts, fingerprint: result.artifact.fingerprint }, null, 2)}\n`);
    return;
  }
  if (command === "verify-safety-repair") {
    onlyOptions(options, ["root", "report-name", "report", "corpus", "output-name"]);
    const result = verifySafetyRepair(root, { reportName: options["report-name"],
      reportPath: options.report, corpusPath: options.corpus, outputName: options["output-name"] });
    process.stdout.write(`${JSON.stringify({ status: result.report.status, file: result.file,
      checks: result.report.checks, delta: result.report.delta,
      fingerprint: result.report.fingerprint }, null, 2)}\n`);
    if (result.report.status !== "ACCEPTED") process.exitCode = 1; return;
  }
  if (command === "verify-capability-repair") {
    onlyOptions(options, ["root", "report-name", "report", "classification-name",
      "classification", "before-name", "output-name"]);
    const result = verifyCapabilityRepair(root, { reportName: options["report-name"],
      reportPath: options.report, classificationName: options["classification-name"],
      classificationPath: options.classification, beforeName: options["before-name"],
      outputName: options["output-name"] });
    process.stdout.write(`${JSON.stringify({ status: result.report.status, file: result.file,
      checks: result.report.checks, delta: result.report.delta,
      fingerprint: result.report.fingerprint }, null, 2)}\n`);
    if (result.report.status !== "ACCEPTED") process.exitCode = 1; return;
  }
  if (command === "verify-observation-frontier") {
    onlyOptions(options, ["root", "report-name", "report", "capability-name",
      "capability", "sr2", "imp6", "build", "output-name"]);
    const result = verifyObservationFrontier(root, { reportName: options["report-name"],
      reportPath: options.report, capabilityName: options["capability-name"],
      capabilityPath: options.capability, sr2Path: options.sr2,
      imp6Path: options.imp6, buildPath: options.build, outputName: options["output-name"] });
    process.stdout.write(`${JSON.stringify({ status: result.report.status, file: result.file,
      checks: result.report.checks, counters: result.report.counters,
      capacity: result.report.capacity, fingerprint: result.report.fingerprint }, null, 2)}\n`);
    if (result.report.status !== "ACCEPTED") process.exitCode = 1; return;
  }
  if (command === "classify-physical-safety") {
    onlyOptions(options, ["root", "report-name", "report", "corpus", "output-name",
      "transition-budget", "node-budget", "maximum-belief-worlds"]);
    const result = await classifyPhysicalSafety(root, { reportName: options["report-name"],
      reportPath: options.report, corpusPath: options.corpus, outputName: options["output-name"],
      transitionBudget: options["transition-budget"], nodeBudget: options["node-budget"],
      maximumBeliefWorlds: options["maximum-belief-worlds"],
      onProgress(done, total, fingerprint, verdict, counters) {
        process.stderr.write(`\rphysical Safety ${done}/${total} ${fingerprint.slice(0, 12)} ` +
          `${verdict} nodes=${counters.nodes} transitions=${counters.transitions}`);
        if (done === total) process.stderr.write("\n");
      } });
    process.stdout.write(`${JSON.stringify({ status: result.report.status, file: result.file,
      counts: result.report.counts, fingerprint: result.report.fingerprint,
      defectCorpus: { file: result.defectCorpus.file,
        fingerprint: result.defectCorpus.artifact.fingerprint,
        counts: result.defectCorpus.artifact.counts } }, null, 2)}\n`);
    if (result.report.status !== "COMPLETED") process.exitCode = 1; return;
  }
  if (command === "verify") {
    onlyOptions(options, ["root", "lane", "cases", "seed", "normal-runtime", "cohort"]);
    const result = await verifyFastRegression(root, { lane: options.lane,
      cases: options.cases, seed: options.seed, historicalRuntime: !options["normal-runtime"],
      cohort: options.cohort,
      onPreloadProgress(done, total, matchId) {
        if (done % 64 === 0 || done === total)
          process.stderr.write(`\rfast-regression preload ${done}/${total} ${matchId.slice(0, 48)}`);
        if (done === total) process.stderr.write("\n");
      },
      onProgress(done, total, fingerprint, status) {
        if (done % 64 === 0 || done === total)
          process.stderr.write(`\rfast-regression verify ${done}/${total} ${fingerprint.slice(0, 12)} ${status}`);
        if (done === total) process.stderr.write("\n");
      } });
    process.stdout.write(`${JSON.stringify({ status: result.report.status, file: result.file,
      fingerprint: result.report.fingerprint, invariants: result.report.invariantTotals }, null, 2)}\n`);
    if (result.report.status !== "ACCEPTED") process.exitCode = 1; return;
  }
  if (command === "benchmark-replay") {
    onlyOptions(options, ["root", "cohort", "maximum-matches", "report-name",
      "normal-runtime"]);
    const result = await benchmarkReplay(root, { cohort: options.cohort,
      maximumMatches: options["maximum-matches"], reportName: options["report-name"],
      historicalRuntime: !options["normal-runtime"], onProgress(phase, done, total) {
        if (done % 8 === 0 || done === total)
          process.stderr.write(`\rreplay benchmark ${phase} ${done}/${total}`);
        if (done === total) process.stderr.write("\n");
      } });
    process.stdout.write(`${JSON.stringify({ status: result.report.status, file: result.file,
      fingerprint: result.report.fingerprint, denominator: result.report.denominator,
      replay: result.report.replay, differential: result.report.differential }, null, 2)}\n`);
    if (result.report.status !== "PASS") process.exitCode = 1; return;
  }
  if (command === "compile-replay") {
    onlyOptions(options, ["root", "cohort"]); const store = new FastRegressionStore(root);
    store.initialize(); const cohortReference = options.cohort || "initial-full";
    const cohort = loadCohort(store, cohortReference);
    if (!cohort) throw new Error(`cohort not found: ${cohortReference}`);
    const cached = loadCompiledReplayCorpus(store, cohort);
    if (cached) {
      process.stdout.write(`${JSON.stringify({ status: "REUSED", cohort: cohortReference,
        manifest: cached.manifest.fingerprint, dataFile: cached.dataFile,
        denominator: cached.manifest.denominator, preload: cached.stats }, null, 2)}\n`); return;
    }
    const entries = laneEntries(store, "capsule-all", cohortReference);
    const corpus = preloadReplayCorpus(store, entries, { onProgress(done, total, matchId) {
      if (done % 64 === 0 || done === total)
        process.stderr.write(`\rcompile replay ${done}/${total} ${matchId.slice(0, 48)}`);
      if (done === total) process.stderr.write("\n");
    } });
    const result = writeCompiledReplayCorpus(store, cohort, corpus);
    process.stdout.write(`${JSON.stringify({ status: "COMPILED", cohort: cohortReference,
      manifest: result.manifest.fingerprint, manifestFile: result.manifestFile,
      dataFile: result.dataFile, denominator: result.manifest.denominator,
      preload: result.manifest.preload }, null, 2)}\n`); return;
  }
  if (command === "explain") {
    onlyOptions(options, ["root", "capsule"]); const store = new FastRegressionStore(root);
    const result = store.readCapsule(options.capsule);
    process.stdout.write(`${JSON.stringify({ file: result.file, fingerprint: result.capsule.fingerprint,
      source: result.capsule.source, window: result.capsule.window,
      restorePolicy: result.capsule.restorePolicy, original: result.capsule.original.result }, null, 2)}\n`);
    return;
  }
  throw new Error(`unknown fast-regression command: ${command}`);
}

main().catch(error => {
  process.stderr.write(`${error.code || "FAST_REGRESSION_ERROR"}: ${error.message}\n`);
  process.exitCode = 1;
});
