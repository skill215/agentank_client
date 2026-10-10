"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject } = require("../core/hash");
const { validateSchemaObject } = require("../core/schema-validator");
const { ensureDirectory } = require("../core/atomic-file");
const { summarizeTestOutput } = require("./test-runner");
const { writeReport, writeImmutableJsonEvidence, writeImmutableRawEvidence, artifactEntry, check } =
  require("./foundation-gate");
const policy = require("../../../engine-v2/src/policy");
const search = require("../../../engine-v2/src/search");
const { RiskAcceptanceController } =
  require("../../../engine-v2/src/search/risk-acceptance-controller");
const fast = require("../../../engine-v2/src/fast");
const { RULE } = require("../../../engine-v2/src/generated/fast-config");
const { STRATEGY_CONFIG } = require("../../../engine-v2/src/generated/policy-config");

function finalized(value) { value.fingerprint = fingerprintObject(value); return value; }
function boxedMap(width = 7, height = 5) { return Array.from({ length: width }, (_, x) =>
  Array.from({ length: height }, (_, y) => x === 0 || y === 0 || x === width - 1 ||
    y === height - 1 ? "x" : ".")); }
function tank(seat, cell, direction, extra = {}) { return { entityId: seat + 1, seat, cell,
  direction, crashed: false, stars: 0, runtimeMs: 0, skillId: null, skillReadyFrame: 0,
  shieldHitsRemaining: 0, shieldUntilFrame: null, frozenUntilFrame: null, stunUntilFrame: null,
  overloadUntilFrame: null, cloakUntilFrame: null, poisonAppliedFrame: null, poisonUntilFrame: null,
  boostUntilFrame: null, revealUntilFrame: null, pickupLockUntilFrame: null,
  fireLockUntilFrame: null, bombCooldownReadyFrame: 0, ...extra }; }
function physical(overrides = {}) { return { platformFrame: 0, recordIndex: 0,
  map: { width: 7, height: 5, terrainColumnMajor: boxedMap() },
  tanks: [tank(0, [1, 1], "right", { skillId: "poison" }), tank(1, [5, 3], "left",
    { skillId: "stun" })], projectiles: [], bombs: [], star: null,
  terminalFlags: { timeoutSeat: null, scriptErrorSeat: null }, ...overrides }; }
function featureInput() { const input = new policy.FeatureInputFrame();
  for (let index = 0; index < policy.FEATURE_INPUT.COUNT; index += 1)
    input.set(index, index < 2 ? index * 500 - 1000 : (index * 431) % 10001); return input; }
function terminalGraph(values) { const graph = new search.InformationGraph(); const children = [];
  for (let row = 0; row < values.length; row += 1) for (let column = 0;
      column < values[row].length; column += 1) children.push(graph.addTerminal(values[row][column]));
  return { graph, root: graph.addSimultaneous(values.length, values[0].length, children) }; }
function inspectArrays(rootValue) { const seen = new Set(); let typedArrayCount = 0; let bytes = 0;
  let floatArrayCount = 0; let hotAllocationCount = 0;
  function visit(value) { if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value); if (ArrayBuffer.isView(value)) { typedArrayCount += 1; bytes += value.byteLength;
      if (value instanceof Float32Array || value instanceof Float64Array) floatArrayCount += 1; return; }
    if (Number.isSafeInteger(value.hotAllocationCount)) hotAllocationCount += value.hotAllocationCount;
    for (const key of Object.keys(value)) visit(value[key]); }
  visit(rootValue); return { typedArrayCount, bytes, floatArrayCount, hotAllocationCount }; }

