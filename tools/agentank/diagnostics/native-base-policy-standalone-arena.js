#!/usr/bin/env node
"use strict";

// Small causal arena for the upload-shaped native engine.  This intentionally
// avoids ProductionDiagnosticBot: importing that host would recreate the
// double stack that BP179 is designed to remove.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const vm = require("node:vm");
const { loadSimulator, DecisionAudit, collectCounts } = require(
  "../simulation/paired-arena");
const { createHistoricalStarProvider } = require(
  "../simulation/historical-scenarios");
const { classifyAnalysisOutcome } = require("../analysis/analysis-outcome");
const { V3DiagnosticBot, actionProxy } = require("../../../engine-v3/src");
const { seedFor } = require("./v1-v3-arena");
const { NativeBasePolicyEngine } = require(
  "../../../engine-v2/src/runtime/native-base-policy-engine");
const { NativeBasePolicyRoot: GenericNativeBasePolicyRoot } = require(
  "../../../engine-v2/src/base-policy/native-root");
const { ACTION, TERMINAL, NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { ROOT_CONTROL_MODE } = require(
  "../../../engine-v2/src/runtime/root-control-mode");
const { loadCohort } = require("./v2-native-initiative-arena");

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1] : fallback;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function shadowOwnsStage(mode, stage) {
  if (mode === "all") return stage >= 1 && stage <= 10;
  if (mode === "navigation") return stage === 9;
  if (mode === "stability") return stage === 7;
  if (mode === "navigation-stability") return stage === 7 || stage === 9;
  if (mode === "tactical") return stage === 8;
  if (mode === "initiative") return stage === 4 || stage === 5;
  return false;
}

function sourceClosureSha256(root) {
  const files = [
    "engine-v2/src/runtime/native-base-policy-engine.js",
    "engine-v2/src/runtime/escape-obligation.js",
    "engine-v2/src/search/risk-acceptance-controller.js",
    "engine-v2/src/base-policy-specialized/native-root.js",
    "engine-v2/src/base-policy-specialized/action-owner.js",
    "engine-v2/src/base-policy-specialized/policy-search.js"
  ];
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(file); hash.update("\0");
    hash.update(fs.readFileSync(path.join(root, file))); hash.update("\0");
  }
  return hash.digest("hex");
}

