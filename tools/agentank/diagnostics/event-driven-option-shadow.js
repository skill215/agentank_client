"use strict";

const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { ACTION, HARD_STATUS, NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { PROOF_STATUS } = require("../../../engine-v2/src/abi/search-codes");
const { GLOBAL_MODE, NONE_HANDLE } = require(
  "../../../engine-v2/src/abi/policy-codes");
const { OPTION_KIND } = require("../../../engine-v2/src/policy/option-portfolio");
const { ROOT_CONTROL_MODE } = require(
  "../../../engine-v2/src/runtime/root-control-mode");

const LONG_OPTION = Object.freeze({
  NONE: 0,
  COMMITTED_RESCUE: 1,
  STRICT_PROOF: 2,
  ATTACK: 3,
  RESOURCE: 4,
  STAR_CONTROL: 5,
  TERMINAL: 6,
  POSITION: 7,
  COUNT: 8
});

const OPTION_EVENT = Object.freeze({
  MATCH_START: 1 << 0,
  STAR_TARGET: 1 << 1,
  STAR_SCORE: 1 << 2,
  ENEMY_VISIBILITY: 1 << 3,
  CONTACT_MODE: 1 << 4,
  RESOURCE_READY: 1 << 5,
  COMMITTED_DANGER: 1 << 6,
  TERMINAL_OR_EFFECT: 1 << 7
});

const OPTION_NAME = Object.freeze([
  "NONE", "COMMITTED_RESCUE", "STRICT_PROOF", "ATTACK", "RESOURCE",
  "STAR_CONTROL", "TERMINAL", "POSITION"
]);

const EVENT_NAME = Object.freeze([
  "MATCH_START", "STAR_TARGET", "STAR_SCORE", "ENEMY_VISIBILITY",
  "CONTACT_MODE", "RESOURCE_READY", "COMMITTED_DANGER", "TERMINAL_OR_EFFECT"
]);

function runBucket(length) {
  if (length <= 1) return 0;
  if (length === 2) return 1;
  if (length <= 4) return 2;
  if (length <= 8) return 3;
  return 4;
}

function namedArray(values, names) {
  const output = {};
  for (let index = 0; index < names.length; index += 1)
    output[names[index]] = values[index];
  return output;
}

function sparse(values) {
  const output = [];
  for (let index = 0; index < values.length; index += 1)
    if (values[index]) output.push([index, values[index]]);
  return output;
}

// Diagnostic-only observer. It never mutates the engine or chooses an action.
// observe() is scalar/TypedArray-only; allocations are confined to summary().
class EventDrivenOptionShadow {
  constructor() {
    this.selectedKind = new Uint32Array(LONG_OPTION.COUNT);
    this.riskEligibleKind = new Uint32Array(LONG_OPTION.COUNT);
    this.availableKind = new Uint32Array(LONG_OPTION.COUNT);
    this.eventFramesByBit = new Uint32Array(8);
    this.switchesByEventBit = new Uint32Array(8);
    this.switchMatrix = new Uint32Array(LONG_OPTION.COUNT * LONG_OPTION.COUNT);
    this.eventSwitchMatrix = new Uint32Array(LONG_OPTION.COUNT * LONG_OPTION.COUNT);
    this.unsignaledSwitchMatrix = new Uint32Array(LONG_OPTION.COUNT * LONG_OPTION.COUNT);
    this.foregoneMatrix = new Uint32Array(LONG_OPTION.COUNT * LONG_OPTION.COUNT);
    this.riskEligibleMask = new Uint32Array(1 << LONG_OPTION.COUNT);
    this.availableMask = new Uint32Array(1 << LONG_OPTION.COUNT);
    this.completedRunLength = new Uint32Array(5);
    this.decisionCount = 0;
    this.matchCount = 0;
    this.contextEpoch = 0;
    this.eventFrameCount = 0;
    this.noEventFrameCount = 0;
    this.continuationCount = 0;
    this.optionSwitchCount = 0;
    this.eventOptionSwitchCount = 0;
    this.unsignaledOptionSwitchCount = 0;
    this.targetSwitchCount = 0;
    this.eventTargetSwitchCount = 0;
    this.unsignaledTargetSwitchCount = 0;
    this.planSignatureSwitchCount = 0;
    this.unsignaledPlanSignatureSwitchCount = 0;
    this.selectedPlanCount = 0;
    this.selectedPurposeIncompleteCount = 0;
    this.selectedUnownedCount = 0;
    this.riskEligibleAlternativeRootCount = 0;
    this.availableAlternativeRootCount = 0;
    this.selectedKindUnavailableCount = 0;
    this.attackAvailableRootCount = 0;
    this.attackForegoneRootCount = 0;
    this.riskEligibleAttackRootCount = 0;
    this.riskEligibleAttackForegoneRootCount = 0;
    this.resourceForegoneRootCount = 0;
    this.starForegoneRootCount = 0;
    this.maximumRunLength = 0;
    this.hotAllocationCount = 0;
    this.initialized = 0;
    this.previousFrame = -1;
    this.previousStar = NONE_CELL;
    this.starGeneration = 0;
    this.previousOwnStars = 0;
    this.previousEnemyStars = 0;
    this.previousVisible = 0;
    this.previousControlMode = 0;
    this.previousResourceReady = 0;
    this.previousCommittedState = 0;
    this.previousTerminalEffect = 0;
    this.previousKind = LONG_OPTION.NONE;
    this.previousTarget = 0;
    this.previousPlanSignature = 0;
    this.currentRunLength = 0;
    this.lastEventMask = 0;
    this.lastAvailabilityMask = 0;
    this.lastSelectedKind = LONG_OPTION.NONE;
    this.lastTargetSignature = 0;
  }

  resourceAction(action) {
    return action === ACTION.THROW_BOMB || action >= ACTION.CAST_SHIELD;
  }

  portfolioMask(engine, row) {
    const portfolio = engine.optionPortfolio;
    if (!portfolio) return 0;
    let mask = 0;
    for (let at = 0; at < portfolio.count; at += 1)
      if (portfolio.primitiveRow[at] === row) mask |= 1 << portfolio.kind[at];
    return mask;
  }

  forcedWinRow(engine) {
    if (engine.lastProofStatus !== PROOF_STATUS.PROVEN ||
        typeof engine.forcedWinRow !== "function") return -1;
    return engine.forcedWinRow();
  }

  classifyRow(engine, row, forcedRow) {
    if (row < 0 || row >= engine.ourCount) return LONG_OPTION.NONE;
    const action = engine.ourActions[row];
    const escape = engine.escapeObligation;
    if ((engine.lastSelectionWasStrictRescue && row === engine.finalGate.lastSelected) ||
        (engine.lastControlMode === ROOT_CONTROL_MODE.COMMITTED_ESCAPE &&
         escape && escape.member[row])) return LONG_OPTION.COMMITTED_RESCUE;
    if (row === forcedRow) return LONG_OPTION.STRICT_PROOF;
    if (this.resourceAction(action)) return LONG_OPTION.RESOURCE;
    const mask = this.portfolioMask(engine, row);
    if (mask & ((1 << OPTION_KIND.DIRECT_KILL) |
        (1 << OPTION_KIND.ATTACK_SETUP))) return LONG_OPTION.ATTACK;
    if (action === ACTION.FIRE) return LONG_OPTION.ATTACK;
    if (mask & (1 << OPTION_KIND.STAR_CONTROL)) return LONG_OPTION.STAR_CONTROL;
    if (mask & (1 << OPTION_KIND.TERMINAL)) return LONG_OPTION.TERMINAL;
    if (engine.rootGlobalMode() !== GLOBAL_MODE.NORMAL &&
        (action === ACTION.GO || action === ACTION.TURN_LEFT ||
         action === ACTION.TURN_RIGHT || action === ACTION.NONE))
      return LONG_OPTION.TERMINAL;
    if (mask & (1 << OPTION_KIND.POSITION)) return LONG_OPTION.POSITION;
    return LONG_OPTION.NONE;
  }

  selectedRow(engine, emittedAction) {
    const selected = engine.finalGate && engine.finalGate.lastSelected;
    if (Number.isSafeInteger(selected) && selected >= 0 && selected < engine.ourCount)
      return selected;
    for (let row = 0; row < engine.ourCount; row += 1)
      if (engine.ourActions[row] === emittedAction &&
          engine.ourArguments[row] === engine.lastArgument) return row;
    return -1;
  }

  planSignature(engine, row) {
    if (row < 0 || !engine.planSketchHandle || !engine.policy ||
        !engine.policy.sketches) return 0;
    const handle = engine.planSketchHandle[row];
    const sketches = engine.policy.sketches;
    return handle === NONE_HANDLE || handle >= sketches.used ? 0 :
      sketches.targetSignature[handle] >>> 0;
  }

  portfolioHasComplete(engine, row, firstKind, secondKind = -1) {
    const portfolio = engine.optionPortfolio;
    if (!portfolio) return 0;
    for (let at = 0; at < portfolio.count; at += 1)
      if (portfolio.primitiveRow[at] === row && portfolio.supportComplete[at] &&
          (portfolio.kind[at] === firstKind || portfolio.kind[at] === secondKind)) return 1;
    return 0;
  }

  targetSignature(engine, kind, row, action) {
    const state = engine.adapter.state; const a = state.arrays;
    if (kind === LONG_OPTION.COMMITTED_RESCUE) {
      const escape = engine.escapeObligation; let signature = 0x10000000;
      for (let at = 0; at < escape.entityCount; at += 1)
        signature = (signature ^ ((escape.entityKind[at] << 28) >>> 0) ^
          escape.entityId[at] ^ (escape.entityGeneration[at] << 12)) >>> 0;
      return signature;
    }
    if (kind === LONG_OPTION.STRICT_PROOF || kind === LONG_OPTION.ATTACK)
      return 0x30000001;
    if (kind === LONG_OPTION.RESOURCE)
      return (0x40000000 | (action & 0xff)) >>> 0;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (kind === LONG_OPTION.STAR_CONTROL ||
        (kind === LONG_OPTION.POSITION && star !== NONE_CELL))
      return (0x50000000 | ((this.starGeneration & 0xfff) << 16) |
        (star & 0xffff)) >>> 0;
    if (kind === LONG_OPTION.TERMINAL)
      return (0x60000000 | ((engine.rootGlobalMode() & 0xf) << 20) |
        ((a[ARRAY.TANK_STARS][0] & 0x3ff) << 10) |
        (a[ARRAY.TANK_STARS][1] & 0x3ff)) >>> 0;
    if (kind === LONG_OPTION.POSITION && engine.adapter.enemyVisible)
      return 0x70000001;
    return 0;
  }

  purposeComplete(engine, kind, row, action) {
    if (kind === LONG_OPTION.ATTACK) {
      const combat = engine.combat && engine.combat.vector;
      return combat && combat.purposeCompleteness[row] >= 4500 &&
        this.portfolioHasComplete(engine, row, OPTION_KIND.DIRECT_KILL,
          OPTION_KIND.ATTACK_SETUP) ? 1 : 0;
    }
    if (kind === LONG_OPTION.RESOURCE) {
      const portfolio = engine.optionPortfolio;
      return portfolio && portfolio.typedResourceVerified(action, row,
        engine.combat.vector, engine.adapter.state, engine.adapter.enemyVisible) ? 1 : 0;
    }
    if (kind === LONG_OPTION.STAR_CONTROL)
      return engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.STAR_CELL] !== NONE_CELL &&
        this.portfolioHasComplete(engine, row, OPTION_KIND.STAR_CONTROL) ? 1 : 0;
    if (kind === LONG_OPTION.TERMINAL)
      return engine.rootGlobalMode() !== GLOBAL_MODE.NORMAL &&
        this.portfolioHasComplete(engine, row, OPTION_KIND.TERMINAL) ? 1 : 0;
    if (kind === LONG_OPTION.POSITION)
      return this.portfolioHasComplete(engine, row, OPTION_KIND.POSITION);
    if (kind === LONG_OPTION.COMMITTED_RESCUE)
      return engine.escapeObligation.supportStatus === 1 &&
        engine.escapeObligation.member[row] ? 1 : 0;
    if (kind === LONG_OPTION.STRICT_PROOF)
      return engine.lastProofStatus === PROOF_STATUS.PROVEN ? 1 : 0;
    return 0;
  }

  externalState(engine, frame) {
    const a = engine.adapter.state.arrays;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const ownStars = a[ARRAY.TANK_STARS][0]; const enemyStars = a[ARRAY.TANK_STARS][1];
    const visible = engine.adapter.enemyVisible ? 1 : 0;
    const control = engine.lastControlMode | 0;
    const resources = (engine.adapter.ownBombReady ? 1 : 0) |
      (engine.adapter.ownSkillReady ? 2 : 0);
    const escape = engine.escapeObligation;
    const committed = ((escape.supportStatus & 3) << 12) |
      ((escape.committedEntityCount & 0xff) << 4) | (escape.firstActionCount & 0xf);
    const enemyPoison = a[ARRAY.TANK_POISON_UNTIL] &&
      a[ARRAY.TANK_POISON_UNTIL][1] > frame ? 1 : 0;
    const enemyShield = a[ARRAY.TANK_SHIELD_HITS] ? a[ARRAY.TANK_SHIELD_HITS][1] : 0;
    const terminalEffect = (engine.rootGlobalMode() & 0xf) |
      ((enemyPoison & 1) << 4) | ((enemyShield & 3) << 5);
    let event = 0;
    if (!this.initialized) event = OPTION_EVENT.MATCH_START;
    else {
      if (star !== this.previousStar) event |= OPTION_EVENT.STAR_TARGET;
      if (ownStars !== this.previousOwnStars || enemyStars !== this.previousEnemyStars)
        event |= OPTION_EVENT.STAR_SCORE;
      if (visible !== this.previousVisible) event |= OPTION_EVENT.ENEMY_VISIBILITY;
      if (control !== this.previousControlMode) event |= OPTION_EVENT.CONTACT_MODE;
      if (resources !== this.previousResourceReady) event |= OPTION_EVENT.RESOURCE_READY;
      if (committed !== this.previousCommittedState) event |= OPTION_EVENT.COMMITTED_DANGER;
      if (terminalEffect !== this.previousTerminalEffect)
        event |= OPTION_EVENT.TERMINAL_OR_EFFECT;
    }
    if (!this.initialized || star !== this.previousStar) this.starGeneration += 1;
    this.previousStar = star; this.previousOwnStars = ownStars;
    this.previousEnemyStars = enemyStars; this.previousVisible = visible;
    this.previousControlMode = control; this.previousResourceReady = resources;
    this.previousCommittedState = committed; this.previousTerminalEffect = terminalEffect;
    return event;
  }

  observe(engine, emittedAction) {
    if (!engine || !engine.adapter || !engine.adapter.state) return;
    const frame = engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    let continuing = this.initialized && frame > this.previousFrame;
    if (this.initialized && frame <= this.previousFrame) {
      if (this.currentRunLength) {
        this.completedRunLength[runBucket(this.currentRunLength)] += 1;
        if (this.currentRunLength > this.maximumRunLength)
          this.maximumRunLength = this.currentRunLength;
      }
      this.initialized = 0; this.currentRunLength = 0;
      this.previousKind = LONG_OPTION.NONE; this.previousTarget = 0;
      this.previousPlanSignature = 0;
      continuing = 0;
    }
    const event = this.externalState(engine, frame);
    this.matchCount += this.initialized ? 0 : 1;
    this.initialized = 1; this.previousFrame = frame;
    this.decisionCount += 1; this.lastEventMask = event;
    if (event) {
      this.contextEpoch += 1; this.eventFrameCount += 1;
      for (let bit = 0; bit < 8; bit += 1)
        if (event & (1 << bit)) this.eventFramesByBit[bit] += 1;
    } else this.noEventFrameCount += 1;

    const selected = this.selectedRow(engine, emittedAction);
    const forced = this.forcedWinRow(engine);
    const kind = this.classifyRow(engine, selected, forced);
    const action = selected < 0 ? emittedAction : engine.ourActions[selected];
    const target = this.targetSignature(engine, kind, selected, action);
    const planSignature = this.planSignature(engine, selected);
    let riskEligibility = 0; let availability = 0;
    const risk = engine.riskController && engine.riskController.outcome;
    for (let row = 0; row < engine.ourCount; row += 1) {
      if (engine.hardStatus[row] !== HARD_STATUS.ALLOW || !risk ||
          row >= risk.count || !risk.acceptable[row] || risk.dominated[row]) continue;
      const rowKind = this.classifyRow(engine, row, forced);
      if (rowKind === LONG_OPTION.NONE) continue;
      riskEligibility |= 1 << rowKind;
      if (this.purposeComplete(engine, rowKind, row, engine.ourActions[row]))
        availability |= 1 << rowKind;
    }
    this.lastAvailabilityMask = availability;
    this.riskEligibleMask[riskEligibility] += 1; this.availableMask[availability] += 1;
    this.lastSelectedKind = kind; this.lastTargetSignature = target;
    this.selectedKind[kind] += 1;
    for (let option = 1; option < LONG_OPTION.COUNT; option += 1) {
      if (riskEligibility & (1 << option)) this.riskEligibleKind[option] += 1;
      if (availability & (1 << option)) this.availableKind[option] += 1;
    }
    if (!(availability & (1 << kind))) this.selectedKindUnavailableCount += 1;
    if (kind === LONG_OPTION.NONE) this.selectedUnownedCount += 1;
    const riskAlternatives = riskEligibility & ~(1 << kind);
    if (riskAlternatives) this.riskEligibleAlternativeRootCount += 1;
    const alternatives = availability & ~(1 << kind);
    if (alternatives) this.availableAlternativeRootCount += 1;
    if (availability & (1 << LONG_OPTION.ATTACK)) {
      this.attackAvailableRootCount += 1;
      if (kind !== LONG_OPTION.ATTACK) this.attackForegoneRootCount += 1;
    }
    if (riskEligibility & (1 << LONG_OPTION.ATTACK)) {
      this.riskEligibleAttackRootCount += 1;
      if (kind !== LONG_OPTION.ATTACK) this.riskEligibleAttackForegoneRootCount += 1;
    }
    if (kind !== LONG_OPTION.RESOURCE && availability & (1 << LONG_OPTION.RESOURCE))
      this.resourceForegoneRootCount += 1;
    if (kind !== LONG_OPTION.STAR_CONTROL && availability & (1 << LONG_OPTION.STAR_CONTROL))
      this.starForegoneRootCount += 1;
    for (let option = 1; option < LONG_OPTION.COUNT; option += 1)
      if (alternatives & (1 << option))
        this.foregoneMatrix[kind * LONG_OPTION.COUNT + option] += 1;
    if (!this.purposeComplete(engine, kind, selected, action))
      this.selectedPurposeIncompleteCount += 1;
    if (planSignature) this.selectedPlanCount += 1;

    if (continuing) {
      if (kind === this.previousKind) {
        this.continuationCount += 1; this.currentRunLength += 1;
      } else {
        const cell = this.previousKind * LONG_OPTION.COUNT + kind;
        this.optionSwitchCount += 1; this.switchMatrix[cell] += 1;
        if (event) {
          this.eventOptionSwitchCount += 1; this.eventSwitchMatrix[cell] += 1;
          for (let bit = 0; bit < 8; bit += 1)
            if (event & (1 << bit)) this.switchesByEventBit[bit] += 1;
        } else {
          this.unsignaledOptionSwitchCount += 1; this.unsignaledSwitchMatrix[cell] += 1;
        }
        if (this.currentRunLength) {
          this.completedRunLength[runBucket(this.currentRunLength)] += 1;
          if (this.currentRunLength > this.maximumRunLength)
            this.maximumRunLength = this.currentRunLength;
        }
        this.currentRunLength = 1;
      }
      if (target !== this.previousTarget) {
        this.targetSwitchCount += 1;
        if (event) this.eventTargetSwitchCount += 1;
        else this.unsignaledTargetSwitchCount += 1;
      }
      if (planSignature !== this.previousPlanSignature) {
        this.planSignatureSwitchCount += 1;
        if (!event) this.unsignaledPlanSignatureSwitchCount += 1;
      }
    } else this.currentRunLength = 1;
    this.previousKind = kind; this.previousTarget = target;
    this.previousPlanSignature = planSignature;
  }

  summary() {
    const runs = Array.from(this.completedRunLength);
    if (this.currentRunLength) runs[runBucket(this.currentRunLength)] += 1;
    return {
      decisionCount: this.decisionCount,
      matchCount: this.matchCount,
      contextEpochs: this.contextEpoch,
      eventFrameCount: this.eventFrameCount,
      noEventFrameCount: this.noEventFrameCount,
      continuationCount: this.continuationCount,
      optionSwitchCount: this.optionSwitchCount,
      eventOptionSwitchCount: this.eventOptionSwitchCount,
      unsignaledOptionSwitchCount: this.unsignaledOptionSwitchCount,
      targetSwitchCount: this.targetSwitchCount,
      eventTargetSwitchCount: this.eventTargetSwitchCount,
      unsignaledTargetSwitchCount: this.unsignaledTargetSwitchCount,
      planSignatureSwitchCount: this.planSignatureSwitchCount,
      unsignaledPlanSignatureSwitchCount: this.unsignaledPlanSignatureSwitchCount,
      selectedPlanCount: this.selectedPlanCount,
      selectedPurposeIncompleteCount: this.selectedPurposeIncompleteCount,
      selectedUnownedCount: this.selectedUnownedCount,
      riskEligibleAlternativeRootCount: this.riskEligibleAlternativeRootCount,
      availableAlternativeRootCount: this.availableAlternativeRootCount,
      selectedKindUnavailableCount: this.selectedKindUnavailableCount,
      attackAvailableRootCount: this.attackAvailableRootCount,
      attackForegoneRootCount: this.attackForegoneRootCount,
      riskEligibleAttackRootCount: this.riskEligibleAttackRootCount,
      riskEligibleAttackForegoneRootCount: this.riskEligibleAttackForegoneRootCount,
      resourceForegoneRootCount: this.resourceForegoneRootCount,
      starForegoneRootCount: this.starForegoneRootCount,
      maximumRunLength: Math.max(this.maximumRunLength, this.currentRunLength),
      runLengthBuckets: runs,
      selectedKind: namedArray(this.selectedKind, OPTION_NAME),
      riskEligibleKind: namedArray(this.riskEligibleKind, OPTION_NAME),
      availableKind: namedArray(this.availableKind, OPTION_NAME),
      eventFramesByBit: namedArray(this.eventFramesByBit, EVENT_NAME),
      switchesByEventBit: namedArray(this.switchesByEventBit, EVENT_NAME),
      switchMatrix: sparse(this.switchMatrix),
      eventSwitchMatrix: sparse(this.eventSwitchMatrix),
      unsignaledSwitchMatrix: sparse(this.unsignaledSwitchMatrix),
      foregoneMatrix: sparse(this.foregoneMatrix),
      riskEligibleMasks: sparse(this.riskEligibleMask),
      availableMasks: sparse(this.availableMask),
      lastEventMask: this.lastEventMask,
      lastAvailabilityMask: this.lastAvailabilityMask,
      lastSelectedKind: this.lastSelectedKind,
      lastTargetSignature: this.lastTargetSignature,
      hotAllocationCount: this.hotAllocationCount
    };
  }
}

module.exports = { LONG_OPTION, OPTION_EVENT, OPTION_NAME, EVENT_NAME,
  EventDrivenOptionShadow };