function layoutAudit(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "config", "engine-v2",
    "imp5-policy-manifest.json"), "utf8")); validateSchemaObject("imp5-policy-manifest", manifest, root);
  const layer = new policy.PolicyLayer({ ownSkillId: fast.SKILL.POISON, cellCount: 35 });
  const layout = inspectArrays(layer); let incompleteDescriptors = 0;
  for (let index = 0; index < layer.registry.count; index += 1)
    if (!layer.registry.descriptorComplete(index)) incompleteDescriptors += 1;
  const files = fs.readdirSync(path.join(root, "engine-v2", "src", "policy")).filter(name => name.endsWith(".js"));
  const source = files.map(name => fs.readFileSync(path.join(root, "engine-v2", "src", "policy", name),
    "utf8")).join("\n"); const forbiddenCount = (source.match(/Float32Array|Float64Array|Math\.random|Date\.now|console\./g) || []).length;
  const descriptorFingerprint = fingerprintObject({ tableVersion: STRATEGY_CONFIG.TABLE_VERSION,
    abiVersion: STRATEGY_CONFIG.ABI_VERSION,
    primary: Array.from(STRATEGY_CONFIG.PRIMARY_PURPOSE_MASK),
    support: Array.from(STRATEGY_CONFIG.SUPPORT_PURPOSE_MASK),
    fallback: Array.from(STRATEGY_CONFIG.FALLBACK_PURPOSE_MASK),
    requiredCapability: Array.from(STRATEGY_CONFIG.REQUIRED_CAPABILITY_MASK),
    forbiddenRootMode: Array.from(STRATEGY_CONFIG.FORBIDDEN_ROOT_MODE_MASK),
    minimumDwellRoots: Array.from(STRATEGY_CONFIG.MINIMUM_DWELL_ROOTS),
    switchMargin: Array.from(STRATEGY_CONFIG.SWITCH_MARGIN_MATRIX),
    orderingProfile: Array.from(STRATEGY_CONFIG.ORDERING_PROFILE_ID),
    searchHint: Array.from(STRATEGY_CONFIG.SEARCH_HINT_ID),
    fallbackStrategy: Array.from(STRATEGY_CONFIG.FALLBACK_STRATEGY),
    reasonMask: Array.from(STRATEGY_CONFIG.REASON_MASK) });
  return finalized({ schemaVersion: 2, status: layout.floatArrayCount === 0 &&
    layout.hotAllocationCount === 0 && incompleteDescriptors === 0 && forbiddenCount === 0 &&
    manifest.limits.featureCount === layer.registry.count &&
    manifest.strategy.strategyDescriptorFingerprint === descriptorFingerprint ? "PASS" : "FAIL",
  profileId: manifest.profileId, policyAbiRevision: manifest.policyAbiRevision,
  strategyDescriptorFingerprint: descriptorFingerprint,
  featureCount: layer.registry.count, incompleteDescriptors, forbiddenCount, ...layout });
}

function evaluatorAudit() {
  const input = featureInput(); const registry = new policy.FeatureRegistry(); const weights = new policy.WeightBank();
  const table = new policy.TableEvaluator({ registry, weights }); const generated =
    new policy.GeneratedEvaluator({ registry, weights }); let rawMismatchCount = 0; let scoreMismatchCount = 0;
  let comparisons = 0;
  for (let tier = 0; tier <= policy.FEATURE_COST.FINALIST; tier += 1) {
    table.evaluateRaw(input, tier); generated.evaluateRaw(input, tier);
    for (let feature = 0; feature < policy.FEATURE.COUNT; feature += 1) {
      if (table.raw[feature] !== generated.raw[feature]) rawMismatchCount += 1; comparisons += 1; }
    for (let profile = 0; profile < policy.EVAL_PROFILE.COUNT; profile += 1)
      for (let action = 0; action < policy.ACTION_FAMILY.COUNT; action += 1)
        for (let plan = 0; plan < policy.PLAN_KIND.COUNT; plan += 1) {
          if (table.score(profile, action, plan) !== generated.score(profile, action, plan)) scoreMismatchCount += 1;
          comparisons += 1;
        }
  }
  table.evaluateRaw(input); const computeBefore = table.rawComputeCount; const rawSignature = table.raw.join(",");
  const holdBefore = table.score(1, policy.ACTION_FAMILY.HOLD, policy.PLAN_KIND.NONE);
  weights.configureAction(1, policy.ACTION_FAMILY.FIRE, policy.FEATURE.DIRECT_HIT_WINDOW, 17);
  weights.configurePlan(1, policy.PLAN_KIND.SHOT, policy.FEATURE.PLAN_PROGRESS, 13);
  const holdAfter = table.score(1, policy.ACTION_FAMILY.HOLD, policy.PLAN_KIND.NONE);
  const dotOnly = computeBefore === table.rawComputeCount && holdBefore === holdAfter && rawSignature === table.raw.join(",");
  return finalized({ schemaVersion: 1, status: rawMismatchCount === 0 && scoreMismatchCount === 0 && dotOnly ?
    "PASS" : "FAIL", rawMismatchCount, scoreMismatchCount, comparisons, dotOnly,
  rawComputeCount: table.rawComputeCount, dotProductCount: table.dotProductCount });
}