// Deliberately conservative: bind every production source, not just six roots.
function productionTreeSha256(root) {
  const hash = crypto.createHash("sha256");
  function visit(relative) {
    for (const entry of fs.readdirSync(path.join(root, relative),
      { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) {
        hash.update(file); hash.update("\0");
        hash.update(fs.readFileSync(path.join(root, file))); hash.update("\0");
      }
    }
  }
  visit("engine-v2/src");
  return hash.digest("hex");
}

function searchEntryReason(engine) {
  if (!engine.adapter?.enemyVisible) return "ENEMY_NOT_VISIBLE";
  if (engine.lastControlMode !== ROOT_CONTROL_MODE.TACTICAL_CONTACT)
    return "NON_CONTACT_MODE";
  if (engine.lastProofStatus === PROOF_STATUS.PROVEN) return "STRICT_PROOF_OWNER";
  if (engine.lastSelectionWasStrictRescue) return "STRICT_RESCUE_OWNER";
  if (engine.lastSelectionWasVerifiedDirectKill) return "DIRECT_KILL_OWNER";
  if (engine.escapeObligation?.committedEntityCount > 0 &&
      !engine.basePolicyOwnsViableCommitted) return "COMMITTED_OWNER";
  return "OWNER_EARLY_RETURN";
}

class NativeBasePolicyDiagnosticBot {
  constructor(options = {}) {
    this.engine = new NativeBasePolicyEngine();
    // Diagnostic-only off-policy labeler.  It observes the exact state given to
    // NativeBasePolicy, but its proposed action is never executed.  This lets
    // us compare V1's staged owner with V2's owner without embedding V1 in the
    // upload-shaped engine or charging V1 work to V2's runtime measurement.
    this.v3Shadow = options.v3ShadowLabels ? new V3DiagnosticBot({
      enableOwnershipTrace: true,
      contextName: "native-base-policy-v1-shadow"
    }) : null;
    this.lastV3Shadow = null;
    this.v1ShadowOwnerMode = options.v1ShadowOwnerMode || "off";
    this.v1ShadowOwnerAttempts = 0;
    this.v1ShadowOwnerApplied = 0;
    this.v1ShadowOwnerBlocked = 0;
    this.lastV1ShadowOverride = 0;
    if (this.v1ShadowOwnerMode !== "off") {
      if (!this.v3Shadow) throw new Error("V1_SHADOW_OWNER_REQUIRES_LABELER");
      const engine = this.engine;
      const originalEmit = engine.emit.bind(engine);
      engine.emit = (me, action) => {
        const shadow = this.lastV3Shadow;
        if (!shadow || !shadowOwnsStage(this.v1ShadowOwnerMode, shadow.stage))
          return originalEmit(me, action);
        const wanted = shadow.resolvedAction;
        if (wanted === ACTION.NONE || wanted === action)
          return originalEmit(me, action);
        this.v1ShadowOwnerAttempts += 1;
        let row = -1;
        for (let at = 0; at < engine.ourCount; at += 1) {
          if (engine.ourActions[at] !== wanted) continue;
          // Teleport has a positional argument.  The diagnostic owner refuses
          // to guess an argument if V1's exact destination is not represented.
          if (wanted === ACTION.CAST_TELEPORT) continue;
          if (!engine.finalGate.finalAllows(engine.adapter.bundle,
              engine.ourActions, engine.ourArguments, at, engine.ourCount)) continue;
          row = at; break;
        }
        if (row < 0) {
          this.v1ShadowOwnerBlocked += 1;
          return originalEmit(me, action);
        }
        engine.lastSelectedRow = row;
        if (engine.basePolicy?.intent?.commitSelection)
          engine.basePolicy.intent.commitSelection(wanted);
        this.v1ShadowOwnerApplied += 1;
        this.lastV1ShadowOverride = 1;
        return originalEmit(me, wanted);
      };
    }
    if (Number.isSafeInteger(options.nodeBudget) && options.nodeBudget > 0) {
      const closedSearch = this.engine.basePolicy.policySearch;
      this.engine.basePolicy = new GenericNativeBasePolicyRoot({
        nodeBudget: options.nodeBudget,
        targetDepth: Number.isSafeInteger(options.targetDepth) ?
          options.targetDepth : 3,
        rootBudgetMode: options.rootBudgetMode
      });
      // The generic search normally runs inside ProductionRootEngine, whose
      // legacy DepthSearch facade owns these two names.  The standalone host
      // deliberately omits that duplicate stack, so point the facade at the
      // byte-equivalent helpers already owned by the generic policy search.
      // This is construction-only diagnostic wiring; the specialized
      // production search performs the same rewrite at generation time.
      this.engine.basePolicy.policySearch.target =
        this.engine.basePolicy.policySearch.targetCell;
      this.engine.basePolicy.policySearch.walkable =
        this.engine.basePolicy.policySearch.positionWalkable;
      this.engine.basePolicy.policySearch.heuristic = closedSearch.heuristic;
      this.engine.basePolicy.policySearch.terminalValue =
        closedSearch.terminalValue;
      this.engine.basePolicy.policySearch.chanceAlternatives =
        closedSearch.chanceAlternatives;
      this.engine.depthSearch = this.engine.basePolicy.policySearch;
    }
    this.riskRescueGoVetoCount = 0;
    this.committedParetoRejectedCount = 0;
    this.strategicFallbackOverrideCount = 0;
    this.forcedFrame = Number.isSafeInteger(options.forcedFrame) ?
      options.forcedFrame : -1;
    this.forcedAction = Number.isSafeInteger(options.forcedAction) ?
      options.forcedAction : -1;
    this.forceFrameSeen = 0;
    this.forceApplied = 0;
    this.forceOriginalAction = -1;
    if (options.basePolicyOwnsViableCommitted === false)
      this.engine.basePolicyOwnsViableCommitted = 0;
    if (options.basePolicyOwnerEnabled === false)
      this.engine.basePolicy.selectOverride = () => null;
    const riskMode = options.basePolicyRiskMode || "current";
    if (riskMode !== "current") {
      const owner = this.engine.basePolicy.owner;
      const original = owner.selectOverride.bind(owner);
      const savedAcceptable = new Uint8Array(owner.allowedRow.length);
      const savedDominated = new Uint8Array(owner.allowedRow.length);
      const noSoftMember = () => 0;
      owner.selectOverride = (engine, selected, incumbentAction) => {
        const outcome = engine.riskController?.outcome;
        const count = Math.min(engine.ourCount, savedAcceptable.length);
        const pareto = riskMode === "pareto" || riskMode === "strict-pareto";
        const strict = riskMode === "acceptable" ||
          riskMode === "strict-pareto";
        const relative = riskMode === "relative-soft";
        const committedPareto = riskMode === "committed-eo-pareto";
        const intent = owner.intent;
        const originalMember = intent?.member;
        const relativeMember = relative && intent ? row => {
          const member = originalMember.call(intent, row);
          if (!member || !outcome || outcome.acceptable[row]) return member;
          if (selected < 0 || selected >= count) return 0;
          const noWorse =
            outcome.immediateFatalMass[row] <= outcome.immediateFatalMass[selected] &&
            outcome.committedChanceFatalMass[row] <=
              outcome.committedChanceFatalMass[selected] &&
            outcome.horizonFatalMass[row] <= outcome.horizonFatalMass[selected] &&
            outcome.unknownMass[row] <= outcome.unknownMass[selected] &&
            outcome.earliestFatalFrame[row] >= outcome.earliestFatalFrame[selected] &&
            outcome.escapeSlack[row] >= outcome.escapeSlack[selected];
          if (!noWorse) return 0;
          const escape = engine.escapeObligation;
          if (escape?.supportStatus === 1 && escape.committedEntityCount > 0 &&
              !escape.member[row]) return 0;
          return member;
        } : null;
        if (pareto && outcome)
          for (let row = 0; row < count; row += 1) {
            savedAcceptable[row] = outcome.acceptable[row];
            if (outcome.dominated[row]) outcome.acceptable[row] = 0;
          }
        if (committedPareto && outcome) {
          const escape = engine.escapeObligation;
          for (let row = 0; row < count; row += 1) {
            savedAcceptable[row] = outcome.acceptable[row];
            savedDominated[row] = outcome.dominated[row];
          }
          if (escape?.supportStatus === 1 &&
              escape.committedEntityCount > 0 &&
              escape.successorQualityReady) {
            for (let right = 0; right < count; right += 1) {
              if (!escape.member[right] || !escape.successorCoverage[right]) continue;
              for (let left = 0; left < count; left += 1) {
                if (left === right || !escape.member[left] ||
                    !escape.successorCoverage[left]) continue;
                const noWorse =
                  escape.successorExposed[left] <= escape.successorExposed[right] &&
                  escape.successorSlack[left] >= escape.successorSlack[right] &&
                  escape.successorBranches[left] >= escape.successorBranches[right];
                const strict =
                  escape.successorExposed[left] < escape.successorExposed[right] ||
                  escape.successorSlack[left] > escape.successorSlack[right] ||
                  escape.successorBranches[left] > escape.successorBranches[right];
                if (!noWorse || !strict) continue;
                outcome.acceptable[right] = 0;
                outcome.dominated[right] = 1;
                this.committedParetoRejectedCount += 1;
                break;
              }
            }
          }
        }
        if (strict && intent) intent.member = noSoftMember;
        else if (relativeMember) intent.member = relativeMember;
        try {
          const proposal = original(engine, selected, incumbentAction);
          const committedVeto = riskMode === "committed-risk-veto" &&
            engine.escapeObligation?.supportStatus === 1 &&
            engine.escapeObligation.committedEntityCount > 0;
          if ((riskMode === "rescue-go-veto" || committedVeto) &&
              proposal && outcome &&
              selected >= 0 && selected < count &&
              (riskMode !== "rescue-go-veto" ||
               engine.ourActions[selected] === ACTION.GO) &&
              outcome.acceptable[selected] && !outcome.dominated[selected] &&
              (outcome.dominated[proposal.row] ||
               !outcome.acceptable[proposal.row])) {
            const left = selected; const right = proposal.row;
            const less = outcome.immediateFatalMass[left] <
                outcome.immediateFatalMass[right] ||
              outcome.immediateFatalMass[left] ===
                outcome.immediateFatalMass[right] &&
              (outcome.committedChanceFatalMass[left] <
                  outcome.committedChanceFatalMass[right] ||
               outcome.committedChanceFatalMass[left] ===
                  outcome.committedChanceFatalMass[right] &&
               (outcome.horizonFatalMass[left] < outcome.horizonFatalMass[right] ||
                outcome.horizonFatalMass[left] === outcome.horizonFatalMass[right] &&
                (outcome.unknownMass[left] < outcome.unknownMass[right] ||
                 outcome.unknownMass[left] === outcome.unknownMass[right] &&
                 outcome.escapeSlack[left] > outcome.escapeSlack[right])));
            if (less) {
              if (intent?.commitSelection) intent.commitSelection(incumbentAction);
              this.riskRescueGoVetoCount += 1;
              return null;
            }
          }
          return proposal;
        } finally {
          if ((strict || relativeMember) && intent) intent.member = originalMember;
          if ((pareto || committedPareto) && outcome)
            for (let row = 0; row < count; row += 1)
              outcome.acceptable[row] = savedAcceptable[row];
          if (committedPareto && outcome)
            for (let row = 0; row < count; row += 1)
              outcome.dominated[row] = savedDominated[row];
        }
      };
    }
    if (options.hiddenBeliefCombat === true) {
      const engine = this.engine;
      const originalPrepareHiddenWorlds = engine.prepareHiddenWorlds.bind(engine);
      engine.prepareHiddenWorlds = () => {
        const count = originalPrepareHiddenWorlds();
        engine.beliefCoverage.fill(0, 0, engine.ourCount);
        if (engine.adapter.enemyVisible) return count;
        for (let row = 0; row < engine.ourCount; row += 1) {
          const action = engine.ourActions[row];
          if (action !== ACTION.FIRE && action !== ACTION.THROW_BOMB) continue;
          const source = engine.projectedCell[row];
          const direction = engine.projectedDirection[row];
          let mass = 0;
          for (let world = 0; world < count; world += 1) {
            const cell = engine.worldCell[world];
            const hit = action === ACTION.FIRE ?
              engine.directionTo(source, cell) === direction &&
                engine.clearLine(source, cell) :
              engine.combat.bombHits(engine.adapter.state, source, cell);
            if (hit) mass += engine.worldMass[world];
          }
          engine.beliefCoverage[row] = Math.min(10000, mass);
        }
        return count;
      };
    }
    if (options.exactFrameTerminal === true) {
      const search = this.engine.basePolicy.policySearch;
      const originalTerminalUtility = search.terminalUtility.bind(search);
      search.terminalUtility = (engine, terminal, depth, pathScore, top) => {
        const crash = engine.adapter.state.arrays[ARRAY.TANK_CRASH];
        if (!crash[0] && !crash[1]) {
          if (terminal === TERMINAL.WIN0) return 100000;
          if (terminal === TERMINAL.WIN1) return -100000;
          if (terminal === TERMINAL.DRAW) return 0;
        }
        return originalTerminalUtility(engine, terminal, depth, pathScore, top);
      };
    }
    if (options.opponentBlendScale === 2) {
      const search = this.engine.basePolicy.policySearch;
      const originalSetOpponentContext =
        search.setOracleOpponentContext.bind(search);
      search.setOracleOpponentContext = census => {
        originalSetOpponentContext(census);
        search.currentBlendBasisPoints = Math.min(7000,
          search.currentBlendBasisPoints * 2);
      };
    }
    if (options.basePolicyStrategicFallback === "noncontact" ||
        options.basePolicyStrategicFallback === "attack-lane" ||
        options.basePolicyStrategicFallback === "path-frontier") {
      const engine = this.engine;
      const originalSelectIncumbent = engine.selectIncumbent.bind(engine);
      engine.selectIncumbent = count => {
        const incumbent = originalSelectIncumbent(count);
        if (engine.lastControlMode !== ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION)
          return incumbent;
        const intent = engine.basePolicy.intent;
        let wanted = ACTION.NONE;
        if (options.basePolicyStrategicFallback === "path-frontier") {
          const a = engine.adapter.state.arrays;
          const state = engine.adapter.state;
          const own = a[ARRAY.TANK_CELL][0];
          const enemy = a[ARRAY.TANK_CELL][1];
          const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
          const target = star !== NONE_CELL ? star :
            engine.adapter.enemyVisible ? enemy : NONE_CELL;
          if (target === NONE_CELL ||
              engine.escapeObligation.committedEntityCount > 0 ||
              !intent.fillDistanceField(state, target)) return incumbent;
          const currentDistance = intent.pathDistance[own] === NONE_CELL ?
            99 : intent.pathDistance[own];
          const step = intent.nextStarStep(state, own, target, enemy);
          if (step === NONE_CELL) return incumbent;
          const wantedDirection = engine.directionTo(own, step);
          const risk = engine.riskController.outcome;
          let best = -1;
          let bestScore = -2147483648;
          for (let row = 0; row < count; row += 1) {
            const action = engine.ourActions[row];
            if (action !== ACTION.GO && action !== ACTION.TURN_LEFT &&
                action !== ACTION.TURN_RIGHT || engine.hardStatus[row] !== 0 ||
                !risk.acceptable[row] || risk.dominated[row]) continue;
            const distance = intent.pathDistance[engine.projectedCell[row]] ===
              NONE_CELL ? 99 : intent.pathDistance[engine.projectedCell[row]];
            let score = (currentDistance - distance) * 220;
            const direction = engine.projectedDirection[row];
            if (direction === wantedDirection) score += 100;
            else score -= intent.quarterTurns(direction, wantedDirection) * 55;
            if (action === ACTION.GO) score += 30;
            else score -= 10 + engine.turnStreak * 8;
            if (score > bestScore || score === bestScore &&
                (action === ACTION.GO || best >= 0 &&
                 engine.ourActions[best] !== ACTION.GO && row < best)) {
              best = row; bestScore = score;
            }
          }
          if (best < 0) return incumbent;
          this.strategicFallbackOverrideCount += best !== incumbent ? 1 : 0;
          return best;
        }
        if (options.basePolicyStrategicFallback === "attack-lane") {
          const a = engine.adapter.state.arrays;
          const own = a[ARRAY.TANK_CELL][0];
          const enemy = a[ARRAY.TANK_CELL][1];
          if (!engine.adapter.enemyVisible ||
              engine.escapeObligation.committedEntityCount > 0 ||
              engine.clearLine(own, enemy)) return incumbent;
          const step = intent.nextAttackLaneStep(engine,
            engine.adapter.state, own, enemy);
          if (step !== NONE_CELL)
            wanted = intent.actionForStep(engine.adapter.state, own,
              a[ARRAY.TANK_DIR][0], step);
        } else {
          intent.prepare(engine, count);
          wanted = intent.currentCommittedAction;
        }
        if (wanted === ACTION.NONE) return incumbent;
        const risk = engine.riskController.outcome;
        for (let row = 0; row < count; row += 1) {
          if (engine.ourActions[row] !== wanted || engine.hardStatus[row] !== 0 ||
              risk.dominated[row]) continue;
          const accepted = risk.acceptable[row] ||
            risk.immediateFatalMass[row] === 0 && risk.unknownMass[row] === 0 &&
              intent.member(row) > 0;
          if (!accepted) continue;
          if (options.basePolicyStrategicFallback === "noncontact")
            intent.commitSelection(wanted);
          this.strategicFallbackOverrideCount += row !== incumbent ? 1 : 0;
          return row;
        }
        return incumbent;
      };
    }
    if (this.forcedFrame >= 0 && this.forcedAction >= 0) {
      const engine = this.engine;
      const originalEmit = engine.emit.bind(engine);
      engine.emit = (me, action) => {
        const frame = engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
        if (frame !== this.forcedFrame) return originalEmit(me, action);
        this.forceFrameSeen = 1;
        this.forceOriginalAction = action;
        let forcedRow = -1;
        for (let row = 0; row < engine.ourCount; row += 1)
          if (engine.ourActions[row] === this.forcedAction &&
              engine.finalGate.finalAllows(engine.adapter.bundle,
                engine.ourActions, engine.ourArguments, row, engine.ourCount)) {
            forcedRow = row; break;
          }
        if (forcedRow < 0) return originalEmit(me, action);
        engine.lastSelectedRow = forcedRow;
        if (engine.basePolicy?.intent?.commitSelection)
          engine.basePolicy.intent.commitSelection(this.forcedAction);
        this.forceApplied = 1;
        return originalEmit(me, this.forcedAction);
      };
    }
    this.decisions = 0; this.runtimeMicros = 0;
    this.actionCounts = Object.create(null);
    this.captureRoots = Boolean(options.captureRoots);
    this.captureV1FirstDivergence = Boolean(options.captureV1FirstDivergence);
    this.captureV1DivergenceAfter = Number.isSafeInteger(
      options.captureV1DivergenceAfter) ? options.captureV1DivergenceAfter : 0;
    this.captureV1DivergenceStages = new Set(
      options.captureV1DivergenceStages || []);
    this.capturedV1DivergenceStages = new Set();
    this.traceTail = Number.isSafeInteger(options.traceTail) ?
      Math.max(0, options.traceTail) : 0;
    this.rootFrames = [];
    this.searchEvidenceCurrent = false;
    this.searchEntry = "OWNER_NOT_CALLED";
    this.previousAction = ACTION.NONE;
    const owner = this.engine.basePolicy;
    const selectOverride = owner.selectOverride.bind(owner);
    owner.selectOverride = (...args) => {
      this.searchEntry = searchEntryReason(args[0]);
      return selectOverride(...args);
    };
    const search = this.engine.basePolicy.policySearch;
    const prepare = search.prepare.bind(search);
    search.prepare = (...args) => {
      const result = prepare(...args);
      this.searchEvidenceCurrent = Boolean(result);
      this.searchEntry = result ? "SEARCH_PREPARED" : "PREPARE_FAILED";
      return result;
    };
  }

  decide(context) {
    this.searchEvidenceCurrent = false;
    this.searchEntry = "OWNER_NOT_CALLED";
    this.previousAction = this.engine.lastAction;
    this.lastV1ShadowOverride = 0;
    if (this.v3Shadow) {
      const decision = this.v3Shadow.decide(context);
      const trace = this.v3Shadow.controller.ownershipTrace.frameSnapshot();
      this.lastV3Shadow = {
        action: decision.action?.type || "none",
        side: decision.action?.side || null,
        argument: decision.action?.type === "teleport" ?
          [decision.action.x, decision.action.y] : null,
        stage: trace.stage,
        stageName: trace.stageName,
        requestedAction: trace.requestedAction,
        resolvedAction: trace.resolvedAction,
        finalOverride: trace.finalOverride,
        emitted: trace.emitted
      };
    }
    const actions = [];
    const me = actionProxy(context.me, actions);
    const started = process.hrtime.bigint();
    this.engine.decide(me, context.enemy, context.game);
    const micros = Number((process.hrtime.bigint() - started) / 1000n);
    const action = actions[0] || null;
    const name = action?.type || "none";
    this.decisions += 1; this.runtimeMicros += micros;
    this.actionCounts[name] = (this.actionCounts[name] || 0) + 1;
    if (this.captureRoots) this.captureRoot(context, action);
    else if (this.captureV1FirstDivergence && this.rootFrames.length === 0) {
      const selected = this.engine.lastSelectedRow;
      const selectedAction = selected >= 0 && selected < this.engine.ourCount ?
        this.engine.ourActions[selected] : ACTION.NONE;
      if (this.lastV3Shadow &&
          this.lastV3Shadow.resolvedAction !== ACTION.NONE &&
          this.lastV3Shadow.resolvedAction !== selectedAction)
        this.captureRoot(context, action);
    } else if (this.captureV1DivergenceStages.size > 0 &&
        (context?.game?.frames ?? 0) >= this.captureV1DivergenceAfter) {
      const selected = this.engine.lastSelectedRow;
      const selectedAction = selected >= 0 && selected < this.engine.ourCount ?
        this.engine.ourActions[selected] : ACTION.NONE;
      const stage = this.lastV3Shadow?.stageName || "";
      if (this.lastV3Shadow && this.captureV1DivergenceStages.has(stage) &&
          !this.capturedV1DivergenceStages.has(stage) &&
          this.lastV3Shadow.resolvedAction !== ACTION.NONE &&
          this.lastV3Shadow.resolvedAction !== selectedAction) {
        this.captureRoot(context, action);
        this.capturedV1DivergenceStages.add(stage);
      }
    }
    return { action, runtimeMs: micros / 1000, logs: [] };
  }

  captureRoot(context, action) {
    const engine = this.engine; const outcome = engine.riskController.outcome;
    const safety = engine.safetyClosure.outcome;
    const search = engine.basePolicy.policySearch;
    const state = engine.adapter.state; const arrays = state.arrays;
    const own = arrays[ARRAY.TANK_CELL][0];
    const enemy = arrays[ARRAY.TANK_CELL][1];
    const star = arrays[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const count = outcome.count;
    const candidates = [];
    const opponentActions = [];
    for (let column = 0; column < engine.enemyCount; column += 1) {
      const enemyAction = engine.enemyActions[column];
      opponentActions.push({ action: enemyAction,
        allowed: search.rootEnemyDomainMask[column],
        weight: search.opponentWeight(engine, engine.adapter.state,
          enemyAction) });
    }
    for (let row = 0; row < count; row += 1)
      candidates.push({ row, action: engine.ourActions[row],
        cell: engine.projectedCell[row],
        direction: engine.projectedDirection[row],
        hard: engine.hardStatus[row], safety: safety.status[row],
        immediate: outcome.immediateFatalMass[row],
        horizon: outcome.horizonFatalMass[row], unknown: outcome.unknownMass[row],
        committed: outcome.committedFatalMass?.[row] || 0,
        possibleProjectile: outcome.possibleProjectileFatalMass?.[row] || 0,
        futureFire: outcome.futureFireFatalMass?.[row] || 0,
        slack: outcome.escapeSlack[row], acceptable: outcome.acceptable[row],
        dominated: outcome.dominated[row], robust: outcome.robustLower[row],
        expected: outcome.expectedValue[row], tactical: outcome.tacticalValue[row],
        purpose: outcome.purposeCompleteness[row],
        escapeMember: engine.escapeObligation.member[row],
        escapeProof: outcome.escapeSuccessorProof[row],
        escapeExposed: outcome.escapeSuccessorExposed[row],
        escapeSuccessorSlack: outcome.escapeSuccessorSlack[row],
        escapeBranches: outcome.escapeSuccessorBranches[row],
        strategyPurpose: engine.strategyBands.purpose[row],
        strategySelected: engine.strategyBands.selected[row],
        strategyOwner: engine.strategyBands.ownerStrategy[row],
        beliefCoverage: engine.beliefCoverage[row],
        basePolicyMembership: this.searchEvidenceCurrent ?
          engine.basePolicy.owner.membership[row] : null,
        basePolicyValue: this.searchEvidenceCurrent &&
          engine.basePolicy.owner.membership[row] === 5 ?
          engine.basePolicy.owner.backedValue[row] : null,
        basePolicyExactBlock: this.searchEvidenceCurrent ?
          search.rowExactBlockMask[row] : null });
    this.rootFrames.push({ frame: Number.isSafeInteger(context?.game?.frames) ?
      context.game.frames : this.decisions, emitted: action?.type || "none",
      controlMode: engine.lastControlMode,
      ownCell: own, ownDirection: arrays[ARRAY.TANK_DIR][0],
      enemyCell: enemy, enemyDirection: arrays[ARRAY.TANK_DIR][1],
      ownStars: arrays[ARRAY.TANK_STARS][0],
      enemyStars: arrays[ARRAY.TANK_STARS][1], starCell: star,
      ownEnemyDistance: engine.manhattan(own, enemy),
      clearLineToEnemy: engine.clearLine(own, enemy) ? 1 : 0,
      lastAction: this.previousAction, emittedAction: engine.lastAction,
      turnStreak: engine.turnStreak,
      goStallStreak: engine.goStallStreak,
      intent: { contextEpoch: engine.basePolicy.intent.contextEpoch,
        proposed: engine.basePolicy.intent.currentProposed,
        committed: engine.basePolicy.intent.currentCommitted,
        committedAction: engine.basePolicy.intent.currentCommittedAction },
      informationComplete: engine.adapter.informationComplete,
      hiddenWorlds: engine.hiddenWorldCount,
      hiddenWorldSupportComplete: engine.hiddenWorldSupportComplete,
      hiddenWorldRiskSupportComplete: engine.hiddenWorldRiskSupportComplete,
      possibleProjectiles: engine.possibleProjectiles.count(),
      escapeSupport: engine.escapeObligation.supportStatus,
      escapeEntities: engine.escapeObligation.committedEntityCount,
      incumbent: engine.lastIncumbentRow, proposal: engine.lastProposalRow,
      selected: engine.lastSelectedRow, strategy: engine.strategyId,
      searchEvidenceCurrent: this.searchEvidenceCurrent,
      searchEntryReason: this.searchEntry === "OWNER_NOT_CALLED" &&
        this.engine.lastIncumbentRow >= 0 &&
        this.engine.ourActions[this.engine.lastIncumbentRow] >= ACTION.CAST_SHIELD &&
        this.engine.ourActions[this.engine.lastIncumbentRow] <= ACTION.CAST_BOOST &&
        this.engine.ourActions[this.engine.lastIncumbentRow] !== ACTION.CAST_POISON ?
        "RESOURCE_ACTION_OWNER" : this.searchEntry,
      basePolicyNodes: this.searchEvidenceCurrent ? search.nodes : 0,
      basePolicyDepth: this.searchEvidenceCurrent ? search.currentDepth : 0,
      basePolicySupportComplete: this.searchEvidenceCurrent ?
        search.lastOwnershipSupportComplete : null,
      basePolicyBudgetLeaves: this.searchEvidenceCurrent ? search.lastBudgetLeafCount : 0,
      basePolicyFastIncomplete: this.searchEvidenceCurrent ? search.lastFastIncompleteCount : 0,
      basePolicyHardIncomplete: this.searchEvidenceCurrent ? search.lastHardIncompleteCount : 0,
      basePolicyNoActionLeaves: this.searchEvidenceCurrent ? search.lastNoActionLeafCount : 0,
      ...(this.lastV3Shadow ? { v1Shadow: this.lastV3Shadow } : {}),
      v1ShadowOverride: this.lastV1ShadowOverride,
      opponentObservations: search.oracleOpponentObservations,
      opponentBlendBasisPoints: search.currentBlendBasisPoints,
      opponentActions,
      candidates });
  }

  summary() {
    const search = this.engine.basePolicy.policySearch;
    return { decisions: this.decisions, runtimeMicros: this.runtimeMicros,
      actionCounts: { ...this.actionCounts },
      rootRestoreFailures: search.rootRestoreFailureCount || 0,
      hotAllocations: (this.engine.escapeObligation.hotAllocationCount || 0) +
        (this.engine.riskController.outcome.hotAllocationCount || 0),
      observationStatus: this.engine.adapter.lastStatus,
      informationComplete: this.engine.adapter.informationComplete,
      forceFrameSeen: this.forceFrameSeen,
      forceApplied: this.forceApplied,
      forceOriginalAction: this.forceOriginalAction,
      riskRescueGoVetoCount: this.riskRescueGoVetoCount,
      committedParetoRejectedCount: this.committedParetoRejectedCount,
      strategicFallbackOverrideCount: this.strategicFallbackOverrideCount,
      searchRoots: search.completeCount || 0,
      searchNodes: search.totalNodes || 0,
      searchBudgetLeaves: search.leafBudgetCount || 0,
      searchFastIncomplete: search.fastIncompleteCount || 0,
      searchHardIncomplete: search.hardIncompleteCount || 0,
      searchDepthLeaves: search.depthLeafCount || 0,
      searchStrictOwnershipRoots: search.strictOwnershipRootCount || 0,
      searchHeuristicOwnershipRoots: search.heuristicOwnershipRootCount || 0,
      v1ShadowOwnerMode: this.v1ShadowOwnerMode,
      v1ShadowOwnerAttempts: this.v1ShadowOwnerAttempts,
      v1ShadowOwnerApplied: this.v1ShadowOwnerApplied,
      v1ShadowOwnerBlocked: this.v1ShadowOwnerBlocked,
      ...(this.v3Shadow ? { v1Shadow: this.v3Shadow.summary() } : {}),
      ...(this.captureRoots || this.captureV1FirstDivergence ||
        this.captureV1DivergenceStages.size > 0 ? {
        rootFrames: this.traceTail > 0 ?
        this.rootFrames.slice(-this.traceTail) : this.rootFrames } : {}) };
  }
}

function safeMath() {
  return Object.freeze({ abs: Math.abs, floor: Math.floor, max: Math.max,
    min: Math.min, ceil: Math.ceil, round: Math.round, trunc: Math.trunc,
    sign: Math.sign });
}

class VmNativeBasePolicyDiagnosticBot {
  constructor(source) {
    this.decisions = 0; this.runtimeMicros = 0;
    this.actionCounts = Object.create(null);
    this.sandbox = { Math: safeMath() };
    vm.createContext(this.sandbox);
    vm.runInContext(source, this.sandbox, { timeout: 4000 });
    if (typeof this.sandbox.onIdle !== "function")
      throw new Error("NATIVE_STANDALONE_VM_ENTRY_MISSING");
  }

  decide(context) {
    const actions = []; const me = actionProxy(context.me, actions);
    const started = process.hrtime.bigint();
    this.sandbox.onIdle(me, context.enemy, context.game);
    const micros = Number((process.hrtime.bigint() - started) / 1000n);
    const action = actions[0] || null; const name = action?.type || "none";
    this.decisions += 1; this.runtimeMicros += micros;
    this.actionCounts[name] = (this.actionCounts[name] || 0) + 1;
    return { action, runtimeMs: micros / 1000, logs: [] };
  }

  summary() {
    return { decisions: this.decisions, runtimeMicros: this.runtimeMicros,
      actionCounts: { ...this.actionCounts }, rootRestoreFailures: 0,
      hotAllocations: 0 };
  }
}

function rawResult(replay, candidateSeat) {
  const winner = replay.result?.winner;
  return { winnerSeat: winner === 0 || winner === 1 ? winner : null,
    winnerImplementation: winner === candidateSeat ? "v2" :
      winner === (candidateSeat ^ 1) ? "v1" : "draw",
    reason: replay.result?.reason || "UNKNOWN" };
}

async function play(module, scenario, candidateSeat, captureRoots = false,
    candidateCode = null, basePolicyOwnsViableCommitted = true,
    basePolicyOwnerEnabled = true, basePolicyRiskMode = "current",
    hiddenBeliefCombat = false, exactFrameTerminal = false,
    opponentBlendScale = 1, basePolicyStrategicFallback = "off",
    forcedFrame = -1, forcedAction = -1, traceTail = 0,
    nodeBudget = 0, targetDepth = 3, rootBudgetMode = "row-shared",
    v3ShadowLabels = false, v1ShadowOwnerMode = "off",
    captureV1FirstDivergence = false, captureV1DivergenceStages = null,
    captureV1DivergenceAfter = 0) {
  const star = createHistoricalStarProvider(scenario.stars);
  const simulator = new module.AgenTankSimulator({
    map: scenario.map,
    tanks: scenario.starts.map((tank, seat) =>
      ({ ...tank, id: `native-initiative-${seat}` })),
    skills: ["stun", "stun"], star: star.initialStar,
    starProvider: value => star.provider(value),
    seed: seedFor(scenario),
    maxFrames: 128, starLimit: false
  });
  const candidateBot = candidateCode ?
    new VmNativeBasePolicyDiagnosticBot(candidateCode) :
    new NativeBasePolicyDiagnosticBot({ captureRoots,
      basePolicyOwnsViableCommitted, basePolicyOwnerEnabled,
      basePolicyRiskMode, hiddenBeliefCombat, exactFrameTerminal,
      opponentBlendScale, basePolicyStrategicFallback,
      forcedFrame, forcedAction, traceTail, nodeBudget, targetDepth,
      rootBudgetMode, v3ShadowLabels, v1ShadowOwnerMode,
      captureV1FirstDivergence, captureV1DivergenceStages,
      captureV1DivergenceAfter });
  const candidate = new DecisionAudit(candidateBot,
    { captureCompactFrames: true });
  const control = new DecisionAudit(new V3DiagnosticBot(),
    { captureCompactFrames: true, captureActionFrames: captureRoots });
  const bots = candidateSeat === 0 ? [candidate, control] : [control, candidate];
  const replay = simulator.run(bots[0], bots[1]);
  const result = rawResult(replay, candidateSeat);
  const counts = collectCounts(replay, candidateSeat);
  const match = { matchUrlId: scenario.matchUrlId,
    scenarioFingerprint: scenario.fingerprint, candidateSeat,
    seatImplementations: candidateSeat === 0 ? ["v2", "v1"] : ["v1", "v2"],
    frames: replay.replayData.replay.records.length, result, counts,
    candidate: candidate.summary(), candidateEngine: candidate.bot.summary(),
    control: control.summary() };
  const classified = classifyAnalysisOutcome(match);
  match.analysisOutcome = classified.analysisOutcome;
  match.terminalCategory = classified.terminalCategory;
  return match;
}

function summarize(matches) {
  const output = { matches: matches.length, wins: 0, losses: 0, draws: 0,
    scoreBasisPoints: 0, stars: 0, opponentStars: 0,
    crashWins: 0, crashLosses: 0, actions: {}, runtimeMicros: 0,
    rootRestoreFailures: 0, hotAllocations: 0 };
  for (const match of matches) {
    if (match.analysisOutcome === "V2_WIN") output.wins += 1;
    else if (match.analysisOutcome === "V1_WIN") output.losses += 1;
    else output.draws += 1;
    const seat = match.candidateSeat;
    output.stars += match.counts.stars[seat];
    output.opponentStars += match.counts.stars[seat ^ 1];
    if (match.result.winnerImplementation === "v2" &&
        match.counts.crashes[seat ^ 1]) output.crashWins += 1;
    if (match.result.winnerImplementation === "v1" &&
        match.counts.crashes[seat]) output.crashLosses += 1;
    output.runtimeMicros += match.candidate.totalRuntimeMicros || 0;
    const inner = match.candidateEngine || match.candidate;
    output.rootRestoreFailures += inner.rootRestoreFailures || 0;
    output.hotAllocations += inner.hotAllocations || 0;
    for (const [name, count] of Object.entries(match.candidate.actionCounts || {}))
      output.actions[name] = (output.actions[name] || 0) + count;
  }
  output.scoreBasisPoints = output.matches ? Math.floor(
    (output.wins * 10000 + output.draws * 5000) / output.matches) : 0;
  output.starDifference = output.stars - output.opponentStars;
  return output;
}

async function run(root = process.cwd()) {
  const cohortFile = path.resolve(option("--cohort",
    path.join(root, "config/engine-v3/v3-repair-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const limit = Math.max(1, Number(option("--limit", "16")) | 0);
  const traceTail = Math.max(0, Number(option("--trace-tail", "0")) | 0);
  const captureRoots = option("--trace-roots", "false") === "true" ||
    traceTail > 0;
  const v3ShadowLabels = option("--v3-shadow-labels", "off") === "on";
  const captureV1FirstDivergence =
    option("--v1-first-divergence", "off") === "on";
  const captureV1DivergenceStages = option("--v1-divergence-stages", "")
    .split(",").map(value => value.trim().toUpperCase()).filter(Boolean);
  const allowedV1DivergenceStages = new Set(["VISIBLE_BOMB_SAFETY",
    "VISIBLE_PROJECTILE_SAFETY", "PROJECTILE_ESCAPE", "HIDDEN_ATTACK",
    "DIRECT_ATTACK", "PREEMPTIVE_SAFETY", "INLINE_STABILITY",
    "TACTICAL_SEARCH", "NAVIGATION", "FINAL_ACTION_GATE"]);
  for (const stage of captureV1DivergenceStages)
    if (!allowedV1DivergenceStages.has(stage))
      throw new Error(`NATIVE_STANDALONE_V1_DIVERGENCE_STAGE_INVALID:${stage}`);
  const captureV1DivergenceAfter = Number(option("--v1-divergence-after", "0"));
  if (!Number.isSafeInteger(captureV1DivergenceAfter) ||
      captureV1DivergenceAfter < 0 || captureV1DivergenceAfter > 127)
    throw new Error("NATIVE_STANDALONE_V1_DIVERGENCE_AFTER_INVALID");
  const v1ShadowOwnerMode = option("--v1-shadow-owner", "off");
  if (!new Set(["off", "navigation", "stability", "navigation-stability",
    "tactical", "initiative", "all"]).has(v1ShadowOwnerMode))
    throw new Error(`NATIVE_STANDALONE_V1_SHADOW_OWNER_INVALID:${v1ShadowOwnerMode}`);
  if (v1ShadowOwnerMode !== "off" && !v3ShadowLabels)
    throw new Error("NATIVE_STANDALONE_V1_SHADOW_OWNER_REQUIRES_LABELS");
  if (captureV1FirstDivergence && !v3ShadowLabels)
    throw new Error("NATIVE_STANDALONE_V1_FIRST_DIVERGENCE_REQUIRES_LABELS");
  if (captureV1DivergenceStages.length && !v3ShadowLabels)
    throw new Error("NATIVE_STANDALONE_V1_DIVERGENCE_STAGES_REQUIRE_LABELS");
  const candidateSeatOption = option("--candidate-seat", "both");
  const candidateSeats = candidateSeatOption === "both" ? [0, 1] :
    [Number(candidateSeatOption)];
  if (candidateSeats.some(seat => seat !== 0 && seat !== 1))
    throw new Error(`NATIVE_STANDALONE_CANDIDATE_SEAT_INVALID:${candidateSeatOption}`);
  const forcedFrame = Number(option("--force-frame", "-1"));
  const forcedAction = Number(option("--force-action", "-1"));
  if (!Number.isSafeInteger(forcedFrame) || !Number.isSafeInteger(forcedAction))
    throw new Error("NATIVE_STANDALONE_FORCE_INVALID");
  const nodeBudget = Number(option("--base-policy-node-budget", "0"));
  const targetDepth = Number(option("--base-policy-depth", "3"));
  const rootBudgetMode = option("--base-policy-budget-mode", "row-shared");
  if (!Number.isSafeInteger(nodeBudget) || nodeBudget < 0 ||
      !Number.isSafeInteger(targetDepth) || targetDepth < 1 || targetDepth > 8)
    throw new Error("NATIVE_STANDALONE_SEARCH_PROFILE_INVALID");
  if (rootBudgetMode !== "row-shared" && rootBudgetMode !== "cell-equal")
    throw new Error(`NATIVE_STANDALONE_BUDGET_MODE_INVALID:${rootBudgetMode}`);
  const candidateCodeFile = option("--candidate-code", "");
  const basePolicyOwnsViableCommitted =
    option("--base-policy-committed", "on") !== "off";
  const basePolicyOwnerEnabled = option("--base-policy-owner", "on") !== "off";
  const basePolicyRiskMode = option("--base-policy-risk", "current");
  if (!new Set(["current", "acceptable", "pareto", "strict-pareto",
    "relative-soft", "rescue-go-veto", "committed-risk-veto",
    "committed-eo-pareto"])
      .has(basePolicyRiskMode))
    throw new Error(`NATIVE_STANDALONE_RISK_MODE_INVALID:${basePolicyRiskMode}`);
  const hiddenBeliefCombat = option("--hidden-belief-combat", "off") === "on";
  const exactFrameTerminal = option("--frame-terminal", "current") === "exact";
  const opponentBlendScale = Number(option("--opponent-blend-scale", "1"));
  if (opponentBlendScale !== 1 && opponentBlendScale !== 2)
    throw new Error(`NATIVE_STANDALONE_BLEND_SCALE_INVALID:${opponentBlendScale}`);
  const basePolicyStrategicFallback = option(
    "--base-policy-strategic-fallback", "off");
  if (basePolicyStrategicFallback !== "off" &&
      basePolicyStrategicFallback !== "noncontact" &&
      basePolicyStrategicFallback !== "attack-lane" &&
      basePolicyStrategicFallback !== "path-frontier")
    throw new Error(`NATIVE_STANDALONE_STRATEGIC_FALLBACK_INVALID:${
      basePolicyStrategicFallback}`);
  if (candidateCodeFile && captureRoots)
    throw new Error("NATIVE_STANDALONE_VM_ROOT_TRACE_UNAVAILABLE");
  const candidateCode = candidateCodeFile ?
    fs.readFileSync(path.resolve(candidateCodeFile), "utf8") : null;
  const loaded = loadCohort(root, cohortFile, role);
  const requestedIds = option("--scenario-id", "").split(",").filter(Boolean);
  if (requestedIds.length) {
    const wanted = new Set(requestedIds);
    loaded.scenarios = loaded.scenarios.filter(item =>
      wanted.has(item.matchUrlId));
    const missing = requestedIds.filter(id =>
      !loaded.scenarios.some(item => item.matchUrlId === id));
    if (missing.length) throw new Error(`NATIVE_STANDALONE_SCENARIO_MISSING:${
      missing.join(",")}`);
  }
  loaded.scenarios = loaded.scenarios.slice(0, limit);
  const { module } = await loadSimulator(root);
  const matches = [];
  for (let at = 0; at < loaded.scenarios.length; at += 1) {
    for (const seat of candidateSeats)
      matches.push(await play(module, loaded.scenarios[at], seat, captureRoots,
        candidateCode, basePolicyOwnsViableCommitted, basePolicyOwnerEnabled,
        basePolicyRiskMode, hiddenBeliefCombat, exactFrameTerminal,
        opponentBlendScale, basePolicyStrategicFallback,
        forcedFrame, forcedAction, traceTail, nodeBudget, targetDepth,
        rootBudgetMode, v3ShadowLabels, v1ShadowOwnerMode,
        captureV1FirstDivergence, captureV1DivergenceStages,
        captureV1DivergenceAfter));
    if ((at + 1) % 8 === 0 || at + 1 === loaded.scenarios.length)
      process.stderr.write(`[native-standalone] ${at + 1}/${loaded.scenarios.length}\n`);
  }
  const overview = { objectKind: "NATIVE_BASE_POLICY_STANDALONE_ARENA_V1",
    role, scenarioCount: loaded.scenarios.length,
    cohortFingerprint: loaded.manifest.fingerprint,
    source: {
      engine: sha256(fs.readFileSync(path.join(root,
        "engine-v2/src/runtime/native-base-policy-engine.js"))),
      observation: sha256(fs.readFileSync(path.join(root,
        "engine-v2/src/runtime/production-observation.js"))),
      runtimeClosure: sourceClosureSha256(root),
      productionTree: productionTreeSha256(root),
      ...(candidateCode ? { candidateCode: sha256(candidateCode) } : {}) },
    diagnostics: { basePolicyOwnsViableCommitted, basePolicyOwnerEnabled,
      basePolicyRiskMode, hiddenBeliefCombat, exactFrameTerminal,
      opponentBlendScale, basePolicyStrategicFallback,
      candidateSeats, forcedFrame, forcedAction, traceTail,
      nodeBudget: nodeBudget || 128, targetDepth, rootBudgetMode,
      v3ShadowLabels, v1ShadowOwnerMode, captureV1FirstDivergence,
      captureV1DivergenceStages, captureV1DivergenceAfter },
    candidate: summarize(matches) };
  overview.fingerprint = sha256(JSON.stringify(overview));
  const output = path.resolve(option("--output",
    "/tmp/agentank-bp179-native-standalone-fixed16"));
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "overview.json"),
    `${JSON.stringify(overview, null, 2)}\n`);
  fs.writeFileSync(path.join(output, "matches.ndjson.gz"), zlib.gzipSync(
    Buffer.from(`${matches.map(value => JSON.stringify(value)).join("\n")}\n`),
    { level: 9 }));
  process.stdout.write(`${JSON.stringify({ output, overview }, null, 2)}\n`);
  return { output, overview };
}

if (require.main === module) run().catch(error => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { NativeBasePolicyDiagnosticBot,
  VmNativeBasePolicyDiagnosticBot, play, sourceClosureSha256,
  productionTreeSha256, searchEntryReason, summarize, run };
