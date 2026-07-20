"use strict";

const { RUNTIME_CONFIG, SEARCH_BUDGET, BUILD_CONFIG } = require("../generated/runtime-config");
const { RUNTIME_MODE, RUNTIME_BUDGET_MODE, CLOCK_HEALTH, WORK_KIND,
  EMERGENCY_REASON } = require("../abi/cache-runtime-codes");
const { HARD_STATUS, ACTION, NONE_CELL } = require("../abi/fast-codes");

class EmergencyReserve {
  constructor() {
    this.rootFacts = new Uint32Array(BUILD_CONFIG.EMERGENCY_ROOT_FACTS);
    this.terrainScratch = new Uint16Array(BUILD_CONFIG.EMERGENCY_TERRAIN_CELLS);
    this.hazardScratch = new Uint16Array(BUILD_CONFIG.EMERGENCY_HAZARD_CELLS);
    this.actionProgram = new Uint16Array(BUILD_CONFIG.EMERGENCY_ACTION_SLOTS);
    this.result = new Int32Array(16); this.coverage = new Uint32Array(8);
    this.used = 0; this.activationCount = 0; this.hotAllocationCount = 0;
  }
  resetRoot() { this.used = 0; this.result.fill(0); this.coverage.fill(0); }
  bytes() { return this.rootFacts.byteLength + this.terrainScratch.byteLength +
    this.hazardScratch.byteLength + this.actionProgram.byteLength + this.result.byteLength +
    this.coverage.byteLength; }
}