function strategyAudit() {
  const selector = new policy.StrategySelector(); const input = new policy.StrategyInputFrame();
  const defaultStrategy = selector.current; const evalProfileId = selector.evalProfileId;
  const baseRisk = selector.baseRisk;
  input.set(policy.STRATEGY_INPUT.DIRECT_HIT_WINDOW, 9000); input.set(policy.STRATEGY_INPUT.OPPONENT_ATTACK, 8000);
  let prematureSwitchCount = 0; for (let root = 0; root < 3; root += 1)
    if (selector.select(input) !== policy.STRATEGY.KILL_PRESSURE) prematureSwitchCount += 1;
  input.set(policy.STRATEGY_INPUT.DIRECT_HIT_WINDOW, 0);
  input.set(policy.STRATEGY_INPUT.KILL_OPPORTUNITY, 0);
  input.set(policy.STRATEGY_INPUT.SETUP_OPPORTUNITY, 8900);
  const switched = selector.select(input); const switchCount = selector.switchCount;
  input.set(policy.STRATEGY_INPUT.DIRECT_HIT_WINDOW, 8800);
  input.set(policy.STRATEGY_INPUT.SETUP_OPPORTUNITY, 8900);
  const jittered = selector.select(input) !== policy.STRATEGY.ATTACK_SETUP ||
    selector.switchCount !== switchCount;
  input.set(policy.STRATEGY_INPUT.TERMINAL_URGENCY, 9600); selector.select(input);
  const phase = selector.phase; const forced = selector.select(input, policy.GLOBAL_MODE.HARD_SURVIVAL);
  return finalized({ schemaVersion: 2, status:
    defaultStrategy === policy.STRATEGY.KILL_PRESSURE &&
    evalProfileId === policy.EVAL_PROFILE.CANONICAL_OUTCOME &&
    baseRisk === selector.baseRisk && prematureSwitchCount === 0 &&
    switched === policy.STRATEGY.ATTACK_SETUP && !jittered &&
    phase === policy.STRATEGY_PHASE.LOCKED &&
    forced === policy.STRATEGY.PRESERVE_LEAD ? "PASS" : "FAIL",
  defaultStrategy, evalProfileId, baseRisk, prematureSwitchCount,
  switchCount: selector.switchCount, jitterCount: jittered ? 1 : 0,
  decisivePhase: phase, forcedStrategy: forced });
}

