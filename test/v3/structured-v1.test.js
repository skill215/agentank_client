"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ACTION } = require("../../engine-v2/src/abi/fast-codes");
const { SUPPORT_STATUS, SUCCESSOR_PROOF } =
  require("../../engine-v2/src/runtime/escape-obligation");
const { PLAN_KIND, PLAN_PURPOSE } = require("../../engine-v2/src/abi/policy-codes");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");
const { V3_COMPONENT_ABI, V3_SLOT, V3_PORTS, actionFromLegacy, actionToLegacy,
  V3_COMPONENT_MODE, ComponentRegistry, LegacyV1Runtime, StructuredV1Controller,
  V2ContactAttackAdapter, V2BridgeKernel, V2TacticalContactAdapter, ComponentResult,
  V2HardFinalAdapter, V2CommittedEscapeOwner, V2CommittedRescueShadowAdapter,
  V2CommittedRescueFinalAdapter,
  ProposalBus, V3_PROPOSAL_CLASS,
  V3_RESULT_STATUS, V3_EVIDENCE, V2CombatAttackOwner, V2VerifiedAttackOwner,
  V2OrderedRescueAttackFinalAdapter, V2PreemptiveSafetyShadowAdapter,
  SOFT_SAFETY_SUPPORT, V2StabilityShadowOwner,
  V2StrategicNavigationAdapter,
  V2RescueStabilityShadowFinalAdapter, V2RescueStabilityFinalAdapter } =
  require("../../engine-v3/src");
const { OWNERSHIP_STAGE, V1OwnershipTrace, OwnershipTraceComponent } =
  require("../../engine-v3/src/ownership-trace");
const { SHADOW_MODE, NATIVE_CONTROL_PORT, NativeControlModeShadow } =
  require("../../engine-v3/src/native-control-shadow");
const { NativeHierarchicalRoot } = require("../../engine-v3/src/native-hierarchical-root");
const { buildNativeV1Module } =
  require("../../tools/agentank/diagnostics/v3-native-build");
const { maximumMemoryFixture, typedArrayBytes } =
  require("../../tools/agentank/build/imp6-builder");
const { V2TacticalCoreAdapter } = require("../../engine-v3/src/adapters/v2-tactical-core");
const { V2NativeBasePolicyTacticalAdapter } = require(
  "../../engine-v3/src/adapters/v2-native-base-policy-tactical");
const { RECOVERY_VERIFY_STATUS, RecoveryProposalVerifier } =
  require("../../engine-v3/src/recovery-proposal-verifier");
const { OPTION_CERTIFICATE_STATUS, OPTION_CERTIFICATE_REASON,
  OptionPolicyCertificate } = require("../../engine-v3/src/option-policy-certificate");
const { resolveFrozenV1 } = require("../../engine-v3/src/legacy/default-source");
const { validateManifest } = require("../../tools/agentank/diagnostics/v3-component-cohort");
const { v3OptionsFor } = require("../../tools/agentank/diagnostics/v1-v3-arena");
const { componentOptions, analysisResult } =
  require("../../tools/agentank/diagnostics/v3-component-arena");

function boxedMap(width = 11, height = 7) {
  return Array.from({ length: width }, (_, x) => Array.from({ length: height }, (_, y) =>
    x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "x" : "."));
}

function snapshot(id, position, direction, skill = "stun") {
  return { tank: { id, position: position.slice(), direction, crashed: false },
    stars: 0, bullet: null, skill: { type: skill, remainingCooldownFrames: 0 },
    effects: { self: null, debuff: null }, status: { shielded: false, frozen: false,
      stunned: false, overloaded: false, cloaked: false, poisoned: false,
      boosted: false, fireLocked: false, bombActive: false, bombCooldownFrames: 0,
      canActThisFrame: true, actionSpeed: 1 } };
}

function capture(snapshotValue) {
  const actions = [];
  return { me: { ...snapshotValue,
    go() { actions.push("GO"); }, turn(side) { actions.push(side === "left" ? "LEFT" : "RIGHT"); },
    fire() { actions.push("FIRE"); }, throwBomb() { actions.push("BOMB"); },
    stun() { actions.push("STUN"); } }, actions };
}

function context(frame, own = [2, 3], enemy = [8, 3]) {
  return { me: snapshot("own", own, "right"), enemy: snapshot("enemy", enemy, "left", "poison"),
    game: { frames: frame, map: boxedMap(), star: [5, 5], bombs: [] } };
}

test("V3 action ABI is the V2 numeric ABI", () => {
  assert.equal(actionFromLegacy("GO"), ACTION.GO);
  assert.equal(actionFromLegacy("LEFT"), ACTION.TURN_LEFT);
  assert.equal(actionFromLegacy("FIRE"), ACTION.FIRE);
  assert.equal(actionFromLegacy("STUN"), ACTION.CAST_STUN);
  assert.equal(actionToLegacy(ACTION.THROW_BOMB), "BOMB");
  assert.equal(actionFromLegacy(null), ACTION.NONE);
});

test("VC0 cohort is immutable, unique, and split 16 Discovery plus 48 Holdout", () => {
  const file = path.resolve(__dirname, "../../config/engine-v3/vc0-scenario-manifest.json");
  const manifest = validateManifest(JSON.parse(fs.readFileSync(file, "utf8")));
  assert.equal(manifest.contract.scenarioCount, 64);
  assert.equal(manifest.contract.matchCount, 128);
  assert.equal(manifest.scenarios.filter(item => item.role === "DISCOVERY").length, 16);
  assert.equal(manifest.scenarios.filter(item => item.role === "HOLDOUT").length, 48);
  assert.equal(manifest.scenarios.filter(item => item.sourceClass === "NEW_HISTORY").length, 16);
  assert.equal(new Set(manifest.scenarios.map(item => item.matchUrlId)).size, 64);
  assert.equal(new Set(manifest.scenarios.map(item => item.scenarioFingerprint)).size, 64);
});

test("component results are reused in place and incomplete support stays explicit", () => {
  const result = new ComponentResult();
  const identity = result.set(3, ACTION.FIRE, 7, false, 4, 19);
  assert.equal(identity, result);
  result.reset();
  assert.equal(result.status, 0);
  assert.equal(result.action, ACTION.NONE);
  assert.equal(result.supportComplete, false);
  assert.equal(result.workUnits, 0);
});

test("V3R1 ProposalBus converts an unproved NONE proposal to NO_PROPOSAL", () => {
  const bus = new ProposalBus(); bus.beginFrame(7);
  const result = new ComponentResult(bus, V3_SLOT.NAVIGATION, true);
  result.set(V3_RESULT_STATUS.PROPOSED, ACTION.NONE, -1, true,
    V3_EVIDENCE.OBSERVATION_COMPLETE, 1, V3_PROPOSAL_CLASS.STRATEGIC_PROGRESS);
  assert.equal(result.status, V3_RESULT_STATUS.NO_PROPOSAL);
  assert.equal(bus.eligible[V3_SLOT.NAVIGATION], 0);
  assert.equal(bus.proposedNoneViolationCount, 1);
  assert.ok(bus.bytes() <= 256);
});

