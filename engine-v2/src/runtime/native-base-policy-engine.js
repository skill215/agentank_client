"use strict";

// Standalone upload-shaped host for the closed BP68 policy.  It deliberately
// does not import ProductionRootEngine: observation, Hard/Safety/Risk,
// committed rescue, bounded Minimax and emission execute exactly once.
const { SEARCH_CAPACITY } = require("../generated/search-config");
const { CAPACITY, RULE } = require("../generated/fast-config");
const { TACTICAL_CONFIG } = require("../generated/tactical-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { ACTION, HARD_STATUS, SKILL, TERRAIN, NONE_FRAME, NONE_CELL, DX, DY } =
  require("../abi/fast-codes");
const { PROOF_STATUS } = require("../abi/search-codes");
const { ProductionObservationAdapter } = require("./production-observation");
const { FinalActionGate } = require("./final-action-gate");
const { EscapeObligation, SUPPORT_STATUS } = require("./escape-obligation");
const { ROOT_CONTROL_MODE } = require("./root-control-mode");
const { InformationSafetyClosure, SAFETY_STATUS, NONE_FATAL_FRAME } = require(
  "../search/information-safety-closure");
const { ObservationSafetyFrontier, FRONTIER_STATUS } = require(
  "../search/observation-safety-frontier");
const { ThreatCapabilityTimeline } = require(
  "../search/threat-capability-timeline");
const { MultiFrameRiskBounds } = require("../search/multi-frame-risk-bounds");
const { RiskAcceptanceController } = require(
  "../search/risk-acceptance-controller");
const { CombatPressure } = require("../search/combat-pressure");
const { PossibleProjectileTracker } = require("./possible-projectiles");
const { StrategyInputFrame, StrategySelector } = require(
  "../policy/strategy-selector");
const { StrategyBandSlab, StrategicArbiter } = require(
  "../policy/strategy-layer");
const { GLOBAL_MODE, STRATEGY_INPUT, STRATEGY_MODIFIER, STRATEGY_PURPOSE } =
  require("../abi/policy-codes");
const { NativeBasePolicyRoot } = require(
  "../base-policy-specialized/native-root");

const BASE_RISK = 65;

class NativeBasePolicyEngine {
  constructor() {
    this.adapter = new ProductionObservationAdapter();
    this.finalGate = new FinalActionGate();
    this.safetyClosure = new InformationSafetyClosure();
    this.observationSafety = new ObservationSafetyFrontier();
    this.threatCapability = new ThreatCapabilityTimeline();
    this.multiFrameRisk = new MultiFrameRiskBounds();
    this.riskController = new RiskAcceptanceController();
    this.combat = new CombatPressure();
    this.possibleProjectiles = new PossibleProjectileTracker();
    this.escapeObligation = new EscapeObligation();
    this.strategyInput = new StrategyInputFrame();
    this.strategySelector = new StrategySelector();
    this.strategyBands = new StrategyBandSlab();
    this.strategicArbiter = new StrategicArbiter();
    this.policyProbability = new Uint16Array(
      SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.strategyId = this.strategySelector.current;
    this.basePolicy = new NativeBasePolicyRoot();
    this.basePolicyOwnsViableCommitted = 1;
    this.ourActions = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.ourArguments = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.enemyActions = new Uint8Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.enemyArguments = new Uint16Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.hardStatus = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.projectedCell = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.projectedDirection = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    // ProductionRoot keeps pre-clamp feature scores in Int32 storage.  An
    // INCOMPLETE penalty can exceed Int16; narrowing here changes ordering.
    this.tacticalValue = new Int32Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.beliefCoverage = new Uint16Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.hiddenReachMaskA = new Uint8Array(CAPACITY.MAX_CELLS);
    this.hiddenReachMaskB = new Uint8Array(CAPACITY.MAX_CELLS);
    this.worldCell = new Uint16Array(SEARCH_CAPACITY.MAX_SUPPORT_PER_NODE);
    this.worldMass = new Uint16Array(SEARCH_CAPACITY.MAX_SUPPORT_PER_NODE);
    this.worldDirectionMask = new Uint8Array(SEARCH_CAPACITY.MAX_SUPPORT_PER_NODE);
    this.hiddenWorldCount = 0;
    this.hiddenWorldSupportComplete = 0;
    this.hiddenWorldRiskSupportComplete = 0;
    this.ourCount = 0; this.enemyCount = 0;
    this.lastAction = ACTION.NONE; this.turnStreak = 0; this.goStallStreak = 0;
    this.lastObservedCell = NONE_CELL; this.lastObservedDirection = 0;
    this.opponentObservationReady = 0;
    this.previousOwnCell = NONE_CELL; this.previousEnemyCell = NONE_CELL;
    this.previousEnemyDirection = 0; this.previousEnemyStars = 0;
    this.previousEnemyProjectileCount = 0; this.previousEnemyBombCount = 0;
    this.previousEnemySkillReady = 0; this.previousEnemyCanFire = 0;
    this.previousFrame = NONE_FRAME;
    this.lastControlMode = ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION;
    this.lastProofStatus = PROOF_STATUS.UNKNOWN;
    this.lastSelectionWasStrictRescue = 0;
    this.lastSelectionWasVerifiedDirectKill = 0;
    this.lastIncumbentRow = -1;
    this.lastProposalRow = -1;
    this.lastSelectedRow = -1;
  }

  pushOur(action) {
    this.ourActions[this.ourCount] = action;
    this.ourArguments[this.ourCount++] = NONE_CELL;
  }

  pushEnemy(action) {
    this.enemyActions[this.enemyCount] = action;
    this.enemyArguments[this.enemyCount++] = NONE_CELL;
  }

  generateActions() {
    const a = this.adapter.state.arrays;
    this.ourCount = 0; this.enemyCount = 0;
    if (!this.adapter.ownCanAct) this.pushOur(ACTION.NONE);
    else {
      this.pushOur(ACTION.GO); this.pushOur(ACTION.TURN_LEFT);
      this.pushOur(ACTION.TURN_RIGHT);
      if (this.adapter.ownCanFire) this.pushOur(ACTION.FIRE);
      if (this.adapter.ownBombReady) this.pushOur(ACTION.THROW_BOMB);
      const ownSkill = a[ARRAY.TANK_SKILL][0];
      if (this.adapter.ownSkillReady && ownSkill >= SKILL.SHIELD &&
          ownSkill <= SKILL.BOOST && ownSkill !== SKILL.TELEPORT)
        this.pushOur(ACTION.CAST_SHIELD + ownSkill - SKILL.SHIELD);
      this.pushOur(ACTION.NONE);
    }
    this.pushEnemy(ACTION.NONE);
    if (!this.adapter.enemyCanAct) return;
    this.pushEnemy(ACTION.GO); this.pushEnemy(ACTION.TURN_LEFT);
    this.pushEnemy(ACTION.TURN_RIGHT);
    if (this.adapter.enemyCanFire) this.pushEnemy(ACTION.FIRE);
    if (this.adapter.enemyBombReady) this.pushEnemy(ACTION.THROW_BOMB);
    const skill = a[ARRAY.TANK_SKILL][1];
    if (this.adapter.enemySkillReady && skill >= SKILL.SHIELD &&
        skill <= SKILL.BOOST && skill !== SKILL.TELEPORT)
      this.pushEnemy(ACTION.CAST_SHIELD + skill - SKILL.SHIELD);
  }

  target(cell, direction) {
    const state = this.adapter.state;
    const x = state.x(cell) + DX[direction];
    const y = state.y(cell) + DY[direction];
    return x < 0 || x >= state.width || y < 0 || y >= state.height ?
      NONE_CELL : state.cell(x, y);
  }

  walk(cell, direction, speed, blocked) {
    const terrain = this.adapter.state.arrays[ARRAY.TERRAIN];
    let current = cell;
    for (let step = 0; step < speed; step += 1) {
      const next = this.target(current, direction);
      if (next === NONE_CELL || next === blocked ||
          terrain[next] === TERRAIN.WALL || terrain[next] === TERRAIN.DIRT)
        break;
      current = next;
    }
    return current;
  }

  projected(action) {
    const a = this.adapter.state.arrays;
    let cell = a[ARRAY.TANK_CELL][0]; let direction = a[ARRAY.TANK_DIR][0];
    if (action === ACTION.TURN_LEFT) direction = (direction + 3) & 3;
    else if (action === ACTION.TURN_RIGHT) direction = (direction + 1) & 3;
    else if (action === ACTION.GO) {
      const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
      const boosted = a[ARRAY.TANK_BOOST_UNTIL][0] !== NONE_FRAME &&
        a[ARRAY.TANK_BOOST_UNTIL][0] > frame;
      cell = this.walk(cell, direction, boosted ? 2 : 1,
        a[ARRAY.TANK_CELL][1]);
    }
    return cell * 4 + direction;
  }

  manhattan(left, right) {
    const state = this.adapter.state;
    return Math.abs(state.x(left) - state.x(right)) +
      Math.abs(state.y(left) - state.y(right));
  }

  directionTo(from, to) {
    const state = this.adapter.state;
    const fx = state.x(from); const fy = state.y(from);
    const tx = state.x(to); const ty = state.y(to);
    if (fx === tx) return ty < fy ? 0 : ty > fy ? 2 : -1;
    if (fy === ty) return tx > fx ? 1 : tx < fx ? 3 : -1;
    return -1;
  }

  clearLine(from, to) {
    const state = this.adapter.state;
    const fx = state.x(from); const fy = state.y(from);
    const tx = state.x(to); const ty = state.y(to);
    if (fx !== tx && fy !== ty) return 0;
    const dx = tx === fx ? 0 : tx > fx ? 1 : -1;
    const dy = ty === fy ? 0 : ty > fy ? 1 : -1;
    const terrain = state.arrays[ARRAY.TERRAIN];
    let x = fx + dx; let y = fy + dy;
    while (x !== tx || y !== ty) {
      const tile = terrain[state.cell(x, y)];
      if (tile === TERRAIN.WALL || tile === TERRAIN.DIRT) return 0;
      x += dx; y += dy;
    }
    return 1;
  }

  countMobility(cell) {
    const a = this.adapter.state.arrays; const terrain = a[ARRAY.TERRAIN];
    const opposing = a[ARRAY.TANK_CELL][1];
    let count = 0;
    for (let direction = 0; direction < 4; direction += 1) {
      const next = this.target(cell, direction);
      if (next !== NONE_CELL && next !== opposing &&
          terrain[next] !== TERRAIN.WALL && terrain[next] !== TERRAIN.DIRT)
        count += 1;
    }
    return count;
  }

  buildHiddenReachability(frame, maximumSpeed) {
    const state = this.adapter.state;
    let current = this.hiddenReachMaskA; let next = this.hiddenReachMaskB;
    current.fill(0, 0, state.cells); next.fill(0, 0, state.cells);
    const seed = this.adapter.lastEnemyCell;
    const seedDirection = this.adapter.lastEnemyDirection;
    if (seed === NONE_CELL || seedDirection < 0 || seedDirection > 3)
      return null;
    current[seed] = 1 << seedDirection;
    const frames = Math.max(1, frame - this.adapter.lastEnemySeenFrame);
    for (let elapsed = 0; elapsed < frames; elapsed += 1) {
      next.fill(0, 0, state.cells);
      for (let cell = 0; cell < state.cells; cell += 1) {
        const mask = current[cell]; if (!mask) continue;
        for (let direction = 0; direction < 4; direction += 1) {
          const bit = 1 << direction; if (!(mask & bit)) continue;
          next[cell] |= bit | (1 << ((direction + 3) & 3)) |
            (1 << ((direction + 1) & 3));
          next[this.walk(cell, direction, 1, NONE_CELL)] |= bit;
          next[this.walk(cell, (direction + 2) & 3, 1, NONE_CELL)] |= bit;
          if (maximumSpeed > 1) {
            next[this.walk(cell, direction, maximumSpeed, NONE_CELL)] |= bit;
            next[this.walk(cell, (direction + 2) & 3,
              maximumSpeed, NONE_CELL)] |= bit;
          }
        }
      }
      const swap = current; current = next; next = swap;
    }
    return current;
  }

  prepareHiddenWorlds() {
    const state = this.adapter.state; const a = state.arrays;
    const own = a[ARRAY.TANK_CELL][0];
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    this.hiddenWorldCount = 0;
    this.hiddenWorldSupportComplete = this.adapter.enemyVisible ? 1 : 0;
    this.hiddenWorldRiskSupportComplete = 1;
    if (this.adapter.enemyVisible) {
      this.worldCell[0] = a[ARRAY.TANK_CELL][1];
      this.worldMass[0] = 10000;
      this.worldDirectionMask[0] = 1 << a[ARRAY.TANK_DIR][1];
      this.hiddenWorldCount = 1;
      return 1;
    }
    const movementSkill = a[ARRAY.TANK_SKILL][1];
    const boosted = a[ARRAY.TANK_BOOST_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_BOOST_UNTIL][1] > frame;
    const maximumSpeed = boosted || movementSkill === SKILL.BOOST ? 2 : 1;
    let reach = null;
    if (this.adapter.lastEnemySeenFrame !== NONE_FRAME &&
        movementSkill !== SKILL.TELEPORT)
      reach = this.buildHiddenReachability(frame, maximumSpeed);
    const terrain = a[ARRAY.TERRAIN];
    for (let cell = 0; cell < state.cells; cell += 1) {
      let directionMask = reach ? reach[cell] : 0x0f;
      if (!directionMask || cell === own || terrain[cell] === TERRAIN.WALL ||
          terrain[cell] === TERRAIN.DIRT) continue;
      if (this.hiddenWorldCount >= this.worldCell.length) {
        this.hiddenWorldRiskSupportComplete = 0; break;
      }
      const at = this.hiddenWorldCount++;
      this.worldCell[at] = cell;
      this.worldDirectionMask[at] = directionMask;
    }
    if (!reach) this.hiddenWorldRiskSupportComplete = 0;
    if (!this.hiddenWorldCount) {
      this.hiddenWorldRiskSupportComplete = 0;
      return 0;
    }
    const mass = Math.floor(10000 / this.hiddenWorldCount);
    let remainder = 10000 - mass * this.hiddenWorldCount;
    for (let world = 0; world < this.hiddenWorldCount; world += 1) {
      this.worldMass[world] = mass + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder -= 1;
    }
    return this.hiddenWorldCount;
  }

  resetActionHistory() {
    const a = this.adapter.state.arrays;
    this.turnStreak = 0; this.goStallStreak = 0;
    this.lastObservedCell = a[ARRAY.TANK_CELL][0];
    this.lastObservedDirection = a[ARRAY.TANK_DIR][0];
    this.lastAction = ACTION.NONE;
  }

  updateActionHistory() {
    const a = this.adapter.state.arrays; const cell = a[ARRAY.TANK_CELL][0];
    const direction = a[ARRAY.TANK_DIR][0];
    if ((this.lastAction === ACTION.TURN_LEFT ||
         this.lastAction === ACTION.TURN_RIGHT) &&
        cell === this.lastObservedCell && direction !== this.lastObservedDirection)
      this.turnStreak += 1;
    else if (this.lastAction !== ACTION.NONE) this.turnStreak = 0;
    if (this.lastAction === ACTION.GO && cell === this.lastObservedCell)
      this.goStallStreak += 1;
    else if (this.lastAction !== ACTION.NONE) this.goStallStreak = 0;
    this.lastObservedCell = cell; this.lastObservedDirection = direction;
  }

  enemyProjectileCount() {
    const tracker = this.adapter.tracker; let count = 0;
    for (let slot = 0; slot < tracker.projectileActive.length; slot += 1)
      if (tracker.projectileActive[slot] && tracker.projectileOwner[slot] === 1)
        count += 1;
    return count;
  }

  enemyBombCount() {
    const tracker = this.adapter.tracker; let count = 0;
    for (let slot = 0; slot < tracker.bombActive.length; slot += 1)
      if (tracker.bombActive[slot] && tracker.bombOwner[slot] === 1) count += 1;
    return count;
  }

  snapshotOpponentObservation() {
    const a = this.adapter.state.arrays;
    this.previousOwnCell = a[ARRAY.TANK_CELL][0];
    this.previousEnemyCell = a[ARRAY.TANK_CELL][1];
    this.previousEnemyDirection = a[ARRAY.TANK_DIR][1];
    this.previousEnemyStars = a[ARRAY.TANK_STARS][1];
    this.previousEnemyProjectileCount = this.enemyProjectileCount();
    this.previousEnemyBombCount = this.enemyBombCount();
    this.previousEnemySkillReady = a[ARRAY.TANK_SKILL_READY][1] <=
      a[ARRAY.SCALAR][SCALAR.FRAME] ? 1 : 0;
    this.previousEnemyCanFire = this.adapter.enemyCanFire ? 1 : 0;
    this.previousFrame = a[ARRAY.SCALAR][SCALAR.FRAME];
    this.opponentObservationReady = 1;
  }

  updatePossibleProjectiles(reset) {
    const a = this.adapter.state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (reset || !this.opponentObservationReady) {
      this.possibleProjectiles.reset(frame);
      this.snapshotOpponentObservation(); return;
    }
    this.possibleProjectiles.advance(this.adapter.state, frame,
      a[ARRAY.TANK_CELL][0]);
    const projectileCount = this.enemyProjectileCount();
    const bombCount = this.enemyBombCount();
    const skillReady = a[ARRAY.TANK_SKILL_READY][1] <= frame ? 1 : 0;
    const poseChanged = this.adapter.enemyVisible &&
      (a[ARRAY.TANK_CELL][1] !== this.previousEnemyCell ||
       a[ARRAY.TANK_DIR][1] !== this.previousEnemyDirection);
    const exclusiveActionObserved = bombCount > this.previousEnemyBombCount ||
      (this.previousEnemySkillReady && !skillReady) ||
      a[ARRAY.TANK_STARS][1] > this.previousEnemyStars;
    if (projectileCount === 0 && this.previousEnemyCanFire && !poseChanged &&
        !exclusiveActionObserved && this.previousEnemyCell !== NONE_CELL &&
        this.previousFrame !== NONE_FRAME && frame > this.previousFrame)
      this.possibleProjectiles.addFired(this.adapter.state,
        this.previousEnemyCell, this.previousEnemyDirection,
        this.previousFrame, frame, a[ARRAY.TANK_CELL][0], 5000);
    this.snapshotOpponentObservation();
  }

  bombUtility(cell) {
    const a = this.adapter.state.arrays;
    let score = this.manhattan(cell, a[ARRAY.TANK_CELL][1]) <= 4 ? 3500 : -1200;
    if (a[ARRAY.TERRAIN][cell] === TERRAIN.GRASS) score -= 2500;
    return score;
  }

  actionScore(row) {
    const action = this.ourActions[row]; const hard = this.hardStatus[row];
    if (hard === HARD_STATUS.REJECT_PROVEN || hard === HARD_STATUS.REJECT_POLICY)
      return -1000000000;
    if (action === ACTION.NONE) return -999999999;
    const a = this.adapter.state.arrays; const original = a[ARRAY.TANK_CELL][0];
    const cell = this.projectedCell[row]; const direction = this.projectedDirection[row];
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const starDelta = (a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1]) * 1000;
    const starGain = star === NONE_CELL ? 0 :
      (this.manhattan(original, star) - this.manhattan(cell, star)) * 2500;
    const mobility = this.countMobility(cell);
    const resource = (this.adapter.ownCanFire + this.adapter.ownBombReady +
      this.adapter.ownSkillReady) * 3000;
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const remaining = Math.max(0, RULE.FRAME_RECORD_LIMIT - 1 - frame);
    const urgency = 10000 - Math.min(10000, remaining * 80);
    const planProgress = action === this.lastAction ? 4000 : 1000;
    // Algebraic specialization of canonical GeneratedEvaluator profile 0.
    // Risk/combat-owned dimensions are deliberately absent here, matching the
    // production evaluator; CombatPressure is applied below the Risk gate.
    let score = Math.trunc((20 * starDelta + 18 * starGain +
      10 * mobility * 2500 + 3 * a[ARRAY.TANK_SHIELD_HITS][0] * 5000 +
      4 * (this.adapter.enemyVisible ? 5000 : 0) + 4 * resource +
      3 * (action === ACTION.CAST_POISON ? 9000 : 0) +
      2 * planProgress - 5000 + 8 * urgency +
      8 * Math.max(0, starDelta) + 2 * Math.max(0, -starDelta)) / 100);
    if (hard === HARD_STATUS.INCOMPLETE) score -= 200000;
    if (action === ACTION.CAST_POISON)
      score += this.adapter.enemyVisible ? 6500 : -4000;
    else if (action === ACTION.THROW_BOMB) score += this.bombUtility(cell);
    else if (action === ACTION.GO) {
      if (cell === original) score -= 2500 + this.goStallStreak * 900;
      if (star !== NONE_CELL)
        score += (this.manhattan(original, star) - this.manhattan(cell, star)) * 1200;
    } else if ((action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) &&
        this.adapter.enemyVisible &&
        this.directionTo(cell, a[ARRAY.TANK_CELL][1]) === direction)
      score += 1500;
    if ((action === ACTION.TURN_LEFT || action === ACTION.TURN_RIGHT) &&
        (this.lastAction === ACTION.TURN_LEFT || this.lastAction === ACTION.TURN_RIGHT))
      score -= 700;
    return score;
  }

  rootGlobalMode() {
    const a = this.adapter.state.arrays;
    const remaining = Math.max(0, RULE.FRAME_RECORD_LIMIT - 1 -
      a[ARRAY.SCALAR][SCALAR.FRAME]);
    if (remaining > 16) return GLOBAL_MODE.NORMAL;
    return a[ARRAY.TANK_STARS][0] <= a[ARRAY.TANK_STARS][1] ?
      GLOBAL_MODE.FORCED_LOSS_RECOVERY : GLOBAL_MODE.HARD_SURVIVAL;
  }

  directHitWindow(action, cell, direction) {
    if (action !== ACTION.FIRE || !this.adapter.enemyVisible) return 0;
    const enemy = this.adapter.state.arrays[ARRAY.TANK_CELL][1];
    if (this.directionTo(cell, enemy) !== direction ||
        !this.clearLine(cell, enemy)) return 0;
    return Math.max(1000, 10000 - this.manhattan(cell, enemy) * 500);
  }

  prepareStrategyEvidence(count, combat, globalMode) {
    const bands = this.strategyBands; const a = this.adapter.state.arrays;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const reversal = globalMode === GLOBAL_MODE.FORCED_LOSS_RECOVERY;
    bands.reset(count);
    for (let row = 0; row < count; row += 1) {
      if (star !== NONE_CELL && this.projectedCell[row] === star)
        bands.starPurpose[row] = STRATEGY_PURPOSE.STAR_COLLECT |
          STRATEGY_PURPOSE.STAR_DENY;
      if (reversal && (bands.starPurpose[row] || combat.directKill[row] ||
          combat.aimSetup[row] || combat.intercept[row]))
        bands.terminalReversal[row] = 1;
    }
  }

  prepareStrategyInput(count, combat, globalMode) {
    const a = this.adapter.state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const input = this.strategyInput; input.reset();
    const starDelta = (a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1]) * 1000;
    const remaining = Math.max(0, RULE.FRAME_RECORD_LIMIT - 1 - frame);
    const urgency = 10000 - Math.min(10000, remaining * 80);
    let killOpportunity = 0; let setupOpportunity = 0;
    let purposeCompleteness = 0; let killDeadline = 0xffff;
    let directWindow = 0; let hasStarAction = 0;
    const outcome = this.riskController.outcome;
    for (let row = 0; row < count; row += 1) {
      if (!outcome.acceptable[row] || outcome.dominated[row]) continue;
      if (combat.directKill[row] || combat.intercept[row] ||
          combat.shieldBreak[row]) {
        killOpportunity = Math.max(killOpportunity,
          combat.purposeCompleteness[row], Math.max(0, combat.pressureValue[row]));
        purposeCompleteness = Math.max(purposeCompleteness,
          combat.purposeCompleteness[row]);
        if (combat.hitDeadline[row] < killDeadline)
          killDeadline = combat.hitDeadline[row];
      }
      if (combat.aimSetup[row] || combat.escapeDenial[row] ||
          combat.zoneDenial[row])
        setupOpportunity = Math.max(setupOpportunity,
          combat.purposeCompleteness[row], Math.max(0, combat.pressureValue[row]));
      if (this.ourActions[row] === ACTION.FIRE)
        directWindow = Math.max(directWindow, this.directHitWindow(ACTION.FIRE,
          this.projectedCell[row], this.projectedDirection[row]));
      if (this.strategyBands.starPurpose[row]) hasStarAction = 1;
    }
    if (killDeadline === 0xffff) killDeadline = 0;
    const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    const starDeadline = star === NONE_CELL || !hasStarAction ? 0 :
      Math.min(0x7fff, this.manhattan(a[ARRAY.TANK_CELL][0], star) + 1);
    const mobility = Math.min(10000,
      this.countMobility(a[ARRAY.TANK_CELL][0]) * 2500);
    input.set(STRATEGY_INPUT.STAR_DELTA, starDelta);
    input.set(STRATEGY_INPUT.STAR_RACE, 0);
    input.set(STRATEGY_INPUT.SAFE_SUCCESSORS, mobility);
    input.set(STRATEGY_INPUT.DIRECT_HIT_WINDOW, directWindow);
    input.set(STRATEGY_INPUT.POSITION_CONTROL, setupOpportunity);
    input.set(STRATEGY_INPUT.TERMINAL_URGENCY, urgency);
    input.set(STRATEGY_INPUT.LEAD_SECURITY,
      starDelta > 0 ? Math.min(10000, starDelta) : 0);
    input.set(STRATEGY_INPUT.COMEBACK_PRESSURE,
      starDelta < 0 ? Math.min(10000, -starDelta + urgency) : 0);
    input.set(STRATEGY_INPUT.OPPONENT_CONTEST, 5000);
    input.set(STRATEGY_INPUT.RESOURCE_READY,
      (this.adapter.ownCanFire + this.adapter.ownBombReady +
       this.adapter.ownSkillReady) * 3000);
    input.set(STRATEGY_INPUT.KILL_DEADLINE, killDeadline);
    input.set(STRATEGY_INPUT.STAR_DEADLINE, starDeadline);
    input.set(STRATEGY_INPUT.KILL_OPPORTUNITY, killOpportunity);
    input.set(STRATEGY_INPUT.SETUP_OPPORTUNITY, setupOpportunity);
    input.set(STRATEGY_INPUT.PURPOSE_COMPLETENESS, purposeCompleteness);
    input.set(STRATEGY_INPUT.PLAN_CONTINUITY, 0);
    input.set(STRATEGY_INPUT.REVERSIBILITY, mobility);
    input.set(STRATEGY_INPUT.INFORMATION_COMPLETENESS,
      this.adapter.informationComplete ? 10000 : 0);
    if (this.escapeObligation.supportStatus === SUPPORT_STATUS.COMPLETE)
      input.modifierMask |= STRATEGY_MODIFIER.EVADE_COMMITTED;
    if (!this.adapter.informationComplete)
      input.modifierMask |= STRATEGY_MODIFIER.INFORMATION;
    if (this.adapter.ownSkillReady)
      input.modifierMask |= STRATEGY_MODIFIER.SKILL_WINDOW;
    if (urgency >= 7000)
      input.modifierMask |= STRATEGY_MODIFIER.TERMINAL_URGENCY;
    const decisions = this.strategySelector.prepare(input, globalMode);
    const challenger = this.strategySelector.candidateForPortfolio(input,
      globalMode);
    this.strategyBands.configureRoot(killDeadline, starDeadline,
      purposeCompleteness, globalMode);
    this.strategyBands.buildPortfolio(this.riskController, decisions,
      this.strategyId, this.ourActions, count, combat, challenger);
    return globalMode;
  }

  selectIncumbent(count) {
    const combat = this.combat.vector;
    const globalMode = this.rootGlobalMode();
    this.prepareStrategyEvidence(count, combat, globalMode);
    this.prepareStrategyInput(count, combat, globalMode);
    this.policyProbability.fill(0, 0, count);
    const seed = (this.adapter.state.hashLo ^ this.adapter.state.hashHi) >>> 0;
    let selected = this.strategicArbiter.select(this.lastControlMode,
      this.riskController, this.strategyBands, this.policyProbability, null,
      seed, null, null, 0, globalMode, 0);
    if (selected < 0) selected = this.preferred(count);
    if (selected >= 0) {
      const owner = this.strategyBands.ownerForRow(selected, this.strategyId);
      this.strategyId = this.strategySelector.commitSelected(owner, globalMode);
    }
    return selected;
  }

  refineObservationSafety(bundle, selectionCount, visible) {
    const output = this.safetyClosure.outcome;
    if (!visible) return 0;
    let supportComplete = this.threatCapability.complete &&
      this.possibleProjectiles.count() === 0 &&
      this.adapter.tracker.complete ? 1 : 0;
    const tracker = this.adapter.tracker;
    for (let slot = 0; slot < tracker.bombActive.length; slot += 1)
      if (tracker.bombActive[slot] && (!tracker.bombExact[slot] ||
          !tracker.bombOwnerExact[slot])) { supportComplete = 0; break; }
    let remaining = 128;
    for (let row = 0; row < selectionCount && remaining > 0; row += 1) {
      if (this.hardStatus[row] !== HARD_STATUS.ALLOW ||
          output.status[row] !== SAFETY_STATUS.PROVEN_SAFE) continue;
      const result = this.observationSafety.classify(bundle,
        this.ourActions[row], this.ourArguments[row], this.worldCell, 1,
        supportComplete, visible, this.adapter.lastEnemyDirection, 4, remaining);
      remaining = Math.max(0, remaining - this.observationSafety.nodes);
      if (result === FRONTIER_STATUS.WINDOW_SAFE) {
        output.status[row] = SAFETY_STATUS.PROVEN_SAFE;
        output.immediateFatalMass[row] = 0; output.horizonFatalMass[row] = 0;
        output.unknownMass[row] = 0;
        output.earliestFatalFrame[row] = NONE_FATAL_FRAME;
        output.clearDeath(row); output.coverage[row] = 10000;
      } else {
        output.status[row] = SAFETY_STATUS.UNKNOWN;
        output.unknownMass[row] = 10000; output.coverage[row] = 0;
      }
    }
    return 1;
  }

  prepareRoot(bundle) {
    const priorRiskContinuation = this.multiFrameRisk.recommendedContinuation(
      this.adapter.state);
    const count = this.ourCount;
    for (let row = 0; row < count; row += 1) {
      const packed = this.projected(this.ourActions[row]);
      this.projectedCell[row] = (packed / 4) | 0;
      this.projectedDirection[row] = packed & 3;
    }
    this.finalGate.evaluate(bundle, this.ourActions, this.ourArguments, count);
    for (let row = 0; row < count; row += 1)
      this.hardStatus[row] = this.finalGate.status[row];
    const selectionCount = count > 1 &&
      this.ourActions[count - 1] === ACTION.NONE ? count - 1 : count;
    this.escapeObligation.evaluateCommitted(bundle, this.ourActions,
      this.ourArguments, this.projectedCell, this.projectedDirection,
      this.hardStatus, selectionCount, this.finalGate);
    const visible = this.adapter.enemyVisible ? 1 : 0;
    const worldCount = this.prepareHiddenWorlds();
    this.threatCapability.prepare(bundle, 1, this.adapter.enemyCanAct,
      this.adapter.enemyCanFire,
      this.adapter.enemyCapabilitySupportComplete);
    this.safetyClosure.evaluate(bundle, this.ourActions, selectionCount,
      this.hardStatus, this.projectedCell, this.projectedDirection,
      this.worldCell, this.worldMass, worldCount,
      this.hiddenWorldSupportComplete,
      this.possibleProjectiles,
      this.adapter.enemyCanFire, this.adapter.lastEnemyDirection, 0xffff, 1,
      5000, this.finalGate.chanceSupportCount,
      this.finalGate.chanceFatalSupportCount,
      this.finalGate.chanceIncompleteSupportCount, this.threatCapability,
      this.finalGate.chanceCell, this.finalGate.chanceDirection, 0);
    this.multiFrameRisk.evaluate(bundle, selectionCount, this.hardStatus,
      this.finalGate.chanceSupportCount,
      this.finalGate.chanceIncompleteSupportCount,
      this.finalGate.chanceCell, this.finalGate.chanceDirection,
      this.worldCell, this.worldMass, worldCount,
      this.hiddenWorldSupportComplete,
      this.threatCapability, this.adapter.lastEnemyDirection, 5000, 4096,
      this.safetyClosure.outcome, this.possibleProjectiles,
      this.worldDirectionMask, this.hiddenWorldRiskSupportComplete, null);
    this.refineObservationSafety(bundle, selectionCount, visible);
    const a = this.adapter.state.arrays;
    const stateClass = this.riskController.riskProfile.classify(
      a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1],
      Math.max(0, RULE.FRAME_RECORD_LIMIT - 1 - a[ARRAY.SCALAR][SCALAR.FRAME]),
      this.escapeObligation.supportStatus === SUPPORT_STATUS.COMPLETE ?
        this.escapeObligation.rootSlack : 0, 1,
      this.adapter.informationComplete ? 0 : 2, 0);
    for (let row = 0; row < selectionCount; row += 1)
      this.tacticalValue[row] = this.actionScore(row);
    const combat = this.combat.evaluate(bundle, this.ourActions, selectionCount,
      this.projectedCell, this.projectedDirection, visible,
      this.beliefCoverage, TACTICAL_CONFIG, this.adapter.enemyCanAct);
    this.riskController.populate(selectionCount, this.hardStatus,
      this.safetyClosure.outcome, this.tacticalValue, null, null,
      this.enemyCount, combat, 2);
    this.riskController.gate(BASE_RISK, stateClass);
    this.escapeObligation.publishSuccessorQuality(this.riskController,
      selectionCount);
    this.escapeObligation.restrictRiskController(this.riskController,
      this.adapter.state, selectionCount);
    if (priorRiskContinuation !== ACTION.NONE) {
      let continuationRow = -1;
      for (let row = 0; row < selectionCount; row += 1)
        if (this.ourActions[row] === priorRiskContinuation) {
          continuationRow = row; break;
        }
      this.riskController.commitContinuation(continuationRow);
    }
    this.riskController.applyCombatPressure(combat);
    const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
    const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    const enemyDisabled = a[ARRAY.TANK_STUN_UNTIL][1] !== NONE_FRAME &&
      a[ARRAY.TANK_STUN_UNTIL][1] > frame;
    if (this.escapeObligation.committedEntityCount > 0 &&
        (this.escapeObligation.supportStatus === SUPPORT_STATUS.TRAPPED ||
         (this.escapeObligation.supportStatus === SUPPORT_STATUS.COMPLETE &&
          this.escapeObligation.firstActionCount > 0 &&
          this.escapeObligation.firstActionCount < selectionCount)))
      this.lastControlMode = ROOT_CONTROL_MODE.COMMITTED_ESCAPE;
    else if (visible && (this.manhattan(own, enemy) <= 9 ||
        this.clearLine(own, enemy) || enemyDisabled))
      this.lastControlMode = ROOT_CONTROL_MODE.TACTICAL_CONTACT;
    else this.lastControlMode = ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION;
    return selectionCount;
  }

  acceptable(row) {
    const o = this.riskController.outcome;
    return row >= 0 && row < o.count && o.acceptable[row] &&
      !o.dominated[row] && this.hardStatus[row] === HARD_STATUS.ALLOW;
  }

  preferred(count) {
    return this.riskController.select(
      (this.adapter.state.hashLo ^ this.adapter.state.hashHi) >>> 0);
  }

  emit(me, action) {
    if (action === ACTION.GO && typeof me.go === "function") me.go();
    else if (action === ACTION.TURN_LEFT && typeof me.turn === "function")
      me.turn("left");
    else if (action === ACTION.TURN_RIGHT && typeof me.turn === "function")
      me.turn("right");
    else if (action === ACTION.FIRE && typeof me.fire === "function") me.fire();
    else if (action === ACTION.THROW_BOMB && typeof me.throwBomb === "function")
      me.throwBomb();
    else if (action >= ACTION.CAST_SHIELD && action <= ACTION.CAST_BOOST) {
      const method = action === ACTION.CAST_SHIELD ? "shield" :
        action === ACTION.CAST_FREEZE ? "freeze" :
        action === ACTION.CAST_STUN ? "stun" :
        action === ACTION.CAST_OVERLOAD ? "overload" :
        action === ACTION.CAST_CLOAK ? "cloak" :
        action === ACTION.CAST_TELEPORT ? "teleport" :
        action === ACTION.CAST_POISON ? "poison" : "boost";
      if (method === "teleport" || typeof me[method] !== "function")
        return ACTION.NONE;
      me[method]();
    }
    else return ACTION.NONE;
    this.adapter.recordEmission(action);
    return action;
  }

  decide(me, enemy, game) {
    const adapted = this.adapter.adapt(me, enemy, game);
    if (!adapted.bundle) return this.emit(me, ACTION.TURN_RIGHT);
    if (adapted.matchReset) {
      this.resetActionHistory(); this.opponentObservationReady = 0;
      this.strategySelector.reset(); this.strategyId = this.strategySelector.current;
    }
    else this.updateActionHistory();
    this.updatePossibleProjectiles(adapted.matchReset);
    this.generateActions();
    const count = this.prepareRoot(adapted.bundle);
    let selected = this.selectIncumbent(count);
    this.lastIncumbentRow = selected;
    this.lastProposalRow = -1;
    const incumbent = selected >= 0 ? this.ourActions[selected] : ACTION.NONE;
    // Match the accepted external-hook contract: non-poison skills belong to
    // the resource controller and do not advance BasePolicy history/intent.
    const resourceOwned = incumbent >= ACTION.CAST_SHIELD &&
      incumbent <= ACTION.CAST_BOOST && incumbent !== ACTION.CAST_POISON;
    const proposal = resourceOwned ? null :
      this.basePolicy.selectOverride(this, selected, incumbent);
    if (proposal)
      for (let row = 0; row < count; row += 1)
        if (this.ourActions[row] === proposal.action &&
            this.ourArguments[row] === proposal.argument &&
            this.hardStatus[row] === HARD_STATUS.ALLOW) {
          selected = row; break;
        }
    if (proposal && selected >= 0 && this.ourActions[selected] === proposal.action &&
        this.ourArguments[selected] === proposal.argument)
      this.lastProposalRow = selected;
    if (!this.finalGate.finalAllows(adapted.bundle, this.ourActions,
        this.ourArguments, selected, this.ourCount))
      for (selected = 0; selected < count &&
          !this.finalGate.finalAllows(adapted.bundle, this.ourActions,
            this.ourArguments, selected, this.ourCount); selected += 1) {}
    const action = selected < count ? this.ourActions[selected] : ACTION.NONE;
    this.lastSelectedRow = selected < count ? selected : -1;
    this.lastAction = this.emit(me, action);
    return this.lastAction;
  }
}

module.exports = { BASE_RISK, NativeBasePolicyEngine };
