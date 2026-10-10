"use strict";

const { ACTION, HARD_STATUS } = require("../../../engine-v2/src/abi/fast-codes");

const PAC_COMPLETE = 1;

const STAGE = Object.freeze({
  ROOT: 0,
  ENEMY_VISIBLE: 1,
  FIRE_CANDIDATE: 2,
  HARD_ALLOWED: 3,
  RISK_ACCEPTABLE: 4,
  RISK_FRONTIER: 5,
  PURPOSE_COMPLETE: 6,
  POSSIBLE_HIT: 7,
  DIRECT_KILL_LABEL: 8,
  PAC_COMPLETE: 9,
  POST_FIRE_ESCAPE: 10,
  COUNTER_EXPOSURE_OK: 11,
  RESPONSE_CONSTRAINT: 12,
  STRICT_KILL_CERTIFICATE: 13,
  QUALIFIED_ATTACK_EVIDENCE: 14,
  SELECTED_FIRE: 15,
  SELECTED_QUALIFIED_EVIDENCE: 16,
  SELECTED_STRICT_KILL: 17,
  COUNT: 18
});

const STAGE_NAME = Object.freeze([
  "root",
  "enemyVisible",
  "fireCandidate",
  "hardAllowed",
  "riskAcceptable",
  "riskFrontier",
  "purposeComplete",
  "possibleHit",
  "directKillLabel",
  "pacComplete",
  "postFireEscape",
  "counterExposureOk",
  "responseConstraint",
  "strictKillCertificate",
  "qualifiedAttackEvidence",
  "selectedFire",
  "selectedQualifiedEvidence",
  "selectedStrictKill"
]);

const BLOCK = Object.freeze({
  HARD: 0,
  RISK: 1,
  DOMINATED: 2,
  PURPOSE: 3,
  PAC: 4,
  ESCAPE: 5,
  COUNTER_EXPOSURE: 6,
  NO_RESPONSE_EFFECT: 7,
  QUALIFIED: 8,
  COUNT: 9
});

const BLOCK_NAME = Object.freeze([
  "hard",
  "risk",
  "dominated",
  "purpose",
  "pac",
  "escape",
  "counterExposure",
  "noResponseEffect",
  "qualified"
]);

function named(values, names) {
  const output = {};
  for (let index = 0; index < names.length; index += 1)
    output[names[index]] = values[index];
  return output;
}

// Diagnostic-only census. It never mutates ProductionRoot state and deliberately
// distinguishes a terminal/strict kill certificate from finite-horizon response
// constraint evidence.
class AttackOpportunityCensus {
  constructor() {
    this.row = new Uint32Array(STAGE.COUNT);
    this.root = new Uint32Array(STAGE.COUNT);
    this.block = new Uint32Array(BLOCK.COUNT);
    this.decisionCount = 0;
    this.hotAllocationCount = 0;
  }