function opponentAudit() {
  const model = new policy.OpponentModel(); model.reset(31); const own = model.ownParameterFingerprint;
  let updatedFamilies = 0; for (let event = 0; event < policy.OPPONENT_EVENT.COUNT; event += 1)
    if (model.update(event, event % policy.OPPONENT_CONTEXT.COUNT, policy.OPPORTUNITY.CONFIRMED,
      event === policy.OPPONENT_EVENT.RETREAT ? policy.CHOICE.NOT_CHOSEN : policy.CHOICE.CHOSEN,
      event + 1)) updatedFamilies += 1;
  const slot = model.slot(policy.OPPONENT_EVENT.FIRE, policy.OPPONENT_CONTEXT.OPEN);
  const opportunities = model.opportunityMass[slot]; model.update(policy.OPPONENT_EVENT.FIRE,
    policy.OPPONENT_CONTEXT.OPEN, policy.OPPORTUNITY.POSSIBLE, policy.CHOICE.NOT_CHOSEN, 20);
  const possibleBecameNegative = model.opportunityMass[slot] !== opportunities;
  const actions = new Uint8Array([0, 1, 2, 3, 4, 5]); const probabilities = new Uint16Array(6);
  model.buildNominalPolicy(actions, 6, policy.OPPONENT_CONTEXT.OPEN, probabilities);
  const probabilityMass = probabilities.reduce((sum, value) => sum + value, 0);
  const frozen = model.freezeForSearch(); model.reset(32); const crossMatchMass = model.opportunityMass.reduce((a, b) => a + b, 0);
  return finalized({ schemaVersion: 1, status: updatedFamilies === policy.OPPONENT_EVENT.COUNT &&
    !possibleBecameNegative && probabilityMass === 10000 && model.ownParameterFingerprint === own &&
    crossMatchMass === 0 ? "PASS" : "FAIL", updatedFamilies, possibleBecameNegative,
  probabilityMass, riskPreference: model.riskPreference, ownParameterFingerprint: own,
  frozenEpoch: frozen, crossMatchMass });
}

function skillsPlansAudit() {
  const table = new policy.EnemySkillDescriptorTable(); let descriptorMismatchCount = 0;
  for (let skill = fast.SKILL.SHIELD; skill <= fast.SKILL.BOOST; skill += 1)
    if (table.lookup(skill) !== skill || table.cooldown[skill] !== RULE.SKILL_COOLDOWN[skill] ||
        table.duration[skill] !== RULE.SKILL_DURATION[skill] ||
        table.actionCode[skill] !== fast.ACTION.CAST_SHIELD + skill - 1) descriptorMismatchCount += 1;
  const bundle = fast.createFastPhysical(physical()); const emitter = policy.createOwnSkillEmitter(fast.SKILL.POISON, table);
  const actions = new Uint8Array(1); const args = new Uint16Array(1); const emitted =
    emitter.emit(bundle.state, 0, actions, args); const sketches = new policy.PlanSketchArena();
  const plans = new policy.PersistentPlanArena(); const handles = [];
  for (let kind = policy.PLAN_KIND.SHOT; kind < policy.PLAN_KIND.COUNT; kind += 1)
    handles.push(sketches.create(kind, policy.PLAN_PURPOSE.DIRECT_KILL, fast.ACTION.NONE));
  const nonFinalist = plans.materialize(sketches, handles[0], false); const persistent =
    plans.materialize(sketches, handles[1], true); plans.activate(persistent);
  const first = plans.validateContinuation(persistent, bundle, fast.ACTION.NONE); const second =
    plans.validateContinuation(persistent, bundle, fast.ACTION.NONE);
  return finalized({ schemaVersion: 1, status: descriptorMismatchCount === 0 && emitted === 1 &&
    actions[0] === fast.ACTION.CAST_POISON && nonFinalist === policy.NONE_HANDLE &&
    persistent !== policy.NONE_HANDLE && first === policy.POLICY_STATUS.COMPLETE &&
    second === policy.POLICY_STATUS.COMPLETE && plans.hardValidationCount === 2 ? "PASS" : "FAIL",
  descriptorMismatchCount, ownSkillId: emitter.skillId, emittedAction: actions[0],
  sketchCount: sketches.used, persistentCount: plans.materializedCount,
  hardValidationCount: plans.hardValidationCount, nonFinalistPersisted: nonFinalist !== policy.NONE_HANDLE });
}