test("V3R1 intentional wait is the only selectable NONE proposal", () => {
  const bus = new ProposalBus(); bus.beginFrame(8);
  const result = new ComponentResult(bus, V3_SLOT.NAVIGATION, true);
  result.set(V3_RESULT_STATUS.PROPOSED, ACTION.NONE, -1, true,
    V3_EVIDENCE.INTENTIONAL_WAIT, 1, V3_PROPOSAL_CLASS.INTENTIONAL_WAIT);
  assert.equal(result.status, V3_RESULT_STATUS.PROPOSED);
  assert.equal(bus.eligible[V3_SLOT.NAVIGATION], 1);
});

test("V3R1 only the final arbiter may mark a proposal selected", () => {
  const bus = new ProposalBus(); bus.beginFrame(9);
  const result = new ComponentResult(bus, V3_SLOT.DIRECT_ATTACK, true);
  result.set(V3_RESULT_STATUS.SELECTED, ACTION.FIRE, -1, true,
    V3_EVIDENCE.OBSERVATION_COMPLETE, 1, V3_PROPOSAL_CLASS.VERIFIED_ATTACK);
  assert.equal(result.status, V3_RESULT_STATUS.PROPOSED);
  assert.equal(bus.selectedOwnershipViolationCount, 1);
});

test("V3R1 final arbiter selects the highest-priority complete Hard-allowed proposal", () => {
  const value = context(10, [2, 3], [8, 3]);
  const bridge = new V2BridgeKernel(); bridge.prepare(value.me, value.enemy, value.game);
  bridge.proposals.write(V3_SLOT.NAVIGATION, V3_RESULT_STATUS.PROPOSED, ACTION.GO, -1,
    V3_PROPOSAL_CLASS.STRATEGIC_PROGRESS, true, V3_EVIDENCE.OBSERVATION_COMPLETE, 1, true);
  bridge.proposals.write(V3_SLOT.TACTICAL_SEARCH, V3_RESULT_STATUS.PROPOSED, ACTION.FIRE, -1,
    V3_PROPOSAL_CLASS.STRICT_FORCED_WIN, true,
    V3_EVIDENCE.PHYSICAL_HARD | V3_EVIDENCE.STRICT_PROOF, 2, true);
  const arbiter = new V2HardFinalAdapter(bridge, V3_COMPONENT_MODE.ACTIVE);
  assert.equal(arbiter.invoke({ next() { return "RIGHT"; } }), "FIRE");
  assert.equal(arbiter.result.status, V3_RESULT_STATUS.SELECTED);
  assert.equal(arbiter.result.proposalClass, V3_PROPOSAL_CLASS.STRICT_FORCED_WIN);
  assert.equal(arbiter.proposalSelectionCount, 1);
});

test("selected exact tactical proposal can arm its existing Plan for ACTION_EMIT", () => {
  const value = context(10, [2, 3], [8, 3]);
  const bridge = new V2BridgeKernel(); bridge.prepare(value.me, value.enemy, value.game);
  const fire = bridge.actions.findIndex(action => action === ACTION.FIRE);
  bridge.engine.ourCount = bridge.actionCount;
  const sketch = bridge.engine.policy.sketches.create(PLAN_KIND.SHOT,
    PLAN_PURPOSE.DIRECT_KILL, ACTION.FIRE, 0xffff, 14, 1, 7, 100);
  bridge.engine.planSketchHandle[fire] = sketch;
  bridge.proposals.write(V3_SLOT.TACTICAL_SEARCH, V3_RESULT_STATUS.PROPOSED, ACTION.FIRE, -1,
    V3_PROPOSAL_CLASS.EXACT_VALUE_DOMINANCE, true,
    V3_EVIDENCE.OBSERVATION_COMPLETE, 2, true);
  const arbiter = new V2HardFinalAdapter(bridge, V3_COMPONENT_MODE.ACTIVE,
    { commitSelectedTacticalPlans: true });
  assert.equal(arbiter.invoke({ next() { return "RIGHT"; } }), "FIRE");
  assert.equal(bridge.pendingTacticalIndex, fire);
  assert.equal(arbiter.tacticalPlanCommitArmedCount, 1);
  bridge.recordEmissionFromPending("FIRE");
  assert.equal(bridge.engine.planCommitCount, 1);
});

test("strict tactical navigation Plan becomes an active bounded handoff", () => {
  const value = context(10, [2, 3], [8, 3]);
  const bridge = new V2BridgeKernel({ engineOptions: {
    diagnosticPersistentNavigationPlans: true } });
  bridge.prepare(value.me, value.enemy, value.game);
  const turn = bridge.actions.findIndex(action => action === ACTION.TURN_RIGHT);
  bridge.engine.ourCount = bridge.actionCount;
  const sketch = bridge.engine.policy.sketches.create(PLAN_KIND.NAVIGATION,
    PLAN_PURPOSE.REPOSITION, ACTION.TURN_RIGHT, 0xffff, 14, 1, 7, 100);
  bridge.engine.planSketchHandle[turn] = sketch;
  bridge.proposals.write(V3_SLOT.TACTICAL_SEARCH, V3_RESULT_STATUS.PROPOSED,
    ACTION.TURN_RIGHT, -1, V3_PROPOSAL_CLASS.EXACT_VALUE_DOMINANCE, true,
    V3_EVIDENCE.OBSERVATION_COMPLETE, 2, true);
  const arbiter = new V2HardFinalAdapter(bridge, V3_COMPONENT_MODE.ACTIVE,
    { commitSelectedTacticalPlans: true });
  assert.equal(arbiter.invoke({ next() { return "GO"; } }), "RIGHT");
  bridge.recordEmissionFromPending("RIGHT");
  assert.equal(bridge.hasActiveTacticalHandoff(), true);
  assert.equal(bridge.tacticalHandoffCommitCount, 1);
  assert.equal(bridge.hasTacticalRecoveryWindow(), true);
  assert.equal(bridge.tacticalRecoveryDeadline, 14);
  assert.equal(bridge.tacticalRecoveryKind, PLAN_KIND.NAVIGATION);
  assert.equal(bridge.tacticalRecoveryPurpose, PLAN_PURPOSE.REPOSITION);
  assert.equal(bridge.tacticalRecoveryTargetSignature, 7);
  bridge.tacticalRecoveryDeadline = 9;
  assert.equal(bridge.hasTacticalRecoveryWindow(), false);
});

test("recovery ownership is bounded by the original deadline and Plan identity", () => {
  const value = context(10, [2, 3], [8, 3]);
  const bridge = new V2BridgeKernel({ engineOptions: {
    diagnosticPersistentNavigationPlans: true } });
  bridge.prepare(value.me, value.enemy, value.game);
  const right = bridge.actions.findIndex(action => action === ACTION.TURN_RIGHT);
  bridge.engine.ourCount = bridge.actionCount;
  const original = bridge.engine.policy.sketches.create(PLAN_KIND.NAVIGATION,
    PLAN_PURPOSE.REPOSITION, ACTION.TURN_RIGHT, 0xffff, 14, 0x1234, 17, 100);
  bridge.engine.planSketchHandle[right] = original;
  bridge.pendingTacticalIndex = right; bridge.pendingTacticalPlan = true;
  bridge.recordEmissionFromPending("RIGHT");
  assert.equal(bridge.tacticalRecoveryDeadline, 14);

  bridge.prepare(value.me, value.enemy, { ...value.game, frames: 11 });
  const matching = bridge.actions.findIndex(action => action === ACTION.TURN_RIGHT);
  bridge.engine.ourCount = bridge.actionCount;
  const same = bridge.engine.policy.sketches.create(PLAN_KIND.NAVIGATION,
    PLAN_PURPOSE.REPOSITION, ACTION.TURN_RIGHT, 0xffff, 14, 0x1234, 17, 1);
  bridge.engine.planSketchHandle[matching] = same;
  assert.equal(bridge.matchesTacticalRecoveryPlan(matching), true);
  bridge.engine.policy.sketches.targetSignature[same] = 18;
  assert.equal(bridge.matchesTacticalRecoveryPlan(matching), false);
  bridge.engine.policy.sketches.targetSignature[same] = 17;
  bridge.engine.policy.sketches.rawScore[same] = 0;
  assert.equal(bridge.matchesTacticalRecoveryPlan(matching), false);

  bridge.engine.policy.sketches.rawScore[same] = 1;
  bridge.frame = 15;
  assert.equal(bridge.matchesTacticalRecoveryPlan(matching), false);
});