  observe(engine, emittedAction) {
    this.decisionCount += 1;
    this.row[STAGE.ROOT] += 1;
    this.root[STAGE.ROOT] += 1;
    if (!engine || !engine.adapter || !engine.adapter.bundle) return;
    if (engine.adapter.enemyVisible) {
      this.row[STAGE.ENEMY_VISIBLE] += 1;
      this.root[STAGE.ENEMY_VISIBLE] += 1;
    }
    const combat = engine.combat && engine.combat.vector;
    const risk = engine.riskController && engine.riskController.outcome;
    if (!combat || !risk) return;
    let rootMask = 0;
    let selectedRow = -1;
    const selectedArgument = engine.lastArgument;
    for (let row = 0; row < engine.ourCount; row += 1) {
      if (engine.ourActions[row] === emittedAction &&
          engine.ourArguments[row] === selectedArgument && selectedRow < 0)
        selectedRow = row;
      if (engine.ourActions[row] !== ACTION.FIRE) continue;
      this.row[STAGE.FIRE_CANDIDATE] += 1;
      rootMask |= 1 << STAGE.FIRE_CANDIDATE;
      const hardAllowed = engine.hardStatus[row] === HARD_STATUS.ALLOW;
      const acceptable = hardAllowed && risk.acceptable[row] !== 0;
      const frontier = acceptable && risk.dominated[row] === 0;
      const purpose = combat.purposeCompleteness[row] >= 4500;
      const pacComplete = combat.attackClosureStatus[row] === PAC_COMPLETE;
      const escape = combat.postFireEscape[row] > 0;
      const exposure = combat.ownCounterExposure[row] < 10000;
      const constrained = pacComplete && combat.enemyUnknownFirstActions[row] === 0 &&
        (combat.enemyDoomedFirstActions[row] > 0 ||
         combat.enemyEndpointReduction[row] > 0 || combat.enemyMobilityLoss[row] > 0);
      const strictKill = pacComplete && combat.enemyUnknownFirstActions[row] === 0 &&
        combat.enemySurvivingFirstActions[row] === 0 &&
        combat.enemyDoomedFirstActions[row] > 0;
      const qualified = frontier && purpose && pacComplete && escape && exposure && constrained;
      if (hardAllowed) { this.row[STAGE.HARD_ALLOWED] += 1;
        rootMask |= 1 << STAGE.HARD_ALLOWED; }
      if (acceptable) { this.row[STAGE.RISK_ACCEPTABLE] += 1;
        rootMask |= 1 << STAGE.RISK_ACCEPTABLE; }
      if (frontier) { this.row[STAGE.RISK_FRONTIER] += 1;
        rootMask |= 1 << STAGE.RISK_FRONTIER; }
      if (purpose) { this.row[STAGE.PURPOSE_COMPLETE] += 1;
        rootMask |= 1 << STAGE.PURPOSE_COMPLETE; }
      if (combat.possibleHit[row]) { this.row[STAGE.POSSIBLE_HIT] += 1;
        rootMask |= 1 << STAGE.POSSIBLE_HIT; }
      if (combat.directKill[row]) { this.row[STAGE.DIRECT_KILL_LABEL] += 1;
        rootMask |= 1 << STAGE.DIRECT_KILL_LABEL; }
      if (pacComplete) { this.row[STAGE.PAC_COMPLETE] += 1;
        rootMask |= 1 << STAGE.PAC_COMPLETE; }
      if (escape) { this.row[STAGE.POST_FIRE_ESCAPE] += 1;
        rootMask |= 1 << STAGE.POST_FIRE_ESCAPE; }
      if (exposure) { this.row[STAGE.COUNTER_EXPOSURE_OK] += 1;
        rootMask |= 1 << STAGE.COUNTER_EXPOSURE_OK; }
      if (constrained) { this.row[STAGE.RESPONSE_CONSTRAINT] += 1;
        rootMask |= 1 << STAGE.RESPONSE_CONSTRAINT; }
      if (strictKill) { this.row[STAGE.STRICT_KILL_CERTIFICATE] += 1;
        rootMask |= 1 << STAGE.STRICT_KILL_CERTIFICATE; }
      if (qualified) { this.row[STAGE.QUALIFIED_ATTACK_EVIDENCE] += 1;
        rootMask |= 1 << STAGE.QUALIFIED_ATTACK_EVIDENCE; }

      if (!hardAllowed) this.block[BLOCK.HARD] += 1;
      else if (!acceptable) this.block[BLOCK.RISK] += 1;
      else if (!frontier) this.block[BLOCK.DOMINATED] += 1;
      else if (!purpose) this.block[BLOCK.PURPOSE] += 1;
      else if (!pacComplete) this.block[BLOCK.PAC] += 1;
      else if (!escape) this.block[BLOCK.ESCAPE] += 1;
      else if (!exposure) this.block[BLOCK.COUNTER_EXPOSURE] += 1;
      else if (!constrained) this.block[BLOCK.NO_RESPONSE_EFFECT] += 1;
      else this.block[BLOCK.QUALIFIED] += 1;
    }
    for (let stage = STAGE.FIRE_CANDIDATE; stage <= STAGE.QUALIFIED_ATTACK_EVIDENCE;
      stage += 1)
      if (rootMask & (1 << stage)) this.root[stage] += 1;

    if (emittedAction !== ACTION.FIRE || selectedRow < 0) return;
    this.row[STAGE.SELECTED_FIRE] += 1; this.root[STAGE.SELECTED_FIRE] += 1;
    const selectedQualified = engine.hardStatus[selectedRow] === HARD_STATUS.ALLOW &&
      risk.acceptable[selectedRow] && !risk.dominated[selectedRow] &&
      combat.purposeCompleteness[selectedRow] >= 4500 &&
      combat.attackClosureStatus[selectedRow] === PAC_COMPLETE &&
      combat.postFireEscape[selectedRow] > 0 &&
      combat.ownCounterExposure[selectedRow] < 10000 &&
      combat.enemyUnknownFirstActions[selectedRow] === 0 &&
      (combat.enemyDoomedFirstActions[selectedRow] > 0 ||
       combat.enemyEndpointReduction[selectedRow] > 0 ||
       combat.enemyMobilityLoss[selectedRow] > 0);
    if (selectedQualified) {
      this.row[STAGE.SELECTED_QUALIFIED_EVIDENCE] += 1;
      this.root[STAGE.SELECTED_QUALIFIED_EVIDENCE] += 1;
    }
    if (combat.attackClosureStatus[selectedRow] === PAC_COMPLETE &&
        combat.enemyUnknownFirstActions[selectedRow] === 0 &&
        combat.enemySurvivingFirstActions[selectedRow] === 0 &&
        combat.enemyDoomedFirstActions[selectedRow] > 0) {
      this.row[STAGE.SELECTED_STRICT_KILL] += 1;
      this.root[STAGE.SELECTED_STRICT_KILL] += 1;
    }
  }

  summary() {
    return {
      decisionCount: this.decisionCount,
      row: named(this.row, STAGE_NAME),
      root: named(this.root, STAGE_NAME),
      firstBlock: named(this.block, BLOCK_NAME),
      hotAllocationCount: this.hotAllocationCount
    };
  }
}

module.exports = { STAGE, STAGE_NAME, BLOCK, BLOCK_NAME, AttackOpportunityCensus };
