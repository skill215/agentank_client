"use strict";

const { CAPACITY } = require("../generated/fast-config");
const { SEARCH_CAPACITY } = require("../generated/search-config");
const { ARRAY, SCALAR } = require("../state/fast-state");
const { ACTION, SKILL, FAST_STATUS, HARD_STATUS, TERMINAL, TERRAIN,
  BOOST_COMPOUND_BASE, BOOST_COMPOUND_STRIDE, NONE_FRAME, NONE_CELL, DX, DY } =
  require("../abi/fast-codes");
const { OPTION_KIND, OptionPortfolioSlab } = require("../policy/option-portfolio");
const { SafetyPhysicalStateArena } = require("./observation-safety-frontier");
const { ObjectiveConditionedDepthSearch } = require("./action-continuation-envelope");
const { ProductionCacheBank } = require("../cache/production-cache");
const { RUNTIME_MODE } = require("../abi/cache-runtime-codes");

const COMMON_OPTION_STATUS = Object.freeze({ NONE: 0, COMPLETE: 1, INCOMPLETE: 2 });
const VALUE_MIN = -32000;
const VALUE_MAX = 32000;
const MAX_ROOTS = 3;
const MAX_WORLDS = 2;
const MAX_BRANCHES = 96;
const MAX_GROUPS = SEARCH_CAPACITY.MAX_SUPPORT_PER_NODE;
const MAX_CONTINUATIONS = SEARCH_CAPACITY.MAX_ENEMY_POLICIES;

function movementAction(action) {
  return action === ACTION.GO || action === ACTION.TURN_LEFT ||
    action === ACTION.TURN_RIGHT ? 1 : 0;
}

function mix32(hash, value) {
  let result = (hash ^ (value >>> 0)) >>> 0;
  result = (result + ((result << 1) >>> 0) + ((result << 4) >>> 0) +
    ((result << 7) >>> 0) + ((result << 8) >>> 0) + ((result << 24) >>> 0)) >>> 0;
  return result;
}

// Diagnostic-only, two-ply Information interval for a visible singleton pose
// plus one possible projectile.  The first ply enumerates every enemy action
// and ChanceOutcome in both physical worlds.  Successors are grouped by the
// platform-visible observation; worlds in the same group must execute one
// common continuation action.  The lower bound is the best common action's
// worst supported leaf, while the upper bound permits per-world fusion.
class CommonPolicyOptionInterval {
  constructor(runtimeConfig, options = {}) {
    this.maximumRoots = Math.max(2, Math.min(MAX_ROOTS,
      Number.isSafeInteger(options.maximumRoots) ? options.maximumRoots : 3));
    this.nodeBudget = Math.max(128, Math.min(8192,
      Number.isSafeInteger(options.nodeBudget) ? options.nodeBudget : 2048));
    this.active = options.active ? 1 : 0;
    this.stateArena = new SafetyPhysicalStateArena(MAX_BRANCHES + 1);
    this.evaluator = new ObjectiveConditionedDepthSearch(new ProductionCacheBank(),
      runtimeConfig, null, { dynamicPositionTarget: true });
    this.evaluator.rootTransitions.setEnabled(false);
    this.portfolio = new OptionPortfolioSlab(MAX_ROOTS * 3);
    this.rootRows = new Uint8Array(MAX_ROOTS);
    this.rootActions = new Uint8Array(MAX_ROOTS);
    this.rootArguments = new Uint16Array(MAX_ROOTS);
    this.rootKinds = new Uint8Array(MAX_ROOTS);
    this.rootTargets = new Uint16Array(MAX_ROOTS);
    this.rootOptionIndex = new Uint8Array(MAX_ROOTS);
    this.rootLower = new Int32Array(MAX_ROOTS);
    this.rootUpper = new Int32Array(MAX_ROOTS);
    this.rootFused = new Int32Array(MAX_ROOTS);
    this.rootCommon = new Int32Array(MAX_ROOTS);
    this.rootExact = new Uint8Array(MAX_ROOTS);
    this.usedRow = new Uint8Array(SEARCH_CAPACITY.MAX_OUR_ACTIONS);
    this.branchRoot = new Uint8Array(MAX_BRANCHES);
    this.branchWorld = new Uint8Array(MAX_BRANCHES);
    this.branchGroup = new Uint8Array(MAX_BRANCHES);
    this.branchTerminal = new Uint8Array(MAX_BRANCHES);
    this.groupKey = new Uint32Array(MAX_GROUPS);
    this.groupRoot = new Uint8Array(MAX_GROUPS);
    this.groupCount = new Uint8Array(MAX_GROUPS);
    this.continuationMask = new Uint32Array(MAX_BRANCHES);
    this.continuationActions = new Uint8Array(MAX_GROUPS * MAX_CONTINUATIONS);
    this.continuationArguments = new Uint16Array(MAX_GROUPS * MAX_CONTINUATIONS);
    this.continuationCount = new Uint8Array(MAX_GROUPS);
    this.continuationComplete = new Uint8Array(MAX_GROUPS);
    this.enemyActions = new Uint8Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.enemyArguments = new Uint16Array(SEARCH_CAPACITY.MAX_ENEMY_POLICIES);
    this.leaf = new Int32Array(MAX_BRANCHES * MAX_CONTINUATIONS);
    this.worldSlots = new Int16Array(MAX_WORLDS);
    this.lastStatus = COMMON_OPTION_STATUS.NONE; this.lastProposal = -1;
    this.attempts = 0; this.supportSkips = 0; this.completed = 0;
    this.incomplete = 0; this.nodes = 0; this.totalNodes = 0; this.maximumNodes = 0;
    this.branchCount = 0; this.groupTotal = 0; this.totalBranches = 0;
    this.totalGroups = 0; this.observationSplitCount = 0;
    this.strategyFusionGapCount = 0; this.horizonSeparationCount = 0;
    this.terminalOwnershipCount = 0;
    this.proposalCount = 0; this.rootRestoreFailures = 0;
    this.capacityStops = 0; this.hotAllocationCount = 0;
    this.lastFrame = -32; this.cooldownFrames = 4; this.cooldownSkips = 0;
    this.valueOwnerSkips = 0; this.noConflictSkips = 0;
  }

