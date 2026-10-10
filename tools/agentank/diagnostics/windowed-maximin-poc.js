#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ProductionDepthSearch, DEPTH_VALUE_MIN, DEPTH_VALUE_MAX } = require(
  "../../../engine-v2/src/search/production-depth-search");
const { ProductionCacheBank } = require("../../../engine-v2/src/cache/production-cache");
const { ACTION, FAST_STATUS, HARD_STATUS, TERMINAL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const calibration = require("./minimax-depth-calibration");
const { defaultWorkspaceRoot } = require("../core/paths");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { writeJsonAtomic } = require("../core/atomic-file");

const OBJECT_KIND = "WINDOWED_MAXIMIN_POC_V1";
const BOUND = Object.freeze({ EXACT: 0, LOWER: 1, UPPER: 2 });
const WIDTH = 2;

function option(name, fallback = null) {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : process.argv[at + 1];
}

function integer(value, fallback, label) {
  if (value === null || value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`HP28_OPTION:${label}:${value}`);
  return parsed;
}

function classify(value, alpha, beta) {
  return { value, bound: value <= alpha ? BOUND.UPPER : value >= beta ? BOUND.LOWER : BOUND.EXACT };
}

class PhysicalMaximinPoc {
  constructor(bundle, root, baseRisk = 50) {
    this.bundle = bundle; this.root = root; this.baseRisk = baseRisk;
    this.helper = new ProductionDepthSearch(new ProductionCacheBank());
    this.helper.baseRisk = baseRisk; this.helper.iterationExpansionLimit = WIDTH;
    this.nodes = 0; this.multiOutcomeExactFallbacks = 0; this.windowCutoffs = 0;
    this.researches = 0; this.incomplete = 0;
  }

  transitionValue(depth, action0, argument0, action1, argument1, chance0, chance1,
      alpha, beta, windowed) {
    const status = this.bundle.kernel.applyFrame(action0, argument0, action1, argument1,
      chance0, chance1); this.nodes += 1; let value = -22000; let bound = BOUND.EXACT;
    if (status === FAST_STATUS.APPLIED || status === FAST_STATUS.APPLIED_TERMINAL) {
      const mark = this.bundle.kernel.lastMark; const hard = this.bundle.hard.classifyApplied();
      const terminal = this.bundle.hard.lastTerminal;
      if (hard === HARD_STATUS.REJECT_POLICY) value = -27500;
      else if (terminal && terminal !== TERMINAL.INCOMPLETE)
        value = this.helper.terminalValue(terminal, depth);
      else if (hard === HARD_STATUS.REJECT_PROVEN) value = -28000 - depth * 50;
      else if (hard === HARD_STATUS.INCOMPLETE) {
        value = this.helper.heuristic(this.bundle.state) - 6000; this.incomplete += 1;
      } else if (depth <= 1) value = this.helper.heuristic(this.bundle.state);
      else if (windowed) {
        const child = this.matrixWindow(depth - 1, alpha, beta);
        value = child.value; bound = child.bound;
      } else value = this.matrixExact(depth - 1).value;
      this.bundle.state.undoTo(mark);
    }
    return windowed && bound !== BOUND.EXACT ? { value, bound } : classify(value, alpha, beta);
  }

  jointExact(depth, action0, argument0, action1, argument1) {
    const own = this.helper.chanceAlternatives(this.bundle.state, 0, action0);
    const enemy = this.helper.chanceAlternatives(this.bundle.state, 1, action1);
    const count = own * enemy; let sum = 0; let worst = DEPTH_VALUE_MAX;
    for (let index = 0; index < count; index += 1) {
      const result = this.transitionValue(depth, action0, argument0, action1, argument1,
        index % own, Math.floor(index / own), DEPTH_VALUE_MIN, DEPTH_VALUE_MAX, false);
      sum += result.value; if (result.value < worst) worst = result.value;
    }
    return this.helper.robustChance(sum, worst, count);
  }

  jointWindow(depth, action0, argument0, action1, argument1, alpha, beta) {
    const own = this.helper.chanceAlternatives(this.bundle.state, 0, action0);
    const enemy = this.helper.chanceAlternatives(this.bundle.state, 1, action1);
    if (own * enemy !== 1) {
      this.multiOutcomeExactFallbacks += 1;
      return classify(this.jointExact(depth, action0, argument0, action1, argument1), alpha, beta);
    }
    return this.transitionValue(depth, action0, argument0, action1, argument1,
      0, 0, alpha, beta, true);
  }

  generate(depth) {
    this.helper.generateDeep(depth, this.bundle.state, 0);
    this.helper.generateDeep(depth, this.bundle.state, 1);
    return { ownCount: this.helper.frameOurCount[depth],
      enemyCount: this.helper.frameEnemyCount[depth], offset: depth * 4 };
  }

  matrixExact(depth) {
    const generated = this.generate(depth); let best = DEPTH_VALUE_MIN; let bestRow = 0;
    for (let row = 0; row < generated.ownCount; row += 1) {
      let worst = DEPTH_VALUE_MAX;
      for (let column = 0; column < generated.enemyCount; column += 1) {
        const value = this.jointExact(depth,
          this.helper.deepOurActions[generated.offset + row],
          this.helper.deepOurArguments[generated.offset + row],
          this.helper.deepEnemyActions[generated.offset + column],
          this.helper.deepEnemyArguments[generated.offset + column]);
        if (value < worst) worst = value;
        if (worst <= best) break;
      }
      if (worst > best) { best = worst; bestRow = row; }
    }
    return { value: best, bestRow };
  }

  matrixWindow(depth, alpha, beta) {
    const originalAlpha = alpha; const originalBeta = beta;
    const generated = this.generate(depth); let best = DEPTH_VALUE_MIN; let bestRow = 0;
    for (let row = 0; row < generated.ownCount; row += 1) {
      let worst = DEPTH_VALUE_MAX;
      for (let column = 0; column < generated.enemyCount; column += 1) {
        const child = this.jointWindow(depth,
          this.helper.deepOurActions[generated.offset + row],
          this.helper.deepOurArguments[generated.offset + row],
          this.helper.deepEnemyActions[generated.offset + column],
          this.helper.deepEnemyArguments[generated.offset + column], alpha,
          Math.min(beta, worst));
        if (child.value < worst) worst = child.value;
        if (worst <= alpha) { this.windowCutoffs += 1; break; }
      }
      if (worst > best) { best = worst; bestRow = row; }
      if (best > alpha) alpha = best;
      if (alpha >= beta) { this.windowCutoffs += 1; break; }
    }
    return { value: best, bestRow,
      bound: best <= originalAlpha ? BOUND.UPPER :
        best >= originalBeta ? BOUND.LOWER : BOUND.EXACT };
  }

  rootRowExact(depth, row) {
    let worst = DEPTH_VALUE_MAX;
    for (let column = 0; column < this.root.enemyCount; column += 1) {
      const value = this.jointExact(depth, this.root.ourActions[row], this.root.ourArguments[row],
        this.root.enemyActions[column], this.root.enemyArguments[column]);
      if (value < worst) worst = value;
    }
    return worst;
  }

  rootRowProbe(depth, row, alpha) {
    let worst = DEPTH_VALUE_MAX;
    for (let column = 0; column < this.root.enemyCount; column += 1) {
      const child = this.jointWindow(depth, this.root.ourActions[row], this.root.ourArguments[row],
        this.root.enemyActions[column], this.root.enemyArguments[column], alpha, worst);
      if (child.value < worst) worst = child.value;
      if (worst <= alpha) { this.windowCutoffs += 1; return worst; }
    }
    return worst;
  }

  rootExact(depth) {
    let best = DEPTH_VALUE_MIN; let bestRow = 0;
    for (let row = 0; row < this.root.ourCount; row += 1) {
      const value = this.rootRowExact(depth, row);
      if (value > best) { best = value; bestRow = row; }
    }
    return { value: best, bestRow };
  }

  rootWindow(depth) {
    let best = this.rootRowExact(depth, 0); let bestRow = 0;
    for (let row = 1; row < this.root.ourCount; row += 1) {
      if (best >= DEPTH_VALUE_MAX) break;
      const probe = this.rootRowProbe(depth, row, best);
      if (probe > best) {
        this.researches += 1; const exact = this.rootRowExact(depth, row);
        if (exact > best) { best = exact; bestRow = row; }
      }
    }
    return { value: best, bestRow };
  }
}

function rootSpec(prepared) {
  return { ourActions: prepared.engine.ourActions,
    ourArguments: prepared.engine.ourArguments, ourCount: prepared.ourCount,
    enemyActions: prepared.engine.enemyActions,
    enemyArguments: prepared.engine.enemyArguments, enemyCount: prepared.engine.enemyCount };
}

function execute(index, depth, windowed, baseRisk) {
  const prepared = calibration.preparedScenario(index, true);
  const signature = prepared.bundle.state.rootSignature();
  const evaluator = new PhysicalMaximinPoc(prepared.bundle, rootSpec(prepared), baseRisk);
  const result = windowed ? evaluator.rootWindow(depth) : evaluator.rootExact(depth);
  return { ...result, action: prepared.engine.ourActions[result.bestRow],
    argument: prepared.engine.ourArguments[result.bestRow], nodes: evaluator.nodes,
    multiOutcomeExactFallbacks: evaluator.multiOutcomeExactFallbacks,
    windowCutoffs: evaluator.windowCutoffs, researches: evaluator.researches,
    incomplete: evaluator.incomplete,
    rootRestoreFailure: prepared.bundle.state.rootSignature() === signature ? 0 : 1 };
}

function sourceIdentity(root) {
  const source = calibration.sourceIdentity(root);
  const relative = "tools/agentank/diagnostics/windowed-maximin-poc.js";
  return { ...source, diagnosticFile: relative,
    diagnosticSha256: sha256Bytes(fs.readFileSync(path.join(root, relative))) };
}

function verify(report) {
  const errors = [];
  if (!report || report.objectKind !== OBJECT_KIND) errors.push("OBJECT_KIND");
  if (report?.invariants?.valueMismatches) errors.push("VALUE_MISMATCH");
  if (report?.invariants?.actionMismatches) errors.push("ACTION_MISMATCH");
  if (report?.invariants?.rootRestoreFailures) errors.push("ROOT_RESTORE");
  return { status: errors.length ? "FAIL" : "PASS", errors };
}

function run(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const scenarioCount = integer(options.scenarioCount, 16, "scenarios");
  const depth = integer(options.depth, 3, "depth");
  const baseRisk = Number.isSafeInteger(options.baseRisk) ?
    Math.max(0, Math.min(100, options.baseRisk)) : 50; const rows = [];
  const invariants = { valueMismatches: 0, actionMismatches: 0, rootRestoreFailures: 0 };
  let exactNodes = 0; let windowNodes = 0; let cutoffs = 0; let researches = 0;
  let multiOutcomeFallbacks = 0;
  for (let index = 0; index < scenarioCount; index += 1) {
    const exact = execute(index, depth, false, baseRisk);
    const windowed = execute(index, depth, true, baseRisk);
    const valueMismatch = exact.value === windowed.value ? 0 : 1;
    const actionMismatch = exact.action === windowed.action &&
      exact.argument === windowed.argument ? 0 : 1;
    invariants.valueMismatches += valueMismatch; invariants.actionMismatches += actionMismatch;
    invariants.rootRestoreFailures += exact.rootRestoreFailure + windowed.rootRestoreFailure;
    exactNodes += exact.nodes; windowNodes += windowed.nodes;
    cutoffs += windowed.windowCutoffs; researches += windowed.researches;
    multiOutcomeFallbacks += windowed.multiOutcomeExactFallbacks;
    rows.push({ index, valueMismatch, actionMismatch, exact, windowed });
  }
  const report = { schemaVersion: 1, objectKind: OBJECT_KIND,
    createdAt: new Date().toISOString(), source: sourceIdentity(root), scenarioCount, depth,
    baseRisk,
    exactNodes, windowNodes, nodesSaved: exactNodes - windowNodes,
    nodeReductionBasisPoints: Math.floor((exactNodes - windowNodes) * 10000 /
      Math.max(1, exactNodes)), cutoffs, researches, multiOutcomeFallbacks,
    invariants, rows, status: "PENDING", qualification: "PENDING", fingerprint: "" };
  report.status = verify(report).status;
  report.qualification = report.status === "PASS" && report.nodeReductionBasisPoints >= 600 ?
    "QUALIFIED_FOR_FIXED_STACK_PROTOTYPE" : "REJECTED_NO_MATERIAL_GAIN";
  report.fingerprint = fingerprintObject(report); return report;
}

function main() {
  const report = run({ scenarioCount: integer(option("--scenarios"), 16, "scenarios"),
    depth: integer(option("--depth"), 3, "depth"),
    baseRisk: Number(option("--risk", 50)) });
  const output = option("--output");
  if (output) writeJsonAtomic(path.resolve(output), report, { mode: 0o644 });
  process.stdout.write(`${JSON.stringify({ status: report.status,
    qualification: report.qualification, output: output || null,
    fingerprint: report.fingerprint, exactNodes: report.exactNodes,
    windowNodes: report.windowNodes, nodesSaved: report.nodesSaved,
    nodeReductionBasisPoints: report.nodeReductionBasisPoints,
    cutoffs: report.cutoffs, researches: report.researches,
    multiOutcomeFallbacks: report.multiOutcomeFallbacks,
    invariants: report.invariants }, null, 2)}\n`);
  if (report.status !== "PASS") process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { OBJECT_KIND, BOUND, PhysicalMaximinPoc, run, verify };