test("recovery continuation cannot increase any Risk ownership dimension", () => {
  const bridge = new V2BridgeKernel(); const engine = bridge.engine;
  engine.ourCount = 2; engine.ourActions[0] = ACTION.GO;
  engine.ourActions[1] = ACTION.TURN_RIGHT;
  const outcome = engine.riskController.outcome; outcome.count = 2;
  outcome.committedFatalMass[0] = 0; outcome.committedFatalMass[1] = 0;
  outcome.immediateFatalMass[0] = 100; outcome.immediateFatalMass[1] = 100;
  outcome.horizonFatalMass[0] = 200; outcome.horizonFatalMass[1] = 150;
  outcome.unknownMass[0] = 300; outcome.unknownMass[1] = 300;
  outcome.escapeSlack[0] = 1; outcome.escapeSlack[1] = 2;
  const adapter = new V2StrategicNavigationAdapter(bridge, V3_COMPONENT_MODE.ACTIVE,
    { requireTacticalRecovery: true });
  assert.equal(adapter.notRiskWorseThanLegacy(1, ACTION.GO), true);
  outcome.unknownMass[1] = 301;
  assert.equal(adapter.notRiskWorseThanLegacy(1, ACTION.GO), false);
});

test("bounded recovery verifier is explicit about same-action and incomplete support", () => {
  const bridge = new V2BridgeKernel(); const verifier = new RecoveryProposalVerifier(
    bridge.engine, { depth: 2, nodeBudget: 64 });
  assert.equal(verifier.verify(null, bridge.engine, -1, ACTION.GO),
    RECOVERY_VERIFY_STATUS.NOT_APPLICABLE);
  bridge.engine.ourCount = 1; bridge.engine.ourActions[0] = ACTION.GO;
  assert.equal(verifier.verify({}, bridge.engine, 0, ACTION.GO),
    RECOVERY_VERIFY_STATUS.NOT_APPLICABLE);
  assert.equal(verifier.sameActionCount, 1);
});

test("recovery verifier distinguishes noninferior equality from strict dominance", () => {
  assert.ok(RECOVERY_VERIFY_STATUS.DOMINATES > RECOVERY_VERIFY_STATUS.NONINFERIOR);
  assert.ok(RECOVERY_VERIFY_STATUS.NONINFERIOR > RECOVERY_VERIFY_STATUS.REFUTED);
});

test("option policy certificate starts empty and fails closed without exact P2 support", () => {
  const certificate = new OptionPolicyCertificate();
  assert.equal(certificate.status, OPTION_CERTIFICATE_STATUS.NONE);
  assert.equal(certificate.build(null, null, -1, {}), OPTION_CERTIFICATE_STATUS.INCOMPLETE);
  assert.equal(certificate.reason, OPTION_CERTIFICATE_REASON.ROOT_SUPPORT);
  assert.equal(certificate.hotAllocationCount, 0);
});

test("option policy certificate coalesces identical observations only for a common action", () => {
  const certificate = new OptionPolicyCertificate();
  assert.equal(certificate.addSuccessor(1, 2, ACTION.GO, 0xffff, 0), 0);
  assert.equal(certificate.addSuccessor(1, 2, ACTION.GO, 0xffff, 0), 0);
  assert.equal(certificate.branchCount, 1);
  assert.equal(certificate.addSuccessor(1, 2, ACTION.TURN_RIGHT, 0xffff, 0), -1);
  assert.equal(certificate.conflictCount, 1);
});

test("complete option policy is copied before execution and lookup is allocation-free", () => {
  const source = new OptionPolicyCertificate();
  source.status = OPTION_CERTIFICATE_STATUS.COMPLETE; source.buildFrame = 10;
  source.rootAction = ACTION.FIRE; source.rootArgument = 0xffff; source.branchCount = 1;
  source.successorHashLo[0] = 11; source.successorHashHi[0] = 12;
  source.action[0] = ACTION.TURN_RIGHT; source.argument[0] = 0xffff;
  const active = new OptionPolicyCertificate();
  assert.equal(active.copyPolicy(source), 1);
  assert.equal(active.lookupKey(11, 12), 0);
  source.action[0] = ACTION.GO;
  assert.equal(active.action[0], ACTION.TURN_RIGHT);
  assert.equal(active.hotAllocationCount, 0);
});

test("V1-shaped leaf evaluator is diagnostic and installs on the physical search only", () => {
  const bridge = new V2BridgeKernel();
  const originalDepth = bridge.engine.depthSearch.heuristic;
  const originalInformation = bridge.engine.informationSearch.heuristic;
  const adapter = new V2TacticalCoreAdapter(bridge, V3_COMPONENT_MODE.SHADOW,
    { leafEvaluator: "v1-policy" });
  assert.ok(adapter.leafEvaluator);
  assert.notEqual(bridge.engine.depthSearch.heuristic, originalDepth);
  assert.equal(bridge.engine.informationSearch.heuristic, originalInformation);
  assert.equal(adapter.leafEvaluator.hotAllocationCount, 0);
});

test("V1 root policy prior is ordering-only and allocates no new slab", () => {
  const bridge = new V2BridgeKernel();
  const adapter = new V2TacticalCoreAdapter(bridge, V3_COMPONENT_MODE.SHADOW,
    { rootPolicyPrior: "v1-action-seed" });
  assert.equal(adapter.rootPolicyPrior, 1);
  assert.equal(bridge.engine.depthSearch.diagnosticRootPriorPrepared, 0);
  assert.equal(adapter.summary().rootPolicyPrior.semantics,
    "V1_ACTION_INITIAL_ROOT_ORDER_THEN_SEARCH_PV");
});

test("VC8 BEST enables only the shared V2 bridge and complete Hard final gate", () => {
  assert.deepEqual(v3OptionsFor("BASE_V3"), {});
  assert.deepEqual(v3OptionsFor("BEST_VC1_VC2"), { enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE });
  assert.throws(() => v3OptionsFor("VC3_NEGATIVE"), /MODE_UNKNOWN/);
});

test("accepted component BEST owns only strict final committed rescue", () => {
  assert.deepEqual(componentOptions("BEST_ACCEPTED_COMPONENTS"), {
    enableV2Bridge: true,
    enableOwnershipTrace: true,
    enableNativeControlShadow: true,
    finalCommittedRescueActive: true
  });
});

