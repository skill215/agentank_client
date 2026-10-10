"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, NONE_FRAME } = require("../../../engine-v2/src/abi/fast-codes");
const { NativeBasePolicyDiagnosticBot, play, productionTreeSha256 } = require("./native-base-policy-standalone-arena");
const { prefixMatches } = require("./native-base-policy-root-action-counterfactual");
const { loadCohort } = require("./v2-native-initiative-arena");
const { loadSimulator } = require("../simulation/paired-arena");
const { NativeBasePolicySearch } = require("../../../engine-v2/src/base-policy-specialized/policy-search");

function tracedDomain() {
  const file = require.resolve("../../../engine-v2/src/base-policy-specialized/action-domain");
  const source = fs.readFileSync(file, "utf8");
  const marker = "if (best > thresholdTimes100) {";
  if (source.split(marker).length !== 2) throw Error("TRACE_ANCHOR_NOT_UNIQUE");
  const sandbox = { module: { exports: {} }, require: createRequire(file), trace: null };
  vm.runInNewContext(source.replace(marker,
    "globalThis.trace = { best, thresholdTimes100 }; " + marker), sandbox, { filename: file });
  const domain = new sandbox.module.exports.NativeBasePolicyActionDomain();
  return { domain, sandbox };
}

function inspect(engine) {
  const state = engine.adapter.state, a = state.arrays;
  const search = engine.basePolicy.policySearch;
  const domain = search.deepFireDomain;
  const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
  const ready = domain.canFire(state, 0);
  const qualified = domain.qualifiedFireForSeat(state, 0);
  const traced = tracedDomain();
  if (traced.domain.qualifiedFireForSeat(state, 0) !== qualified)
    throw Error("TRACE_SEMANTICS_MISMATCH");
  const fixture = { width: state.width, height: state.height, arrays: {} };
  for (const key of ["SCALAR", "TERRAIN", "TANK_CELL", "TANK_DIR", "TANK_STARS",
    "TANK_FIRE_LOCK", "TANK_CLOAK_UNTIL", "TANK_SHIELD_UNTIL", "TANK_SHIELD_HITS",
    "TANK_BOOST_UNTIL", "TANK_FROZEN_UNTIL", "TANK_POISON_UNTIL", "TANK_POISON_APPLIED",
    "PROJECTILE_ACTIVE", "PROJECTILE_OWNER"])
    fixture.arrays[key] = Array.from(a[ARRAY[key]]);
  return { frame, ready: Boolean(ready), qualified: Boolean(qualified),
    qualificationTrace: traced.sandbox.trace,
    rootAllowed: Boolean(search.rootV1ShapedAllowed(engine, ACTION.FIRE)),
    enemyCloaked: a[ARRAY.TANK_CLOAK_UNTIL][1] !== NONE_FRAME && a[ARRAY.TANK_CLOAK_UNTIL][1] > frame,
    own: [state.x(a[ARRAY.TANK_CELL][0]), state.y(a[ARRAY.TANK_CELL][0])],
    enemy: [state.x(a[ARRAY.TANK_CELL][1]), state.y(a[ARRAY.TANK_CELL][1])], fixture };
}