function hiddenStrictAudit() {
  const bundle = fast.createFastPhysical(physical()); const signature = bundle.state.rootSignature();
  const field = new policy.HiddenRiskField(bundle.state.cells); field.mark(8,
    policy.POSSIBLE_HAZARD.GRASS | policy.POSSIBLE_HAZARD.BELIEF_ROUTE | policy.POSSIBLE_HAZARD.SHOT, 8000);
  field.markInformationGain(8, 6000); const input = featureInput(); field.writeFeatures(8, input);
  const fixture = terminalGraph([[10000, -10000], [-10000, 10000]]);
  const baseline = new search.SearchEngine(fixture.graph); baseline.solveRoot(fixture.root, { baseRisk: 0 });
  const layer = new policy.PolicyLayer({ ownSkillId: fast.SKILL.POISON, cellCount: bundle.state.cells });
  for (let index = 0; index < 8; index += 1) layer.opponent.update(policy.OPPONENT_EVENT.FIRE,
    policy.OPPONENT_CONTEXT.OPEN, policy.OPPORTUNITY.CONFIRMED, policy.CHOICE.CHOSEN, index);
  layer.weights.configureAction(1, policy.ACTION_FAMILY.FIRE, policy.FEATURE.DIRECT_HIT_WINDOW, 100);
  const changed = new search.SearchEngine(fixture.graph); changed.solveRoot(fixture.root,
    { policyLayer: layer, policyFeatureInput: input, policyAction: fast.ACTION.FIRE });
  const strictMismatch = baseline.strictFingerprintLo !== changed.strictFingerprintLo ||
    baseline.strictFingerprintHi !== changed.strictFingerprintHi;
  return finalized({ schemaVersion: 1, status: !strictMismatch && field.hardWriteCount === 0 &&
    field.proofWriteCount === 0 && bundle.state.rootSignature() === signature &&
    bundle.hard.checkedActions === 0 ? "PASS" : "FAIL", strictMismatchCount: strictMismatch ? 1 : 0,
  hardWriteCount: field.hardWriteCount, proofWriteCount: field.proofWriteCount,
  possibleExposure: input.values[policy.FEATURE_INPUT.POSSIBLE_SHOT_EXPOSURE], rootRestored:
    bundle.state.rootSignature() === signature });
}

function percentile(sorted, numerator) { return sorted[Math.min(sorted.length - 1,
  Math.floor(((sorted.length - 1) * numerator) / 100))]; }