class RuntimeController {
  constructor(options = {}) {
    this.runtimeConfig = options.runtimeConfig || RUNTIME_CONFIG;
    this.searchBudget = options.searchBudget || SEARCH_BUDGET;
    this.budgetMode = RUNTIME_BUDGET_MODE.CALIBRATED_WORK_COUNTER;
    this.clockHealth = CLOCK_HEALTH.UNAVAILABLE; this.runtimeMode = RUNTIME_MODE.NORMAL;
    this.fallbackLatched = 0; this.emergencyReason = EMERGENCY_REASON.NONE;
    this.accumulatedWorkUnits = 0; this.currentCallbackWorkUnits = 0;
    this.accountedWorkUnits = 0; this.fallbackEnterAt = 0; this.emergencyEnterAt = 0;
    this.matchRuntimeGeneration = 0; this.lastPlatformFrame = 0xffff;
    this.matchFingerprintLo = 0; this.matchFingerprintHi = 0; this.callbackCount = 0;
    this.modeTransitionCount = 0; this.batchCount = 0; this.unknownChargeCount = 0;
    this.calibrationValid = options.calibrationValid === false ? 0 : 1;
    this.emergency = options.emergencyReserve || new EmergencyReserve(); this.hotAllocationCount = 0;
  }
  resetMatch(frame, fingerprintLo, fingerprintHi) {
    this.matchRuntimeGeneration += 1; this.accumulatedWorkUnits = 0;
    this.currentCallbackWorkUnits = 0; this.accountedWorkUnits = 0;
    this.runtimeMode = RUNTIME_MODE.NORMAL; this.fallbackLatched = 0;
    this.emergencyReason = EMERGENCY_REASON.NONE; this.fallbackEnterAt = 0;
    this.emergencyEnterAt = 0; this.lastPlatformFrame = frame; this.matchFingerprintLo = fingerprintLo >>> 0;
    this.matchFingerprintHi = fingerprintHi >>> 0; this.emergency.resetRoot(); return this.matchRuntimeGeneration;
  }
  beginCallback(frame, fingerprintLo, fingerprintHi, confirmedNewMatch = false) {
    const fingerprintChanged = this.matchFingerprintLo !== (fingerprintLo >>> 0) ||
      this.matchFingerprintHi !== (fingerprintHi >>> 0);
    const reset = this.matchRuntimeGeneration === 0 || confirmedNewMatch ||
      (frame === 0 && this.lastPlatformFrame !== 0xffff && this.lastPlatformFrame > frame && fingerprintChanged);
    if (reset) this.resetMatch(frame, fingerprintLo, fingerprintHi);
    this.currentCallbackWorkUnits = 0; this.accountedWorkUnits = this.accumulatedWorkUnits;
    this.lastPlatformFrame = frame; this.callbackCount += 1; this.emergency.resetRoot();
    if (!this.calibrationValid) this.enterEmergency(EMERGENCY_REASON.CLOCK_UNTRUSTED);
    return this.evaluateMode();
  }
  enterMode(mode, reason = EMERGENCY_REASON.NONE) {
    if (mode < this.runtimeMode || this.runtimeMode === RUNTIME_MODE.EMERGENCY) return this.runtimeMode;
    if (mode !== this.runtimeMode) this.modeTransitionCount += 1;
    this.runtimeMode = mode;
    if (mode >= RUNTIME_MODE.FALLBACK) { if (!this.fallbackLatched)
      this.fallbackEnterAt = this.accountedWorkUnits; this.fallbackLatched = 1; }
    if (mode === RUNTIME_MODE.EMERGENCY) { this.emergencyReason = reason;
      this.emergencyEnterAt = this.accountedWorkUnits; this.emergency.activationCount += 1; }
    return this.runtimeMode;
  }
  enterEmergency(reason) { return this.enterMode(RUNTIME_MODE.EMERGENCY, reason); }
  evaluateMode() {
    const config = this.runtimeConfig;
    this.accountedWorkUnits = this.accumulatedWorkUnits + this.currentCallbackWorkUnits;
    if (!Number.isSafeInteger(this.accountedWorkUnits)) return this.enterEmergency(EMERGENCY_REASON.UNKNOWN_WORK);
    // Frame floors are deterministic secondary triggers. They never divide the
    // 128-frame game into a time budget and never replace cumulative work; a
    // profile may omit them, in which case only the work counter is active.
    const degradedFrame = Number.isSafeInteger(config.DEGRADED_ENTER_FRAME) ?
      config.DEGRADED_ENTER_FRAME : 0xffff;
    const fallbackFrame = Number.isSafeInteger(config.FALLBACK_ENTER_FRAME) ?
      config.FALLBACK_ENTER_FRAME : 0xffff;
    const emergencyFrame = Number.isSafeInteger(config.EMERGENCY_ENTER_FRAME) ?
      config.EMERGENCY_ENTER_FRAME : 0xffff;
    if (this.currentCallbackWorkUnits >= config.PER_CALLBACK_WORK_UNIT_LIMIT)
      return this.enterEmergency(EMERGENCY_REASON.CALLBACK_LIMIT);
    if (this.accountedWorkUnits >= config.EMERGENCY_ENTER_WORK_UNITS ||
        this.lastPlatformFrame >= emergencyFrame)
      return this.enterEmergency(this.lastPlatformFrame >= emergencyFrame ?
        EMERGENCY_REASON.FRAME_FLOOR : EMERGENCY_REASON.CUMULATIVE_LIMIT);
    if (this.accountedWorkUnits >= config.FALLBACK_ENTER_WORK_UNITS ||
        this.lastPlatformFrame >= fallbackFrame || this.fallbackLatched)
      return this.enterMode(RUNTIME_MODE.FALLBACK);
    if (this.accountedWorkUnits >= config.DEGRADED_ENTER_WORK_UNITS ||
        this.lastPlatformFrame >= degradedFrame)
      return this.enterMode(RUNTIME_MODE.DEGRADED);
    return this.runtimeMode;
  }
  chargeUnits(units, kind = WORK_KIND.UNKNOWN) {
    if (!Number.isSafeInteger(units) || units < 0 || kind < 0 || kind >= WORK_KIND.COUNT) {
      this.unknownChargeCount += 1; return this.enterEmergency(EMERGENCY_REASON.UNKNOWN_WORK); }
    this.currentCallbackWorkUnits += units; this.batchCount += 1; return this.evaluateMode();
  }
  charge(kind, count = 1) {
    if (kind < 0 || kind >= WORK_KIND.COUNT || !Number.isSafeInteger(count) || count < 0) {
      this.unknownChargeCount += 1; return this.enterEmergency(EMERGENCY_REASON.UNKNOWN_WORK); }
    return this.chargeUnits(this.runtimeConfig.WORK_CHARGES[kind] * count, kind);
  }
  canStartBatch(kind, count = 1) {
    if (kind < 0 || kind >= WORK_KIND.COUNT || !Number.isSafeInteger(count) || count < 0) {
      this.enterEmergency(EMERGENCY_REASON.UNKNOWN_WORK); return 0; }
    const config = this.runtimeConfig; const charge = config.WORK_CHARGES[kind] * count;
    const predicted = this.accumulatedWorkUnits + this.currentCallbackWorkUnits + charge;
    if (predicted + config.MINIMUM_EMERGENCY_BATCH_RESERVE >=
        config.EMERGENCY_ENTER_WORK_UNITS ||
        this.currentCallbackWorkUnits + charge >= config.PER_CALLBACK_WORK_UNIT_LIMIT) {
      this.enterEmergency(EMERGENCY_REASON.RESERVE_INTRUSION); return 0;
    }
    if (predicted >= config.FALLBACK_ENTER_WORK_UNITS && !this.fallbackLatched)
      this.enterMode(RUNTIME_MODE.FALLBACK);
    else if (predicted >= config.DEGRADED_ENTER_WORK_UNITS)
      this.enterMode(RUNTIME_MODE.DEGRADED);
    return this.runtimeMode !== RUNTIME_MODE.EMERGENCY;
  }
  finishCallback() {
    this.accumulatedWorkUnits += this.currentCallbackWorkUnits;
    this.currentCallbackWorkUnits = 0; this.accountedWorkUnits = this.accumulatedWorkUnits;
    this.evaluateMode(); return this.runtimeMode;
  }
  budgetProfileId() { return this.runtimeMode; }
  writeSearchOptions(out) {
    const mode = this.runtimeMode; const budget = this.searchBudget;
    out.nodeBudget = budget.NODE_BUDGET[mode];
    out.proofBudget = budget.PROOF_BUDGET[mode];
    out.matrixIterations = budget.MATRIX_ITERATIONS[mode];
    out.matrixBatch = budget.MATRIX_BATCH[mode];
    out.decisionDepth = budget.DECISION_DEPTH[mode]; return mode;
  }
}