async function run(root, input, output) {
  const oracle = JSON.parse(fs.readFileSync(input));
  if (oracle.productionTreeSha256 !== productionTreeSha256(root)) throw Error("SOURCE_DRIFT");
  const matches = zlib.gunzipSync(fs.readFileSync(path.join(oracle.input.directory, "matches.ndjson.gz")))
    .toString().trim().split("\n").map(JSON.parse);
  const scenarios = loadCohort(root, path.join(root, "config/engine-v3/v3-repair-cohort.json"), "DISCOVERY").scenarios;
  const targets = oracle.records.filter(r => r.recoverable &&
    r.baselineOutcome !== r.oracle.terminal.outcome && r.oracle.row.action === ACTION.FIRE &&
    r.oracle.row.basePolicyMembership === 3);
  const { module } = await loadSimulator(root);
  const records = [];
  const original = NativeBasePolicyDiagnosticBot.prototype.captureRoot;
  try {
    for (const target of targets) {
      let captured;
      NativeBasePolicyDiagnosticBot.prototype.captureRoot = function(context) {
        if (this.engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] === target.root.frame)
          captured = inspect(this.engine);
      };
      const scenario = scenarios.find(s => s.matchUrlId === target.matchUrlId);
      if (!scenario) throw Error("SCENARIO_MISSING");
      const replay = await play(module, scenario, target.candidateSeat, true);
      const baseline = matches.find(m => m.matchUrlId === target.matchUrlId && m.candidateSeat === target.candidateSeat);
      if (!captured || !prefixMatches(baseline, replay, target.root.frame, target.selected.action))
        throw Error("AUDIT_ROOT_MISMATCH");
      const controls = [];
      for (const action of [ACTION.NONE, ACTION.FIRE]) {
        NativeBasePolicyDiagnosticBot.prototype.captureRoot = function() {};
        const branch = await play(module, scenario, target.candidateSeat, false,
          null, true, true, "current", false, false, 1, "off", target.root.frame, action);
        const prefixMatched = prefixMatches(baseline, branch, target.root.frame, action);
        if (!prefixMatched || !branch.candidateEngine.forceApplied)
          throw Error("CONTROL_PREFIX_MISMATCH");
        controls.push({ action, prefixMatched, forceApplied: true,
          outcome: branch.analysisOutcome, category: branch.terminalCategory,
          counts: branch.counts, frames: branch.frames });
      }
      const originalAllowed = NativeBasePolicySearch.prototype.rootV1ShapedAllowed;
      let searchOnly;
      let rootEvidence;
      try {
        NativeBasePolicySearch.prototype.rootV1ShapedAllowed = function(engine, action) {
          if (action === ACTION.FIRE && engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] === target.root.frame)
            return this.canFire(engine.adapter.state, 0) ? 1 : 0;
          return originalAllowed.call(this, engine, action);
        };
        NativeBasePolicyDiagnosticBot.prototype.captureRoot = function(context) {
          if (this.engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME] !== target.root.frame) return;
          original.call(this, context, null);
          rootEvidence = this.rootFrames.pop();
        };
        searchOnly = await play(module, scenario, target.candidateSeat, true);
      } finally {
        NativeBasePolicySearch.prototype.rootV1ShapedAllowed = originalAllowed;
      }
      const selectedAction = rootEvidence.candidates.find(r => r.row === rootEvidence.selected)?.action;
      const prefixMatched = prefixMatches(baseline, searchOnly, target.root.frame, selectedAction);
      if (!prefixMatched) throw Error("SEARCH_ADMIT_PREFIX_MISMATCH");
      controls.push({ mode: "SEARCH_ADMIT_FIRE_AT_ONE_ROOT", prefixMatched,
        outcome: searchOnly.analysisOutcome, frames: searchOnly.frames,
        selectedAction, nodes: rootEvidence.basePolicyNodes,
        depth: rootEvidence.basePolicyDepth,
        rows: rootEvidence.candidates.map(r => ({ action: r.action,
          membership: r.basePolicyMembership, value: r.basePolicyValue })) });
      records.push({ matchUrlId: target.matchUrlId, seat: target.candidateSeat,
        baselineOutcome: target.baselineOutcome, alternativeOutcome: target.oracle.terminal.outcome,
        ...captured, controls });
    }
  } finally { NativeBasePolicyDiagnosticBot.prototype.captureRoot = original; }
  const report = { productionTreeSha256: oracle.productionTreeSha256, records };
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(records.map(({fixture, ...record}) => record), null, 2));
}
if (require.main === module) run(process.cwd(), process.argv[2], process.argv[3])
  .catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { inspect, run, tracedDomain };