test("component arena analysis follows candidate seat when implementation ids are identical", () => {
  const base = { candidateSeat: 1,
    comparison: { challengerImplementation: "V3_PLUS_VC2_HARD_ACTIVE",
      controlImplementation: "V3_PLUS_VC2_HARD_ACTIVE" },
    seatImplementations: ["V3_PLUS_VC2_HARD_ACTIVE", "V3_PLUS_VC2_HARD_ACTIVE"],
    result: { winnerSeat: 0, winnerImplementation: "V3_PLUS_VC2_HARD_ACTIVE",
      reason: "crashed" },
    counts: { stars: [0, 0], crashes: [0, 1] } };
  assert.deepEqual(analysisResult(base), {
    outcome: "CONTROL_WIN", terminalCategory: "SINGLE_CRASH" });
  base.result.winnerSeat = 1;
  base.counts.crashes = [1, 0];
  assert.deepEqual(analysisResult(base), {
    outcome: "CHALLENGER_WIN", terminalCategory: "SINGLE_CRASH" });
});

test("VC0-VC8 acceptance binds the fixed cohort and excludes every negative owner", () => {
  const report = JSON.parse(fs.readFileSync(path.resolve(__dirname,
    "../../config/engine-v3/vc0-vc8-acceptance.json"), "utf8"));
  assert.equal(report.officialPlatformOperationPerformed, false);
  assert.equal(report.cohort.scenarioCount, 64);
  assert.equal(report.stages.length, 9);
  assert.deepEqual(report.stages.find(item => item.stage === "VC8").enabledComponents,
    ["VC1_SHARED_OBSERVATION_BRIDGE", "VC2_COMPLETE_PHYSICAL_HARD_FINAL_GATE"]);
  for (const item of report.stages.filter(stage => stage.classification === "NEGATIVE"))
    assert.equal(item.includeInBest, false);
  assert.ok(report.artifactBudget.allComponentArtifactsBytes <
    report.artifactBudget.allComponentArtifactsMaximumBytes);
});

test("registry rejects an incompatible component and locks after first decision", () => {
  const registry = new ComponentRegistry();
  assert.throws(() => registry.replace(V3_SLOT.DIRECT_ATTACK,
    { slot: V3_SLOT.DIRECT_ATTACK, invoke() {} }), /CONTRACT_MISMATCH/);
  const frozen = resolveFrozenV1();
  const controller = new StructuredV1Controller({ source: frozen.source,
    sourceFile: frozen.sourceFile, sourceSha256: frozen.sha256, registry });
  const value = context(0); const own = capture(value.me);
  controller.decide(own.me, value.enemy, value.game);
  assert.throws(() => controller.replace(V3_SLOT.DIRECT_ATTACK,
    { abi: V3_COMPONENT_ABI, slot: V3_SLOT.DIRECT_ATTACK, invoke(call) { return call.next(); } }),
  /REGISTRY_LOCKED/);
});

test("all default V3 ports preserve the frozen V1 action stream", () => {
  const frozen = resolveFrozenV1();
  const raw = new LegacyV1Runtime({ source: frozen.source, sourceIdentity: frozen.sha256,
    filename: frozen.sourceFile });
  const structured = new StructuredV1Controller({ source: frozen.source,
    sourceFile: frozen.sourceFile, sourceSha256: frozen.sha256 });
  const frames = [context(0), context(1, [3, 3], [8, 3]),
    context(2, [3, 3], [7, 3]), context(3, [3, 4], [7, 3])];
  const rawActions = []; const structuredActions = [];
  for (const value of frames) {
    const left = capture(value.me); const right = capture(value.me);
    raw.decide(left.me, value.enemy, value.game);
    structured.decide(right.me, value.enemy, value.game);
    rawActions.push(left.actions[0]); structuredActions.push(right.actions[0]);
  }
  assert.deepEqual(structuredActions, rawActions);
  const summary = structured.summary();
  assert.equal(summary.sourceSha256, frozen.sha256);
  assert.equal(summary.replacementMask, 0);
  assert.equal(summary.ports.length, V3_PORTS.length);
  assert.ok(summary.ports.some(port => port.calls > 0));
  assert.equal(summary.ports[V3_SLOT.FRAME_PREPARE].calls, frames.length);
  assert.equal(summary.ports[V3_SLOT.ACTION_EMIT].calls, frames.length);
});

test("ownership trace observes V1 stage ownership without changing its action", () => {
  const frozen = resolveFrozenV1();
  const raw = new StructuredV1Controller({ source: frozen.source,
    sourceFile: frozen.sourceFile, sourceSha256: frozen.sha256 });
  const traced = new StructuredV1Controller({ source: frozen.source,
    sourceFile: frozen.sourceFile, sourceSha256: frozen.sha256,
    enableOwnershipTrace: true });
  const value = context(0, [2, 3], [8, 3]);
  const left = capture(value.me); const right = capture(value.me);
  raw.decide(left.me, value.enemy, value.game);
  traced.decide(right.me, value.enemy, value.game);
  assert.deepEqual(right.actions, left.actions);
  const ownership = traced.summary().ownership;
  assert.equal(ownership.decisionCount, 1);
  assert.equal(ownership.emissionCount, 1);
  assert.equal(ownership.unattributedCount, 0);
  assert.equal(Object.values(ownership.stages).reduce((sum, count) => sum + count, 0), 1);
});

test("ownership trace attributes nested navigation and final overrides correctly", () => {
  const trace = new V1OwnershipTrace();
  const navigation = new OwnershipTraceComponent(V3_SLOT.NAVIGATION,
    { id: "NAV", invoke(call) {
      const emit = new OwnershipTraceComponent(V3_SLOT.ACTION_EMIT,
        { id: "EMIT", invoke() { return undefined; } }, trace);
      emit.invoke({ requestedAction: "GO" });
      return call.next();
    } }, trace);
  trace.beginDecision(1);
  navigation.invoke({ next() { return undefined; } });
  trace.finishDecision();
  assert.equal(trace.frameSnapshot().stage, OWNERSHIP_STAGE.NAVIGATION);

  const override = new V1OwnershipTrace();
  override.beginDecision(2);
  override.recordRequested("FIRE");
  override.recordReturn(V3_SLOT.FINAL_ACTION_GATE, "GO", "FIRE");
  override.finishDecision();
  assert.equal(override.frameSnapshot().stage, OWNERSHIP_STAGE.FINAL_ACTION_GATE);
  assert.equal(override.frameSnapshot().resolvedAction, ACTION.GO);
  assert.equal(override.summary().finalOverrideCount, 1);
});

test("native control shadow classifies the physical prefix without search or mutation", () => {
  const value = context(3, [2, 3], [8, 3]);
  const bridge = new V2BridgeKernel();
  bridge.prepare(value.me, value.enemy, value.game);
  const before = bridge.bundle.state.rootSignature();
  const shadow = new NativeControlModeShadow();
  assert.equal(shadow.observe(bridge), SHADOW_MODE.TACTICAL_CONTACT);
  assert.equal(bridge.bundle.state.rootSignature(), before);
  const summary = shadow.summary();
  assert.equal(summary.observeCount, 1);
  assert.equal(summary.incompleteCount, 0);
  assert.equal(summary.rootRestoreFailureCount, 0);
  assert.equal(summary.searchNodeCount, 0);
  assert.equal(summary.modes.TACTICAL_CONTACT, 1);
  assert.ok(shadow.lastPortMask & NATIVE_CONTROL_PORT.TACTICAL_EVIDENCE);
  assert.ok(shadow.lastPortMask & NATIVE_CONTROL_PORT.NAVIGATION);
  assert.equal(summary.ports.OVERLAP, 1);
  assert.equal(Buffer.from(summary.modeStream, "base64").length, 1);
});