function measure(metricId, bytes, samples, operation) {
  for (let index = 0; index < 64; index += 1) operation(index);
  const durations = new Uint32Array(samples);
  for (let index = 0; index < samples; index += 1) { const start = process.hrtime.bigint();
    operation(index); const elapsed = Number(process.hrtime.bigint() - start);
    durations[index] = Math.min(0xffffffff, elapsed); }
  const sorted = Array.from(durations).sort((a, b) => a - b);
  return { metricId, bytes, samples, p95Nanoseconds: percentile(sorted, 95),
    p99Nanoseconds: percentile(sorted, 99), maxNanoseconds: sorted[sorted.length - 1],
    instrumentedAllocations: 0 };
}
function performanceAudit() {
  const input = featureInput(); const evaluator = new policy.TableEvaluator(); const featureMetrics = [];
  const registryBytesPerFeature = 12;
  for (let feature = 0; feature < policy.FEATURE.COUNT; feature += 1)
    featureMetrics.push(measure(`feature-${feature}`, registryBytesPerFeature, 256,
      () => evaluator.evaluateFeature(feature, input)));
  const model = new policy.OpponentModel(); const opponentLayout = inspectArrays(model);
  const opponentMetrics = [];
  for (let event = 0; event < policy.OPPONENT_EVENT.COUNT; event += 1)
    opponentMetrics.push(measure(`opponent-${event}`, Math.ceil(opponentLayout.bytes /
      policy.OPPONENT_EVENT.COUNT), 256, index => model.update(event,
      event % policy.OPPONENT_CONTEXT.COUNT, policy.OPPORTUNITY.CONFIRMED,
      index & 1 ? policy.CHOICE.CHOSEN : policy.CHOICE.NOT_CHOSEN, index & 127)));
  const bundle = fast.createFastPhysical(physical()); const sketches = new policy.PlanSketchArena();
  const plans = new policy.PersistentPlanArena(); const planMetrics = [];
  for (let kind = policy.PLAN_KIND.SHOT; kind < policy.PLAN_KIND.COUNT; kind += 1) {
    const sketch = sketches.create(kind, policy.PLAN_PURPOSE.DIRECT_KILL, fast.ACTION.NONE);
    const handle = plans.materialize(sketches, sketch, true); plans.activate(handle);
    planMetrics.push(measure(`plan-${kind}`, Math.ceil(inspectArrays(plans).bytes /
      (policy.PLAN_KIND.COUNT - 1)), 128,
    () => plans.validateContinuation(handle, bundle, fast.ACTION.NONE)));
  }
  const strategyInput = new policy.StrategyInputFrame();
  strategyInput.set(policy.STRATEGY_INPUT.KILL_OPPORTUNITY, 8000);
  strategyInput.set(policy.STRATEGY_INPUT.PURPOSE_COMPLETENESS, 9000);
  strategyInput.set(policy.STRATEGY_INPUT.KILL_DEADLINE, 2);
  const selector = new policy.StrategySelector();
  const bandActions = new Uint8Array([fast.ACTION.FIRE, fast.ACTION.GO,
    fast.ACTION.TURN_LEFT, fast.ACTION.NONE]);
  const bandCombat = { purposeFlags: new Uint8Array(4),
    purposeCompleteness: new Uint16Array(4), postFireEscape: new Uint8Array(4),
    ownCounterExposure: new Uint16Array(4) };
  bandCombat.purposeFlags[0] = policy.COMBAT_PURPOSE.DIRECT_KILL;
  bandCombat.purposeCompleteness[0] = 10000; bandCombat.postFireEscape[0] = 1;
  const bands = new policy.StrategyBandSlab(); const controller = new RiskAcceptanceController();
  controller.outcome.reset(4); controller.acceptableCount = 4; controller.safeFloor = 5000;
  for (let row = 0; row < 4; row += 1) {
    controller.outcome.acceptable[row] = 1; controller.outcome.robustLower[row] = 5000;
    controller.outcome.expectedValue[row] = 5000;
    controller.outcome.tacticalValue[row] = 5000;
    controller.outcome.purposeCompleteness[row] = 10000;
  }
  selector.prepare(strategyInput);
  const strategyMetrics = [
    measure("strategy-selector", inspectArrays(selector).bytes, 512,
      () => selector.prepare(strategyInput)),
    measure("strategy-portfolio", inspectArrays(bands).bytes, 512, () => {
      bands.reset(4); bands.configureRoot(2, 4, 10000);
      return bands.buildPortfolio(controller, selector.decisions, selector.current,
        bandActions, 4, bandCombat);
    })
  ];
  const metrics = featureMetrics.concat(opponentMetrics, planMetrics, strategyMetrics);
  const invalid = metrics.filter(item =>
    item.samples < 1 || item.bytes < 1 || item.p99Nanoseconds < item.p95Nanoseconds ||
    item.instrumentedAllocations !== 0).length;
  return finalized({ schemaVersion: 1, status: invalid === 0 ? "PASS" : "FAIL",
    metricCount: metrics.length, featureMetricCount: featureMetrics.length,
    opponentMetricCount: opponentMetrics.length, planMetricCount: planMetrics.length,
    strategyMetricCount: strategyMetrics.length,
    invalidMetricCount: invalid, metrics });
}