  activeEffect(a, id, seat, frame) {
    return a[id][seat] !== NONE_FRAME && a[id][seat] > frame;
  }

  canAct(state, seat) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (this.activeEffect(a, ARRAY.TANK_FROZEN_UNTIL, seat, frame)) return 0;
    if (this.activeEffect(a, ARRAY.TANK_POISON_UNTIL, seat, frame)) {
      const applied = a[ARRAY.TANK_POISON_APPLIED][seat];
      if (applied === NONE_FRAME) return -1;
      if (((frame - applied) & 1) !== 0) return 0;
    }
    return 1;
  }

  activeProjectile(state, seat) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_PROJECTILES; slot += 1)
      if (a[ARRAY.PROJECTILE_ACTIVE][slot] && a[ARRAY.PROJECTILE_OWNER][slot] === seat) return 1;
    return 0;
  }

  activeBomb(state, seat) {
    const a = state.arrays;
    for (let slot = 0; slot < CAPACITY.MAX_BOMBS; slot += 1)
      if (a[ARRAY.BOMB_ACTIVE][slot] && a[ARRAY.BOMB_OWNER][slot] === seat) return 1;
    return 0;
  }

  pushContinuation(group, action, argument = NONE_CELL) {
    let count = this.continuationCount[group];
    if (count >= MAX_CONTINUATIONS) {
      this.continuationComplete[group] = 0; this.capacityStops += 1; return 0;
    }
    const base = group * MAX_CONTINUATIONS;
    for (let index = 0; index < count; index += 1)
      if (this.continuationActions[base + index] === action &&
          this.continuationArguments[base + index] === argument) return 1;
    this.continuationActions[base + count] = action;
    this.continuationArguments[base + count] = argument;
    this.continuationCount[group] = count + 1; return 1;
  }

  teleportSupport(group, state) {
    const a = state.arrays; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star === NONE_CELL) return 0;
    let count = 0;
    for (let direction = 0; direction < 4; direction += 1) {
      const x = state.x(star) + DX[direction]; const y = state.y(star) + DY[direction];
      if (x < 0 || x >= state.width || y < 0 || y >= state.height) continue;
      const cell = state.cell(x, y); const terrain = a[ARRAY.TERRAIN][cell];
      if ((terrain === TERRAIN.OPEN || terrain === TERRAIN.GRASS) &&
          cell !== a[ARRAY.TANK_CELL][1] &&
          this.pushContinuation(group, ACTION.CAST_TELEPORT, cell)) count += 1;
    }
    return count;
  }

  generateContinuations(group, state) {
    this.continuationCount[group] = 0; this.continuationComplete[group] = 1;
    if (!this.pushContinuation(group, ACTION.NONE)) return 0;
    const canAct = this.canAct(state, 0); if (canAct < 0) return 0;
    if (!canAct) return 1;
    this.pushContinuation(group, ACTION.GO);
    this.pushContinuation(group, ACTION.TURN_LEFT);
    this.pushContinuation(group, ACTION.TURN_RIGHT);
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (!this.activeProjectile(state, 0) &&
        (a[ARRAY.TANK_FIRE_LOCK][0] === NONE_FRAME || a[ARRAY.TANK_FIRE_LOCK][0] <= frame))
      this.pushContinuation(group, ACTION.FIRE);
    if (!this.activeBomb(state, 0) && a[ARRAY.TANK_BOMB_READY][0] <= frame)
      this.pushContinuation(group, ACTION.THROW_BOMB);
    if (this.activeEffect(a, ARRAY.TANK_BOOST_UNTIL, 0, frame))
      for (let pre = 0; pre < 2; pre += 1) {
        const base = BOOST_COMPOUND_BASE + pre * BOOST_COMPOUND_STRIDE;
        this.pushContinuation(group, base); this.pushContinuation(group, base + 1);
        this.pushContinuation(group, base + 2);
        if (!this.activeProjectile(state, 0)) this.pushContinuation(group, base + 3);
        if (!this.activeBomb(state, 0)) this.pushContinuation(group, base + 4);
      }
    const skill = a[ARRAY.TANK_SKILL][0];
    if (skill !== SKILL.NONE && a[ARRAY.TANK_SKILL_READY][0] <= frame) {
      if (skill === SKILL.TELEPORT) this.teleportSupport(group, state);
      else this.pushContinuation(group, ACTION.CAST_SHIELD + skill - SKILL.SHIELD);
    }
    return this.continuationComplete[group] ? this.continuationCount[group] : 0;
  }

  pushEnemy(action, argument = NONE_CELL) {
    const count = this.enemyCount;
    if (count >= this.enemyActions.length) { this.enemyComplete = 0;
      this.capacityStops += 1; return 0; }
    for (let index = 0; index < count; index += 1)
      if (this.enemyActions[index] === action && this.enemyArguments[index] === argument) return 1;
    this.enemyActions[count] = action; this.enemyArguments[count] = argument;
    this.enemyCount = count + 1; return 1;
  }

  enemyTeleportSupport(state) {
    const a = state.arrays; const star = a[ARRAY.SCALAR][SCALAR.STAR_CELL];
    if (star === NONE_CELL) return 0;
    let count = 0;
    for (let direction = 0; direction < 4; direction += 1) {
      const x = state.x(star) + DX[direction]; const y = state.y(star) + DY[direction];
      if (x < 0 || x >= state.width || y < 0 || y >= state.height) continue;
      const cell = state.cell(x, y); const terrain = a[ARRAY.TERRAIN][cell];
      if ((terrain === TERRAIN.OPEN || terrain === TERRAIN.GRASS) &&
          cell !== a[ARRAY.TANK_CELL][0] && this.pushEnemy(ACTION.CAST_TELEPORT, cell)) count += 1;
    }
    return count;
  }

  generateEnemy(state) {
    this.enemyCount = 0; this.enemyComplete = 1;
    if (!this.pushEnemy(ACTION.NONE)) return 0;
    const canAct = this.canAct(state, 1); if (canAct < 0) return 0;
    if (!canAct) return 1;
    this.pushEnemy(ACTION.GO); this.pushEnemy(ACTION.TURN_LEFT);
    this.pushEnemy(ACTION.TURN_RIGHT);
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (!this.activeProjectile(state, 1) &&
        (a[ARRAY.TANK_FIRE_LOCK][1] === NONE_FRAME || a[ARRAY.TANK_FIRE_LOCK][1] <= frame))
      this.pushEnemy(ACTION.FIRE);
    if (!this.activeBomb(state, 1) && a[ARRAY.TANK_BOMB_READY][1] <= frame)
      this.pushEnemy(ACTION.THROW_BOMB);
    if (this.activeEffect(a, ARRAY.TANK_BOOST_UNTIL, 1, frame))
      for (let pre = 0; pre < 2; pre += 1) {
        const base = BOOST_COMPOUND_BASE + pre * BOOST_COMPOUND_STRIDE;
        this.pushEnemy(base); this.pushEnemy(base + 1); this.pushEnemy(base + 2);
        if (!this.activeProjectile(state, 1)) this.pushEnemy(base + 3);
        if (!this.activeBomb(state, 1)) this.pushEnemy(base + 4);
      }
    const skill = a[ARRAY.TANK_SKILL][1];
    if (skill !== SKILL.NONE && a[ARRAY.TANK_SKILL_READY][1] <= frame) {
      if (skill === SKILL.TELEPORT) {
        if (!this.enemyTeleportSupport(state)) this.enemyComplete = 0;
      } else this.pushEnemy(ACTION.CAST_SHIELD + skill - SKILL.SHIELD);
    }
    return this.enemyComplete ? this.enemyCount : 0;
  }

  observationKey(state) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME]; let hash = 0x811c9dc5;
    hash = mix32(hash, frame); hash = mix32(hash, a[ARRAY.TANK_CELL][0]);
    hash = mix32(hash, a[ARRAY.TANK_DIR][0]); hash = mix32(hash, a[ARRAY.TANK_CRASH][0]);
    hash = mix32(hash, a[ARRAY.TANK_STARS][0]);
    hash = mix32(hash, a[ARRAY.SCALAR][SCALAR.TERMINAL_CODE]);
    for (let id = ARRAY.TANK_SHIELD_HITS; id <= ARRAY.TANK_FIRE_LOCK; id += 1)
      hash = mix32(hash, (id << 16) ^ a[id][0]);
    const enemy = a[ARRAY.TANK_CELL][1];
    const revealed = this.activeEffect(a, ARRAY.TANK_REVEAL_UNTIL, 1, frame);
    const cloaked = this.activeEffect(a, ARRAY.TANK_CLOAK_UNTIL, 1, frame);
    const visible = revealed || (!cloaked && a[ARRAY.TERRAIN][enemy] !== TERRAIN.GRASS);
    hash = mix32(hash, visible ? 0x51ed : 0x91dd);
    if (visible) {
      hash = mix32(hash, enemy); hash = mix32(hash, a[ARRAY.TANK_DIR][1]);
      hash = mix32(hash, a[ARRAY.TANK_CRASH][1]); hash = mix32(hash, a[ARRAY.TANK_STARS][1]);
      for (let id = ARRAY.TANK_SKILL; id <= ARRAY.TANK_FIRE_LOCK; id += 1)
        hash = mix32(hash, (id << 16) ^ a[id][1]);
    }
    // The platform exposes at most a partial/scalar bullet observation. The
    // exact internal projectile set therefore cannot justify ObservationSplit.
    // Keeping the two worlds in one group is a conservative common-policy
    // lower bound; the fused upper bound still models a future split.
    return hash >>> 0;
  }

  completeValueOwner(engine) {
    const information = engine.informationSearch;
    if (information && information.completedDepth > 0 &&
        information.supportComplete === 1 && information.approximate === 0) return 1;
    const physical = engine.depthSearch;
    return physical && physical.completedDepth > 0 &&
      physical.representativeSupportComplete === 1 ? 1 : 0;
  }

  selectRoots(engine, selected, total) {
    this.usedRow.fill(0, 0, total); let count = 0;
    const add = row => {
      if (row < 0 || row >= total || count >= this.maximumRoots || this.usedRow[row] ||
          engine.hardStatus[row] !== HARD_STATUS.ALLOW ||
          !engine.riskController.outcome.acceptable[row] ||
          !movementAction(engine.ourActions[row])) return;
      this.usedRow[row] = 1; this.rootRows[count] = row;
      this.rootActions[count] = engine.ourActions[row];
      this.rootArguments[count] = engine.ourArguments[row]; count += 1;
    };
    add(selected);
    let conflict = 0;
    while (count < this.maximumRoots) {
      let best = -1;
      for (let row = 0; row < total; row += 1)
        if (!this.usedRow[row] && engine.hardStatus[row] === HARD_STATUS.ALLOW &&
            engine.riskController.outcome.acceptable[row] &&
            movementAction(engine.ourActions[row]) &&
            (!conflict ? engine.riskController.outcome.dominated[row] : 1) &&
            (best < 0 || engine.riskController.outcome.expectedValue[row] >
              engine.riskController.outcome.expectedValue[best] ||
             engine.riskController.outcome.expectedValue[row] ===
              engine.riskController.outcome.expectedValue[best] && row < best)) best = row;
      if (best < 0 && !conflict) { conflict = 1; continue; }
      if (best < 0) break;
      if (engine.riskController.outcome.dominated[best]) conflict = 1;
      add(best);
    }
    return conflict ? count : 0;
  }

  buildPortfolio(engine, count) {
    this.portfolio.reset();
    for (let local = 0; local < count; local += 1) {
      const row = this.rootRows[local]; let kind = OPTION_KIND.POSITION;
      let target = engine.adapter.state.arrays[ARRAY.TANK_CELL][1];
      const source = engine.optionPortfolio;
      if (source) for (let at = 0; at < source.count; at += 1)
        if (source.primitiveRow[at] === row) {
          kind = source.kind[at]; target = source.targetCell[at];
          if (kind === OPTION_KIND.POSITION && !engine.strategyBands.starPurpose[row])
            target = engine.adapter.state.arrays[ARRAY.TANK_CELL][1];
          break;
        }
      if (target === NONE_CELL) target = engine.adapter.state.arrays[ARRAY.TANK_CELL][1];
      this.rootKinds[local] = kind; this.rootTargets[local] = target;
      this.portfolio.add(local, kind, target, 0, 0xffff, 0, 1);
    }
    this.evaluator.preparePortfolio(this.portfolio, this.rootActions,
      this.rootArguments, count, 0);
    if (this.evaluator.optionCount !== count) return 0;
    this.rootOptionIndex.fill(0xff, 0, count);
    for (let option = 0; option < this.evaluator.optionCount; option += 1)
      this.rootOptionIndex[this.evaluator.optionPrimitiveRow[option]] = option;
    for (let root = 0; root < count; root += 1)
      if (this.rootOptionIndex[root] === 0xff) return 0;
    return 1;
  }

  injectPossible(bundle, tracker) {
    if (!tracker || tracker.count() !== 1 || !tracker.pool || !tracker.pool.complete) return 0;
    const pool = tracker.pool; let slot = -1;
    for (let at = 0; at < pool.active.length; at += 1) if (pool.active[at]) { slot = at; break; }
    if (slot < 0 || pool.owner[slot] !== 1) return 0;
    const group = pool.group[slot] || pool.id[slot];
    return bundle.kernel.allocateProjectile(pool.owner[slot], pool.cell[slot],
      pool.direction[slot], group, pool.member[slot]) ? 1 : 0;
  }

  rootValue(state, terminal, hard, option, root) {
    if (hard === HARD_STATUS.REJECT_PROVEN || hard === HARD_STATUS.REJECT_POLICY) return -30000;
    if (hard === HARD_STATUS.INCOMPLETE) { this.rootExact[root] = 0; return VALUE_MIN; }
    if (terminal === TERMINAL.WIN0) return 30000;
    if (terminal === TERMINAL.WIN1) return -30000;
    if (terminal === TERMINAL.DRAW) return 0;
    this.rootExact[root] = 0;
    this.evaluator.bindInformationOption(option);
    const value = this.evaluator.heuristic(state);
    this.evaluator.bindInformationOption(-1); return value;
  }

  addGroup(root, key) {
    for (let group = 0; group < this.groupTotal; group += 1)
      if (this.groupRoot[group] === root && this.groupKey[group] === key) return group;
    if (this.groupTotal >= MAX_GROUPS) return -1;
    const group = this.groupTotal++; this.groupRoot[group] = root;
    this.groupKey[group] = key; this.groupCount[group] = 0; return group;
  }

  addBranch(root, world, group, state, terminal = 0) {
    if (this.branchCount >= MAX_BRANCHES) return -1;
    const branch = this.branchCount++; const slot = branch + 1;
    if (!this.stateArena.save(state, slot)) return -1;
    this.branchRoot[branch] = root; this.branchWorld[branch] = world;
    this.branchGroup[branch] = group; this.branchTerminal[branch] = terminal ? 1 : 0;
    this.groupCount[group] += 1; return branch;
  }

  buildWorld(engine, bundle, root, world, possible, enemyCount) {
    const state = bundle.state; const rootLo = state.hashLo; const rootHi = state.hashHi;
    const rootMark = state.deltaUsed * 1024 + state.eventUsed;
    const transitionDeltaBase = state.transitionDeltaBase;
    const transitionEventBase = state.transitionEventBase;
    const kernelFailure = bundle.kernel.failure; const kernelLastMark = bundle.kernel.lastMark;
    let worldMark = -1; let complete = 1;
    if (world) {
      worldMark = state.beginTransition(); bundle.kernel.failure = 0;
      if (!this.injectPossible(bundle, possible)) complete = 0;
    }
    for (let column = 0; column < enemyCount && complete; column += 1) {
      const ownChance = bundle.hard.chanceAlternativeCount(0, this.rootActions[root]);
      const enemyChance = bundle.hard.chanceAlternativeCount(1, engine.enemyActions[column]);
      for (let chance = 0; chance < ownChance * enemyChance; chance += 1) {
        if (this.nodes >= this.nodeBudget) { complete = 0; break; }
        const status = bundle.kernel.applyFrame(this.rootActions[root], this.rootArguments[root],
          engine.enemyActions[column], engine.enemyArguments[column], chance % ownChance,
          Math.floor(chance / ownChance));
        this.nodes += 1;
        if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
          complete = 0; break;
        }
        const mark = bundle.kernel.lastMark; const hard = bundle.hard.classifyApplied();
        const terminal = bundle.hard.lastTerminal;
        if (hard === HARD_STATUS.ALLOW && (!terminal || terminal === TERMINAL.INCOMPLETE)) {
          const group = this.addGroup(root, this.observationKey(state));
          if (group < 0 || this.addBranch(root, world, group, state) < 0) complete = 0;
        } else {
          const group = this.addGroup(root, this.observationKey(state));
          const branch = group < 0 ? -1 : this.addBranch(root, world, group, state, 1);
          if (branch < 0) complete = 0;
          this.leaf[branch * MAX_CONTINUATIONS] =
            this.rootValue(state, terminal, hard, this.rootOptionIndex[root], root);
        }
        state.undoTo(mark);
        if (!complete) break;
      }
    }
    if (worldMark >= 0) state.undoTo(worldMark);
    state.transitionDeltaBase = transitionDeltaBase;
    state.transitionEventBase = transitionEventBase;
    bundle.kernel.failure = kernelFailure; bundle.kernel.lastMark = kernelLastMark;
    if (state.hashLo !== rootLo || state.hashHi !== rootHi ||
        state.deltaUsed * 1024 + state.eventUsed !== rootMark) {
      this.rootRestoreFailures += 1; state.undoTo(rootMark); complete = 0;
    }
    return complete;
  }

  evaluateGroups(bundle, root) {
    let lower = VALUE_MAX; let fused = VALUE_MAX; let groupSeen = 0;
    for (let group = 0; group < this.groupTotal; group += 1) {
      if (this.groupRoot[group] !== root) continue; groupSeen += 1;
      let firstBranch = -1; let firstNonterminal = -1;
      for (let branch = 0; branch < this.branchCount; branch += 1)
        if (this.branchGroup[branch] === group) {
          if (firstBranch < 0) firstBranch = branch;
          if (!this.branchTerminal[branch]) { firstNonterminal = branch; break; }
        }
      if (firstBranch < 0 || !this.stateArena.load(bundle.state, firstBranch + 1)) return 0;
      if (firstNonterminal >= 0 && !this.stateArena.load(bundle.state, firstNonterminal + 1))
        return 0;
      let count = firstNonterminal < 0 ? 1 : this.generateContinuations(group, bundle.state);
      if (!count) return 0;
      for (let branch = 0; branch < this.branchCount; branch += 1)
        if (this.branchGroup[branch] === group) {
          if (this.branchTerminal[branch]) {
            const value = this.leaf[branch * MAX_CONTINUATIONS];
            this.continuationMask[branch] = count >= 32 ? 0xffffffff : (1 << count) - 1;
            for (let action = 1; action < count; action += 1)
              this.leaf[branch * MAX_CONTINUATIONS + action] = value;
            continue;
          }
          let mask = 0;
          for (let action = 0; action < count; action += 1) {
            if (this.nodes >= this.nodeBudget ||
                !this.stateArena.load(bundle.state, branch + 1)) return 0;
            const base = group * MAX_CONTINUATIONS;
            const ownAction = this.continuationActions[base + action];
            const ownArgument = this.continuationArguments[base + action];
            const enemyCount = this.generateEnemy(bundle.state);
            if (!enemyCount) return 0;
            let worst = VALUE_MAX; let complete = enemyCount > 0 ? 1 : 0;
            for (let column = 0; column < enemyCount; column += 1) {
              const enemyAction = this.enemyActions[column];
              const enemyArgument = this.enemyArguments[column];
              const ownChance = bundle.hard.chanceAlternativeCount(0, ownAction);
              const enemyChance = bundle.hard.chanceAlternativeCount(1, enemyAction);
              for (let chance = 0; chance < ownChance * enemyChance; chance += 1) {
                if (this.nodes >= this.nodeBudget) return 0;
                const status = bundle.kernel.applyFrame(ownAction, ownArgument,
                  enemyAction, enemyArgument, chance % ownChance,
                  Math.floor(chance / ownChance));
                this.nodes += 1;
                if (status !== FAST_STATUS.APPLIED && status !== FAST_STATUS.APPLIED_TERMINAL) {
                  complete = 0; break;
                }
                const mark = bundle.kernel.lastMark; const hard = bundle.hard.classifyApplied();
                const value = this.rootValue(bundle.state, bundle.hard.lastTerminal,
                  hard, this.rootOptionIndex[root], root);
                if (value < worst) worst = value; bundle.state.undoTo(mark);
              }
              if (!complete) break;
            }
            if (complete) { mask |= 1 << action;
              this.leaf[branch * MAX_CONTINUATIONS + action] = worst; }
          }
          this.continuationMask[branch] = mask;
        }
      let common = VALUE_MIN;
      for (let action = 0; action < count; action += 1) {
        let worst = VALUE_MAX; let members = 0; let valid = 1;
        for (let branch = 0; branch < this.branchCount; branch += 1)
          if (this.branchGroup[branch] === group) {
            members += 1;
            if (!(this.continuationMask[branch] & (1 << action))) { valid = 0; break; }
            const value = this.leaf[branch * MAX_CONTINUATIONS + action];
            if (value < worst) worst = value;
          }
        if (valid && members && worst > common) common = worst;
      }
      if (common === VALUE_MIN) return 0;
      let perBranch = VALUE_MAX;
      for (let branch = 0; branch < this.branchCount; branch += 1)
        if (this.branchGroup[branch] === group) {
          let best = VALUE_MIN;
          for (let action = 0; action < count; action += 1)
            if (this.continuationMask[branch] & (1 << action)) {
              const value = this.leaf[branch * MAX_CONTINUATIONS + action];
              if (value > best) best = value;
            }
          if (best < perBranch) perBranch = best;
        }
      if (common < lower) lower = common;
      if (perBranch < fused) fused = perBranch;
    }
    if (!groupSeen) return 0;
    this.rootCommon[root] = lower; this.rootFused[root] = fused;
    this.rootLower[root] = lower; this.rootUpper[root] = fused;
    if (fused > lower) this.strategyFusionGapCount += 1;
    if (groupSeen > 1) this.observationSplitCount += 1;
    return 1;
  }

  evaluate(engine, bundle, selected, total) {
    this.lastStatus = COMMON_OPTION_STATUS.NONE; this.lastProposal = -1;
    this.attempts += 1; this.nodes = 0; this.branchCount = 0; this.groupTotal = 0;
    this.continuationMask.fill(0); this.branchTerminal.fill(0);
    this.rootLower.fill(VALUE_MIN);
    this.rootUpper.fill(VALUE_MAX);
    this.rootExact.fill(1);
    if (!bundle || selected < 0 || selected >= total ||
        !movementAction(engine.ourActions[selected]) ||
        engine.runtime.runtimeMode !== RUNTIME_MODE.NORMAL ||
        !engine.adapter.enemyVisible || engine.hiddenWorldCount !== 1 ||
        engine.hiddenWorldMass[0] !== 10000 || engine.possibleProjectiles.count() !== 1 ||
        !engine.possibleProjectiles.pool.complete) {
      this.supportSkips += 1; return -1;
    }
    if (this.completeValueOwner(engine)) { this.valueOwnerSkips += 1; return -1; }
    const frame = engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    if (frame < this.lastFrame) this.lastFrame = -32;
    if (frame - this.lastFrame < this.cooldownFrames) {
      this.cooldownSkips += 1; return -1;
    }
    const roots = this.selectRoots(engine, selected, total);
    if (roots < 2 || !this.buildPortfolio(engine, roots)) {
      this.noConflictSkips += 1; return -1;
    }
    this.lastFrame = frame;
    const state = bundle.state; const lo = state.hashLo; const hi = state.hashHi;
    const mark = state.deltaUsed * 1024 + state.eventUsed;
    this.stateArena.beginRoot(state);
    let complete = 1;
    for (let root = 0; root < roots && complete; root += 1)
      for (let world = 0; world < MAX_WORLDS && complete; world += 1)
        complete = this.buildWorld(engine, bundle, root, world,
          engine.possibleProjectiles, engine.enemyCount);
    for (let root = 0; root < roots && complete; root += 1)
      complete = this.evaluateGroups(bundle, root);
    this.stateArena.load(state, 0);
    if (state.hashLo !== lo || state.hashHi !== hi ||
        state.deltaUsed * 1024 + state.eventUsed !== mark) {
      this.rootRestoreFailures += 1; complete = 0;
    }
    this.totalNodes += this.nodes; this.totalBranches += this.branchCount;
    this.totalGroups += this.groupTotal;
    if (this.nodes > this.maximumNodes) this.maximumNodes = this.nodes;
    if (!complete) { this.lastStatus = COMMON_OPTION_STATUS.INCOMPLETE;
      this.incomplete += 1; return -1; }
    this.lastStatus = COMMON_OPTION_STATUS.COMPLETE; this.completed += 1;
    let incumbent = 0; let best = -1;
    for (let root = 1; root < roots; root += 1)
      if (this.rootLower[root] > this.rootUpper[incumbent] &&
          (best < 0 || this.rootLower[root] > this.rootLower[best] ||
           this.rootLower[root] === this.rootLower[best] && root < best)) best = root;
    if (best < 0) return -1;
    this.horizonSeparationCount += 1;
    // A heuristic leaf is not a game-value bound.  Finite-horizon common
    // policy separation stays ordering evidence unless both compared roots
    // terminate (or reach a strict committed death certificate) on every
    // supported branch.
    if (!this.rootExact[incumbent] || !this.rootExact[best]) return -1;
    this.terminalOwnershipCount += 1; this.lastProposal = this.rootRows[best];
    if (this.active) { this.proposalCount += 1; return this.lastProposal; }
    return -1;
  }

  summary() {
    return { enabled: true, active: Boolean(this.active),
      maximumRoots: this.maximumRoots, nodeBudget: this.nodeBudget,
      status: this.lastStatus, attempts: this.attempts, supportSkips: this.supportSkips,
      cooldownSkips: this.cooldownSkips, valueOwnerSkips: this.valueOwnerSkips,
      noConflictSkips: this.noConflictSkips,
      completed: this.completed, incomplete: this.incomplete, nodes: this.totalNodes,
      lastNodes: this.nodes, maximumNodes: this.maximumNodes,
      branchCount: this.totalBranches, lastBranchCount: this.branchCount,
      observationGroups: this.totalGroups, lastObservationGroups: this.groupTotal,
      observationSplitCount: this.observationSplitCount,
      strategyFusionGapCount: this.strategyFusionGapCount,
      horizonSeparationCount: this.horizonSeparationCount,
      terminalOwnershipCount: this.terminalOwnershipCount,
      proposalCount: this.proposalCount, rootRestoreFailures: this.rootRestoreFailures,
      capacityStops: this.capacityStops, hotAllocationCount: this.hotAllocationCount,
      lastProposal: this.lastProposal,
      lower: Array.from(this.rootLower.slice(0, this.maximumRoots)),
      upper: Array.from(this.rootUpper.slice(0, this.maximumRoots)),
      exact: Array.from(this.rootExact.slice(0, this.maximumRoots)) };
  }
}

module.exports = { COMMON_OPTION_STATUS, VALUE_MIN, VALUE_MAX, MAX_ROOTS,
  MAX_WORLDS, CommonPolicyOptionInterval };