test("V3R8 generated native root is VM-free and action-equivalent to V3_BEST", () => {
  const nativeManifest = buildNativeV1Module(path.resolve(__dirname, "../.."));
  const structured = new StructuredV1Controller({ enableV2Bridge: true,
    hardFinalMode: V3_COMPONENT_MODE.ACTIVE });
  const native = new NativeHierarchicalRoot({ nativeManifest,
    workspaceRoot: path.resolve(__dirname, "../..") });
  const frames = [context(0), context(1, [3, 3], [8, 3]),
    context(2, [3, 3], [7, 3]), context(3, [3, 4], [7, 3])];
  const structuredActions = []; const nativeActions = [];
  for (const value of frames) {
    const left = capture(value.me); const right = capture(value.me);
    structured.decide(left.me, value.enemy, value.game);
    native.decide(right.me, value.enemy, value.game);
    structuredActions.push(left.actions[0]); nativeActions.push(right.actions[0]);
  }
  assert.deepEqual(nativeActions, structuredActions);
  assert.equal(native.summary().vmDependency, false);
  assert.equal(fs.readFileSync(nativeManifest.moduleFile, "utf8").includes("node:vm"), false);
});

test("V3R8 native hierarchy stays below the old root cap with one shared RiskProfile", () => {
  const nativeManifest = buildNativeV1Module(path.resolve(__dirname, "../.."));
  const native = new NativeHierarchicalRoot({ nativeManifest,
    workspaceRoot: path.resolve(__dirname, "../..") });
  const fixture = maximumMemoryFixture();
  native.bridge.engine.adapter.adapt(fixture.me, fixture.enemy, fixture.game);
  const engineBytes = typedArrayBytes(native.bridge.engine);
  assert.ok(engineBytes < 999280);
  assert.ok(typedArrayBytes(native) <= 999280);
  assert.equal(native.bridge.engine.search.value.risk.profile, native.bridge.engine.riskProfile);
  assert.equal(native.bridge.engine.informationSearch.risk, native.bridge.engine.riskProfile);
  assert.equal(native.bridge.engine.riskController.riskProfile, native.bridge.engine.riskProfile);
  assert.equal(native.bridge.proposals.bytes(), 210);
  assert.equal(native.bridge.proposals.allocatedBytes(), 210);
});

test("V1 instrumentation requires exactly one verified replacement point", () => {
  const frozen = resolveFrozenV1();
  const broken = frozen.source.replace("  updateEnemyProjectileTracking(me, enemy, game);\n", "");
  assert.throws(() => new StructuredV1Controller({ source: broken }),
    /V3_V1_INSTRUMENTATION_ANCHOR:FRAME_PREPARE/);
});

test("shared V2 bridge shadow observes once and preserves every V1 action", () => {
  const frozen = resolveFrozenV1();
  const raw = new LegacyV1Runtime({ source: frozen.source, sourceIdentity: frozen.sha256,
    filename: frozen.sourceFile });
  const structured = new StructuredV1Controller({ source: frozen.source,
    sourceFile: frozen.sourceFile, sourceSha256: frozen.sha256, enableV2Bridge: true });
  const frames = [context(0), context(1, [3, 3], [8, 3]),
    context(2, [3, 3], [7, 3]), context(3, [3, 4], [7, 3])];
  const rawActions = []; const structuredActions = [];
  for (const value of frames) {
    const left = capture(value.me); const right = capture(value.me);
    raw.decide(left.me, value.enemy, value.game);
    structured.decide(right.me, value.enemy, value.game);
    rawActions.push(left.actions[0]); structuredActions.push(right.actions[0]);
  }
  assert.deepEqual(structuredActions, rawActions);
  const summary = structured.summary();
  assert.equal(summary.bridge.prepareCount, frames.length);
  assert.equal(summary.bridge.adapterHotAllocationCount, 0);
  assert.equal(summary.bridge.engineHotAllocationCount, 0);
  assert.equal(summary.ports[V3_SLOT.FRAME_PREPARE].calls, frames.length);
  assert.equal(summary.ports[V3_SLOT.ACTION_EMIT].calls, frames.length);
});

test("proposal-only capture resolves V1 action without emission or history mutation", () => {
  const controller = new StructuredV1Controller({ enableV2Bridge: true });
  const value = context(0); const own = capture(value.me);
  controller.bridge.prepare(value.me, value.enemy, value.game);
  const sandbox = controller.runtime.sandbox;
  const before = sandbox.AT_LAST_ACTION;
  sandbox.V3_CAPTURE_ACTION = true;
  sandbox.executeAction(own.me, "GO", value.enemy, value.game);
  sandbox.V3_CAPTURE_ACTION = false;
  assert.ok(["GO", "LEFT", "RIGHT", "FIRE", "STUN", "BOMB"]
    .includes(sandbox.V3_CAPTURED_ACTION));
  assert.equal(sandbox.AT_LAST_ACTION, before);
  assert.equal(own.actions.length, 0);
  assert.equal(controller.bridge.prepared, true);
  sandbox.executeAction(own.me, sandbox.V3_CAPTURED_ACTION, value.enemy, value.game);
  assert.deepEqual(own.actions, [sandbox.V3_CAPTURED_ACTION]);
  assert.equal(controller.bridge.prepared, false);
});

test("TACTICAL_CONTACT owns the root contact expression and falls back on incomplete support", () => {
  const bridge = new V2BridgeKernel();
  const adapter = new V2TacticalContactAdapter(bridge, V3_COMPONENT_MODE.ACTIVE);
  const fallback = adapter.invoke({ legacyContact: true });
  assert.equal(fallback, true);
  assert.equal(adapter.fallbackCount, 1);
});

test("VC2 Hard adapter overrides only a complete physically rejected V1 preference", () => {
  const bridge = new V2BridgeKernel();
  const me = snapshot("own", [3, 2], "up");
  const enemy = snapshot("enemy", [5, 3], "left");
  enemy.bullet = { position: [1, 2], direction: "right" };
  bridge.prepare(me, enemy, { frames: 4, map: boxedMap(7, 5), star: null, bombs: [] });
  assert.equal(bridge.supportComplete, true);
  const adapter = new V2HardFinalAdapter(bridge, V3_COMPONENT_MODE.ACTIVE);
  const selected = adapter.invoke({ next() { return "RIGHT"; } });
  assert.equal(selected, "GO");
  assert.equal(adapter.preferredRejectedCount, 1);
  assert.equal(adapter.overrideCount, 1);
  assert.equal(bridge.engine.adapter.hard.rootMismatchCount, 0);
});