class RuntimeSearchCoordinator {
  constructor() { this.options = { nodeBudget: 0, proofBudget: 0, matrixIterations: 0,
    matrixBatch: 0, decisionDepth: 0 }; this.minimaxInvocationCount = 0;
    this.emergencySkipCount = 0; this.lastStatus = 0; this.hotAllocationCount = 0; }
  solve(engine, root, runtime, extraOptions) {
    runtime.writeSearchOptions(this.options);
    if (runtime.runtimeMode === RUNTIME_MODE.EMERGENCY) { this.emergencySkipCount += 1; return 0; }
    if (!runtime.canStartBatch(WORK_KIND.VALUE_NODE, this.options.nodeBudget)) {
      this.emergencySkipCount += 1; return 0; }
    // canStartBatch may cross a mode threshold. Refresh the options so the
    // search that follows always uses the newly latched budget profile.
    runtime.writeSearchOptions(this.options);
    const options = extraOptions || this.options;
    if (extraOptions) { extraOptions.nodeBudget = this.options.nodeBudget;
      extraOptions.proofBudget = this.options.proofBudget;
      extraOptions.matrixIterations = this.options.matrixIterations;
      extraOptions.matrixBatch = this.options.matrixBatch;
      extraOptions.decisionDepth = this.options.decisionDepth; }
    this.minimaxInvocationCount += 1; this.lastStatus = engine.solveRoot(root, options);
    runtime.charge(WORK_KIND.VALUE_NODE, Math.max(1, engine.value.visitedNodes)); return this.lastStatus;
  }
}

class EmergencyEmitter {
  constructor(reserve) { this.reserve = reserve; this.hardCheckedActions = 0;
    this.emitCount = 0; this.lastAction = ACTION.NONE; this.lastArgument = NONE_CELL;
    this.hotAllocationCount = 0; }
  select(bundle, actions, arguments_, count) {
    if (!bundle || !bundle.hard || count < 1 || count > actions.length ||
        count > arguments_.length) return 0;
    for (let index = 0; index < count; index += 1) { const hard =
      bundle.hard.evaluateAllOwnChance(actions[index], arguments_[index]);
      this.hardCheckedActions += 1;
      if (hard === HARD_STATUS.ALLOW) { this.lastAction = actions[index];
        this.lastArgument = arguments_[index]; this.reserve.actionProgram[0] = this.lastAction;
        this.reserve.actionProgram[1] = this.lastArgument; this.reserve.used = 2;
        this.emitCount += 1; return 1; } }
    this.lastAction = ACTION.NONE; this.lastArgument = NONE_CELL; return 0;
  }
}

module.exports = { EmergencyReserve, RuntimeController, RuntimeSearchCoordinator, EmergencyEmitter };