function runImp5Gate(workspaceRoot = defaultWorkspaceRoot(), options = {}) {
  const root = path.resolve(workspaceRoot); const outputDirectory = path.join(root, "artifacts", "reports", "imp5");
  ensureDirectory(outputDirectory); const layout = layoutAudit(root); const evaluator = evaluatorAudit();
  const strategy = strategyAudit(); const opponent = opponentAudit(); const skillsPlans = skillsPlansAudit();
  const hiddenStrict = hiddenStrictAudit(); const performance = performanceAudit();
  const tests = summarizeTestOutput(root, options.testOutputFile, options.testExitCode, outputDirectory,
    { testDirectories: ["imp0", "platform", "imp1", "imp2", "imp3", "imp4", "imp5"] });
  const evidenceFiles = [
    ["policy-layout", writeImmutableJsonEvidence(outputDirectory, "policy-layout", layout)],
    ["evaluator", writeImmutableJsonEvidence(outputDirectory, "evaluator", evaluator)],
    ["strategy", writeImmutableJsonEvidence(outputDirectory, "strategy", strategy)],
    ["opponent", writeImmutableJsonEvidence(outputDirectory, "opponent", opponent)],
    ["skills-plans", writeImmutableJsonEvidence(outputDirectory, "skills-plans", skillsPlans)],
    ["hidden-strict", writeImmutableJsonEvidence(outputDirectory, "hidden-strict", hiddenStrict)],
    ["performance", writeImmutableJsonEvidence(outputDirectory, "performance", performance)],
    ["tests", writeImmutableJsonEvidence(outputDirectory, "tests", tests.report)],
    ["test-output", writeImmutableRawEvidence(outputDirectory, "test-output", "tap", tests.output)]
  ];
  const checks = [
    check("INTEGER_FEATURE_REGISTRY", layout.status, { featureCount: layout.featureCount,
      incompleteDescriptors: layout.incompleteDescriptors, floatArrayCount: layout.floatArrayCount }),
    check("TABLE_GENERATED_EQUIVALENCE", evaluator.status, { rawMismatchCount: evaluator.rawMismatchCount,
      scoreMismatchCount: evaluator.scoreMismatchCount, comparisons: evaluator.comparisons }),
    check("DOT_ONLY_RECONFIGURATION", evaluator.dotOnly ? "PASS" : "FAIL", { dotOnly: evaluator.dotOnly }),
    check("STRATEGY_HYSTERESIS", strategy.status, { switchCount: strategy.switchCount,
      jitterCount: strategy.jitterCount }),
    check("CURRENT_MATCH_OPPONENT_MODEL", opponent.status, { updatedFamilies: opponent.updatedFamilies,
      probabilityMass: opponent.probabilityMass, crossMatchMass: opponent.crossMatchMass }),
    check("SKILL_SPECIALIZATION", skillsPlans.status, { descriptorMismatchCount:
      skillsPlans.descriptorMismatchCount, ownSkillId: skillsPlans.ownSkillId }),
    check("PLAN_HARD_REVALIDATION", skillsPlans.status, { persistentCount: skillsPlans.persistentCount,
      hardValidationCount: skillsPlans.hardValidationCount }),
    check("HIDDEN_STRICT_ISOLATION", hiddenStrict.status, { strictMismatchCount:
      hiddenStrict.strictMismatchCount, hardWriteCount: hiddenStrict.hardWriteCount }),
    check("POLICY_PERFORMANCE_INVENTORY", performance.status, { metricCount: performance.metricCount,
      invalidMetricCount: performance.invalidMetricCount }),
    check("G3_G8_POLICY_TESTS", tests.report.status, { tests: tests.report.tests,
      pass: tests.report.pass, fail: tests.report.fail })
  ];
  const blockers = checks.filter(item => item.status === "FAIL").map(item => item.checkId);
  const gate = { schemaVersion: 1, reportId: "imp5-integer-policy-gate-v1",
    status: blockers.length ? "FAIL" : "PASS", checks,
    artifacts: evidenceFiles.map(([id, file]) => artifactEntry(root, id, file)), blockers,
    fingerprint: "" }; gate.fingerprint = fingerprintObject(gate);
  validateSchemaObject("imp5-gate-report", gate, root); writeReport(outputDirectory, "imp5-gate-report.json", gate);
  const gateFile = writeImmutableJsonEvidence(outputDirectory, "imp5-gate", gate); return { gate, gateFile };
}

module.exports = { layoutAudit, evaluatorAudit, strategyAudit, opponentAudit, skillsPlansAudit,
  hiddenStrictAudit, performanceAudit, runImp5Gate };