test("VC3 committed escape proposes for a real projectile but never bypasses final ownership", () => {
  const bridge = new V2BridgeKernel();
  const me = snapshot("own", [3, 2], "up");
  const enemy = snapshot("enemy", [5, 3], "left");
  enemy.bullet = { position: [1, 2], direction: "right" };
  bridge.prepare(me, enemy, { frames: 4, map: boxedMap(7, 5), star: null, bombs: [] });
  const owner = new V2CommittedEscapeOwner(bridge, V3_COMPONENT_MODE.ACTIVE);
  assert.equal(owner.invoke(V3_SLOT.VISIBLE_PROJECTILE_SAFETY,
    { next() { return "RIGHT"; } }), "RIGHT");
  assert.equal(bridge.proposals.status[V3_SLOT.VISIBLE_PROJECTILE_SAFETY],
    V3_RESULT_STATUS.PROPOSED);
  assert.equal(bridge.proposals.proposalClass[V3_SLOT.VISIBLE_PROJECTILE_SAFETY],
    V3_PROPOSAL_CLASS.COMMITTED_RESCUE);

  const clean = new V2BridgeKernel();
  clean.prepare(me, snapshot("enemy-2", [5, 3], "left"),
    { frames: 4, map: boxedMap(7, 5), star: null, bombs: [] });
  const possibleOnly = new V2CommittedEscapeOwner(clean, V3_COMPONENT_MODE.ACTIVE);
  assert.equal(possibleOnly.invoke(V3_SLOT.VISIBLE_PROJECTILE_SAFETY,
    { next() { return "RIGHT"; } }), "RIGHT");
  assert.equal(possibleOnly.overrideCount, 0);
});

test("V3R3 final EO rescues only a V1 action proved dead by complete committed support", () => {
  const bridge = new V2BridgeKernel();
  const me = snapshot("own", [3, 2], "up");
  const enemy = snapshot("enemy", [5, 3], "left");
  enemy.bullet = { position: [1, 2], direction: "right" };
  bridge.prepare(me, enemy, { frames: 4, map: boxedMap(7, 5), star: null, bombs: [] });
  const rescue = new V2CommittedEscapeOwner(bridge, V3_COMPONENT_MODE.ACTIVE);
  const arbiter = new V2HardFinalAdapter(bridge, V3_COMPONENT_MODE.ACTIVE,
    { rescueOwner: rescue });
  assert.equal(arbiter.invoke({ next() { return "RIGHT"; } }), "GO");
  assert.equal(arbiter.selectedByClass[V3_PROPOSAL_CLASS.COMMITTED_RESCUE], 1);

  const safeBridge = new V2BridgeKernel();
  safeBridge.prepare(me, snapshot("enemy-safe", [5, 3], "left"),
    { frames: 4, map: boxedMap(7, 5), star: null, bombs: [] });
  const safeArbiter = new V2HardFinalAdapter(safeBridge, V3_COMPONENT_MODE.ACTIVE,
    { rescueOwner: new V2CommittedEscapeOwner(safeBridge, V3_COMPONENT_MODE.ACTIVE) });
  assert.equal(safeArbiter.invoke({ next() { return "RIGHT"; } }), "RIGHT");
  assert.equal(safeArbiter.selectedByClass[V3_PROPOSAL_CLASS.COMMITTED_RESCUE], 0);
});

test("committed rescue shadow records a certified alternative without taking ownership", () => {
  const bridge = new V2BridgeKernel();
  const me = snapshot("own-shadow", [3, 2], "up");
  const enemy = snapshot("enemy-shadow", [5, 3], "left");
  enemy.bullet = { position: [1, 2], direction: "right" };
  bridge.prepare(me, enemy, { frames: 5, map: boxedMap(7, 5), star: null, bombs: [] });
  const owner = new V2CommittedEscapeOwner(bridge, V3_COMPONENT_MODE.SHADOW);
  const adapter = new V2CommittedRescueShadowAdapter(bridge, owner);
  assert.equal(adapter.invoke({ next() { return "RIGHT"; } }), "RIGHT");
  const summary = owner.summary();
  assert.equal(summary.preferredProvenDeadCount, 1);
  assert.equal(summary.finalProposalCount, 1);
  assert.equal(summary.finalSelectedViableCount, 1);
  assert.equal(Buffer.from(summary.finalProposalActionStream, "base64")[0], ACTION.GO);
  assert.equal(bridge.pendingResolvedAction, ACTION.TURN_RIGHT);
});

test("committed rescue active changes only a proved-dead action to a proved-viable action", () => {
  const bridge = new V2BridgeKernel();
  const me = snapshot("own-active", [3, 2], "up");
  const enemy = snapshot("enemy-active", [5, 3], "left");
  enemy.bullet = { position: [1, 2], direction: "right" };
  bridge.prepare(me, enemy, { frames: 6, map: boxedMap(7, 5), star: null, bombs: [] });
  const owner = new V2CommittedEscapeOwner(bridge, V3_COMPONENT_MODE.ACTIVE);
  const adapter = new V2CommittedRescueFinalAdapter(bridge, owner);
  assert.equal(adapter.invoke({ next() { return "RIGHT"; } }), "GO");
  assert.equal(adapter.overrideCount, 1);
  assert.equal(bridge.pendingResolvedAction, ACTION.GO);

  const safeBridge = new V2BridgeKernel();
  safeBridge.prepare(me, snapshot("enemy-clean", [5, 3], "left"),
    { frames: 6, map: boxedMap(7, 5), star: null, bombs: [] });
  const safe = new V2CommittedRescueFinalAdapter(safeBridge);
  assert.equal(safe.invoke({ next() { return "RIGHT"; } }), "RIGHT");
  assert.equal(safe.overrideCount, 0);
});

test("committed rescue never revives a stale synthetic NONE row", () => {
  const bridge = new V2BridgeKernel();
  const me = snapshot("own-stale-none", [3, 2], "up");
  const enemy = snapshot("enemy-stale-none", [5, 3], "left");
  enemy.bullet = { position: [1, 2], direction: "right" };
  bridge.prepare(me, enemy, { frames: 7, map: boxedMap(7, 5), star: null, bombs: [] });
  const owner = new V2CommittedEscapeOwner(bridge, V3_COMPONENT_MODE.ACTIVE);
  assert.equal(owner.evaluate(), SUPPORT_STATUS.COMPLETE);
  const escape = bridge.engine.escapeObligation;
  const preferred = owner.indexOf(ACTION.TURN_RIGHT);
  assert.ok(preferred >= 0);
  escape.successorProof[preferred] = SUCCESSOR_PROOF.PROVEN_DEAD;
  for (let row = 0; row < bridge.physicalSelectionCount; row += 1) escape.member[row] = 0;
  const noneRow = bridge.actionCount - 1;
  assert.equal(bridge.actions[noneRow], ACTION.NONE);
  escape.member[noneRow] = 1;
  escape.successorProof[noneRow] = SUCCESSOR_PROOF.PROVEN_VIABLE;
  escape.successorExposed[noneRow] = 0;
  escape.successorSlack[noneRow] = 127;
  escape.successorBranches[noneRow] = 127;
  escape.successorCoverage[noneRow] = 127;
  const adapter = new V2CommittedRescueFinalAdapter(bridge, owner);
  assert.equal(adapter.invoke({ next() { return "RIGHT"; } }), "RIGHT");
  assert.equal(adapter.overrideCount, 0);
  assert.equal(owner.summary().finalProposalCount, 0);
});

