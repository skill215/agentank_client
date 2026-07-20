"use strict";

const { fingerprintObject } = require("../core/hash");
const { observationFingerprint } = require("./capsule");
const { publicPhysicalFingerprint } = require("./rehydrate");

const PHYSICAL_SAFETY_STATUS = Object.freeze({ WINDOW_SAFE: "WINDOW_SAFE",
  NO_WITNESS: "NO_WITNESS", UNKNOWN: "UNKNOWN" });
const SKILL_COMMANDS = new Set(["shield", "freeze", "stun", "overload", "cloak", "poison",
  "boost"]);
const NO_FUTURE_STAR = () => null;

function cloneCommand(command) { return command ? { ...command } : null; }
function commandKey(command) {
  if (!command) return "NONE";
  if (command.type === "turn") return command.side === "left" ? "TURN_LEFT" : "TURN_RIGHT";
  return String(command.type).toUpperCase();
}
function sameCommand(left, right) { return JSON.stringify(left || null) === JSON.stringify(right || null); }
function activeDebuff(player, type, frame) {
  return player?.effects?.debuff?.type === type && player.effects.debuff.expiresAt > frame;
}
function activeSelfEffect(player, type, frame) {
  return player?.effects?.self?.type === type && player.effects.self.expiresAt > frame;
}

function commandSupport(simulator, seat, preferred = []) {
  const player = simulator.players[seat]; const frame = simulator.frame;
  if (!player || player.crashed || activeDebuff(player, "freeze", frame) ||
      (activeDebuff(player, "poison", frame) && (frame & 1) !== 0))
    return { commands: [null], complete: true, reason: null };
  const commands = [null, { type: "go" }, { type: "turn", side: "left" },
    { type: "turn", side: "right" }, { type: "fire" }, { type: "throwBomb" }];
  let complete = true; let reason = null;
  if (player.skillType === "teleport") { complete = false; reason = "TELEPORT_TARGET_SUPPORT"; }
  else if (SKILL_COMMANDS.has(player.skillType)) commands.push({ type: player.skillType });
  if (activeSelfEffect(player, "boost", frame)) {
    // The platform API permits compound boost programs. Until every compound
    // program is enumerated, a safe result must remain UNKNOWN.
    complete = false; reason = "BOOST_COMPOUND_SUPPORT";
  }
  const ordered = [];
  for (const command of [...preferred, ...commands])
    if (!ordered.some(existing => sameCommand(existing, command))) ordered.push(cloneCommand(command));
  return { commands: ordered, complete, reason };
}

function binaryChanceCount(simulator, actions) {
  let count = 0;
  for (let seat = 0; seat < 2; seat += 1) {
    const action = actions[seat]; const player = simulator.players[seat];
    if (activeDebuff(player, "stun", simulator.frame) &&
        (action?.type === "go" || action?.type === "turn")) count += 1;
  }
  return count;
}

function chanceMasks(count) {
  if (count < 0 || count > 4) return null;
  return Array.from({ length: 1 << count }, (_, index) => index);
}

function tapeRandom(mask, width) {
  let at = 0; const rng = () => {
    if (at >= width) { rng.overflow = true; at += 1; return 0.25; }
    const value = mask & (1 << at) ? 0.75 : 0.25; at += 1; return value;
  };
  rng.overflow = false; rng.draws = () => at; return rng;
}

function partitionByObservation(worlds, seat) {
  const groups = new Map();
  for (const world of worlds) {
    const fingerprint = observationFingerprint(world.snapshotFor(seat));
    let group = groups.get(fingerprint);
    if (!group) { group = []; groups.set(fingerprint, group); }
    group.push(world);
  }
  return groups;
}