test("V3R4 combat may propose only a complete self-escaping attack with no worse exposure", () => {
  const value = context(12, [2, 3], [3, 3]);
  value.enemy.tank.direction = "down";
  const bridge = new V2BridgeKernel(); bridge.prepare(value.me, value.enemy, value.game);
  const combat = new V2CombatAttackOwner(bridge, V3_COMPONENT_MODE.ACTIVE);
  assert.equal(combat.invoke(V3_SLOT.DIRECT_ATTACK,
    { next() { return "RIGHT"; } }), "RIGHT");
  const bus = bridge.proposals;
  assert.equal(bus.proposalClass[V3_SLOT.DIRECT_ATTACK], V3_PROPOSAL_CLASS.VERIFIED_ATTACK);
  if (bus.eligible[V3_SLOT.DIRECT_ATTACK]) {
    assert.equal(bus.action[V3_SLOT.DIRECT_ATTACK], ACTION.FIRE);
    assert.ok(bridge.engine.combat.vector.postFireEscape[combat.selected] > 0);
    assert.equal(bridge.engine.combat.vector.attackClosureStatus[combat.selected], 1);
  }
});

test("verified attack final scans FIRE directly and shadow never takes ownership", () => {
  const value = context(13, [2, 3], [3, 3]);
  value.enemy.tank.direction = "down";
  const bridge = new V2BridgeKernel(); bridge.prepare(value.me, value.enemy, value.game);
  const attack = new V2VerifiedAttackOwner(bridge);
  const rescue = new V2CommittedEscapeOwner(bridge, V3_COMPONENT_MODE.ACTIVE);
  const shadow = new V2OrderedRescueAttackFinalAdapter(bridge, rescue, attack,
    V3_COMPONENT_MODE.SHADOW);
  assert.equal(shadow.invoke({ next() { return "RIGHT"; } }), "RIGHT");
  assert.equal(attack.summary().proposalCount, 1);
  assert.equal(shadow.attackOverrideCount, 0);
  assert.equal(bridge.pendingResolvedAction, ACTION.TURN_RIGHT);
});

test("verified attack active owns only a complete self-escaping reduced enemy response", () => {
  const value = context(14, [2, 3], [3, 3]);
  value.enemy.tank.direction = "down";
  const bridge = new V2BridgeKernel(); bridge.prepare(value.me, value.enemy, value.game);
  const attack = new V2VerifiedAttackOwner(bridge);
  const rescue = new V2CommittedEscapeOwner(bridge, V3_COMPONENT_MODE.ACTIVE);
  const active = new V2OrderedRescueAttackFinalAdapter(bridge, rescue, attack,
    V3_COMPONENT_MODE.ACTIVE);
  assert.equal(active.invoke({ next() { return "RIGHT"; } }), "FIRE");
  assert.equal(active.attackOverrideCount, 1);
  assert.equal(bridge.pendingResolvedAction, ACTION.FIRE);
  assert.equal(bridge.physicalEvidenceBuildCount, 1);
  assert.ok(bridge.physicalEvidenceReuseCount >= 1);
  assert.equal(bridge.combatEvidenceBuildCount, 1);
});

test("verified direct-kill owner exposes the purpose split as a fixed contract", () => {
  const value = context(15, [2, 3], [3, 3]);
  value.enemy.tank.direction = "down";
  const bridge = new V2BridgeKernel(); bridge.prepare(value.me, value.enemy, value.game);
  const attack = new V2VerifiedAttackOwner(bridge, { requireDirectKill: true });
  assert.ok(attack.evaluateFinal(ACTION.TURN_RIGHT) >= 0);
  assert.equal(attack.summary().requireDirectKill, 1);
  assert.equal(attack.summary().directKillCount, 1);
});

test("preemptive Information safety remains Shadow and cannot own an action", () => {
  const value = context(16, [3, 3], [7, 3]);
  value.me.tank.direction = "right";
  value.enemy.tank.direction = "left";
  const bridge = new V2BridgeKernel(); bridge.prepare(value.me, value.enemy, value.game);
  const adapter = new V2PreemptiveSafetyShadowAdapter(bridge, V3_COMPONENT_MODE.SHADOW);
  assert.equal(adapter.invoke({ next() { return "LEFT"; } }), "LEFT");
  const summary = adapter.summary();
  assert.equal(summary.callCount, 1);
  assert.equal(bridge.proposals.eligible[V3_SLOT.PREEMPTIVE_SAFETY], 0);
  assert.notEqual(adapter.lastSupport, SOFT_SAFETY_SUPPORT.INCOMPLETE);
  assert.equal(bridge.pendingResolvedValid, false);
  assert.equal(bridge.softSafetyEvidenceBuildCount, 1);
  assert.equal(bridge.engine.depthSearch.nodes, 0);
  assert.equal(bridge.engine.informationSearch.nodes, 0);
});

test("stability shadow observes a safe fourth turn without overriding rescue or V1", () => {
  const value = context(17, [2, 3], [8, 3]);
  value.enemy.status.fireLocked = true;
  const bridge = new V2BridgeKernel(); bridge.prepare(value.me, value.enemy, value.game);
  bridge.engine.turnStreak = 3;
  const stability = new V2StabilityShadowOwner(bridge);
  const adapter = new V2RescueStabilityShadowFinalAdapter(bridge, stability);
  assert.equal(adapter.invoke({ next() { return "RIGHT"; } }), "RIGHT");
  const summary = stability.summary();
  assert.equal(summary.streakRootCount, 1);
  assert.equal(summary.turnPreferredCount, 1);
  assert.equal(summary.candidateCount, 1);
  assert.equal(bridge.pendingResolvedAction, ACTION.TURN_RIGHT);
  assert.equal(stability.result.status, V3_RESULT_STATUS.PROPOSED);
  assert.equal(stability.result.eligible, false);
});

test("stability active changes only a qualified fourth TURN to GO", () => {
  const value = context(18, [2, 3], [8, 3]);
  value.enemy.status.fireLocked = true;
  const bridge = new V2BridgeKernel(); bridge.prepare(value.me, value.enemy, value.game);
  bridge.engine.turnStreak = 3;
  const adapter = new V2RescueStabilityFinalAdapter(bridge);
  assert.equal(adapter.invoke({ next() { return "LEFT"; } }), "GO");
  assert.equal(adapter.overrideCount, 1);
  assert.equal(bridge.pendingResolvedAction, ACTION.GO);

  const fireBridge = new V2BridgeKernel();
  fireBridge.prepare(value.me, value.enemy, { ...value.game, frames: 19 });
  fireBridge.engine.turnStreak = 3;
  const preserve = new V2RescueStabilityFinalAdapter(fireBridge);
  assert.equal(preserve.invoke({ next() { return "FIRE"; } }), "FIRE");
  assert.equal(preserve.overrideCount, 0);
});