class PhysicalSafetyOracle {
  constructor(options = {}) {
    this.transitionBudget = Number(options.transitionBudget ?? 200000);
    this.nodeBudget = Number(options.nodeBudget ?? 20000);
    this.maximumBeliefWorlds = Number(options.maximumBeliefWorlds ?? 2048);
    this.memo = new Map(); this.nodes = 0; this.transitions = 0; this.memoHits = 0;
    this.maximumObservedBeliefWorlds = 0; this.incompleteReasons = new Set();
    this.preferredOwnByFrame = options.preferredOwnByFrame || new Map();
    this.preferredEnemyByFrame = options.preferredEnemyByFrame || new Map();
  }
  reset() {
    this.memo.clear(); this.nodes = 0; this.transitions = 0; this.memoHits = 0;
    this.maximumObservedBeliefWorlds = 0; this.incompleteReasons.clear();
  }
  budgetAvailable() {
    return this.nodes < this.nodeBudget && this.transitions < this.transitionBudget;
  }
  beliefKey(worlds, remaining, seat) {
    const physical = worlds.map(publicPhysicalFingerprint).sort();
    return fingerprintObject({ remaining, seat, physical });
  }
  crashed(world, seat) { return Boolean(world.players[seat]?.crashed); }
  uniqueWorlds(worlds) {
    const unique = new Map();
    for (const world of worlds) {
      const key = publicPhysicalFingerprint(world); if (!unique.has(key)) unique.set(key, world);
    }
    return [...unique.values()];
  }
  stepSupport(world, seat, ownCommand, enemyCommand) {
    const actions = [null, null]; actions[seat] = cloneCommand(ownCommand);
    actions[seat ^ 1] = cloneCommand(enemyCommand);
    const draws = binaryChanceCount(world, actions); const masks = chanceMasks(draws);
    if (!masks) { this.incompleteReasons.add("CHANCE_DRAW_CAPACITY");
      return { worlds: [], complete: false, counterexample: null }; }
    const children = []; let complete = true; let firstCrash = null;
    for (const mask of masks) {
      if (this.transitions >= this.transitionBudget) { this.incompleteReasons.add("TRANSITION_BUDGET");
        complete = false; break; }
      const rng = tapeRandom(mask, draws);
      // Historical star providers are stateful closures. Sharing one across
      // clones makes sibling branches consume each other's schedule. A new star
      // cannot change physical survival inside this oracle, and teleport support
      // is deliberately incomplete, so preserve the current star but suppress
      // future spawns in every branch.
      const child = world.clone({ rng, starProvider: NO_FUTURE_STAR });
      const stepActions = actions.map(cloneCommand);
      child.step(stepActions, [{ runtimeMs: 0, logs: [] }, { runtimeMs: 0, logs: [] }]);
      this.transitions += 1;
      if (rng.overflow) { this.incompleteReasons.add("UNMODELED_RANDOM_DRAW"); complete = false; }
      children.push(child);
      if (!firstCrash && this.crashed(child, seat)) firstCrash = { ownAction: commandKey(ownCommand),
        enemyAction: commandKey(enemyCommand), chanceMask: mask, chanceDraws: draws,
        terminalFrame: child.frame, physicalFingerprint: publicPhysicalFingerprint(child) };
    }
    return { worlds: this.uniqueWorlds(children), complete, counterexample: firstCrash };
  }
  evaluateAction(worlds, remaining, seat, ownCommand) {
    const outcomes = []; let complete = true;
    for (const world of worlds) {
      if (world.result) { outcomes.push(world); continue; }
      const enemy = commandSupport(world, seat ^ 1,
        this.preferredEnemyByFrame.get(world.frame) || []);
      if (!enemy.complete) { complete = false; this.incompleteReasons.add(enemy.reason); }
      for (const enemyCommand of enemy.commands) {
        const stepped = this.stepSupport(world, seat, ownCommand, enemyCommand);
        // One concrete fatal environment branch refutes this fixed own action;
        // omitted enemy/chance branches cannot restore universal safety.
        if (stepped.counterexample) return { status: PHYSICAL_SAFETY_STATUS.NO_WITNESS,
          complete: true, counterexample: stepped.counterexample };
        complete = complete && stepped.complete; outcomes.push(...stepped.worlds);
        if (!this.budgetAvailable()) return { status: PHYSICAL_SAFETY_STATUS.UNKNOWN,
          complete: false, counterexample: null };
      }
    }
    const unique = this.uniqueWorlds(outcomes);
    if (unique.length > this.maximumBeliefWorlds) { this.incompleteReasons.add("BELIEF_CAPACITY");
      return { status: PHYSICAL_SAFETY_STATUS.UNKNOWN, complete: false, counterexample: null }; }
    const groups = partitionByObservation(unique, seat); const witnesses = [];
    for (const [observation, group] of groups) {
      const result = this.solveBelief(group, remaining - 1, seat);
      if (result.status === PHYSICAL_SAFETY_STATUS.NO_WITNESS)
        return { status: PHYSICAL_SAFETY_STATUS.NO_WITNESS, complete: complete && result.complete,
          counterexample: { ownAction: commandKey(ownCommand), observation,
            continuation: result.counterexample } };
      if (result.status === PHYSICAL_SAFETY_STATUS.UNKNOWN) complete = false;
      witnesses.push({ observation, worlds: group.length, action: result.action || null,
        continuation: result.witnesses || [] });
    }
    return { status: complete ? PHYSICAL_SAFETY_STATUS.WINDOW_SAFE : PHYSICAL_SAFETY_STATUS.UNKNOWN,
      complete, counterexample: null, witnesses };
  }
  solveBelief(worlds, remaining, seat) {
    if (worlds.some(world => this.crashed(world, seat)))
      return { status: PHYSICAL_SAFETY_STATUS.NO_WITNESS, complete: true,
        action: null, counterexample: { reason: "ALREADY_CRASHED" } };
    if (remaining <= 0) return { status: PHYSICAL_SAFETY_STATUS.WINDOW_SAFE,
      complete: true, action: null, counterexample: null };
    if (worlds.every(world => Boolean(world.result)))
      return { status: PHYSICAL_SAFETY_STATUS.WINDOW_SAFE,
        complete: true, action: null, counterexample: null };
    if (!this.budgetAvailable()) { this.incompleteReasons.add("NODE_BUDGET");
      return { status: PHYSICAL_SAFETY_STATUS.UNKNOWN, complete: false,
        action: null, counterexample: null }; }
    this.nodes += 1; this.maximumObservedBeliefWorlds = Math.max(this.maximumObservedBeliefWorlds,
      worlds.length);
    const key = this.beliefKey(worlds, remaining, seat); const memo = this.memo.get(key);
    if (memo) { this.memoHits += 1; return memo; }
    const first = worlds[0]; const support = commandSupport(first, seat,
      this.preferredOwnByFrame.get(first.frame) || []);
    let anyUnknown = !support.complete; if (!support.complete) this.incompleteReasons.add(support.reason);
    let counterexample = null; const refutations = [];
    for (const command of support.commands) {
      const result = this.evaluateAction(worlds, remaining, seat, command);
      if (result.status === PHYSICAL_SAFETY_STATUS.WINDOW_SAFE) {
        const solved = { status: result.status, complete: true, action: commandKey(command),
          counterexample: null, witnesses: result.witnesses || [] };
        this.memo.set(key, solved); return solved;
      }
      if (result.status === PHYSICAL_SAFETY_STATUS.UNKNOWN) anyUnknown = true;
      else { refutations.push({ action: commandKey(command), counterexample: result.counterexample });
        if (!counterexample) counterexample = result.counterexample; }
    }
    const solved = { status: anyUnknown ? PHYSICAL_SAFETY_STATUS.UNKNOWN :
      PHYSICAL_SAFETY_STATUS.NO_WITNESS, complete: !anyUnknown, action: null,
      counterexample: anyUnknown ? counterexample : { reason: "ALL_ACTIONS_REFUTED", refutations } };
    this.memo.set(key, solved); return solved;
  }
  classifyRoot(world, seat, command, horizonFrames) {
    this.reset();
    if (!Number.isSafeInteger(horizonFrames) || horizonFrames < 1 || horizonFrames > 4)
      throw new TypeError("horizonFrames must be an integer from 1 through 4");
    const result = this.evaluateAction([world], horizonFrames, seat, command);
    return { ...result, horizonFrames, counters: { nodes: this.nodes, transitions: this.transitions,
      memoHits: this.memoHits, maximumBeliefWorlds: this.maximumObservedBeliefWorlds,
      incompleteReasons: [...this.incompleteReasons].sort() } };
  }
}

module.exports = { PHYSICAL_SAFETY_STATUS, SKILL_COMMANDS, cloneCommand, commandKey,
  sameCommand, activeDebuff, activeSelfEffect, commandSupport, binaryChanceCount, chanceMasks,
  tapeRandom, partitionByObservation, PhysicalSafetyOracle };