test("VC6 full TacticalCore reports the V2 oracle action but remains evidence-only", () => {
  const value = context(1, [2, 2], [7, 4]);
  value.me.skill.type = "poison";
  const oracleCalls = capture(value.me); oracleCalls.me.poison = () => oracleCalls.actions.push("POISON");
  const oracle = new ProductionRootEngine();
  const oracleAction = oracle.decide(oracleCalls.me, value.enemy, value.game);

  const bridge = new V2BridgeKernel();
  bridge.prepare(value.me, value.enemy, value.game);
  const adapter = new V2TacticalCoreAdapter(bridge, V3_COMPONENT_MODE.ACTIVE);
  const selected = actionFromLegacy(adapter.invoke({ next() { return "RIGHT"; } }));
  assert.equal(selected, ACTION.TURN_RIGHT);
  assert.equal(adapter.result.action, oracleAction);
  assert.equal(adapter.result.status, V3_RESULT_STATUS.PROPOSED);
  assert.equal(bridge.proposals.eligible[V3_SLOT.TACTICAL_SEARCH], 0);
  assert.equal(adapter.exceptionCount, 0);
  assert.equal(bridge.engine.depthSearch.rootRestoreFailures, 0);
  assert.equal(bridge.engine.informationSearch.rootRestoreFailures, 0);
});

test("native BasePolicy tactical adapter owns only the tactical port and corrects intent to emission", () => {
  const value = context(1, [2, 3], [7, 3]);
  const bridge = new V2BridgeKernel();
  bridge.prepare(value.me, value.enemy, value.game);
  const adapter = new V2NativeBasePolicyTacticalAdapter(bridge,
    V3_COMPONENT_MODE.SHADOW);
  const legacy = adapter.invoke({ next() { return "RIGHT"; } });
  assert.equal(legacy, "RIGHT");
  assert.equal(adapter.callCount, 1);
  assert.equal(adapter.exceptionCount, 0);
  bridge.recordResolvedLegacy("GO");
  bridge.recordEmissionFromPending("GO");
  assert.equal(adapter.selectionPrepared, false);
  assert.equal(adapter.root.intent.lastIntentEpoch,
    adapter.root.intent.contextEpoch);
  assert.equal(adapter.summary().kind, "NATIVE_BASE_POLICY_TACTICAL_ONLY");
  assert.equal(bridge.engine.depthSearch.rootRestoreFailures, 0);
});

test("component arena exposes isolated native BasePolicy tactical modes", () => {
  assert.deepEqual(componentOptions("NATIVE_BP_TACTICAL_SHADOW"), {
    enableV2Bridge: true,
    nativeBasePolicyTacticalMode: V3_COMPONENT_MODE.SHADOW
  });
  assert.deepEqual(componentOptions("NATIVE_BP_TACTICAL_ACTIVE"), {
    enableV2Bridge: true,
    nativeBasePolicyTacticalMode: V3_COMPONENT_MODE.ACTIVE
  });
  assert.deepEqual(componentOptions("NATIVE_BP_TACTICAL_INITIATIVE_ACTIVE"), {
    enableV2Bridge: true,
    nativeBasePolicyTacticalMode: V3_COMPONENT_MODE.ACTIVE,
    nativeBasePolicyTacticalOptions: { preserveV1Initiative: true }
  });
  assert.deepEqual(componentOptions("NATIVE_BP_TACTICAL_MONOTONIC_ACTIVE"), {
    enableV2Bridge: true,
    nativeBasePolicyTacticalMode: V3_COMPONENT_MODE.ACTIVE,
    nativeBasePolicyTacticalOptions: { preserveV1Initiative: true,
      preserveV1TurnAgainstGo: true }
  });
});

test("physical cell dominance requires no worse value for every enemy reply", () => {
  const bridge = new V2BridgeKernel();
  const adapter = new V2TacticalCoreAdapter(bridge, V3_COMPONENT_MODE.ACTIVE,
    { ownershipMode: "physical-cell-dominance" });
  const source = { rootScore: new Int32Array(3),
    rootCellScore: new Int32Array(3 * 4) };
  source.rootCellScore.set([5, 4, 3, 2], 0);
  source.rootCellScore.set([6, 4, 3, 3], 4);
  source.rootCellScore.set([8, 3, 8, 8], 8);
  assert.equal(adapter.matrixDominates(source, 1, 0, 4), true);
  assert.equal(adapter.matrixDominates(source, 2, 0, 4), false);
  assert.equal(adapter.matrixDominates(source, 0, 0, 4), false);
  const strict = new V2TacticalCoreAdapter(bridge, V3_COMPONENT_MODE.ACTIVE,
    { ownershipMode: "physical-strict-maximin-dominance" });
  source.rootScore.set([3, 3, 9]);
  assert.equal(strict.physicalDominates(source, 1, 0, 4), false);
  source.rootScore[1] = 4;
  assert.equal(strict.physicalDominates(source, 1, 0, 4), true);
  const depthTwo = new V2TacticalCoreAdapter(bridge, V3_COMPONENT_MODE.ACTIVE,
    { ownershipMode: "physical-strict-maximin-dominance", minimumOwnershipDepth: 2 });
  assert.equal(depthTwo.minimumOwnershipDepth, 2);
  const refined = new V2TacticalCoreAdapter(bridge, V3_COMPONENT_MODE.ACTIVE,
    { ownershipMode: "physical-strict-maximin-dominance", minimumOwnershipDepth: 2,
      refineDepthTwo: true, refinementNodeBudget: 256 });
  assert.equal(refined.refinementRows.length > 0, true);
  assert.equal(refined.refinementNodeBudget, 256);
  const variants = new V2TacticalCoreAdapter(bridge, V3_COMPONENT_MODE.ACTIVE,
    { ownershipMode: "physical-strict-maximin-dominance", minimumOwnershipDepth: 2,
      refineDepthTwo: true, refineMoveVariants: true, refinementNodeBudget: 256 });
  assert.equal(variants.variantKernels.length, 3);
  assert.equal(variants.variantNonWorse.length, refined.refinementRows.length);
});

test("a component replacement owns exactly one V1 decision port", () => {
  const calls = { count: 0 };
  const component = { abi: V3_COMPONENT_ABI, slot: V3_SLOT.DIRECT_ATTACK,
    id: "TEST_DIRECT_ATTACK", invoke(call) { calls.count += 1; return call.next(); } };
  const controller = new StructuredV1Controller({ replacements: [component] });
  const value = context(0, [2, 3], [6, 3]); const own = capture(value.me);
  controller.decide(own.me, value.enemy, value.game);
  assert.equal(calls.count, 1);
  assert.equal(controller.summary().replacementMask, 1 << V3_SLOT.DIRECT_ATTACK);
  assert.equal(controller.summary().ports[V3_SLOT.DIRECT_ATTACK].componentId, "TEST_DIRECT_ATTACK");
});

test("the real V2 ControlModeRouter can replace V3 direct-contact ownership", () => {
  const frozen = resolveFrozenV1();
  const raw = new LegacyV1Runtime({ source: frozen.source, sourceIdentity: frozen.sha256,
    filename: frozen.sourceFile });
  const adapter = new V2ContactAttackAdapter();
  const controller = new StructuredV1Controller({ replacements: [adapter] });
  const near = context(0, [2, 3], [6, 3]);
  const baseline = capture(near.me); const own = capture(near.me);
  baseline.me.stars = 1;
  own.me.stars = 1;
  raw.decide(baseline.me, near.enemy, near.game);
  controller.decide(own.me, near.enemy, near.game);
  assert.equal(adapter.router.classifyCount, 1);
  assert.equal(adapter.tacticalCount, 1);
  assert.equal(adapter.strategicCount, 0);
  assert.equal(own.actions[0], baseline.actions[0]);
});
