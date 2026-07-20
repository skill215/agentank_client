/*
 * tiny tank v27 candidate - bounded risk-sensitive simultaneous expectiminimax
 *
 * The tactical value is:
 *   max(our action) -> blend(worst enemy action, learned policy expectation)
 *   -> expectation(stun outcome)
 *
 * Only one command is queued per onIdle call. Path finding and emergency bullet
 * avoidance remain deterministic so the search stays inside the runtime budget.
 */

var AT_DIRS = ["up", "right", "down", "left"];
var AT_DIR_INDEX = { up: 0, right: 1, down: 2, left: 3 };
var AT_QUARTER_TURN_TABLE = [
  [0, 1, 2, 1], [1, 0, 1, 2], [2, 1, 0, 1], [1, 2, 1, 0]
];
var AT_TURN_LEFT = { up: "left", right: "up", down: "right", left: "down" };
var AT_TURN_RIGHT = { up: "right", right: "down", down: "left", left: "up" };
var AT_OPPOSITE = { up: "down", right: "left", down: "up", left: "right" };
var AT_DELTAS = {
  up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0]
};
var AT_MAX_NODES = 128;
var AT_SEARCH_NODES = 0;
var AT_NODE_LIMIT = 24;
var AT_LAST_ACTION = null;
var AT_TURN_STREAK = 0;
var AT_ENEMY_COUNTS = { GO: 1, LEFT: 1, RIGHT: 1, FIRE: 1 };
var AT_ENEMY_OBSERVATIONS = 0;
var AT_ENEMY_GO_STREAK = 0;
var AT_ENEMY_STATIONARY_STREAK = 0;
var AT_LAST_ENEMY_POS = null;
var AT_LAST_ENEMY_DIR = null;
var AT_LAST_MY_POS = null;
var AT_LAST_MY_DIR = null;
var AT_LAST_ENEMY_BULLET = false;
var AT_ENEMY_PROJECTILE_TRACK = null;
var AT_PROJECTILE_TRACK_MAX_AGE = 4;
// enemy.bullet exposes at most one projectile inside our view cone. When an
// armed Overload disappears early, infer the just-fired primary/secondary
// pair from the previous visible pose and retain both tracks for a few frames.
var AT_OVERLOAD_PROJECTILE_TRACKS = [];
var AT_OVERLOAD_PROJECTILE_TRACK_MAX_AGE = 8;
var AT_LAST_ENEMY_OVERLOAD_STATE = null;
var AT_EVASION_COMMITMENT = null;
var AT_LAST_ENEMY_VISIBLE_FRAME = -99;
var AT_HIDDEN_ENEMY_BELIEF = [];
var AT_HIDDEN_ENEMY_AGE = 0;
var AT_HIDDEN_BELIEF_MAX_AGE = 3;
var AT_HIDDEN_SPECIAL_MAX_AGE = 7;
var AT_HIDDEN_ENEMY_MODE = 0; // 0=ordinary, 1=cloak, 2=grass
var AT_HIDDEN_GRASS_ENTRY = null;
var AT_HIDDEN_GRASS_REGION = null;
var AT_HIDDEN_GRASS_REGION_TTL = 0;
var AT_HIDDEN_GRASS_REGION_MAX_TTL = 12;
// Cloak is a bounded imperfect-information episode, not an ordinary loss of
// sight. Keep every terrain-legal pose for its six-frame lifetime and keep a
// union of bullets that could have been fired while the pose was hidden.
// These arrays stay empty on the normal visible path.
var AT_CLOAK_PROJECTILE_BELIEF = [];
var AT_CLOAK_REMAINING_FRAMES = 0;
var AT_CLOAK_LAST_UPDATE_FRAME = -1;
var AT_HIDDEN_LAST_UPDATE_FRAME = -1;
var AT_STATIC_RAY_CACHE = [];
var AT_TARGET_RAY_CACHE = [];
var AT_DISTANCE_FIELD_CACHE = [];
var AT_ATTACK_LANE_CACHE = [];
var AT_OPEN_NEIGHBOR_CACHE = [];
var AT_EDGE_DISTANCE_CACHE = [];
var AT_MAP_REFERENCES = [];
var AT_MAP_ID_LOOKUP = typeof WeakMap === "function" ? new WeakMap() : null;
var AT_LAST_MAP_REFERENCE = null;
var AT_LAST_MAP_ID = -1;
var AT_EXPECTATION_BLEND_CACHE = null;
var AT_POSITION_FEATURE_CACHE = [];
var AT_PAIR_GEOMETRY_CACHE = [];
var AT_OPENED_MAP_CACHE = [];
var AT_HISTORY_SIZE = 8;
var AT_STATE_HISTORY = new Array(AT_HISTORY_SIZE);
var AT_HISTORY_CURSOR = 0;
var AT_HISTORY_COUNT = 0;
var AT_CONTEXT_EPOCH = 0;
var AT_LAST_CONTEXT_SIGNATURE = null;
var AT_ACTIVE_HISTORY_RECORD = null;
var AT_LAST_INTENT = null;
var AT_LAST_INTENT_EPOCH = -1;
var AT_INTENT_SWITCH_MARGIN = 150;
var AT_TURN_REVERSAL_PENALTY = 110;
var AT_MC_ROLLOUTS = 8;
var AT_MC_FRAMES = 4;
var AT_MC_FIXED_STATE_PRUNING = true;
var AT_MC_TRANSITIONS = 0;
var AT_MC_TRIGGER_COUNT = 0;
var AT_MC_DISABLE_AFTER_MS = 1000;
var AT_MINIMAX_REDUCE_AFTER_MS = 2250;
var AT_MINIMAX_EMERGENCY_AFTER_MS = 2700;
// Date.now is absent in some battle sandboxes. Keep a deterministic fallback
// based on whichever advances faster: official frame number or onIdle calls.
var AT_MC_DISABLE_AFTER_PROGRESS = 64;
var AT_MINIMAX_REDUCE_AFTER_PROGRESS = 100;
var AT_MINIMAX_EMERGENCY_AFTER_PROGRESS = 112;
var AT_ACCUMULATED_RUNTIME_MS = 0;
var AT_LAST_TIMED_FRAME = -1;
var AT_MC_DISABLED_BY_RUNTIME = false;
var AT_MATCH_DECISION_CALLS = 0;
var AT_MATCH_PROGRESS = 0;
// Preserve terrain-only geometry across frames. Dynamic combat values are
// deliberately excluded: bullets, cooldowns, stars, effects and history must
// still be evaluated from the current runtime state.
var AT_ROOT_MAP_FINGERPRINT = null;
var AT_ROOT_PHYSICAL_CACHE = null;
var AT_STRATEGIC_POSITION_KEY = -1;
var AT_STRATEGIC_WANTED_DIR = null;
var AT_STRATEGIC_EPOCH = -1;
var AT_TERMINAL_SCORE = 100000;
var AT_TIED_MUTUAL_DEATH_SCORE = -60000;
var AT_BOMB_EXACT_HORIZON = 3;
var AT_BOMB_BLAST_CACHE = [];

function onIdle(me, enemy, game) {
  var startedAt = beginRuntimeMeasurement(game);
  try {
    onIdleDecision(me, enemy, game);
  } finally {
    finishRuntimeMeasurement(startedAt);
  }
}

function onIdleDecision(me, enemy, game) {
  resetFrameCaches(game.map);
  observeEnemyBehavior(me, enemy, game);
  updateEnemyProjectileTracking(me, enemy, game);
  var myPos = me.tank.position;
  var enemyTank = enemy.tank;
  var emergency = dodgeVisibleBullet(me, enemy, game);
  updateContextEpoch(me, enemy, game, !!emergency);
  beginHistoryFrame(me, game);

  // Visible bombs are deterministic deadline hazards. This guard runs before
  // every direct-return shortcut below so a locally attractive shot, turn, or
  // patrol step cannot bypass bomb safety.
  var bombEmergency = chooseVisibleBombSafetyAction(me, enemy, game);
  if (bombEmergency) {
    // A bomb-safe action may differ from the projectile turn planned above.
    // Do not carry a commitment for a turn that was never executed.
    AT_EVASION_COMMITMENT = null;
    setActiveIntent("EVADE");
    executeAction(me, bombEmergency, enemy, game);
    return;
  }

  if (emergency) {
    setActiveIntent("EVADE");
    executeAction(me, emergency, enemy, game);
    return;
  }

  var committedEvasion = continueProjectileEvasion(me, enemy, game);
  if (committedEvasion) {
    setActiveIntent("EVADE");
    executeAction(me, committedEvasion, enemy, game);
    return;
  }

  // A tank that moves from a visible open tile into grass disappears from
  // enemy.tank, but the disappearance itself can identify its new tile. Take
  // a short, high-confidence blind shot before generic hidden navigation
  // forgets a winning adjacent attack.
  var hiddenAttack = winningHiddenAttackAction(me, enemy, game);
  if (hiddenAttack) {
    setActiveIntent("ATTACK");
    executeAction(me, hiddenAttack, enemy, game);
    return;
  }

  var initiativeAttack = winningAttackAction(me, enemy, game);
  if (initiativeAttack) {
    setActiveIntent("ATTACK");
    executeAction(me, initiativeAttack, enemy, game);
    return;
  }

  var preemptiveDodge = preemptiveMuzzleDodge(me, enemy, game);
  if (preemptiveDodge) {
    setActiveIntent("EVADE");
    executeAction(me, preemptiveDodge, enemy, game);
    return;
  }

  // Hard stability guard: a bounded search must not rotate indefinitely on a
  // flat evaluation plateau. After three turns, take a safe open step.
  if (AT_TURN_STREAK >= 3) {
    var runtimeBlocker = runtimeEnemyBlockedPosition(enemy);
    var progress = advanceTankPosition(myPos, me.tank.direction,
      me.status.boosted ? 2 : 1, game.map,
      runtimeBlocker);
    var edgeProgressSafe = outerEdgeDistance(progress, game.map) >=
      outerEdgeDistance(myPos, game.map) ||
      (game.star && manhattan(progress, game.star) <
        manhattan(myPos, game.star));
    if (!samePos(progress, myPos) &&
        edgeProgressSafe &&
        runtimeMuzzleRiskAt(progress, enemy, game, me.tank.direction,
          me.status.boosted ? 2 : 1) < 20000) {
      setActiveIntent(game.star ? "CHASE_STAR" : "EXIT_EDGE");
      executeAction(me, "GO", enemy, game);
      return;
    }
  }

  var tacticalContact = enemyTank &&
    (enemy.status.stunned ||
      (game.bombs && game.bombs.length > 0) ||
      manhattan(myPos, enemyTank.position) <= 9 ||
      clearLine(myPos, enemyTank.position, game.map) ||
      runtimePredictiveShotOpportunity(me, enemy, game));

  if (tacticalContact) {
    var state = makeSearchState(me, enemy, game);
    captureHistoryEvaluation(state);
    AT_SEARCH_NODES = 0;
    var action = chooseTacticalAction(state, tacticalSearchRounds(state));
    if (action) {
      executeAction(me, action, enemy, game);
      return;
    }
  }

  navigateWhenHidden(me, enemy, game);
}

function runtimeClockMs() {
  return typeof Date === "function" && typeof Date.now === "function" ?
    Date.now() : 0;
}

function beginRuntimeMeasurement(game) {
  var frame = game && typeof game.frames === "number" ? game.frames : 0;
  if (AT_LAST_TIMED_FRAME >= 0 && frame < AT_LAST_TIMED_FRAME) {
    AT_ACCUMULATED_RUNTIME_MS = 0;
    AT_MC_DISABLED_BY_RUNTIME = false;
    AT_MC_TRIGGER_COUNT = 0;
    AT_MATCH_DECISION_CALLS = 0;
    AT_MATCH_PROGRESS = 0;
  }
  AT_LAST_TIMED_FRAME = frame;
  AT_MATCH_DECISION_CALLS++;
  AT_MATCH_PROGRESS = Math.max(frame, AT_MATCH_DECISION_CALLS - 1);
  if (AT_MATCH_PROGRESS >= AT_MC_DISABLE_AFTER_PROGRESS) {
    AT_MC_DISABLED_BY_RUNTIME = true;
  }
  return runtimeClockMs();
}

function finishRuntimeMeasurement(startedAt) {
  var finishedAt = runtimeClockMs();
  if (startedAt > 0 && finishedAt >= startedAt) {
    AT_ACCUMULATED_RUNTIME_MS += finishedAt - startedAt;
  }
  if (AT_ACCUMULATED_RUNTIME_MS >= AT_MC_DISABLE_AFTER_MS) {
    AT_MC_DISABLED_BY_RUNTIME = true;
  }
}

function monteCarloRuntimeBudgetExceeded() {
  return AT_MC_DISABLED_BY_RUNTIME ||
    AT_ACCUMULATED_RUNTIME_MS >= AT_MC_DISABLE_AFTER_MS ||
    AT_MATCH_PROGRESS >= AT_MC_DISABLE_AFTER_PROGRESS;
}

function minimaxRuntimeReductionActive() {
  return AT_ACCUMULATED_RUNTIME_MS >= AT_MINIMAX_REDUCE_AFTER_MS ||
    AT_MATCH_PROGRESS >= AT_MINIMAX_REDUCE_AFTER_PROGRESS;
}

function minimaxRuntimeEmergencyActive() {
  return AT_ACCUMULATED_RUNTIME_MS >= AT_MINIMAX_EMERGENCY_AFTER_MS ||
    AT_MATCH_PROGRESS >= AT_MINIMAX_EMERGENCY_AFTER_PROGRESS;
}

function physicalMapFingerprint(map) {
  if (!map || !map.length) return null;
  var hash1 = 2166136261;
  var hash2 = 2246822519;
  var height = map[0] ? map[0].length : 0;
  for (var x = 0; x < map.length; x++) {
    var column = map[x] || [];
    for (var y = 0; y < column.length; y++) {
      var tile = column[y];
      var code = tile && tile.charCodeAt ? tile.charCodeAt(0) : 0;
      // The battle sandbox exposes an older Math object without Math.imul.
      // Use shift/add 32-bit mixing so terrain-cache identity stays portable.
      hash1 ^= code;
      hash1 = (hash1 + (hash1 << 1) + (hash1 << 4) +
        (hash1 << 7) + (hash1 << 8) + (hash1 << 24)) >>> 0;
      hash2 ^= code + x * 17 + y * 31;
      hash2 = (hash2 + (hash2 << 10)) >>> 0;
      hash2 ^= hash2 >>> 6;
    }
  }
  hash2 = (hash2 + (hash2 << 3)) >>> 0;
  hash2 ^= hash2 >>> 11;
  hash2 = (hash2 + (hash2 << 15)) >>> 0;
  return map.length + "x" + height + ":" + (hash1 >>> 0) + ":" +
    (hash2 >>> 0);
}

function createRootPhysicalCache(fingerprint) {
  return {
    fingerprint: fingerprint,
    staticRays: [],
    targetRays: {},
    distanceFields: [],
    attackLanes: [],
    openNeighbors: [],
    edgeDistances: [],
    positionFeatures: [],
    pairGeometry: [],
    bombBlasts: []
  };
}

function resetFrameCaches(rootMap) {
  var rootCache = null;
  if (rootMap) {
    var fingerprint = physicalMapFingerprint(rootMap);
    if (!AT_ROOT_PHYSICAL_CACHE ||
        fingerprint !== AT_ROOT_MAP_FINGERPRINT) {
      AT_ROOT_MAP_FINGERPRINT = fingerprint;
      AT_ROOT_PHYSICAL_CACHE = createRootPhysicalCache(fingerprint);
    }
    rootCache = AT_ROOT_PHYSICAL_CACHE;
  }
  AT_STATIC_RAY_CACHE = [];
  AT_TARGET_RAY_CACHE = [];
  AT_DISTANCE_FIELD_CACHE = [];
  AT_ATTACK_LANE_CACHE = [];
  AT_OPEN_NEIGHBOR_CACHE = [];
  AT_EDGE_DISTANCE_CACHE = [];
  AT_MAP_REFERENCES = [];
  AT_MAP_ID_LOOKUP = typeof WeakMap === "function" ? new WeakMap() : null;
  AT_LAST_MAP_REFERENCE = null;
  AT_LAST_MAP_ID = -1;
  AT_EXPECTATION_BLEND_CACHE = null;
  AT_POSITION_FEATURE_CACHE = [];
  AT_PAIR_GEOMETRY_CACHE = [];
  AT_OPENED_MAP_CACHE = [];
  AT_BOMB_BLAST_CACHE = [];

  // The runtime map is always map id zero for this frame. Simulation-created
  // maps (for example a newly destroyed mound) receive later ids and remain
  // frame-local, so they cannot contaminate the persistent root geometry.
  if (rootCache) {
    AT_MAP_REFERENCES[0] = rootMap;
    if (AT_MAP_ID_LOOKUP) AT_MAP_ID_LOOKUP.set(rootMap, 0);
    AT_LAST_MAP_REFERENCE = rootMap;
    AT_LAST_MAP_ID = 0;
    AT_STATIC_RAY_CACHE[0] = rootCache.staticRays;
    AT_TARGET_RAY_CACHE[0] = rootCache.targetRays;
    AT_DISTANCE_FIELD_CACHE[0] = rootCache.distanceFields;
    AT_ATTACK_LANE_CACHE[0] = rootCache.attackLanes;
    AT_OPEN_NEIGHBOR_CACHE[0] = rootCache.openNeighbors;
    AT_EDGE_DISTANCE_CACHE[0] = rootCache.edgeDistances;
    AT_POSITION_FEATURE_CACHE[0] = rootCache.positionFeatures;
    AT_PAIR_GEOMETRY_CACHE[0] = rootCache.pairGeometry;
    AT_BOMB_BLAST_CACHE[0] = rootCache.bombBlasts;
  }
}

function updateContextEpoch(me, enemy, game, emergency) {
  var enemyVisible = !!enemy.tank;
  var enemyProjectileVisibleOrTracked = !!currentEnemyProjectile(enemy, game);
  var starKey = game.star ? positionCode(game.star) : -1;
  var bombKey = game.bombs && game.bombs.length ? game.bombs.length : 0;
  var signature = starKey + "|" + (enemyVisible ? 1 : 0) + "|" +
    (me.bullet ? 1 : 0) + "|" +
    (enemyProjectileVisibleOrTracked ? 1 : 0) + "|" +
    (enemy.status.stunned ? 1 : 0) + "|" + bombKey + "|" +
    (enemy.skill && enemy.skill.type || "none") + "|" +
    (emergency ? 1 : 0);
  if (AT_LAST_CONTEXT_SIGNATURE !== null &&
      signature !== AT_LAST_CONTEXT_SIGNATURE) {
    AT_CONTEXT_EPOCH++;
  }
  AT_LAST_CONTEXT_SIGNATURE = signature;
}

function physicalStateKey(position, direction) {
  return (position[0] * 64 + position[1]) * 4 + AT_DIR_INDEX[direction];
}

function beginHistoryFrame(me, game) {
  var record = {
    key: physicalStateKey(me.tank.position, me.tank.direction),
    epoch: AT_CONTEXT_EPOCH,
    action: null,
    intent: null,
    totalValue: null,
    chosenValue: null,
    components: null
  };
  AT_STATE_HISTORY[AT_HISTORY_CURSOR] = record;
  AT_HISTORY_CURSOR = (AT_HISTORY_CURSOR + 1) % AT_HISTORY_SIZE;
  if (AT_HISTORY_COUNT < AT_HISTORY_SIZE) AT_HISTORY_COUNT++;
  AT_ACTIVE_HISTORY_RECORD = record;
}

function recentHistoryRecord(offset) {
  if (offset < 0 || offset >= AT_HISTORY_COUNT) return null;
  var index = AT_HISTORY_CURSOR - 1 - offset;
  while (index < 0) index += AT_HISTORY_SIZE;
  return AT_STATE_HISTORY[index];
}

function captureHistoryEvaluation(state) {
  if (!AT_ACTIVE_HISTORY_RECORD) return;
  state._captureEvaluationComponents = true;
  var total = evaluateState(state);
  AT_ACTIVE_HISTORY_RECORD.totalValue = total;
  AT_ACTIVE_HISTORY_RECORD.components = copyScoreComponents(
    state._evaluationComponents);
}

function copyScoreComponents(components) {
  if (!components) return null;
  return {
    survival: components.survival,
    objective: components.objective,
    action: components.action,
    projectile: components.projectile,
    attack: components.attack,
    position: components.position,
    status: components.status,
    repetition: components.repetition
  };
}

function setActiveIntent(intent) {
  if (AT_ACTIVE_HISTORY_RECORD) AT_ACTIVE_HISTORY_RECORD.intent = intent;
}

function mapCacheId(map) {
  if (map === AT_LAST_MAP_REFERENCE) return AT_LAST_MAP_ID;
  if (AT_MAP_ID_LOOKUP) {
    var cachedId = AT_MAP_ID_LOOKUP.get(map);
    if (cachedId !== undefined) {
      AT_LAST_MAP_REFERENCE = map;
      AT_LAST_MAP_ID = cachedId;
      return cachedId;
    }
  } else {
    for (var i = 0; i < AT_MAP_REFERENCES.length; i++) {
      if (AT_MAP_REFERENCES[i] === map) {
        AT_LAST_MAP_REFERENCE = map;
        AT_LAST_MAP_ID = i;
        return i;
      }
    }
  }
  AT_MAP_REFERENCES.push(map);
  var id = AT_MAP_REFERENCES.length - 1;
  if (AT_MAP_ID_LOOKUP) AT_MAP_ID_LOOKUP.set(map, id);
  AT_LAST_MAP_REFERENCE = map;
  AT_LAST_MAP_ID = id;
  return id;
}

function positionCode(position) {
  return position[0] * 256 + position[1];
}

function makeSearchState(me, enemy, game) {
  var frame = typeof game.frames === "number" ? game.frames : 0;
  var myDebuff = me.effects && me.effects.debuff;
  var enemyDebuff = enemy.effects && enemy.effects.debuff;
  var enemySkill = enemy.skill || {};
  var enemyProjectiles = currentEnemyProjectiles(enemy, game);
  var enemyProjectile = enemyProjectiles[0] || null;
  var state = {
    map: game.map,
    star: game.star ? copyPos(game.star) : null,
    starDistance: buildDistanceField(game.map, game.star),
    myPos: copyPos(me.tank.position),
    myDir: me.tank.direction,
    enemyPos: copyPos(enemy.tank.position),
    enemyDir: enemy.tank.direction,
    myStars: me.stars || 0,
    enemyStars: enemy.stars || 0,
    myCanFire: !me.bullet && !me.status.fireLocked,
    enemyCanFire: enemyProjectiles.length === 0 &&
      !enemy.status.fireLocked,
    myFireLockedFrames: me.status.fireLocked ? 1 : 0,
    enemyFireLockedFrames: enemy.status.fireLocked ? 1 : 0,
    myProjectile: projectileFromRuntime(me.bullet),
    myProjectile2: null,
    enemyProjectile: enemyProjectile,
    enemyProjectile2: enemyProjectiles[1] || null,
    myMoveSpeed: me.status.boosted ? 2 : 1,
    enemyMoveSpeed: enemy.status.boosted ? 2 : 1,
    myBoosted: !!me.status.boosted,
    enemyBoosted: !!enemy.status.boosted,
    myBoostFrames: me.status.boosted ?
      effectFrames(me.effects && me.effects.self, 1) : 0,
    enemyBoostFrames: enemy.status.boosted ?
      effectFrames(enemy.effects && enemy.effects.self, 1) : 0,
    stunReady: me.skill.type === "stun" &&
      me.skill.remainingCooldownFrames === 0,
    enemyStunned: enemy.status.stunned ?
      effectFrames(enemyDebuff, 1) : 0,
    myStunned: me.status.stunned ? effectFrames(myDebuff, 1) : 0,
    myFrozen: me.status.frozen ? effectFrames(myDebuff, 1) : 0,
    enemyFrozen: enemy.status.frozen ? effectFrames(enemyDebuff, 1) : 0,
    myPoisoned: me.status.poisoned ? effectFrames(myDebuff, 1) : 0,
    enemyPoisoned: enemy.status.poisoned ? effectFrames(enemyDebuff, 1) : 0,
    myCanActNow: me.status.canActThisFrame !== false,
    enemyCanActNow: enemy.status.canActThisFrame !== false,
    myShielded: !!me.status.shielded,
    enemyShielded: !!enemy.status.shielded,
    // Runtime exposes whether a shield exists, not its remaining hit count.
    // Assume one guaranteed block for us and the full two for the minimizer.
    myShieldHits: me.status.shielded ? 1 : 0,
    enemyShieldHits: enemy.status.shielded ? 2 : 0,
    myShieldFrames: me.status.shielded ?
      effectFrames(me.effects && me.effects.self, 1) : 0,
    enemyShieldFrames: enemy.status.shielded ?
      effectFrames(enemy.effects && enemy.effects.self, 1) : 0,
    myOverloaded: !!me.status.overloaded,
    enemyOverloaded: !!enemy.status.overloaded,
    myOverloadFrames: me.status.overloaded ?
      effectFrames(me.effects && me.effects.self, 1) : 0,
    enemyOverloadFrames: enemy.status.overloaded ?
      effectFrames(enemy.effects && enemy.effects.self, 1) : 0,
    myCloaked: me.status.cloaked ?
      effectFrames(me.effects && me.effects.self, 1) : 0,
    enemyCloaked: enemy.status.cloaked ?
      effectFrames(enemy.effects && enemy.effects.self, 1) : 0,
    enemySkillType: enemySkill.type || null,
    enemySkillReady: !!enemySkill.type &&
      enemySkill.remainingCooldownFrames === 0,
    enemySkillCooldown: typeof enemySkill.remainingCooldownFrames === "number" ?
      enemySkill.remainingCooldownFrames : 99,
    myBombReady: !me.status.bombActive &&
      (typeof me.status.bombCooldownFrames !== "number" ||
        me.status.bombCooldownFrames === 0),
    bombs: normalizeVisibleBombs(game.bombs, frame),
    enemyStationaryStreak: AT_ENEMY_STATIONARY_STREAK,
    frame: frame,
    actionScore: 0,
    repetitionPenalty: 0,
    repeatReliefPenalty: 0,
    repeatReferenceValue: null,
    simPathKey1: -1,
    simPathKey2: -1,
    simPathKey3: -1,
    simPathDepth: 0,
    contextEpoch: AT_CONTEXT_EPOCH,
    searchPly: 0,
    lastMyAction: AT_LAST_ACTION,
    myTurnStreak: AT_TURN_STREAK,
    myDead: false,
    enemyDead: false
  };
  state.proposedIntent = determineIntent(state);
  state.committedIntent = committedIntentForState(state);
  return state;
}

function observeEnemyBehavior(me, enemy, game) {
  var frame = game && typeof game.frames === "number" ? game.frames :
    AT_LAST_ENEMY_VISIBLE_FRAME + 1;
  if (!enemy.tank) {
    updateHiddenEnemyBelief(me, enemy, game, frame);
    AT_LAST_ENEMY_BULLET = !!enemy.bullet;
    AT_LAST_MY_POS = copyPos(me.tank.position);
    AT_LAST_MY_DIR = me.tank.direction;
    return;
  }

  // A bullet fired under cloak may remain outside our view after the tank is
  // visible again. Advance those bounded hypotheses until terrain removes
  // them; a visible runtime bullet supersedes the union.
  updateCloakProjectileBelief(me, enemy, game, frame, false);

  var position = enemy.tank.position;
  var direction = enemy.tank.direction;
  var observedAction = null;
  var consecutiveVisible = AT_HIDDEN_ENEMY_AGE === 0 &&
    frame === AT_LAST_ENEMY_VISIBLE_FRAME + 1;
  if (consecutiveVisible && AT_LAST_ENEMY_POS && AT_LAST_ENEMY_DIR) {
    if (!samePos(position, AT_LAST_ENEMY_POS)) {
      observedAction = "GO";
      AT_ENEMY_STATIONARY_STREAK = 0;
    } else if (direction !== AT_LAST_ENEMY_DIR) {
      AT_ENEMY_STATIONARY_STREAK++;
      if (direction === turnDir(AT_LAST_ENEMY_DIR, -1)) observedAction = "LEFT";
      else if (direction === turnDir(AT_LAST_ENEMY_DIR, 1)) observedAction = "RIGHT";
    } else if (enemy.bullet && enemy.bullet.position &&
        !AT_LAST_ENEMY_BULLET &&
        manhattan(position, enemy.bullet.position) <= 2) {
      AT_ENEMY_STATIONARY_STREAK++;
      observedAction = "FIRE";
    } else {
      AT_ENEMY_STATIONARY_STREAK++;
    }
  }

  if (observedAction) {
    AT_ENEMY_COUNTS[observedAction]++;
    AT_ENEMY_OBSERVATIONS++;
    if (observedAction === "GO") AT_ENEMY_GO_STREAK++;
    else AT_ENEMY_GO_STREAK = 0;
  }
  AT_LAST_ENEMY_POS = copyPos(position);
  AT_LAST_ENEMY_DIR = direction;
  AT_LAST_ENEMY_BULLET = !!enemy.bullet;
  AT_LAST_ENEMY_VISIBLE_FRAME = frame;
  AT_HIDDEN_ENEMY_BELIEF = [];
  AT_HIDDEN_ENEMY_AGE = 0;
  AT_HIDDEN_ENEMY_MODE = 0;
  AT_HIDDEN_LAST_UPDATE_FRAME = -1;
  AT_HIDDEN_GRASS_ENTRY = null;
  AT_HIDDEN_GRASS_REGION = null;
  AT_HIDDEN_GRASS_REGION_TTL = 0;
  AT_CLOAK_REMAINING_FRAMES = 0;
  AT_LAST_MY_POS = copyPos(me.tank.position);
  AT_LAST_MY_DIR = me.tank.direction;
}

// enemy.bullet is a vision-cone observation, not authoritative projectile
// state. Preserve a short deterministic track so turning sideways during a
// dodge cannot make an already-fired lethal shot disappear from Minimax.
function updateEnemyProjectileTracking(me, enemy, game) {
  var frame = game && typeof game.frames === "number" ? game.frames : 0;
  var visible = projectileFromRuntime(enemy.bullet);
  updateOverloadProjectileTracking(me, enemy, game, frame, visible);
  if (visible) {
    AT_ENEMY_PROJECTILE_TRACK = {
      position: visible.position,
      direction: visible.direction,
      damage: visible.damage,
      observed: true,
      seenFrame: frame,
      projectedFrame: frame
    };
    return;
  }

  var track = AT_ENEMY_PROJECTILE_TRACK;
  if (!track) return;
  if (frame < track.projectedFrame || frame - track.seenFrame >
      AT_PROJECTILE_TRACK_MAX_AGE) {
    AT_ENEMY_PROJECTILE_TRACK = null;
    AT_EVASION_COMMITMENT = null;
    return;
  }

  while (track.projectedFrame < frame) {
    var projected = advanceTrackedProjectile(track.position,
      track.direction, game.map);
    if (!projected) {
      AT_ENEMY_PROJECTILE_TRACK = null;
      return;
    }
    track.position = projected;
    track.projectedFrame++;
  }

  // If the extrapolated bullet is directly ahead through a clear ray, the
  // runtime would expose it. Its absence then proves that it hit terrain or
  // otherwise ceased to exist. For side/behind positions absence is merely
  // loss of vision and the short ghost remains authoritative.
  if (runtimeDefinitelySeesProjectile(me, track.position, game.map)) {
    AT_ENEMY_PROJECTILE_TRACK = null;
  }
}

function updateOverloadProjectileTracking(me, enemy, game, frame, visible) {
  var previous = AT_LAST_ENEMY_OVERLOAD_STATE;
  if (previous && frame <= previous.frame) {
    AT_OVERLOAD_PROJECTILE_TRACKS = [];
    previous = null;
  }

  var retained = [];
  for (var i = 0; i < AT_OVERLOAD_PROJECTILE_TRACKS.length; i++) {
    var track = AT_OVERLOAD_PROJECTILE_TRACKS[i];
    if (frame < track.projectedFrame || frame - track.seenFrame >
        AT_OVERLOAD_PROJECTILE_TRACK_MAX_AGE) continue;
    var alive = true;
    while (track.projectedFrame < frame) {
      var projected = advanceTrackedProjectile(track.position,
        track.direction, game.map);
      if (!projected) {
        alive = false;
        break;
      }
      track.position = projected;
      track.projectedFrame++;
    }
    if (!alive) continue;
    // A matching visible bullet confirms rather than replaces the inferred
    // pair. The other lane can remain outside enemy.bullet's view cone.
    retained.push(track);
  }
  AT_OVERLOAD_PROJECTILE_TRACKS = retained;

  var active = !!(enemy.status && enemy.status.overloaded);
  var remaining = active ? effectFrames(enemy.effects && enemy.effects.self,
    1) : 0;
  if (previous && previous.active && previous.frame === frame - 1 &&
      previous.remaining > 1 && !active) {
    addInferredOverloadProjectile(previous.position, previous.direction,
      game.map, frame, visible);
    addInferredOverloadProjectile(overloadSecondaryOrigin(previous.position,
      previous.direction), previous.direction, game.map, frame, visible);
  }

  AT_LAST_ENEMY_OVERLOAD_STATE = active && enemy.tank ? {
    active: true,
    position: copyPos(enemy.tank.position),
    direction: enemy.tank.direction,
    remaining: remaining,
    frame: frame
  } : { active: false, remaining: 0, frame: frame };
}

function addInferredOverloadProjectile(origin, direction, map, frame,
    visible) {
  var projected = advanceTrackedProjectile(origin, direction, map);
  if (!projected) return;
  if (visible && samePos(projected, visible.position) &&
      direction === visible.direction) return;
  for (var i = 0; i < AT_OVERLOAD_PROJECTILE_TRACKS.length; i++) {
    var existing = AT_OVERLOAD_PROJECTILE_TRACKS[i];
    if (samePos(existing.position, projected) &&
        existing.direction === direction) return;
  }
  AT_OVERLOAD_PROJECTILE_TRACKS.push({
    position: projected,
    direction: direction,
    damage: 1,
    observed: false,
    inferredOverload: true,
    seenFrame: frame,
    projectedFrame: frame
  });
}

function advanceTrackedProjectile(position, direction, map) {
  var x = position[0];
  var y = position[1];
  var step = AT_DELTAS[direction];
  if (!step) return null;
  for (var i = 0; i < 2; i++) {
    x += step[0];
    y += step[1];
    var column = map[x];
    var tile = column && column[y];
    if (tile !== "." && tile !== "o") return null;
  }
  return [x, y];
}

function runtimeDefinitelySeesProjectile(me, position, map) {
  if (!me || !me.tank || !position) return false;
  var wanted = directionToAligned(me.tank.position, position);
  return wanted === me.tank.direction &&
    clearLine(me.tank.position, position, map);
}

function currentEnemyProjectile(enemy, game) {
  var visible = projectileFromRuntime(enemy && enemy.bullet);
  if (visible) return visible;
  var track = AT_ENEMY_PROJECTILE_TRACK;
  if (!track) return null;
  var frame = game && typeof game.frames === "number" ? game.frames : 0;
  if (track.projectedFrame !== frame ||
      frame - track.seenFrame > AT_PROJECTILE_TRACK_MAX_AGE) return null;
  return cloneProjectile(track);
}

function currentEnemyProjectiles(enemy, game) {
  var result = [];
  var primary = currentEnemyProjectile(enemy, game);
  if (primary) result.push(primary);
  var frame = game && typeof game.frames === "number" ? game.frames : 0;
  for (var i = 0; i < AT_OVERLOAD_PROJECTILE_TRACKS.length &&
      result.length < 2; i++) {
    var track = AT_OVERLOAD_PROJECTILE_TRACKS[i];
    if (track.projectedFrame !== frame || frame - track.seenFrame >
        AT_OVERLOAD_PROJECTILE_TRACK_MAX_AGE) continue;
    var duplicate = false;
    for (var j = 0; j < result.length; j++) {
      if (samePos(result[j].position, track.position) &&
          result[j].direction === track.direction) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) result.push(cloneProjectile(track));
  }
  return result;
}

function addHiddenBeliefCandidate(result, seen, position, direction) {
  var key = positionCode(position) + "|" + direction;
  if (seen[key] || result.length >= 8) return;
  seen[key] = true;
  result.push({ position: copyPos(position), direction: direction });
}

function addUnseenHiddenCandidate(result, seen, position, direction, me,
    map) {
  if (tileAt(position, map) !== "o" &&
      runtimeDefinitelySeesProjectile(me, position, map)) return;
  addHiddenBeliefCandidate(result, seen, position, direction);
}

function detectSpecialHiddenEnemyMode(enemy, map) {
  AT_HIDDEN_GRASS_ENTRY = null;
  AT_HIDDEN_GRASS_REGION = null;
  AT_HIDDEN_GRASS_REGION_TTL = 0;
  if (enemy.status && enemy.status.cloaked) return 1;
  if (!AT_LAST_ENEMY_POS || !AT_LAST_ENEMY_DIR) return 0;
  if (tileAt(AT_LAST_ENEMY_POS, map) === "o") return 2;
  var forward = addPos(AT_LAST_ENEMY_POS,
    dirDelta(AT_LAST_ENEMY_DIR));
  if (tileAt(forward, map) !== "o") return 0;
  AT_HIDDEN_GRASS_ENTRY = forward;
  return 2;
}

function hiddenBeliefAgeLimit() {
  return AT_HIDDEN_ENEMY_MODE ? AT_HIDDEN_SPECIAL_MAX_AGE :
    AT_HIDDEN_BELIEF_MAX_AGE;
}

function specialHiddenCandidateScore(position, direction, actionRank, me,
    map) {
  var target = me.tank.position;
  var distance = manhattan(position, target);
  var score = -distance * 24 + actionRank;
  var wanted = directionToAligned(position, target);
  if (wanted && clearLine(position, target, map)) {
    if (direction === wanted) score += 20000 - distance * 20;
    else if (quarterTurns(direction, wanted) === 1) score += 700;
  }
  if (AT_HIDDEN_ENEMY_MODE === 2 && tileAt(position, map) === "o") {
    score += 80;
  }
  return score;
}

function addSpecialHiddenCandidate(pool, seen, position, direction,
    actionRank, me, map) {
  // A cloaked tank stays invisible on open ground. A grass hypothesis that
  // steps into a tile we can definitely see is disproved immediately.
  if (AT_HIDDEN_ENEMY_MODE !== 1 && tileAt(position, map) !== "o" &&
      runtimeDefinitelySeesProjectile(me, position, map)) return;
  if (samePos(position, me.tank.position)) return;
  var key = positionCode(position) * 4 + AT_DIR_INDEX[direction];
  var score = specialHiddenCandidateScore(position, direction, actionRank,
    me, map);
  var existing = seen[key];
  if (existing !== undefined) {
    if (score > pool[existing].score) pool[existing].score = score;
    return;
  }
  seen[key] = pool.length;
  pool.push({
    position: copyPos(position), direction: direction, score: score
  });
}

function selectSpecialHiddenCandidates(pool) {
  var result = [];
  for (var i = 0; i < pool.length; i++) {
    var candidate = pool[i];
    var insertAt = result.length;
    while (insertAt > 0 &&
        result[insertAt - 1].score < candidate.score) insertAt--;
    if (insertAt >= 8) continue;
    var nextLength = result.length < 8 ? result.length + 1 : 8;
    for (var j = nextLength - 1; j > insertAt; j--) {
      result[j] = result[j - 1];
    }
    result[insertAt] = candidate;
    result.length = nextLength;
  }
  return result;
}

function cloakRemainingFrames(enemy) {
  var selfEffect = enemy.effects && enemy.effects.self;
  if (selfEffect && selfEffect.type === "cloak" &&
      typeof selfEffect.remainingFrames === "number") {
    return Math.max(0, selfEffect.remainingFrames);
  }
  var skill = enemy.skill || {};
  if (skill.activeType === "cloak" &&
      typeof skill.activeRemainingFrames === "number") {
    return Math.max(0, skill.activeRemainingFrames);
  }
  return enemy.status && enemy.status.cloaked ? 1 : 0;
}

function addExactCloakCandidate(pool, seen, position, direction, me, map) {
  if (!isWalkable(position, map) || samePos(position, me.tank.position)) return;
  var key = positionCode(position) * 4 + AT_DIR_INDEX[direction];
  if (seen[key]) return;
  seen[key] = 1;
  pool.push({
    position: copyPos(position),
    direction: direction,
    score: specialHiddenCandidateScore(position, direction, 0, me, map)
  });
}

function advanceCloakProjectile(projectile, map, survivorPosition) {
  var x = projectile.position[0];
  var y = projectile.position[1];
  var delta = AT_DELTAS[projectile.direction];
  if (!delta) return null;
  for (var step = 0; step < 2; step++) {
    x += delta[0];
    y += delta[1];
    var column = map[x];
    var tile = column && column[y];
    if (tile !== "." && tile !== "o") return null;
    // onIdle cannot be called after an unshielded hit. Therefore a hidden
    // projectile branch that crossed the surviving current pose is disproved
    // (or was consumed by a shield) and must not remain in the next belief.
    if (survivorPosition && x === survivorPosition[0] &&
        y === survivorPosition[1]) return null;
  }
  return {
    position: [x, y], direction: projectile.direction,
    damage: 1, observed: false
  };
}

function addCloakProjectile(result, seen, projectile) {
  if (!projectile) return;
  var key = positionCode(projectile.position) * 4 +
    AT_DIR_INDEX[projectile.direction];
  if (seen[key]) return;
  seen[key] = 1;
  result.push(projectile);
}

function updateCloakProjectileBelief(me, enemy, game, frame, spawnSources) {
  if (!game || !game.map) return;
  if (frame < AT_CLOAK_LAST_UPDATE_FRAME) {
    AT_CLOAK_PROJECTILE_BELIEF = [];
    AT_CLOAK_LAST_UPDATE_FRAME = -1;
  }
  if (AT_CLOAK_LAST_UPDATE_FRAME === frame) return;
  if (enemy.bullet) {
    AT_CLOAK_PROJECTILE_BELIEF = [];
    AT_CLOAK_LAST_UPDATE_FRAME = frame;
    return;
  }

  var result = [];
  var seen = [];
  for (var i = 0; i < AT_CLOAK_PROJECTILE_BELIEF.length; i++) {
    addCloakProjectile(result, seen, advanceCloakProjectile(
      AT_CLOAK_PROJECTILE_BELIEF[i], game.map, me.tank.position));
  }

  var status = enemy.status || {};
  if (spawnSources && status.canActThisFrame !== false &&
      !status.frozen && !status.fireLocked) {
    for (var sourceIndex = 0; sourceIndex < spawnSources.length;
        sourceIndex++) {
      var source = spawnSources[sourceIndex];
      addCloakProjectile(result, seen, advanceCloakProjectile({
        position: source.position,
        direction: source.direction
      }, game.map, me.tank.position));
    }
  }
  AT_CLOAK_PROJECTILE_BELIEF = result;
  AT_CLOAK_LAST_UPDATE_FRAME = frame;
}

function updateCloakEnemyBelief(me, enemy, game, frame) {
  var remaining = cloakRemainingFrames(enemy);
  var firstHiddenFrame = AT_HIDDEN_ENEMY_AGE === 0;
  var justCast = firstHiddenFrame && remaining >= 6 &&
    frame === AT_LAST_ENEMY_VISIBLE_FRAME + 1;

  if (firstHiddenFrame && justCast) {
    AT_HIDDEN_ENEMY_BELIEF = [{
      position: copyPos(AT_LAST_ENEMY_POS),
      direction: AT_LAST_ENEMY_DIR,
      score: specialHiddenCandidateScore(AT_LAST_ENEMY_POS,
        AT_LAST_ENEMY_DIR, 0, me, game.map)
    }];
    AT_CLOAK_PROJECTILE_BELIEF = [];
    AT_CLOAK_LAST_UPDATE_FRAME = frame;
    AT_HIDDEN_ENEMY_AGE = 1;
    AT_CLOAK_REMAINING_FRAMES = remaining;
    return;
  }

  var sources = firstHiddenFrame ? [{
    position: AT_LAST_ENEMY_POS, direction: AT_LAST_ENEMY_DIR
  }] : AT_HIDDEN_ENEMY_BELIEF;
  updateCloakProjectileBelief(me, enemy, game, frame, sources);
  var pool = [];
  var seen = [];
  for (var i = 0; i < sources.length; i++) {
    var candidate = sources[i];
    // FIRE and a consumed/empty command preserve this same pose, so one pose
    // represents both without losing the separately tracked bullet branch.
    addExactCloakCandidate(pool, seen, candidate.position,
      candidate.direction, me, game.map);
    addExactCloakCandidate(pool, seen, candidate.position,
      turnDir(candidate.direction, -1), me, game.map);
    addExactCloakCandidate(pool, seen, candidate.position,
      turnDir(candidate.direction, 1), me, game.map);
    var next = addPos(candidate.position, dirDelta(candidate.direction));
    addExactCloakCandidate(pool, seen, next, candidate.direction,
      me, game.map);
    if (enemy.status && enemy.status.stunned) {
      var reversed = addPos(candidate.position,
        dirDelta(oppositeDir(candidate.direction)));
      addExactCloakCandidate(pool, seen, reversed, candidate.direction,
        me, game.map);
    }
  }
  AT_HIDDEN_ENEMY_BELIEF = pool;
  AT_HIDDEN_ENEMY_AGE++;
  AT_CLOAK_REMAINING_FRAMES = remaining;
}

function transitionExpiredCloakToGrass(me, enemy, game, frame) {
  var grassCandidates = [];
  for (var i = 0; i < AT_HIDDEN_ENEMY_BELIEF.length; i++) {
    var candidate = AT_HIDDEN_ENEMY_BELIEF[i];
    if (tileAt(candidate.position, game.map) === "o") {
      grassCandidates.push(candidate);
    }
  }
  AT_HIDDEN_ENEMY_BELIEF = grassCandidates;
  AT_HIDDEN_ENEMY_MODE = grassCandidates.length ? 2 : 0;
  AT_HIDDEN_ENEMY_AGE = grassCandidates.length ? 1 : 0;
  AT_CLOAK_REMAINING_FRAMES = 0;
  updateCloakProjectileBelief(me, enemy, game, frame, false);
  if (grassCandidates.length) buildHiddenGrassThreatRegion(game.map);
}

function buildHiddenGrassThreatRegion(map) {
  // positionCode uses an 8-bit y stride. A compact byte table keeps the
  // later four-ray checks allocation-free and avoids sparse-array hashing.
  var region = new Uint8Array(map.length * 256);
  var queue = [];
  for (var i = 0; i < AT_HIDDEN_ENEMY_BELIEF.length; i++) {
    var position = AT_HIDDEN_ENEMY_BELIEF[i].position;
    if (tileAt(position, map) !== "o") continue;
    var code = positionCode(position);
    if (region[code]) continue;
    region[code] = 1;
    queue.push(copyPos(position));
  }
  if (queue.length === 0 && AT_HIDDEN_GRASS_ENTRY &&
      tileAt(AT_HIDDEN_GRASS_ENTRY, map) === "o") {
    region[positionCode(AT_HIDDEN_GRASS_ENTRY)] = 1;
    queue.push(copyPos(AT_HIDDEN_GRASS_ENTRY));
  }
  for (var head = 0; head < queue.length; head++) {
    var current = queue[head];
    for (var directionIndex = 0; directionIndex < 4; directionIndex++) {
      var next = addPos(current, AT_DELTAS[AT_DIRS[directionIndex]]);
      var nextCode = positionCode(next);
      if (region[nextCode] || tileAt(next, map) !== "o") continue;
      region[nextCode] = 1;
      queue.push(next);
    }
  }
  AT_HIDDEN_GRASS_REGION = queue.length ? region : null;
  AT_HIDDEN_GRASS_REGION_TTL = queue.length ?
    AT_HIDDEN_GRASS_REGION_MAX_TTL : 0;
}

function runtimeGrassRegionMuzzleRisk(target, targetDirection, targetSpeed,
    map) {
  if (!AT_HIDDEN_GRASS_REGION || AT_HIDDEN_GRASS_REGION_TTL <= 0) return 0;
  var risk = 0;
  for (var directionIndex = 0; directionIndex < 4; directionIndex++) {
    var direction = AT_DIRS[directionIndex];
    var delta = AT_DELTAS[direction];
    var x = target[0];
    var y = target[1];
    for (var distance = 1; distance <= 32; distance++) {
      x += delta[0];
      y += delta[1];
      var column = map[x];
      var tile = column && column[y];
      if (tile !== "." && tile !== "o") break;
      if (!AT_HIDDEN_GRASS_REGION[x * 256 + y]) continue;
      if (distance <= 2) return AT_TERMINAL_SCORE;

      // At range, a turn perpendicular to the possible shot lane prepares a
      // deterministic next-frame exit. Continuing along the lane does not.
      var horizontalShot = direction === "left" || direction === "right";
      var perpendicular = horizontalShot ?
        (targetDirection === "up" || targetDirection === "down") :
        (targetDirection === "left" || targetDirection === "right");
      var escape = perpendicular ? advanceTankPosition(target,
        targetDirection, targetSpeed, map, null) : target;
      var leavesLane = perpendicular && !samePos(escape, target) &&
        (horizontalShot ? escape[1] !== target[1] : escape[0] !== target[0]);
      risk = Math.max(risk, leavesLane ? 1200 : 35000);
      break;
    }
  }
  return risk;
}

function updateSpecialHiddenEnemyBelief(me, enemy, game) {
  var sources = AT_HIDDEN_ENEMY_AGE === 0 ? [{
    position: AT_LAST_ENEMY_POS, direction: AT_LAST_ENEMY_DIR
  }] : AT_HIDDEN_ENEMY_BELIEF;
  var pool = [];
  var seen = [];
  for (var i = 0; i < sources.length; i++) {
    var candidate = sources[i];
    var next = addPos(candidate.position, dirDelta(candidate.direction));
    if (isWalkable(next, game.map)) {
      addSpecialHiddenCandidate(pool, seen, next, candidate.direction,
        30, me, game.map);
    }
    addSpecialHiddenCandidate(pool, seen, candidate.position,
      turnDir(candidate.direction, -1), 10, me, game.map);
    addSpecialHiddenCandidate(pool, seen, candidate.position,
      turnDir(candidate.direction, 1), 10, me, game.map);
    addSpecialHiddenCandidate(pool, seen, candidate.position,
      candidate.direction, 0, me, game.map);
    if (enemy.status && enemy.status.stunned) {
      var reversed = addPos(candidate.position,
        dirDelta(oppositeDir(candidate.direction)));
      if (isWalkable(reversed, game.map)) {
        addSpecialHiddenCandidate(pool, seen, reversed,
          candidate.direction, 20, me, game.map);
      }
    }
  }
  AT_HIDDEN_ENEMY_BELIEF = selectSpecialHiddenCandidates(pool);
  AT_HIDDEN_ENEMY_AGE++;
}

function updateHiddenEnemyBelief(me, enemy, game, frame) {
  if (frame < AT_HIDDEN_LAST_UPDATE_FRAME) AT_HIDDEN_LAST_UPDATE_FRAME = -1;
  if (AT_HIDDEN_LAST_UPDATE_FRAME === frame) return;
  AT_HIDDEN_LAST_UPDATE_FRAME = frame;
  if (!game || !game.map) {
    AT_HIDDEN_ENEMY_BELIEF = [];
    AT_HIDDEN_ENEMY_AGE = AT_HIDDEN_BELIEF_MAX_AGE;
    AT_HIDDEN_ENEMY_MODE = 0;
    AT_HIDDEN_GRASS_ENTRY = null;
    AT_HIDDEN_GRASS_REGION = null;
    AT_HIDDEN_GRASS_REGION_TTL = 0;
    AT_CLOAK_PROJECTILE_BELIEF = [];
    AT_CLOAK_REMAINING_FRAMES = 0;
    AT_CLOAK_LAST_UPDATE_FRAME = -1;
    AT_HIDDEN_LAST_UPDATE_FRAME = -1;
    return;
  }

  if (AT_HIDDEN_ENEMY_AGE === 0) {
    AT_HIDDEN_ENEMY_MODE = detectSpecialHiddenEnemyMode(enemy, game.map);
  }
  if (AT_HIDDEN_ENEMY_MODE === 1) {
    if (enemy.status && enemy.status.cloaked) {
      updateCloakEnemyBelief(me, enemy, game, frame);
    } else {
      transitionExpiredCloakToGrass(me, enemy, game, frame);
    }
    return;
  }
  var ageLimit = hiddenBeliefAgeLimit();
  if (AT_HIDDEN_ENEMY_AGE >= ageLimit) {
    if (AT_HIDDEN_ENEMY_MODE === 2) {
      if (!AT_HIDDEN_GRASS_REGION && AT_HIDDEN_ENEMY_BELIEF.length) {
        buildHiddenGrassThreatRegion(game.map);
      } else if (AT_HIDDEN_GRASS_REGION_TTL > 0) {
        AT_HIDDEN_GRASS_REGION_TTL--;
        if (AT_HIDDEN_GRASS_REGION_TTL === 0) {
          AT_HIDDEN_GRASS_REGION = null;
        }
      }
    }
    AT_HIDDEN_ENEMY_BELIEF = [];
    AT_HIDDEN_ENEMY_AGE = ageLimit;
    return;
  }

  var result = [];
  var seen = {};
  if (AT_HIDDEN_ENEMY_AGE === 0) {
    if (!AT_LAST_ENEMY_POS || !AT_LAST_ENEMY_DIR ||
        frame !== AT_LAST_ENEMY_VISIBLE_FRAME + 1) {
      AT_HIDDEN_ENEMY_BELIEF = [];
      AT_HIDDEN_ENEMY_AGE = AT_HIDDEN_BELIEF_MAX_AGE;
      AT_HIDDEN_ENEMY_MODE = 0;
      AT_HIDDEN_GRASS_ENTRY = null;
      AT_HIDDEN_GRASS_REGION = null;
      AT_HIDDEN_GRASS_REGION_TTL = 0;
      AT_CLOAK_REMAINING_FRAMES = 0;
      return;
    }

    if (AT_HIDDEN_ENEMY_MODE) {
      updateSpecialHiddenEnemyBelief(me, enemy, game);
      return;
    }

    // Losing sight can be caused by our own turn as well as by enemy motion.
    // Preserve an unseen stationary/turning hypothesis even on open ground;
    // v18 incorrectly discarded it and then walked into an adjacent rear
    // muzzle two frames later.
    var observerChanged = !AT_LAST_MY_POS ||
      !samePos(me.tank.position, AT_LAST_MY_POS) ||
      me.tank.direction !== AT_LAST_MY_DIR;
    if (observerChanged || tileAt(AT_LAST_ENEMY_POS, game.map) === "o" ||
        (enemy.status && enemy.status.cloaked)) {
      addUnseenHiddenCandidate(result, seen, AT_LAST_ENEMY_POS,
        AT_LAST_ENEMY_DIR, me, game.map);
      addUnseenHiddenCandidate(result, seen, AT_LAST_ENEMY_POS,
        turnDir(AT_LAST_ENEMY_DIR, -1), me, game.map);
      addUnseenHiddenCandidate(result, seen, AT_LAST_ENEMY_POS,
        turnDir(AT_LAST_ENEMY_DIR, 1), me, game.map);
    }

    var forward = addPos(AT_LAST_ENEMY_POS,
      dirDelta(AT_LAST_ENEMY_DIR));
    if (isWalkable(forward, game.map)) {
      addUnseenHiddenCandidate(result, seen, forward,
        AT_LAST_ENEMY_DIR, me, game.map);
    }

    if (enemy.status && enemy.status.stunned) {
      var reversed = addPos(AT_LAST_ENEMY_POS,
        dirDelta(oppositeDir(AT_LAST_ENEMY_DIR)));
      if (isWalkable(reversed, game.map)) {
        addUnseenHiddenCandidate(result, seen, reversed,
          AT_LAST_ENEMY_DIR, me, game.map);
      }
    }
  } else if (AT_HIDDEN_ENEMY_MODE) {
    updateSpecialHiddenEnemyBelief(me, enemy, game);
    return;
  } else {
    for (var i = 0; i < AT_HIDDEN_ENEMY_BELIEF.length; i++) {
      var candidate = AT_HIDDEN_ENEMY_BELIEF[i];
      addUnseenHiddenCandidate(result, seen, candidate.position,
        candidate.direction, me, game.map);
      addUnseenHiddenCandidate(result, seen, candidate.position,
        turnDir(candidate.direction, -1), me, game.map);
      addUnseenHiddenCandidate(result, seen, candidate.position,
        turnDir(candidate.direction, 1), me, game.map);
      var next = addPos(candidate.position, dirDelta(candidate.direction));
      if (isWalkable(next, game.map)) {
        addUnseenHiddenCandidate(result, seen, next, candidate.direction,
          me, game.map);
      }
      if (enemy.status && enemy.status.stunned) {
        var reverseStep = addPos(candidate.position,
          dirDelta(oppositeDir(candidate.direction)));
        if (isWalkable(reverseStep, game.map)) {
          addUnseenHiddenCandidate(result, seen, reverseStep,
            candidate.direction, me, game.map);
        }
      }
    }
  }

  AT_HIDDEN_ENEMY_BELIEF = result;
  AT_HIDDEN_ENEMY_AGE++;
}

function probableHiddenEnemyPosition() {
  if (AT_HIDDEN_ENEMY_AGE <= 0 ||
      AT_HIDDEN_ENEMY_AGE > hiddenBeliefAgeLimit() ||
      AT_HIDDEN_ENEMY_BELIEF.length === 0) return null;
  // On the first grass-hidden frame, stepping from the last visible tile into
  // the grass directly ahead remains the actionable location. Extra turn and
  // wait hypotheses are kept for defense, but must not suppress a proven
  // adjacent blind-fire opportunity.
  if (AT_HIDDEN_ENEMY_MODE === 2 && AT_HIDDEN_ENEMY_AGE === 1 &&
      AT_HIDDEN_GRASS_ENTRY) {
    for (var j = 0; j < AT_HIDDEN_ENEMY_BELIEF.length; j++) {
      if (samePos(AT_HIDDEN_GRASS_ENTRY,
          AT_HIDDEN_ENEMY_BELIEF[j].position)) return AT_HIDDEN_GRASS_ENTRY;
    }
  }
  var position = AT_HIDDEN_ENEMY_BELIEF[0].position;
  for (var i = 1; i < AT_HIDDEN_ENEMY_BELIEF.length; i++) {
    if (!samePos(position, AT_HIDDEN_ENEMY_BELIEF[i].position)) return null;
  }
  return position;
}

function runtimeEnemyBlockedPosition(enemy) {
  if (enemy.tank) return enemy.tank.position;
  return probableHiddenEnemyPosition();
}

function winningHiddenAttackAction(me, enemy, game) {
  if (enemy.tank || me.bullet || me.status.fireLocked ||
      enemy.status.shielded) return null;
  if (AT_HIDDEN_ENEMY_MODE === 1) {
    if ((me.stars || 0) <= (enemy.stars || 0)) return null;
    for (var i = 0; i < AT_HIDDEN_ENEMY_BELIEF.length; i++) {
      var candidate = AT_HIDDEN_ENEMY_BELIEF[i];
      var distance = manhattan(me.tank.position, candidate.position);
      if (distance <= 2 &&
          directionToAligned(me.tank.position, candidate.position) ===
            me.tank.direction &&
          directionToAligned(candidate.position, me.tank.position) ===
            candidate.direction &&
          clearLine(me.tank.position, candidate.position, game.map)) {
        return "FIRE";
      }
    }
    return null;
  }
  if (AT_HIDDEN_ENEMY_AGE !== 1) return null;
  var hidden = probableHiddenEnemyPosition();
  if (!hidden || tileAt(hidden, game.map) !== "o") return null;
  var distance = manhattan(me.tank.position, hidden);
  if (distance > 2 ||
      directionToAligned(me.tank.position, hidden) !== me.tank.direction ||
      !clearLine(me.tank.position, hidden, game.map)) return null;
  return "FIRE";
}

function tacticalSearchRounds(state) {
  if (state._searchRounds !== undefined) return state._searchRounds;
  // The final tier keeps root hard-safety filters and the exact simultaneous
  // enemy reply, but evaluates that reply immediately instead of recursively
  // expanding another ply. This is the reliable timeout fallback when the
  // sandbox has no wall clock.
  if (minimaxRuntimeEmergencyActive()) {
    state._searchRounds = 1;
    state._runtimeEmergencySearch = true;
    return state._searchRounds;
  }
  // At 2250 ms, frame/call 100, or later, cap the search at two rounds. The
  // separate root guards still look through immediate bullets, bombs,
  // Overload and close turn-then-fire forced losses.
  if (minimaxRuntimeReductionActive()) {
    state._searchRounds = 2;
    state._runtimeReducedSearch = true;
    return state._searchRounds;
  }
  var distance = manhattan(state.myPos, state.enemyPos);
  var nearEdge = outerEdgeDistance(state.myPos, state.map) <= 2;
  var stunTransition = state.enemyStunned > 0 && state.enemyStunned <= 2;
  var intercept = state.myCanFire &&
    predictiveInterceptUtility(state, true) > 90;
  state._searchRounds = (distance <= 6 || state.myProjectile ||
    state.myProjectile2 || state.enemyProjectile || state.enemyProjectile2 ||
    bombPressureScore(state, true) > 0 ||
    nearEdge || stunTransition || intercept) ? 3 : 2;
  return state._searchRounds;
}

function determineIntent(state) {
  var distance = manhattan(state.myPos, state.enemyPos);
  var lineOpen = clearLine(state.myPos, state.enemyPos, state.map);
  var myAim = directionToAligned(state.myPos, state.enemyPos);
  var enemyAim = directionToAligned(state.enemyPos, state.myPos);
  var incoming = projectilePairThreat(state.enemyProjectile,
    state.enemyProjectile2, state.myPos, state.myDir,
    state.myMoveSpeed, state.map);
  var muzzle = muzzleRiskScore(state.enemyPos, state.enemyDir, state.myPos,
    state.map, state.enemyCanFire, state.enemyBoosted, state.myDir,
    state.myMoveSpeed, enemyAim, lineOpen, distance,
    state.enemyOverloaded);
  if (incoming >= 1200 || muzzle >= 10000) return "EVADE";

  var myFrames = attackArrivalFrames(state.myPos, state.myDir,
    state.enemyPos, state.map, state.myCanFire, state.myBoosted,
    state.enemyShielded, myAim, lineOpen, distance);
  var enemyFrames = attackArrivalFrames(state.enemyPos, state.enemyDir,
    state.myPos, state.map, state.enemyCanFire, state.enemyBoosted,
    state.myShielded, enemyAim, lineOpen, distance);
  if (myFrames < enemyFrames && myFrames <= 3) return "ATTACK";
  var edgeDistance = outerEdgeDistance(state.myPos, state.map);
  if (edgeDistance <= 1 && !state.star) return "EXIT_EDGE";
  if (state.star) return "CHASE_STAR";
  if (edgeDistance <= 2) return "EXIT_EDGE";
  return "FACE_ENEMY";
}

function committedIntentForState(state) {
  if (state.proposedIntent === "EVADE" ||
      state.proposedIntent === "ATTACK") return state.proposedIntent;
  if (AT_LAST_INTENT && AT_LAST_INTENT_EPOCH === state.contextEpoch) {
    return AT_LAST_INTENT;
  }
  return state.proposedIntent;
}

function actionForIntent(state, intent) {
  if (!intent || intent === "EVADE") return null;
  var step = null;
  var wanted = null;
  if (intent === "CHASE_STAR" && state.star) {
    step = nextStepFromDistanceField(state.myPos, state.starDistance,
      state.map, state.enemyPos);
  } else if (intent === "EXIT_EDGE") {
    var bestEdge = outerEdgeDistance(state.myPos, state.map);
    var bestOpen = -1;
    for (var i = 0; i < AT_DIRS.length; i++) {
      var candidate = addPos(state.myPos, AT_DELTAS[AT_DIRS[i]]);
      if (!isWalkable(candidate, state.map) ||
          samePos(candidate, state.enemyPos)) continue;
      var edge = outerEdgeDistance(candidate, state.map);
      var open = openNeighborCount(candidate, state.map);
      if (edge > bestEdge || (edge === bestEdge && open > bestOpen)) {
        bestEdge = edge;
        bestOpen = open;
        step = candidate;
      }
    }
  } else if (intent === "ATTACK" || intent === "FACE_ENEMY") {
    wanted = directionToAligned(state.myPos, state.enemyPos);
    if (!wanted) {
      step = nextAttackLaneStep(state.myPos, state.enemyPos, state.map);
    }
  }

  if (step) return actionForStep(state.myPos, state.myDir, step);
  if (!wanted) return null;
  if (wanted === state.myDir) {
    if (intent === "ATTACK" && state.myCanFire) return "FIRE";
    return "GO";
  }
  return shortTurn(state.myDir, wanted) === "left" ? "LEFT" : "RIGHT";
}

function chooseTacticalAction(state, rounds) {
  var actions = tacticalActions(state, true);
  var evaluated = [];
  var hasSafeAction = false;
  var committedAction = actionForIntent(state, state.committedIntent);

  // Give every root action the same search allowance.
  AT_NODE_LIMIT = Math.max(12, Math.floor(AT_MAX_NODES / actions.length));

  for (var i = 0; i < actions.length; i++) {
    AT_SEARCH_NODES = 0;
    var safetyProfile = { unsafe: false };
    var value = worstEnemyReply(state, actions[i], rounds, -Infinity,
      safetyProfile);
    var overloadTrap = overloadForcesNextFrameLoss(state, actions[i]);
    var stunnedContactTrap = stunnedContactForcesUnfavorableTrade(state,
      actions[i]);
    var turnThenFireTrap = ordinaryTurnThenFireForcesLoss(state, actions[i]);
    if (overloadTrap || stunnedContactTrap || turnThenFireTrap) {
      safetyProfile.unsafe = true;
    }
    var intentBonus = actions[i] === committedAction ?
      AT_INTENT_SWITCH_MARGIN : 0;
    // An armed Overload is a short forced-tactics window. Positional intent
    // hysteresis must not overturn the exact root ordering while the opponent
    // can cover two parallel lanes with one FIRE.
    if (state.enemyOverloaded && state.enemyCanFire) intentBonus = 0;
    evaluated.push({
      action: actions[i], value: value + intentBonus, rawValue: value,
      unsafe: safetyProfile.unsafe, overloadTrap: overloadTrap,
      stunnedContactTrap: stunnedContactTrap,
      turnThenFireTrap: turnThenFireTrap
    });
    if (!safetyProfile.unsafe) hasSafeAction = true;
  }

  applyMonteCarloLeafExtension(state, evaluated, hasSafeAction);

  var bestAction = null;
  var bestValue = -Infinity;
  var bestRawValue = -Infinity;
  for (var j = 0; j < evaluated.length; j++) {
    var candidate = evaluated[j];
    if (hasSafeAction && candidate.unsafe) continue;
    if (candidate.value > bestValue ||
        (candidate.value === bestValue &&
          actionPriority(candidate.action) > actionPriority(bestAction))) {
      bestValue = candidate.value;
      bestRawValue = candidate.rawValue;
      bestAction = candidate.action;
    }
  }
  state._chosenValue = bestRawValue;
  state._chosenAdjustedValue = bestValue;
  state._selectedIntent = bestAction === committedAction ?
    state.committedIntent : state.proposedIntent;
  if (AT_ACTIVE_HISTORY_RECORD) {
    AT_ACTIVE_HISTORY_RECORD.chosenValue = bestRawValue;
    AT_ACTIVE_HISTORY_RECORD.intent = state._selectedIntent;
  }
  return bestAction;
}

function armedOverloadForcesNextFrameLoss(state, myAction) {
  if (!state.enemyOverloaded || !state.enemyCanFire ||
      !actorCanAct(state, false)) return false;
  if (immediateOverloadFireForcesLoss(state, myAction)) return true;
  var enemyActions = tacticalActions(state, false);
  for (var i = 0; i < enemyActions.length; i++) {
    var enemyAction = enemyActions[i];
    // Immediate FIRE is covered by the exact guard above. Here we are looking
    // for a turn/move that creates an unavoidable double-lane shot next frame.
    if (enemyAction === "FIRE" || enemyAction.indexOf("FIRE") >= 0 ||
        enemyAction === "WAIT") continue;
    var prepared = applyJointActions(state, myAction, enemyAction, false);
    if (stateIsLosingTerminal(prepared) || !prepared.enemyOverloaded ||
        !prepared.enemyCanFire) continue;
    var replies = tacticalActions(prepared, true);
    var hasEscape = false;
    for (var j = 0; j < replies.length; j++) {
      var fired = applyJointActions(prepared, replies[j], "FIRE", false);
      if (!stateIsLosingTerminal(fired)) {
        hasEscape = true;
        break;
      }
    }
    if (!hasEscape) return true;
  }
  return false;
}

function immediateOverloadFireForcesLoss(state, myAction) {
  if (!state.enemyOverloaded || !state.enemyCanFire ||
      !actorCanAct(state, false)) return false;

  // Enemy FIRE generation is intentionally utility-pruned. That pruning is
  // unsafe at the root: our simultaneous GO can enter either Overload lane
  // even when the pre-move pose is not currently on a firing ray. Test the
  // physical shot directly, independently of tacticalActions().
  if (stateIsLosingTerminal(
      applyJointActions(state, myAction, "FIRE", false))) return true;
  if (!state.enemyBoosted) return false;
  if (stateIsLosingTerminal(
      applyJointActions(state, myAction, "LEFT_FIRE", false))) return true;
  return stateIsLosingTerminal(
    applyJointActions(state, myAction, "RIGHT_FIRE", false));
}

function readyOverloadCastForcesLoss(state, myAction) {
  if (state.enemyOverloaded || state.enemySkillType !== "overload" ||
      !state.enemySkillReady || !state.enemyCanFire ||
      !actorCanAct(state, false)) return false;
  var enemyActions = tacticalActions(state, false);
  var canCast = false;
  for (var i = 0; i < enemyActions.length; i++) {
    if (enemyActions[i] === "OVERLOAD") {
      canCast = true;
      break;
    }
  }
  if (!canCast) return false;

  // Look through the cast itself. A root move is unsafe only when the cast
  // leaves no reply that survives both the immediate shot and the armed
  // Overload turn-then-double-lane continuation.
  var armed = applyJointActions(state, myAction, "OVERLOAD", false);
  if (stateIsLosingTerminal(armed)) return true;
  var replies = tacticalActions(armed, true);
  for (var j = 0; j < replies.length; j++) {
    if (!hasCertainImmediateLosingReply(armed, replies[j]) &&
        !armedOverloadForcesNextFrameLoss(armed, replies[j])) {
      return false;
    }
  }
  return true;
}

function overloadForcesNextFrameLoss(state, myAction) {
  if (!state._overloadTrapCache) state._overloadTrapCache = {};
  if (state._overloadTrapCache[myAction] !== undefined) {
    return state._overloadTrapCache[myAction];
  }
  var result = state.enemyOverloaded ?
    armedOverloadForcesNextFrameLoss(state, myAction) :
    readyOverloadCastForcesLoss(state, myAction);
  state._overloadTrapCache[myAction] = result;
  return result;
}

function stunnedContactForcesUnfavorableTrade(state, myAction) {
  // Only hard-filter the probabilistic continuation while strictly behind.
  // At equal stars, ordinary risk scoring may still exploit the stun window;
  // making every possible reversal a veto was too conservative in won games.
  if (state.enemyStunned <= 0 || state.myStars >= state.enemyStars ||
      manhattan(state.myPos, state.enemyPos) > 2) return false;
  var enemyActions = tacticalActions(state, false);
  for (var i = 0; i < enemyActions.length; i++) {
    var outcomes = enemyActionOutcomes(state, enemyActions[i]);
    for (var j = 0; j < outcomes.length; j++) {
      if (outcomes[j].probability <= 0) continue;
      var prepared = applyJointActions(state, myAction,
        outcomes[j].action, outcomes[j].reversed);
      if (stateIsLosingTerminal(prepared)) return true;
      if (!prepared.enemyCanFire ||
          (!firesAt(prepared.enemyPos, prepared.enemyDir,
            prepared.myPos, prepared.map) &&
           !(prepared.enemyOverloaded && firesAt(overloadSecondaryOrigin(
             prepared.enemyPos, prepared.enemyDir), prepared.enemyDir,
             prepared.myPos, prepared.map)))) continue;
      var replies = tacticalActions(prepared, true);
      var allLose = replies.length > 0;
      for (var k = 0; k < replies.length; k++) {
        var fired = applyJointActions(prepared, replies[k], "FIRE", false);
        if (!stateIsLosingTerminal(fired)) {
          allLose = false;
          break;
        }
      }
      if (allLose) return true;
    }
  }
  return false;
}

function ordinaryTurnThenFireForcesLoss(state, myAction) {
  // A close ordinary duel needs one extra exact ply beyond the usual root
  // danger test: our move may enter a dead end while the opponent turns onto
  // our new tile, making next-frame FIRE unavoidable. Keep this guard narrow
  // so it has no measurable cost in long-range and special-skill positions.
  if (state.enemyFrozen > 0 || state.enemyStunned > 0 ||
      state.enemyOverloaded || !state.enemyCanFire ||
      manhattan(state.myPos, state.enemyPos) > 3) return false;

  var turns = ["LEFT", "RIGHT"];
  for (var i = 0; i < turns.length; i++) {
    var prepared = applyJointActions(state, myAction, turns[i], false);
    if (stateIsLosingTerminal(prepared)) return true;
    if (!prepared.enemyCanFire ||
        !firesAt(prepared.enemyPos, prepared.enemyDir,
          prepared.myPos, prepared.map)) continue;

    var replies = tacticalActions(prepared, true);
    var allLose = replies.length > 0;
    for (var j = 0; j < replies.length; j++) {
      var fired = applyJointActions(prepared, replies[j], "FIRE", false);
      if (!stateIsLosingTerminal(fired)) {
        allLose = false;
        break;
      }
    }
    if (allLose) return true;
  }
  return false;
}

function applyMonteCarloLeafExtension(state, evaluated, hasSafeAction) {
  state._monteCarloUsed = false;
  state._monteCarloTransitions = 0;
  state._monteCarloPrunedReason = null;
  state._monteCarloBudget = null;
  if (monteCarloRuntimeBudgetExceeded() ||
      !hasSafeAction || AT_ENEMY_OBSERVATIONS < 6 ||
      state.myProjectile || state.myProjectile2 ||
      state.enemyProjectile || state.enemyProjectile2 ||
      (state.bombs && state.bombs.length > 0) ||
      state.myFrozen > 0 || state.myPoisoned > 0 ||
      state.myStunned > 0 || state.enemyBoosted ||
      state.enemyStationaryStreak >= 8 ||
      (state.enemyStunned > 0 && state.enemyStunned <= 2)) {
    state._monteCarloPrunedReason = monteCarloGuardReason(state,
      hasSafeAction);
    return;
  }

  var geometry = stateGeometry(state);
  if (geometry.distance <= 3) {
    state._monteCarloPrunedReason = "close-contact";
    return;
  }
  if (!state.star && geometry.myEdgeDistance > 2) {
    state._monteCarloPrunedReason = "no-strategic-objective";
    return;
  }
  var enemyMuzzle = muzzleRiskScore(state.enemyPos, state.enemyDir,
    state.myPos, state.map, state.enemyCanFire, state.enemyBoosted,
    state.myDir, state.myMoveSpeed, geometry.enemyAim,
    geometry.lineOpen, geometry.distance, state.enemyOverloaded);
  if (enemyMuzzle >= 1800) {
    state._monteCarloPrunedReason = "certain-muzzle-danger";
    return;
  }
  if (fireUtility(state, true) >= 350) {
    state._monteCarloPrunedReason = "certain-fire";
    return;
  }

  var safe = [];
  for (var i = 0; i < evaluated.length; i++) {
    if (!evaluated[i].unsafe) safe.push(evaluated[i]);
  }
  safe.sort(function(a, b) { return b.value - a.value; });
  if (safe.length < 2) {
    state._monteCarloPrunedReason = "single-safe-action";
    return;
  }
  if (safe[0].rawValue >= AT_TERMINAL_SCORE) {
    state._monteCarloPrunedReason = "exact-terminal-win";
    return;
  }
  if (safe[0].value - safe[1].value > 250) {
    state._monteCarloPrunedReason = "exact-score-margin";
    return;
  }

  var budget = monteCarloBudget(state);
  state._monteCarloBudget = budget;
  AT_MC_TRANSITIONS = 0;
  for (var j = 0; j < 2; j++) {
    var rolloutValue = monteCarloActionValue(state, safe[j].action, j,
      budget);
    safe[j].monteCarloValue = rolloutValue;
    safe[j].value = safe[j].value * 0.75 + rolloutValue * 0.25;
  }
  state._monteCarloUsed = true;
  state._monteCarloTransitions = AT_MC_TRANSITIONS;
  AT_MC_TRIGGER_COUNT++;
}

function monteCarloGuardReason(state, hasSafeAction) {
  if (monteCarloRuntimeBudgetExceeded()) return "runtime-budget";
  if (!hasSafeAction) return "no-safe-action";
  if (AT_ENEMY_OBSERVATIONS < 6) return "insufficient-observations";
  if (state.myProjectile || state.myProjectile2 ||
      state.enemyProjectile || state.enemyProjectile2) {
    return "active-projectile";
  }
  if (state.bombs && state.bombs.length > 0) return "active-bomb";
  if (state.myFrozen > 0 || state.myPoisoned > 0 ||
      state.myStunned > 0) return "self-control-effect";
  if (state.enemyBoosted) return "boosted-enemy";
  if (state.enemyStationaryStreak >= 8) return "stationary-enemy";
  if (state.enemyStunned > 0 && state.enemyStunned <= 2) {
    return "stun-final-frames";
  }
  return "fixed-state";
}

function monteCarloBudget(state) {
  var budget = {
    rollouts: AT_MC_ROLLOUTS,
    frames: AT_MC_FRAMES,
    mode: "full"
  };
  if (!AT_MC_FIXED_STATE_PRUNING) return budget;

  // Minimax already enumerates normal and reversed controls for a stunned
  // enemy. Four quasi-random rollouts retain the extra horizon while avoiding
  // a second full eight-sample estimate of the same fixed 50/50 branch.
  if (state.enemyStunned >= 3) {
    budget.rollouts = Math.min(budget.rollouts, 4);
    budget.mode = "stunned-half";
  }

  // If freeze covers the whole extension, every enemy root in the rollout is
  // WAIT. Two samples are enough to cover our left/right fallback tie without
  // repeating an otherwise identical trajectory eight times.
  if (state.enemyFrozen >= budget.frames) {
    budget.rollouts = Math.min(budget.rollouts, 2);
    budget.mode = "forced-wait-quarter";
  }
  return budget;
}

function monteCarloActionValue(state, rootAction, actionIndex, budget) {
  budget = budget || {
    rollouts: AT_MC_ROLLOUTS,
    frames: AT_MC_FRAMES,
    mode: "full"
  };
  var total = 0;
  for (var rollout = 0; rollout < budget.rollouts; rollout++) {
    var current = state;
    for (var frame = 0; frame < budget.frames; frame++) {
      if (stateHasTerminalOutcome(current)) break;
      var q = quasiRandom(rollout, frame, actionIndex);
      var myAction = frame === 0 ? rootAction :
        rolloutMyAction(current, q);
      var enemyAction = sampleEnemyAction(current, q);
      var reversed = current.enemyStunned > 0 &&
        (enemyAction === "GO" || enemyAction === "LEFT" ||
          enemyAction === "RIGHT") && quasiRandom(rollout, frame + 7,
            actionIndex) < 0.5;
      current = applyJointActions(current, myAction, enemyAction, reversed);
      AT_MC_TRANSITIONS++;
    }
    total += evaluateState(current);
  }
  return total / budget.rollouts;
}

function quasiRandom(rollout, frame, actionIndex) {
  var value = (rollout + 0.5) * 0.61803398875 +
    (frame + 1) * 0.41421356237 + actionIndex * 0.13750352375;
  return value - Math.floor(value);
}

function sampleEnemyAction(state, q) {
  var actions = tacticalActions(state, false);
  var total = 0;
  for (var i = 0; i < actions.length; i++) {
    total += enemyActionWeight(state, actions[i]);
  }
  var threshold = q * total;
  for (var j = 0; j < actions.length; j++) {
    threshold -= enemyActionWeight(state, actions[j]);
    if (threshold <= 0) return actions[j];
  }
  return actions[actions.length - 1];
}

function rolloutMyAction(state, q) {
  var actions = tacticalActions(state, true);
  if (actions.indexOf("FIRE") >= 0 && fireUtility(state, true) > 140) {
    return "FIRE";
  }
  var preferred = actionForIntent(state, state.proposedIntent);
  if (preferred && actions.indexOf(preferred) >= 0) return preferred;
  if (actions.indexOf("GO") >= 0) return "GO";
  return q < 0.5 ? "LEFT" : "RIGHT";
}

function minimaxValue(state, rounds, alpha) {
  AT_SEARCH_NODES++;
  if (rounds <= 0 || stateHasTerminalOutcome(state) ||
      AT_SEARCH_NODES >= AT_NODE_LIMIT) {
    return evaluateState(state);
  }

  var actions = tacticalActions(state, true);
  var best = -Infinity;
  for (var i = 0; i < actions.length; i++) {
    var value = worstEnemyReply(state, actions[i], rounds, Math.max(alpha, best));
    if (value > best) best = value;
  }
  return best;
}

function worstEnemyReply(state, myAction, rounds, alpha, safetyProfile) {
  var enemyActions = tacticalActions(state, false);
  var worst = Infinity;
  var weighted = 0;
  var totalWeight = 0;

  for (var i = 0; i < enemyActions.length; i++) {
    var outcomes = enemyActionOutcomes(state, enemyActions[i]);
    var expected = 0;
    var losingProbability = 0;
    for (var j = 0; j < outcomes.length; j++) {
      var next = applyJointActions(state, myAction, outcomes[j].action,
        outcomes[j].reversed);
      if (safetyProfile && stateIsLosingTerminal(next)) {
        losingProbability += outcomes[j].probability;
      }
      expected += outcomes[j].probability *
        minimaxValue(next, rounds - 1, alpha);
    }
    if (safetyProfile && losingProbability >= 0.999) {
      safetyProfile.unsafe = true;
      // Root candidates with a certain unilateral-death reply are discarded
      // whenever any safe action exists. Do not spend the remaining node
      // budget evaluating alternate enemy replies for an already unsafe move.
      return -AT_TERMINAL_SCORE;
    }
    if (expected < worst) worst = expected;
    var weight = enemyActionWeight(state, enemyActions[i]);
    weighted += expected * weight;
    totalWeight += weight;
  }
  var policyExpected = totalWeight > 0 ? weighted / totalWeight : worst;
  var expectationBlend = opponentExpectationBlend();
  return worst + (policyExpected - worst) * expectationBlend;
}

function opponentExpectationBlend() {
  if (AT_EXPECTATION_BLEND_CACHE !== null) {
    return AT_EXPECTATION_BLEND_CACHE;
  }
  var total = AT_ENEMY_COUNTS.GO + AT_ENEMY_COUNTS.LEFT +
    AT_ENEMY_COUNTS.RIGHT + AT_ENEMY_COUNTS.FIRE;
  var concentration = Math.max(AT_ENEMY_COUNTS.GO, AT_ENEMY_COUNTS.LEFT,
    AT_ENEMY_COUNTS.RIGHT, AT_ENEMY_COUNTS.FIRE) / total;
  var blend = 0.15 + Math.min(0.12, AT_ENEMY_OBSERVATIONS * 0.01);
  blend += Math.max(0, concentration - 0.5) * 0.28;
  if (AT_ENEMY_GO_STREAK >= 3) blend += 0.05;
  AT_EXPECTATION_BLEND_CACHE = Math.min(0.35, blend);
  return AT_EXPECTATION_BLEND_CACHE;
}

function enemyMotionFactor(state) {
  var streak = state && typeof state.enemyStationaryStreak === "number" ?
    state.enemyStationaryStreak : AT_ENEMY_STATIONARY_STREAK;
  var streakFactor = 1;
  if (streak >= 12) streakFactor = 0.06;
  else if (streak >= 8) streakFactor = 0.12;
  else if (streak >= 5) streakFactor = 0.3;
  else if (streak >= 3) streakFactor = 0.6;

  var total = AT_ENEMY_COUNTS.GO + AT_ENEMY_COUNTS.LEFT +
    AT_ENEMY_COUNTS.RIGHT + AT_ENEMY_COUNTS.FIRE;
  var observedMoveFactor = Math.max(0.08,
    Math.min(1, (AT_ENEMY_COUNTS.GO / total) * 4));
  return Math.min(streakFactor, observedMoveFactor);
}

function enemyActionWeight(state, action) {
  if (!state._enemyActionWeights) state._enemyActionWeights = {};
  if (state._enemyActionWeights[action] !== undefined) {
    return state._enemyActionWeights[action];
  }
  var weight = AT_ENEMY_COUNTS[action] || 1;
  if (action === "GO") {
    var forward = advanceTankPosition(state.enemyPos, state.enemyDir,
      state.enemyMoveSpeed, state.map, state.myPos);
    if (samePos(forward, state.enemyPos)) {
      state._enemyActionWeights[action] = 0.05;
      return 0.05;
    }
    weight *= (1 + Math.min(5, AT_ENEMY_GO_STREAK) * 0.3) *
      enemyMotionFactor(state);
    if (state.star && manhattan(forward, state.star) <
        manhattan(state.enemyPos, state.star)) weight *= 1.5;
  } else if (action === "FIRE") {
    if (!state.enemyCanFire) {
      state._enemyActionWeights[action] = 0.01;
      return 0.01;
    }
    if (firesAt(state.enemyPos, state.enemyDir, state.myPos, state.map) ||
        (state.enemyOverloaded && firesAt(overloadSecondaryOrigin(
          state.enemyPos, state.enemyDir), state.enemyDir,
          state.myPos, state.map))) {
      weight *= 2.5;
    }
  } else if (action === "LEFT" || action === "RIGHT") {
    var amount = action === "LEFT" ? -1 : 1;
    var nextDirection = turnDir(state.enemyDir, amount);
    var wanted = directionToAligned(state.enemyPos, state.myPos);
    if (wanted && nextDirection === wanted) weight *= 1.7;
    if (state.star) {
      var starDirection = directionBetween(state.enemyPos, state.star);
      if (nextDirection === starDirection) weight *= 1.3;
    }
  }
  state._enemyActionWeights[action] = Math.max(0.01, weight);
  return state._enemyActionWeights[action];
}

function hasCertainImmediateLosingReply(state, myAction) {
  var enemyActions = tacticalActions(state, false);
  for (var i = 0; i < enemyActions.length; i++) {
    var outcomes = enemyActionOutcomes(state, enemyActions[i]);
    var losingProbability = 0;
    for (var j = 0; j < outcomes.length; j++) {
      var next = applyJointActions(state, myAction, outcomes[j].action,
        outcomes[j].reversed);
      if (stateIsLosingTerminal(next)) {
        losingProbability += outcomes[j].probability;
      }
    }
    if (losingProbability >= 0.999) return true;
  }
  return false;
}

function tacticalActions(state, forMe) {
  var cacheName = forMe ? "_myTacticalActions" : "_enemyTacticalActions";
  if (state[cacheName]) return state[cacheName];
  if (!actorCanAct(state, forMe)) {
    state[cacheName] = ["WAIT"];
    return state[cacheName];
  }
  var pos = forMe ? state.myPos : state.enemyPos;
  var dir = forMe ? state.myDir : state.enemyDir;
  var other = forMe ? state.enemyPos : state.myPos;
  var result = [];
  var forward = addPos(pos, dirDelta(dir));

  var canFire = forMe ? state.myCanFire : state.enemyCanFire;
  var utility = canFire ? fireUtility(state, forMe) : -Infinity;
  var fireThreshold = 25;
  if (forMe && state.star && state.myStars <= state.enemyStars) {
    var myStarDistance = distanceFromField(state.starDistance, state.myPos);
    var enemyStarDistance = distanceFromField(state.starDistance,
      state.enemyPos);
    fireThreshold = myStarDistance <= enemyStarDistance + 3 ? 110 : 70;
  }

  // Moving is the stable tie-break. FIRE is generated only for an enemy on
  // the ray or a strategically useful destructible mound.
  if (isWalkable(forward, state.map) && !samePos(forward, other)) {
    result.push("GO");
  }
  if (utility > fireThreshold) result.push("FIRE");
  if (forMe && shouldConsiderStun(state)) result.push("STUN");
  if (forMe && shouldConsiderBomb(state, true)) result.push("BOMB");
  result.push("LEFT");
  result.push("RIGHT");

  if (!forMe) {
    appendEnemySkillActions(state, result);
    appendBoostCompoundActions(state, result);
  }

  // A stunned opponent creates a useful tactical window, but the objective
  // action is only searched first. It is never executed outside maximin.
  if (forMe) {
    var preference = stunnedActionPreference(state);
    if (preference) moveActionFirst(result, preference.action);
  }
  state[cacheName] = result;
  return state[cacheName];
}

function enemyActionOutcomes(state, action) {
  if (!state._enemyOutcomeCache) state._enemyOutcomeCache = {};
  if (state._enemyOutcomeCache[action]) {
    return state._enemyOutcomeCache[action];
  }
  if (state.enemyStunned > 0 &&
      (action === "GO" || action === "LEFT" || action === "RIGHT" ||
        action === "LEFT_GO" || action === "RIGHT_GO" ||
        action === "LEFT_FIRE" || action === "RIGHT_FIRE")) {
    // The guide does not publish the exact reversal probability. 0.5 is a
    // neutral expectation and the minimizer still chooses the intended action.
    state._enemyOutcomeCache[action] = [
      { action: action, reversed: false, probability: 0.5 },
      { action: action, reversed: true, probability: 0.5 }
    ];
    return state._enemyOutcomeCache[action];
  }
  state._enemyOutcomeCache[action] = [
    { action: action, reversed: false, probability: 1 }
  ];
  return state._enemyOutcomeCache[action];
}

function shouldConsiderStun(state) {
  if (!state.stunReady || state.enemyStunned > 0) return false;
  var distance = manhattan(state.myPos, state.enemyPos);
  if (distance > 9) return false;
  if (state.enemyStationaryStreak >= 6) {
    var immediateThreat = state.enemyCanFire &&
      firesAt(state.enemyPos, state.enemyDir, state.myPos, state.map);
    var starContested = false;
    if (state.star) {
      var stationaryMyDistance = distanceFromField(state.starDistance,
        state.myPos);
      var stationaryEnemyDistance = distanceFromField(state.starDistance,
        state.enemyPos);
      starContested = stationaryEnemyDistance <= stationaryMyDistance + 1 &&
        enemyMotionFactor(state) > 0.25;
    }
    if (!immediateThreat && distance > 3 && !starContested) return false;
  }
  if (clearLine(state.myPos, state.enemyPos, state.map)) return true;
  if (distance <= 4) return true;
  if (!state.star) return false;

  var myDistance = distanceFromField(state.starDistance, state.myPos);
  var enemyDistance = distanceFromField(state.starDistance, state.enemyPos);
  return enemyDistance <= myDistance + 3;
}

function actionPriority(action) {
  if (action === "GO") return 5;
  if (action === "FIRE") return 4;
  if (action === "STUN" || action === "BOMB") return 3;
  if (action === "LEFT") return 2;
  if (action === "RIGHT") return 1;
  if (action === "WAIT") return -1;
  return 0;
}

function moveActionFirst(actions, preferred) {
  var index = actions.indexOf(preferred);
  if (index > 0) {
    actions.splice(index, 1);
    actions.unshift(preferred);
  }
}

function stunnedActionPreference(state) {
  if (state._stunPreferenceComputed) return state._stunPreference;
  state._stunPreferenceComputed = true;
  state._stunPreference = null;
  if (state.enemyStunned <= 0) return null;

  var distance = manhattan(state.myPos, state.enemyPos);
  var line = clearLine(state.myPos, state.enemyPos, state.map);
  var wanted = directionToAligned(state.myPos, state.enemyPos);

  // Preserve a certain shot, then prefer preparing one. These bonuses are
  // deliberately small compared with death/projectile penalties, so an enemy
  // simultaneous move can still make minimax reject the preferred action.
  if (line && distance <= 5 && !state.enemyShielded && wanted) {
    if (wanted === state.myDir && state.myCanFire) {
      state._stunPreference = { action: "FIRE", score: 110 };
      return state._stunPreference;
    }
    state._stunPreference = {
      action: shortTurn(state.myDir, wanted) === "left" ? "LEFT" : "RIGHT",
      score: 70
    };
    return state._stunPreference;
  }

  if (state.star) {
    var starStep = nextStepFromDistanceField(state.myPos, state.starDistance,
      state.map, state.enemyPos);
    if (starStep) {
      state._stunPreference = {
        action: actionForStep(state.myPos, state.myDir, starStep),
        score: 55
      };
      return state._stunPreference;
    }
  }

  var laneStep = nextAttackLaneStep(state.myPos, state.enemyPos, state.map);
  if (laneStep) {
    state._stunPreference = {
      action: actionForStep(state.myPos, state.myDir, laneStep),
      score: 35
    };
    return state._stunPreference;
  }
  return null;
}

function actorCanAct(state, forMe) {
  var frozen = forMe ? state.myFrozen : state.enemyFrozen;
  var poisoned = forMe ? state.myPoisoned : state.enemyPoisoned;
  var runtimeCanAct = forMe ? state.myCanActNow : state.enemyCanActNow;
  if (!runtimeCanAct || frozen > 0) return false;
  // Poison permits one action every other frame. Newly applied duration 4
  // therefore skips at 4, acts at 3, skips at 2, and acts at 1.
  return poisoned <= 0 || poisoned % 2 === 1;
}

function appendEnemySkillActions(state, actions) {
  if (!state.enemySkillReady || !state.enemySkillType) return;
  var type = state.enemySkillType;
  var distance = manhattan(state.myPos, state.enemyPos);
  var myBombRisk = bombPressureScore(state, true);
  var enemyBombRisk = bombPressureScore(state, false);
  var line = clearLine(state.enemyPos, state.myPos, state.map);

  if (type === "shield") {
    if (!state.enemyShielded && (state.myProjectile || state.myProjectile2 ||
        (state.myCanFire && line))) actions.push("SHIELD");
  } else if (type === "freeze") {
    if (distance <= 8 || myBombRisk >= 1200) actions.push("FREEZE");
  } else if (type === "stun") {
    if (distance <= 8 || myBombRisk >= 1200) actions.push("ENEMY_STUN");
  } else if (type === "overload") {
    if (!state.enemyOverloaded && state.enemyCanFire && distance <= 10) {
      actions.push("OVERLOAD");
    }
  } else if (type === "cloak") {
    if (state.enemyCloaked <= 0 && distance <= 9) actions.push("CLOAK");
  } else if (type === "poison") {
    if (distance <= 8 || myBombRisk >= 1200) actions.push("POISON");
  } else if (type === "teleport") {
    if (distance <= 8 || enemyBombRisk >= 1200 || state.star) {
      actions.push("TELEPORT");
    }
  } else if (type === "boost") {
    if (!state.enemyBoosted && (distance <= 9 || state.star ||
        enemyBombRisk >= 1200)) actions.push("BOOST");
  }
}

function appendBoostCompoundActions(state, actions) {
  if (!state.enemyBoosted) return;
  var leftDir = turnDir(state.enemyDir, -1);
  var rightDir = turnDir(state.enemyDir, 1);
  var leftForward = advanceTankPosition(state.enemyPos, leftDir,
    state.enemyMoveSpeed, state.map, state.myPos);
  var rightForward = advanceTankPosition(state.enemyPos, rightDir,
    state.enemyMoveSpeed, state.map, state.myPos);
  if (!samePos(leftForward, state.enemyPos)) actions.push("LEFT_GO");
  if (!samePos(rightForward, state.enemyPos)) actions.push("RIGHT_GO");
  if (state.enemyCanFire) {
    if (firesAt(state.enemyPos, leftDir, state.myPos, state.map)) {
      actions.push("LEFT_FIRE");
    }
    if (firesAt(state.enemyPos, rightDir, state.myPos, state.map)) {
      actions.push("RIGHT_FIRE");
    }
  }
}

function enemySkillCooldown(type) {
  if (type === "shield") return 25;
  if (type === "freeze") return 29;
  if (type === "stun") return 20;
  if (type === "overload") return 32;
  if (type === "cloak") return 35;
  if (type === "poison") return 20;
  if (type === "teleport") return 40;
  if (type === "boost") return 26;
  return 99;
}

function enemyActionMatchesSkill(action, type) {
  return (type === "shield" && action === "SHIELD") ||
    (type === "freeze" && action === "FREEZE") ||
    (type === "stun" && action === "ENEMY_STUN") ||
    (type === "overload" && action === "OVERLOAD") ||
    (type === "cloak" && action === "CLOAK") ||
    (type === "poison" && action === "POISON") ||
    (type === "teleport" && action === "TELEPORT") ||
    (type === "boost" && action === "BOOST");
}

function applyEnemySkillCast(state, next, enemyAction) {
  var type = state.enemySkillType;
  if (!state.enemySkillReady || !enemyActionMatchesSkill(enemyAction, type)) {
    return;
  }
  next.enemySkillReady = false;
  next.enemySkillCooldown = enemySkillCooldown(type);
  if (type === "shield") {
    next.enemyShieldHits = 2;
    next.enemyShieldFrames = 4;
    next.enemyShielded = true;
  } else if (type === "freeze") {
    next.myFrozen = 2;
  } else if (type === "stun") {
    next.myStunned = 6;
  } else if (type === "overload") {
    next.enemyOverloaded = true;
    next.enemyOverloadFrames = 10;
  } else if (type === "cloak") {
    next.enemyCloaked = 6;
  } else if (type === "poison") {
    next.myPoisoned = 4;
  } else if (type === "teleport") {
    if (manhattan(next.enemyPos, next.myPos) <= 4) {
      next.enemyFireLockedFrames = 2;
      next.enemyCanFire = false;
    }
  } else if (type === "boost") {
    next.enemyBoosted = true;
    next.enemyBoostFrames = 6;
    next.enemyMoveSpeed = 2;
  }
}

function advanceTimedEffects(state, next, myAction, enemyAction) {
  var castType = enemyActionMatchesSkill(enemyAction, state.enemySkillType) ?
    state.enemySkillType : null;
  // Most search nodes have no active timed effect. cloneState already copied
  // the stable zero values, and projectile resolution above already refreshed
  // can-fire state, so avoid rewriting every status field on this hot path.
  if (!castType && state.myFrozen <= 0 && state.myStunned <= 0 &&
      state.myPoisoned <= 0 && state.enemyFrozen <= 0 &&
      state.enemyPoisoned <= 0 && state.myBoostFrames <= 0 &&
      state.enemyBoostFrames <= 0 && !state.myBoosted &&
      !state.enemyBoosted && state.myShieldFrames <= 0 &&
      state.enemyShieldFrames <= 0 && state.myShieldHits <= 0 &&
      state.enemyShieldHits <= 0 && !state.myShielded &&
      !state.enemyShielded && state.myOverloadFrames <= 0 &&
      state.enemyOverloadFrames <= 0 && !state.myOverloaded &&
      !state.enemyOverloaded && state.myCloaked <= 0 &&
      state.enemyCloaked <= 0 && state.myFireLockedFrames <= 0 &&
      state.enemyFireLockedFrames <= 0 && state.enemySkillCooldown <= 0 &&
      state.myCanActNow && state.enemyCanActNow) {
    return;
  }
  next.myFrozen = castType === "freeze" ? 2 :
    Math.max(0, state.myFrozen - 1);
  next.myStunned = castType === "stun" ? 6 :
    Math.max(0, state.myStunned - 1);
  next.myPoisoned = castType === "poison" ? 4 :
    Math.max(0, state.myPoisoned - 1);
  next.enemyFrozen = Math.max(0, state.enemyFrozen - 1);
  next.enemyPoisoned = Math.max(0, state.enemyPoisoned - 1);

  next.myBoostFrames = Math.max(0, state.myBoostFrames - 1);
  next.enemyBoostFrames = castType === "boost" ? 6 :
    Math.max(0, state.enemyBoostFrames - 1);
  next.myBoosted = next.myBoostFrames > 0;
  next.enemyBoosted = next.enemyBoostFrames > 0;
  next.myMoveSpeed = next.myBoosted ? 2 : 1;
  next.enemyMoveSpeed = next.enemyBoosted ? 2 : 1;

  next.myShieldFrames = Math.max(0, state.myShieldFrames - 1);
  next.enemyShieldFrames = castType === "shield" ? 4 :
    Math.max(0, state.enemyShieldFrames - 1);
  if (next.myShieldFrames <= 0 || next.myShieldHits <= 0) {
    next.myShieldHits = 0;
    next.myShielded = false;
  } else {
    next.myShielded = true;
  }
  if (next.enemyShieldFrames <= 0 || next.enemyShieldHits <= 0) {
    next.enemyShieldHits = 0;
    next.enemyShielded = false;
  } else {
    next.enemyShielded = true;
  }

  next.myOverloadFrames = Math.max(0, state.myOverloadFrames - 1);
  next.enemyOverloadFrames = castType === "overload" ? 10 :
    Math.max(0, state.enemyOverloadFrames - 1);
  if (myAction === "FIRE" || next.myOverloadFrames <= 0) {
    next.myOverloaded = false;
    if (myAction === "FIRE") next.myOverloadFrames = 0;
  }
  if (enemyAction === "FIRE" || enemyAction === "LEFT_FIRE" ||
      enemyAction === "RIGHT_FIRE" || next.enemyOverloadFrames <= 0) {
    next.enemyOverloaded = false;
    if (enemyAction.indexOf("FIRE") >= 0) next.enemyOverloadFrames = 0;
  } else if (castType === "overload") {
    next.enemyOverloaded = true;
  }

  next.myCloaked = Math.max(0, state.myCloaked - 1);
  next.enemyCloaked = castType === "cloak" ? 6 :
    Math.max(0, state.enemyCloaked - 1);
  next.myFireLockedFrames = Math.max(0, state.myFireLockedFrames - 1);
  next.enemyFireLockedFrames = castType === "teleport" &&
    manhattan(next.enemyPos, next.myPos) <= 4 ? 2 :
    Math.max(0, state.enemyFireLockedFrames - 1);
  next.myCanFire = !next.myProjectile && !next.myProjectile2 &&
    next.myFireLockedFrames <= 0;
  next.enemyCanFire = !next.enemyProjectile && !next.enemyProjectile2 &&
    next.enemyFireLockedFrames <= 0;

  if (!castType && state.enemySkillCooldown > 0) {
    next.enemySkillCooldown = state.enemySkillCooldown - 1;
    next.enemySkillReady = next.enemySkillCooldown <= 0;
  }
  next.myCanActNow = next.myFrozen <= 0 &&
    (next.myPoisoned <= 0 || next.myPoisoned % 2 === 1);
  next.enemyCanActNow = next.enemyFrozen <= 0 &&
    (next.enemyPoisoned <= 0 || next.enemyPoisoned % 2 === 1);
}

function bestEnemyTeleportTarget(state) {
  if (state._enemyTeleportComputed) return state._enemyTeleportTarget;
  state._enemyTeleportComputed = true;
  state._enemyTeleportTarget = null;
  var bestScore = -Infinity;
  for (var x = 0; x < state.map.length; x++) {
    var column = state.map[x];
    if (!column) continue;
    for (var y = 0; y < column.length; y++) {
      var position = [x, y];
      if (!isWalkable(position, state.map) ||
          samePos(position, state.myPos) ||
          (state.star && samePos(position, state.star)) ||
          (state.myProjectile && samePos(position,
            state.myProjectile.position)) ||
          (state.myProjectile2 && samePos(position,
            state.myProjectile2.position))) continue;
      var score = -positionBombRisk(state, position, false);
      var distance = manhattan(position, state.myPos);
      var aim = directionToAligned(position, state.myPos);
      if (aim && clearLine(position, state.myPos, state.map)) {
        score += distance > 4 ? 700 - Math.min(300, distance * 20) : 120;
      }
      if (tileAt(position, state.map) === "o") score += 90;
      score -= edgePositionPenalty(position, state.enemyDir, state.map,
        state.myPos, false, state.star) * 0.3;
      if (state.star) score -= manhattan(position, state.star) * 6;
      if (score > bestScore) {
        bestScore = score;
        state._enemyTeleportTarget = position;
      }
    }
  }
  return state._enemyTeleportTarget;
}

function shouldReverseMyActionForRisk(state, action) {
  if (action !== "GO" && action !== "LEFT" && action !== "RIGHT") {
    return false;
  }
  var normalPos = state.myPos;
  var reversePos = state.myPos;
  var normalDir = state.myDir;
  var reverseDir = state.myDir;
  if (action === "GO") {
    normalPos = advanceTankPosition(state.myPos, state.myDir,
      state.myMoveSpeed, state.map, state.enemyPos);
    reversePos = advanceTankPosition(state.myPos,
      oppositeDir(state.myDir), state.myMoveSpeed, state.map,
      state.enemyPos);
  } else {
    var amount = action === "LEFT" ? -1 : 1;
    normalDir = turnDir(state.myDir, amount);
    reverseDir = turnDir(state.myDir, -amount);
  }
  var normalRisk = positionImmediateRisk(state, normalPos, normalDir, true);
  var reverseRisk = positionImmediateRisk(state, reversePos, reverseDir, true);
  return reverseRisk >= normalRisk;
}

function enemySkillOptionPenalty(state) {
  if (!state.enemySkillReady || !state.enemySkillType) return 0;
  var distance = manhattan(state.myPos, state.enemyPos);
  var opportunity = Math.max(0, 10 - distance) / 10;
  var type = state.enemySkillType;
  var base = 0;
  if (type === "freeze") base = 900;
  else if (type === "stun") base = 700;
  else if (type === "overload") base = 650;
  else if (type === "teleport") base = 800;
  else if (type === "boost") base = 700;
  else if (type === "poison") base = 600;
  else if (type === "cloak") base = 450;
  else if (type === "shield") base = 400;
  if (bombPressureScore(state, true) >= 1200 &&
      (type === "freeze" || type === "stun" || type === "poison")) {
    base += 600;
  }
  return base * (0.35 + opportunity * 0.65);
}

function applyJointActions(state, myAction, enemyAction, enemyReversed) {
  var next = cloneState(state);
  next.frame = state.frame + 1;
  var myStart = state.myPos;
  var enemyStart = state.enemyPos;
  var myNext = myStart;
  var enemyNext = enemyStart;
  var enemyBaseAction = enemyAction;
  var enemyFreeTurn = null;
  if (enemyAction === "LEFT_GO" || enemyAction === "LEFT_FIRE") {
    enemyFreeTurn = "LEFT";
    enemyBaseAction = enemyAction === "LEFT_GO" ? "GO" : "FIRE";
  } else if (enemyAction === "RIGHT_GO" || enemyAction === "RIGHT_FIRE") {
    enemyFreeTurn = "RIGHT";
    enemyBaseAction = enemyAction === "RIGHT_GO" ? "GO" : "FIRE";
  }
  var myReversed = state.myStunned > 0 &&
    shouldReverseMyActionForRisk(state, myAction);

  // Keep tactical bonuses and penalties from every simulated ply. Resetting
  // here made the root action's fire/edge score disappear at depth two.
  next.actionScore = state.actionScore;
  var stunnedPreference = stunnedActionPreference(state);
  if (stunnedPreference && myAction === stunnedPreference.action) {
    next.actionScore += stunnedPreference.score;
  }

  if (myAction === "LEFT" || myAction === "RIGHT") {
    next.myTurnStreak = (state.lastMyAction === "LEFT" ||
      state.lastMyAction === "RIGHT") ? state.myTurnStreak + 1 : 1;
    next.actionScore -= 12 + next.myTurnStreak * 10;
    if ((state.lastMyAction === "LEFT" && myAction === "RIGHT") ||
        (state.lastMyAction === "RIGHT" && myAction === "LEFT")) {
      next.actionScore -= AT_TURN_REVERSAL_PENALTY;
    }
    if (next.myTurnStreak === 2) next.actionScore -= 60;
    else if (next.myTurnStreak === 3) next.actionScore -= 180;
    else if (next.myTurnStreak >= 4) next.actionScore -= 360;
  } else {
    next.myTurnStreak = 0;
  }
  next.lastMyAction = myAction;

  if (myAction === "LEFT") {
    next.myDir = turnDir(state.myDir, myReversed ? 1 : -1);
  }
  if (myAction === "RIGHT") {
    next.myDir = turnDir(state.myDir, myReversed ? -1 : 1);
  }

  if (enemyBaseAction === "LEFT") {
    next.enemyDir = turnDir(state.enemyDir, enemyReversed ? 1 : -1);
  }
  if (enemyBaseAction === "RIGHT") {
    next.enemyDir = turnDir(state.enemyDir, enemyReversed ? -1 : 1);
  }
  if (enemyFreeTurn === "LEFT") {
    next.enemyDir = turnDir(state.enemyDir, enemyReversed ? 1 : -1);
  }
  if (enemyFreeTurn === "RIGHT") {
    next.enemyDir = turnDir(state.enemyDir, enemyReversed ? -1 : 1);
  }

  if (myAction === "GO") {
    var myMoveDir = myReversed ? oppositeDir(state.myDir) : state.myDir;
    myNext = advanceTankPosition(myStart, myMoveDir, state.myMoveSpeed,
      state.map, enemyStart);
  }
  if (enemyBaseAction === "GO") {
    var enemyMoveDir = enemyReversed ? oppositeDir(next.enemyDir) : next.enemyDir;
    enemyNext = advanceTankPosition(enemyStart, enemyMoveDir,
      state.enemyMoveSpeed, state.map, myStart);
  }
  if (enemyAction === "TELEPORT") {
    var teleportTarget = bestEnemyTeleportTarget(state);
    if (teleportTarget) enemyNext = teleportTarget;
  }

  // Tanks block the same destination and cannot swap through each other.
  if (samePos(myNext, enemyNext) ||
      (samePos(myNext, enemyStart) && samePos(enemyNext, myStart))) {
    myNext = myStart;
    enemyNext = enemyStart;
  } else {
    if (samePos(myNext, enemyStart)) myNext = myStart;
    if (samePos(enemyNext, myStart)) enemyNext = enemyStart;
  }
  next.myPos = myNext;
  next.enemyPos = enemyNext;

  // Moving deeper into the outer rings is a distinct strategic cost. This
  // catches gradual cornering before the low-neighbor score becomes critical.
  if (myAction === "GO") {
    var beforeEdge = outerEdgeDistance(myStart, state.map);
    var afterEdge = outerEdgeDistance(myNext, state.map);
    if (afterEdge < beforeEdge) {
      var enteringOuterRing = afterEdge <= 1;
      var edgeStepCost = enteringOuterRing ?
        (state.myStars > state.enemyStars ? 190 : 105) :
        (state.myStars > state.enemyStars ? 90 : 50);
      if (manhattan(myNext, enemyNext) <= 4) edgeStepCost += 55;
      next.actionScore -= (beforeEdge - afterEdge) * edgeStepCost;
    } else if (afterEdge > beforeEdge && beforeEdge <= 2) {
      next.actionScore += 28;
    }
  }

  // Tank movement resolves before the next bullet travel update. Entering the
  // tile currently occupied by an existing bullet is therefore an immediate
  // collision (the exact failure seen in match mat_4uzdv3lDkXD9kds3m).
  if (next.enemyProjectile &&
      samePos(myNext, next.enemyProjectile.position)) {
    applyTankDamage(next, true, "bullet");
    next.enemyProjectile = null;
  }
  if (next.enemyProjectile2 &&
      samePos(myNext, next.enemyProjectile2.position)) {
    applyTankDamage(next, true, "bullet");
    next.enemyProjectile2 = null;
  }
  if (next.myProjectile &&
      samePos(enemyNext, next.myProjectile.position)) {
    applyTankDamage(next, false, "bullet");
    next.myProjectile = null;
  }
  if (next.myProjectile2 &&
      samePos(enemyNext, next.myProjectile2.position)) {
    applyTankDamage(next, false, "bullet");
    next.myProjectile2 = null;
  }

  // Skill casts affect projectiles later in the frame but never cancel the
  // opponent's already selected simultaneous action.
  applyEnemySkillCast(state, next, enemyAction);
  if (myAction === "BOMB" && state.myBombReady) {
    next.bombs = state.bombs.slice();
    next.bombs.push({
      position: copyPos(myStart),
      placedFrame: state.frame,
      explodeFrame: state.frame + 10,
      owner: "my"
    });
    next.myBombReady = false;
    next.actionScore += bombPlacementUtility(state, true);
  }

  if (myAction === "FIRE" && state.myCanFire && !next.myProjectile &&
      !next.myProjectile2) {
    var initialMyRay = scanForwardRay(myStart, state.myDir, enemyStart,
      state.map);
    var myRay = scanForwardRay(myStart, state.myDir, enemyNext, state.map);
    next.myProjectile = {
      position: copyPos(myStart), direction: state.myDir,
      damage: 1
    };
    if (state.myOverloaded) {
      next.myProjectile2 = {
        position: overloadSecondaryOrigin(myStart, state.myDir),
        direction: state.myDir, damage: 1
      };
    }
    if (initialMyRay.firstObject === "enemy") {
      next.actionScore += longRangeHitScore(state, true);
    } else if (initialMyRay.firstObject === "m") {
      next.actionScore += Math.min(220, fireUtility(state, true));
    } else {
      // An off-line prediction occupies our only bullet until it leaves the
      // map. Require a meaningful advantage instead of firing on a near tie.
      next.actionScore -= 30;
      if (state.star && state.myStars <= state.enemyStars) {
        var fireMyStarDistance = distanceFromField(state.starDistance,
          state.myPos);
        var fireEnemyStarDistance = distanceFromField(state.starDistance,
          state.enemyPos);
        if (fireMyStarDistance <= fireEnemyStarDistance + 3) {
          next.actionScore -= 90;
        }
      }
      next.actionScore += predictiveInterceptOutcomeScore(state, enemyBaseAction,
        enemyReversed, enemyNext, myRay);
    }
  }
  if (enemyBaseAction === "FIRE" && state.enemyCanFire &&
      !next.enemyProjectile && !next.enemyProjectile2) {
    next.enemyProjectile = {
      position: copyPos(enemyNext),
      direction: next.enemyDir,
      damage: 1
    };
    if (state.enemyOverloaded) {
      next.enemyProjectile2 = {
        position: overloadSecondaryOrigin(enemyNext, next.enemyDir),
        direction: next.enemyDir, damage: 1
      };
    }
  }

  var projectileMapChanged = false;
  if (next.myProjectile) {
    var myBulletResult = advanceProjectile(next.myProjectile, "my", next.map,
      myNext, enemyNext, true);
    next.myProjectile = myBulletResult.projectile;
    next.map = myBulletResult.map;
    projectileMapChanged = myBulletResult.mapChanged;
    if (myBulletResult.hitTarget) {
      var myDamage = myBulletResult.damage || 1;
      for (var myHit = 0; myHit < myDamage && !next.enemyDead; myHit++) {
        applyTankDamage(next, false, "bullet");
      }
    }
  }

  if (next.myProjectile2) {
    var myBulletResult2 = advanceProjectile(next.myProjectile2, "my",
      next.map, myNext, enemyNext, true);
    next.myProjectile2 = myBulletResult2.projectile;
    next.map = myBulletResult2.map;
    projectileMapChanged = projectileMapChanged ||
      myBulletResult2.mapChanged;
    if (myBulletResult2.hitTarget) {
      applyTankDamage(next, false, "bullet");
    }
  }

  if (next.enemyProjectile) {
    var enemyBulletResult = advanceProjectile(next.enemyProjectile, "enemy",
      next.map, myNext, enemyNext, true);
    next.enemyProjectile = enemyBulletResult.projectile;
    next.map = enemyBulletResult.map;
    projectileMapChanged = projectileMapChanged ||
      enemyBulletResult.mapChanged;
    if (enemyBulletResult.hitTarget) {
      var enemyDamage = enemyBulletResult.damage || 1;
      for (var enemyHit = 0; enemyHit < enemyDamage && !next.myDead;
          enemyHit++) {
        applyTankDamage(next, true, "bullet");
      }
    }
  }

  if (next.enemyProjectile2) {
    var enemyBulletResult2 = advanceProjectile(next.enemyProjectile2,
      "enemy", next.map, myNext, enemyNext, true);
    next.enemyProjectile2 = enemyBulletResult2.projectile;
    next.map = enemyBulletResult2.map;
    projectileMapChanged = projectileMapChanged ||
      enemyBulletResult2.mapChanged;
    if (enemyBulletResult2.hitTarget) {
      applyTankDamage(next, true, "bullet");
    }
  }

  if (projectileMapChanged) {
    next.starDistance = buildDistanceField(next.map, next.star);
  }
  next.myCanFire = !next.myProjectile && !next.myProjectile2;
  next.enemyCanFire = !next.enemyProjectile && !next.enemyProjectile2;

  var bombResult = applyBombDetonations(next, state.frame);
  if (bombResult.mapChanged) {
    next.starDistance = buildDistanceField(next.map, next.star);
  }

  advanceTimedEffects(state, next, myAction, enemyAction);
  next.enemyStunned = Math.max(0, state.enemyStunned - 1);
  if (myAction === "STUN" && state.stunReady) {
    next.stunReady = false;
    next.enemyStunned = 6;
    next.actionScore -= 20;
  }

  if (next.star && samePos(next.myPos, next.star)) {
    next.myStars++;
    next.star = null;
  } else if (next.star && samePos(next.enemyPos, next.star)) {
    next.enemyStars++;
    next.star = null;
  }
  applyWeakSuperko(state, next);
  return next;
}

function repetitionPenaltyForDistance(distance) {
  if (distance === 2) return 240;
  if (distance === 3) return 170;
  if (distance === 4) return 120;
  if (distance >= 5 && distance <= 8) return 60;
  return 0;
}

function findRepeatedState(state, key) {
  if (state.simPathDepth >= 2 && state.simPathKey2 === key) {
    return { distance: 2, epoch: state.contextEpoch, record: null };
  }
  if (state.simPathDepth >= 3 && state.simPathKey3 === key) {
    return { distance: 3, epoch: state.contextEpoch, record: null };
  }

  var simulatedDepth = state.simPathDepth;
  var distance;
  for (var offset = 0; offset < AT_HISTORY_COUNT; offset++) {
    distance = simulatedDepth + offset + 1;
    if (distance > 8) break;
    var record = recentHistoryRecord(offset);
    if (record && record.key === key) {
      return { distance: distance, epoch: record.epoch, record: record };
    }
  }
  return null;
}

function repetitionEmergency(state, next) {
  if (next.enemyDead) return true;
  if (projectilePairThreat(state.enemyProjectile, state.enemyProjectile2,
      state.myPos, state.myDir, state.myMoveSpeed, state.map) >= 1200) {
    return true;
  }
  var geometry = stateGeometry(state);
  return muzzleRiskScore(state.enemyPos, state.enemyDir, state.myPos,
    state.map, state.enemyCanFire, state.enemyBoosted, state.myDir,
    state.myMoveSpeed, geometry.enemyAim, geometry.lineOpen,
    geometry.distance, state.enemyOverloaded) >= 10000;
}

function applyWeakSuperko(state, next) {
  var key = physicalStateKey(next.myPos, next.myDir);
  var match = findRepeatedState(state, key);
  var penalty = match ? repetitionPenaltyForDistance(match.distance) : 0;
  if (penalty > 0) {
    if (match.epoch !== state.contextEpoch) penalty *= 0.5;
    if (repetitionEmergency(state, next)) penalty = 0;
  }
  next.repetitionPenalty = state.repetitionPenalty + penalty;
  next.repeatReliefPenalty = penalty;
  next.repeatReferenceValue = match && match.record &&
    typeof match.record.totalValue === "number" ?
    match.record.totalValue : null;
  next.simPathKey3 = state.simPathKey2;
  next.simPathKey2 = state.simPathKey1;
  next.simPathKey1 = key;
  next.simPathDepth = Math.min(3, state.simPathDepth + 1);
}

function evaluateState(state) {
  if (state._evaluationComputed) return state._evaluation;
  state._evaluationComputed = true;
  var survival = 0;
  var objective = 0;
  var action = 0;
  var projectile = 0;
  var attack = 0;
  var position = 0;
  var status = 0;
  var repetition = 0;
  var myForcedBombDeath = hasForcedBombDeath(state, true);
  var enemyForcedBombDeath = hasForcedBombDeath(state, false);
  if ((state.myDead || myForcedBombDeath) &&
      (state.enemyDead || enemyForcedBombDeath)) {
    if (state.myStars > state.enemyStars) survival = AT_TERMINAL_SCORE;
    else if (state.myStars < state.enemyStars) {
      survival = -AT_TERMINAL_SCORE;
    } else survival = AT_TIED_MUTUAL_DEATH_SCORE;
    storeEvaluationComponents(state, survival, objective, action,
      projectile, attack, position, status, repetition);
    state._evaluation = survival;
    return state._evaluation;
  }
  if (state.enemyDead || enemyForcedBombDeath) {
    survival = AT_TERMINAL_SCORE;
    storeEvaluationComponents(state, survival, objective, action,
      projectile, attack, position, status, repetition);
    state._evaluation = AT_TERMINAL_SCORE;
    return state._evaluation;
  }
  if (state.myDead || myForcedBombDeath) {
    survival = -AT_TERMINAL_SCORE;
    storeEvaluationComponents(state, survival, objective, action,
      projectile, attack, position, status, repetition);
    state._evaluation = -AT_TERMINAL_SCORE;
    return state._evaluation;
  }

  objective = (state.myStars - state.enemyStars) * 900;
  action = state.actionScore;
  projectile += projectilePairThreat(state.myProjectile,
    state.myProjectile2, state.enemyPos, state.enemyDir,
    state.enemyMoveSpeed, state.map);
  projectile -= projectilePairThreat(state.enemyProjectile,
    state.enemyProjectile2, state.myPos, state.myDir,
    state.myMoveSpeed, state.map);
  projectile += bombPressureScore(state, false);
  projectile -= bombPressureScore(state, true);
  var geometry = stateGeometry(state);
  var distance = geometry.distance;
  var lineOpen = geometry.lineOpen;
  var myAim = geometry.myAim;
  var enemyAim = geometry.enemyAim;
  attack += muzzleRiskScore(state.myPos, state.myDir,
    state.enemyPos,
    state.map, state.myCanFire, state.myBoosted, state.enemyDir,
    state.enemyMoveSpeed, myAim, lineOpen, distance) * 0.75;
  attack -= muzzleRiskScore(state.enemyPos, state.enemyDir,
    state.myPos,
    state.map, state.enemyCanFire, state.enemyBoosted, state.myDir,
    state.myMoveSpeed, enemyAim, lineOpen, distance,
    state.enemyOverloaded);
  attack += attackRaceScore(state, distance, lineOpen,
    myAim, enemyAim);

  if (state.star) {
    var myStarDistance = distanceFromField(state.starDistance, state.myPos);
    var enemyStarDistance = distanceFromField(state.starDistance, state.enemyPos);
    var myDistanceWeight = 20;
    var enemyDistanceWeight = 16;
    if (state.myStars < state.enemyStars) {
      myDistanceWeight = 38;
      enemyDistanceWeight = 24;
    } else if (state.myStars === state.enemyStars &&
        myStarDistance <= enemyStarDistance + 3) {
      myDistanceWeight = 28;
      enemyDistanceWeight = 20;
    }
    objective += finiteDistance(enemyStarDistance) * enemyDistanceWeight;
    objective -= finiteDistance(myStarDistance) * myDistanceWeight;
  }

  if (lineOpen) {
    if (myAim === state.myDir) attack += state.myCanFire ?
      lineFireValue(state.myPos, state.myDir, state.enemyPos, state.enemyDir,
        state.enemyMoveSpeed, state.map) : 35;
    if (enemyAim === state.enemyDir && state.enemyCanFire) {
      attack -= lineFireValue(state.enemyPos, state.enemyDir,
        state.myPos,
        state.myDir, state.myMoveSpeed, state.map);
    }
    if (state.enemyShielded && myAim === state.myDir) {
      attack -= 100;
    }
  } else {
    position += 18; // cover is mildly valuable
  }

  var myOpenNeighbors = geometry.myFeatures.openNeighbors;
  var enemyOpenNeighbors = geometry.enemyFeatures.openNeighbors;
  var myEdgeDistance = geometry.myEdgeDistance;
  var enemyEdgeDistance = geometry.enemyEdgeDistance;
  position += (myOpenNeighbors - enemyOpenNeighbors) * 7;
  position -= edgePositionPenalty(state.myPos, state.myDir,
    state.map,
    state.enemyPos, state.myStars > state.enemyStars, state.star,
    myEdgeDistance, myOpenNeighbors);
  position += edgePositionPenalty(state.enemyPos, state.enemyDir,
    state.map,
    state.myPos, false, state.star, enemyEdgeDistance,
    enemyOpenNeighbors) * 0.55;
  if (geometry.myFeatures.tile === "o") position += 18;
  if (geometry.enemyFeatures.tile === "o") position -= 8;
  if (distance === 1) position -= 25;
  if (state.stunReady) status += 10;
  status += state.enemyStunned * 18;
  status -= state.myFrozen * 260 + state.myPoisoned * 90 +
    state.myStunned * 75;
  status += state.enemyFrozen * 220 + state.enemyPoisoned * 70;
  status += state.myShieldHits * 180 - state.enemyShieldHits * 180;
  if (state.enemyOverloaded) status -= 420;
  if (state.enemyBoosted) status -= 260;
  if (state.enemyCloaked > 0) status -= 220;
  status -= enemySkillOptionPenalty(state);

  repetition = -state.repetitionPenalty;
  var baseScore = survival + objective + action + projectile + attack +
    position + status;
  if (state.repeatReferenceValue !== null &&
      baseScore > state.repeatReferenceValue + 150) {
    repetition += state.repeatReliefPenalty * 0.5;
  }
  storeEvaluationComponents(state, survival, objective, action, projectile,
    attack, position, status, repetition);
  state._evaluation = baseScore + repetition;
  return state._evaluation;
}

function storeEvaluationComponents(state, survival, objective, action,
    projectile, attack, position, status, repetition) {
  if (!state._captureEvaluationComponents) return;
  state._evaluationComponents = {
    survival: survival,
    objective: objective,
    action: action,
    projectile: projectile,
    attack: attack,
    position: position,
    status: status,
    repetition: repetition
  };
}

function staticPositionFeatures(position, map, mapId) {
  if (mapId === undefined) mapId = mapCacheId(map);
  var table = AT_POSITION_FEATURE_CACHE[mapId];
  if (!table) {
    table = [];
    AT_POSITION_FEATURE_CACHE[mapId] = table;
  }
  var key = positionCode(position);
  if (!table[key]) {
    table[key] = {
      openNeighbors: openNeighborCount(position, map, mapId),
      edgeDistance: outerEdgeDistance(position, map, mapId),
      tile: tileAt(position, map)
    };
  }
  return table[key];
}

function stateGeometry(state) {
  if (state._geometry) return state._geometry;
  var mapId = mapCacheId(state.map);
  var table = AT_PAIR_GEOMETRY_CACHE[mapId];
  if (!table) {
    table = [];
    AT_PAIR_GEOMETRY_CACHE[mapId] = table;
  }
  // These values depend only on the two positions. Including both tank
  // directions created up to sixteen duplicate entries in turn-heavy search.
  var myKey = positionCode(state.myPos);
  var enemyKey = positionCode(state.enemyPos);
  var myTable = table[myKey];
  if (!myTable) {
    myTable = [];
    table[myKey] = myTable;
  }
  var geometry = myTable[enemyKey];
  if (!geometry) {
    var myFeatures = staticPositionFeatures(state.myPos, state.map, mapId);
    var enemyFeatures = staticPositionFeatures(state.enemyPos, state.map,
      mapId);
    geometry = {
      distance: manhattan(state.myPos, state.enemyPos),
      lineOpen: clearLine(state.myPos, state.enemyPos, state.map, mapId),
      myAim: directionToAligned(state.myPos, state.enemyPos),
      enemyAim: directionToAligned(state.enemyPos, state.myPos),
      myFeatures: myFeatures,
      enemyFeatures: enemyFeatures,
      myEdgeDistance: myFeatures.edgeDistance,
      enemyEdgeDistance: enemyFeatures.edgeDistance
    };
    myTable[enemyKey] = geometry;
  }
  state._geometry = geometry;
  return state._geometry;
}

function attackRaceScore(state, distance, lineOpen, myAim, enemyAim) {
  var myFrames = attackArrivalFrames(state.myPos, state.myDir,
    state.enemyPos, state.map, state.myCanFire, state.myBoosted,
    state.enemyShielded, myAim, lineOpen, distance);
  var enemyFrames = attackArrivalFrames(state.enemyPos, state.enemyDir,
    state.myPos, state.map, state.enemyCanFire, state.enemyBoosted,
    state.myShielded, enemyAim, lineOpen, distance);

  if (myFrames < enemyFrames && myFrames <= 4) {
    return 16000 / myFrames;
  }
  if (enemyFrames < myFrames && enemyFrames <= 4) {
    return -22000 / enemyFrames;
  }
  if (myFrames === enemyFrames && myFrames <= 2) return -2500;
  return 0;
}

function dodgeVisibleBullet(me, enemy, game) {
  var bullet = currentEnemyProjectile(enemy, game);
  if (!bullet || !bullet.position || !bullet.direction) return null;

  var path = bulletPath(bullet.position, bullet.direction, game.map, 6);
  var hitStep = indexOfPos(path, me.tank.position);
  if (hitStep < 0 || hitStep > 4) return null;
  var impactFrames = Math.ceil((hitStep + 1) / 2);

  var moveSpeed = me.status.boosted ? 2 : 1;
  var forward = advanceTankPosition(me.tank.position, me.tank.direction,
    moveSpeed, game.map, enemy.tank && enemy.tank.position);
  if (!samePos(forward, me.tank.position) && indexOfPos(path, forward) < 0 &&
      !movementCrossesPosition(me.tank.position, me.tank.direction, moveSpeed,
        game.map, enemy.tank && enemy.tank.position, bullet.position) &&
      (!enemy.tank || !samePos(forward, enemy.tank.position))) {
    AT_EVASION_COMMITMENT = null;
    return "GO";
  }

  // A turn needs a later frame before it produces lateral movement.
  if (impactFrames < 2) return null;

  var turns = ["LEFT", "RIGHT"];
  var bestAction = null;
  var bestDirection = null;
  var bestScore = -Infinity;
  for (var i = 0; i < turns.length; i++) {
    var escapeDirection = turnDir(me.tank.direction,
      turns[i] === "LEFT" ? -1 : 1);
    var escape = advanceTankPosition(me.tank.position, escapeDirection,
      moveSpeed, game.map, enemy.tank && enemy.tank.position);
    if (samePos(escape, me.tank.position) ||
        sameBulletAxis(me.tank.position, escape, bullet.direction)) continue;
    var score = -edgePositionPenalty(escape, escapeDirection, game.map,
      enemy.tank && enemy.tank.position,
      (me.stars || 0) > (enemy.stars || 0), game.star);
    if (enemy.tank) score -= runtimeMuzzleRiskAt(escape, enemy, game,
      escapeDirection, moveSpeed);
    if (game.star) score -= manhattan(escape, game.star) * 4;
    if (score > bestScore) {
      bestScore = score;
      bestAction = turns[i];
      bestDirection = escapeDirection;
    }
  }
  if (bestAction) {
    rememberProjectileEvasion(me, bullet, bestDirection, game);
    return bestAction;
  }
  return null;
}

function rememberProjectileEvasion(me, bullet, escapeDirection, game) {
  var frame = game && typeof game.frames === "number" ? game.frames : 0;
  AT_EVASION_COMMITMENT = {
    origin: copyPos(me.tank.position),
    escapeDirection: escapeDirection,
    bulletDirection: bullet.direction,
    createdFrame: frame,
    expiresFrame: frame + 2
  };
}

function continueProjectileEvasion(me, enemy, game) {
  var commitment = AT_EVASION_COMMITMENT;
  if (!commitment) return null;
  var frame = game && typeof game.frames === "number" ? game.frames : 0;
  if (frame <= commitment.createdFrame || frame > commitment.expiresFrame ||
      !samePos(me.tank.position, commitment.origin) ||
      me.tank.direction !== commitment.escapeDirection) {
    AT_EVASION_COMMITMENT = null;
    return null;
  }

  var speed = me.status.boosted ? 2 : 1;
  var blocker = enemy.tank && enemy.tank.position;
  var forward = advanceTankPosition(me.tank.position, me.tank.direction,
    speed, game.map, blocker);
  if (samePos(forward, me.tank.position) ||
      sameBulletAxis(me.tank.position, forward,
        commitment.bulletDirection)) {
    AT_EVASION_COMMITMENT = null;
    return null;
  }

  var bullet = currentEnemyProjectile(enemy, game);
  if (bullet && (samePos(forward, bullet.position) ||
      movementCrossesPosition(me.tank.position, me.tank.direction, speed,
        game.map, blocker, bullet.position))) {
    AT_EVASION_COMMITMENT = null;
    return null;
  }

  var bombs = normalizeVisibleBombs(game.bombs,
    typeof game.frames === "number" ? game.frames : 0);
  if (runtimeBombCandidateRisk(me, enemy, game, bombs, "GO") >= 35000) {
    AT_EVASION_COMMITMENT = null;
    return null;
  }

  AT_EVASION_COMMITMENT = null;
  return "GO";
}

function winningAttackAction(me, enemy, game) {
  if (!enemy.tank || enemy.status.shielded || me.bullet ||
      me.status.fireLocked) return null;

  var activeEnemyProjectile = currentEnemyProjectile(enemy, game);
  if (activeEnemyProjectile) {
    var incomingRisk = runtimeProjectileRiskAfterAction(
      activeEnemyProjectile, me.tank.position, me.tank.position,
      me.tank.direction, me.status.boosted ? 2 : 1, game.map,
      enemy.tank.position, "WAIT");
    if (incomingRisk >= 35000 &&
        !favorableImmediateRuntimeFire(me, enemy, game, "FIRE")) {
      return null;
    }
  }

  var myCanFire = true;
  var enemyCanFire = !enemy.status.fireLocked &&
    !activeEnemyProjectile;
  var distance = manhattan(me.tank.position, enemy.tank.position);
  if (distance > 6) return null;

  var myFrames = attackArrivalFrames(me.tank.position, me.tank.direction,
    enemy.tank.position, game.map, myCanFire, !!me.status.boosted, false);
  var enemyFrames = attackArrivalFrames(enemy.tank.position,
    enemy.tank.direction, me.tank.position, game.map, enemyCanFire,
    !!enemy.status.boosted, !!me.status.shielded);
  // evaluateState already awards a simultaneous destruction to the tank with
  // the star lead. Keep this direct initiative guard consistent: when both
  // open shots arrive on the same frame, finishing the aim/fire sequence is
  // a forced favorable trade, not a reason to fall back to generic evasion.
  var winsMutualTrade = myFrames === enemyFrames &&
    (me.stars || 0) > (enemy.stars || 0);
  if (myFrames >= 99 || myFrames > enemyFrames ||
      (myFrames === enemyFrames && !winsMutualTrade)) return null;

  var wanted = directionToAligned(me.tank.position, enemy.tank.position);
  if (!wanted) return null;
  if (wanted === me.tank.direction) return "FIRE";
  return shortTurn(me.tank.direction, wanted) === "left" ? "LEFT" : "RIGHT";
}

function attackArrivalFrames(shooter, shooterDir, target, map, canFire,
    boosted, targetShielded, wanted, lineOpen, distance) {
  if (!canFire || targetShielded) return 99;
  if (wanted === undefined) wanted = directionToAligned(shooter, target);
  if (lineOpen === undefined) {
    lineOpen = wanted ? clearLine(shooter, target, map) : false;
  }
  if (!wanted || !lineOpen) return 99;
  var turns = quarterTurns(shooterDir, wanted);
  var turnFrames = boosted ? Math.max(0, turns - 1) : turns;
  if (distance === undefined) distance = manhattan(shooter, target);
  return turnFrames + Math.ceil(distance / 2);
}

function preemptiveMuzzleDodge(me, enemy, game) {
  var activeEnemyProjectile = currentEnemyProjectile(enemy, game);
  if (!enemy.tank || enemy.status.fireLocked || activeEnemyProjectile) {
    return null;
  }
  var myPos = me.tank.position;
  var enemyPos = enemy.tank.position;
  var ray = scanForwardRay(enemyPos, enemy.tank.direction, myPos, game.map);
  if (ray.firstObject !== "enemy" || ray.distance > 10) return null;

  // mat_Hoo0zaDiWttHI6Vln: with a 2-0 lead we kept retreating along a
  // six-tile open muzzle lane. The shot stayed behind our vision cone and
  // caught us at the map edge. At range, preempt only when protecting a lead
  // or when there is already too little edge space.
  if (ray.distance > 4 &&
      (me.stars || 0) <= (enemy.stars || 0) &&
      outerEdgeDistance(myPos, game.map) > 2) return null;

  var speed = me.status.boosted ? 2 : 1;
  var forward = advanceTankPosition(myPos, me.tank.direction, speed,
    game.map, enemyPos);
  if (!samePos(forward, myPos) &&
      !firesAt(enemyPos, enemy.tank.direction, forward, game.map) &&
      (!activeEnemyProjectile ||
        !samePos(forward, activeEnemyProjectile.position))) {
    return "GO";
  }

  // At distance 3+ a turn survives the first two-tile bullet advance and
  // prepares a lateral move on the next frame.
  if (ray.distance >= 3) {
    var turns = ["LEFT", "RIGHT"];
    for (var i = 0; i < turns.length; i++) {
      var direction = turnDir(me.tank.direction, turns[i] === "LEFT" ? -1 : 1);
      var escape = advanceTankPosition(myPos, direction, speed, game.map,
        enemyPos);
      if (!samePos(escape, myPos) &&
          !firesAt(enemyPos, enemy.tank.direction, escape, game.map)) {
        rememberProjectileEvasion(me, {
          position: enemyPos, direction: enemy.tank.direction
        }, direction, game);
        return turns[i];
      }
    }
  }
  return null;
}

function runtimeMuzzleRiskAt(position, enemy, game, targetDirection,
    targetSpeed) {
  if (!enemy.tank) return 0;
  var canFire = !enemy.status.fireLocked &&
    !currentEnemyProjectile(enemy, game);
  if (!canFire) return 0;
  if (!targetDirection) targetDirection = "up";
  if (!targetSpeed) targetSpeed = 1;
  return runtimeMuzzleRiskFrom(enemy.tank.position, enemy.tank.direction,
    position, targetDirection, targetSpeed, game.map,
    !!enemy.status.overloaded);
}

function nextAttackLaneStep(start, enemyPos, map) {
  var mapId = mapCacheId(map);
  var height = map[0] ? map[0].length : 0;
  var width = map.length;
  if (!width || !height) return null;
  var startIndex = start[0] * height + start[1];
  var enemyIndex = enemyPos[0] * height + enemyPos[1];
  var mapTable = AT_ATTACK_LANE_CACHE[mapId];
  if (!mapTable) {
    mapTable = [];
    AT_ATTACK_LANE_CACHE[mapId] = mapTable;
  }
  var startTable = mapTable[startIndex];
  if (!startTable) {
    startTable = [];
    mapTable[startIndex] = startTable;
  }
  var cached = startTable[enemyIndex];
  if (cached !== undefined) {
    return cached === false ? null : cached;
  }
  var cellCount = width * height;
  var QueueType = cellCount <= 65535 ? Uint16Array : Uint32Array;
  var queue = new QueueType(cellCount);
  var first = new QueueType(cellCount);
  var seen = new Uint8Array(cellCount);
  var tail = 1;
  queue[0] = startIndex;
  first[0] = startIndex;
  seen[startIndex] = 1;
  var pos = [start[0], start[1]];
  for (var head = 0; head < tail; head++) {
    var currentIndex = queue[head];
    var x = Math.floor(currentIndex / height);
    var y = currentIndex - x * height;
    pos[0] = x;
    pos[1] = y;
    if ((x !== start[0] || y !== start[1]) &&
        clearLine(pos, enemyPos, map)) {
      var firstIndex = first[head];
      var result = [Math.floor(firstIndex / height), firstIndex % height];
      startTable[enemyIndex] = result;
      return result;
    }
    for (var i = 0; i < 4; i++) {
      var nextX = x;
      var nextY = y;
      if (i === 0) nextY--;
      else if (i === 1) nextX++;
      else if (i === 2) nextY++;
      else nextX--;
      var nextIndex = nextX * height + nextY;
      var column = map[nextX];
      var tile = column && column[nextY];
      if (seen[nextIndex] || (tile !== "." && tile !== "o") ||
          (nextX === enemyPos[0] && nextY === enemyPos[1])) continue;
      seen[nextIndex] = 1;
      queue[tail] = nextIndex;
      first[tail] = first[head] === startIndex ? nextIndex : first[head];
      tail++;
    }
  }
  startTable[enemyIndex] = false;
  return null;
}

function actionForStep(position, direction, step) {
  var wanted = directionBetween(position, step);
  if (wanted === direction) return "GO";
  return shortTurn(direction, wanted) === "left" ? "LEFT" : "RIGHT";
}

function navigateWhenHidden(me, enemy, game) {
  var runtimeBlocker = runtimeEnemyBlockedPosition(enemy);
  var target = game.star || (enemy.tank && enemy.tank.position);
  if (target) {
    setActiveIntent(game.star ? "CHASE_STAR" : "FACE_ENEMY");
    var targetField = buildDistanceField(game.map, target);
    var clearAction = bestStrategicMoundAction(me, enemy, game, target,
      targetField);
    if (clearAction) {
      executeAction(me, clearAction, enemy, game);
      return;
    }
    var step = nextStepFromDistanceField(me.tank.position, targetField,
      game.map, runtimeBlocker);
    if (step) {
      step = stableStrategicStep(me.tank.position, step, targetField,
        game.map, runtimeBlocker);
      faceOrMove(me, enemy, game, step, targetField);
      return;
    }
  }

  setActiveIntent("EXIT_EDGE");
  executeAction(me, edgeAwarePatrolAction(me, enemy, game), enemy, game);
}

function edgeAwarePatrolAction(me, enemy, game) {
  var actions = ["GO", "LEFT", "RIGHT"];
  var bestAction = "RIGHT";
  var bestScore = -Infinity;
  var start = me.tank.position;
  var speed = me.status.boosted ? 2 : 1;
  var protectingLead = (me.stars || 0) > (enemy.stars || 0);
  var runtimeBlocker = runtimeEnemyBlockedPosition(enemy);

  for (var i = 0; i < actions.length; i++) {
    var action = actions[i];
    var direction = me.tank.direction;
    if (action === "LEFT") direction = turnDir(direction, -1);
    if (action === "RIGHT") direction = turnDir(direction, 1);

    var actual = copyPos(start);
    if (action === "GO") {
      actual = advanceTankPosition(start, direction, speed, game.map,
        runtimeBlocker);
      if (samePos(actual, start)) continue;
    }
    var projected = action === "GO" ?
      advanceTankPosition(actual, direction, speed, game.map,
        runtimeBlocker) :
      advanceTankPosition(start, direction, speed, game.map,
        runtimeBlocker);

    var score = outerEdgeDistance(actual, game.map) * 34 +
      outerEdgeDistance(projected, game.map) * 46;
    score -= edgePositionPenalty(actual, direction, game.map, null,
      protectingLead, null) * 0.65;
    score -= edgePositionPenalty(projected, direction, game.map, null,
      protectingLead, null);
    score += openNeighborCount(projected, game.map) * 24;

    if (action === "GO" && !samePos(actual, start)) score += 18;
    if (samePos(projected, action === "GO" ? actual : start)) score -= 90;
    if ((AT_LAST_ACTION === "LEFT" && action === "RIGHT") ||
        (AT_LAST_ACTION === "RIGHT" && action === "LEFT")) {
      score -= AT_TURN_REVERSAL_PENALTY;
    }
    if (action !== "GO") score -= 10 + AT_TURN_STREAK * 8;
    score -= runtimeRepetitionPenalty(actual, direction);

    if (score > bestScore ||
        (score === bestScore && actionPriority(action) >
          actionPriority(bestAction))) {
      bestScore = score;
      bestAction = action;
    }
  }
  return bestAction;
}

function bestStrategicMoundAction(me, enemy, game, target, currentField) {
  var currentDistance = distanceFromField(currentField, me.tank.position);
  var bestDirection = null;
  var bestScore = -Infinity;

  for (var i = 0; i < AT_DIRS.length; i++) {
    var direction = AT_DIRS[i];
    var ray = scanForwardRay(me.tank.position, direction, null, game.map);
    if (ray.firstObject !== "m") continue;

    var openedMap = mapWithOpenedTile(game.map, ray.position);
    var viaMound = ray.distance + manhattan(ray.position, target);
    var estimatedGain = currentDistance >= 99 ? 0 :
      Math.max(0, currentDistance - viaMound);
    var score = -50 - ray.distance * 8 +
      Math.min(180, estimatedGain * 35);
    if (currentDistance >= 99 && viaMound <=
        manhattan(me.tank.position, target) + 3) score += 220;
    score += Math.max(0, openNeighborCount(me.tank.position, openedMap) -
      openNeighborCount(me.tank.position, game.map)) * 25;

    if (enemy.tank && clearLine(me.tank.position,
        enemy.tank.position, openedMap)) score += 100;
    if (score > bestScore) {
      bestScore = score;
      bestDirection = direction;
    }
  }

  var threshold = currentDistance >= 99 ? 25 : 90;
  if (bestScore <= threshold || !bestDirection) return null;
  if (bestDirection === me.tank.direction) {
    if (!me.bullet && !me.status.fireLocked) return "FIRE";
    return null;
  }
  return shortTurn(me.tank.direction, bestDirection) === "left" ?
    "LEFT" : "RIGHT";
}

function nextStepFromDistanceField(start, field, map, blocked) {
  var current = distanceFromField(field, start);
  var best = null;
  var bestDistance = current;
  for (var i = 0; i < AT_DIRS.length; i++) {
    var next = addPos(start, dirDelta(AT_DIRS[i]));
    if (!isWalkable(next, map) || (blocked && samePos(next, blocked))) continue;
    var distance = distanceFromField(field, next);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = next;
    }
  }
  return best;
}

function runtimeActionPose(me, enemy, game, action, blocker) {
  var position = me.tank.position;
  var direction = me.tank.direction;
  if (action === "LEFT") direction = turnDir(direction, -1);
  else if (action === "RIGHT") direction = turnDir(direction, 1);
  else if (action === "GO") {
    if (blocker === undefined) blocker = runtimeEnemyBlockedPosition(enemy);
    position = advanceTankPosition(position, direction,
      me.status.boosted ? 2 : 1, game.map,
      blocker);
  }
  return { position: position, direction: direction };
}

function runtimeReversedActionPose(me, enemy, game, action, blocker) {
  var position = me.tank.position;
  var direction = me.tank.direction;
  if (action === "LEFT") direction = turnDir(direction, 1);
  else if (action === "RIGHT") direction = turnDir(direction, -1);
  else if (action === "GO") {
    if (blocker === undefined) blocker = runtimeEnemyBlockedPosition(enemy);
    position = advanceTankPosition(position, oppositeDir(direction),
      me.status.boosted ? 2 : 1, game.map, blocker);
  }
  return { position: position, direction: direction };
}

function runtimeProjectileRiskAfterAction(projectile, start, target,
    targetDirection, targetSpeed, map, blocker, action,
    movementDirection) {
  if (!projectile) return 0;
  if (!movementDirection) movementDirection = targetDirection;
  if (samePos(target, projectile.position) ||
      (action === "GO" && movementCrossesPosition(start, movementDirection,
        targetSpeed, map, blocker, projectile.position))) {
    return AT_TERMINAL_SCORE;
  }

  var x = projectile.position[0];
  var y = projectile.position[1];
  var delta = AT_DELTAS[projectile.direction];
  for (var i = 0; i < 2; i++) {
    x += delta[0];
    y += delta[1];
    var column = map[x];
    var tile = column && column[y];
    if (!tile || tile === "x" || tile === "m") return 0;
    if (x === target[0] && y === target[1]) return AT_TERMINAL_SCORE;
  }
  return projectileThreat({
    position: [x, y], direction: projectile.direction,
    damage: projectile.damage || 1, observed: true
  }, target, targetDirection, targetSpeed, map);
}

function runtimeMuzzleRiskFrom(shooter, shooterDirection, target,
    targetDirection, targetSpeed, map, overloaded) {
  var distance = manhattan(shooter, target);
  var wanted = directionToAligned(shooter, target);
  var lineOpen = wanted ? clearLine(shooter, target, map) : false;
  var exactRisk = 0;
  if (wanted === shooterDirection && lineOpen) {
    exactRisk = runtimeProjectileRiskAfterAction({
      position: shooter, direction: shooterDirection,
      damage: 1, observed: true
    }, target, target, targetDirection, targetSpeed, map, null, "WAIT");
  }
  if (overloaded) {
    var secondary = overloadSecondaryOrigin(shooter, shooterDirection);
    var secondaryWanted = directionToAligned(secondary, target);
    if (secondaryWanted === shooterDirection &&
        clearLine(secondary, target, map)) {
      exactRisk = Math.max(exactRisk, runtimeProjectileRiskAfterAction({
        position: secondary, direction: shooterDirection,
        damage: 1, observed: true
      }, target, target, targetDirection, targetSpeed, map, null, "WAIT"));
    }
  }
  return Math.max(exactRisk, muzzleRiskScore(shooter, shooterDirection,
    target, map, true, false, targetDirection, targetSpeed, wanted,
    lineOpen, distance, overloaded));
}

function runtimeCandidateMuzzleRisk(me, enemy, game, target,
    targetDirection, enemyProjectile) {
  if (enemy.status.fireLocked || enemyProjectile ||
      enemy.status.canActThisFrame === false || enemy.status.frozen) return 0;
  var targetSpeed = me.status.boosted ? 2 : 1;
  var risk = 0;
  if (enemy.tank) {
    var enemyPos = enemy.tank.position;
    var enemyDir = enemy.tank.direction;
    risk = runtimeMuzzleRiskFrom(enemyPos, enemyDir, target,
      targetDirection, targetSpeed, game.map, !!enemy.status.overloaded);
    if (risk >= AT_TERMINAL_SCORE) return risk;
    if (enemy.status.boosted) {
      risk = Math.max(risk, runtimeMuzzleRiskFrom(enemyPos,
        turnDir(enemyDir, -1), target, targetDirection, targetSpeed,
        game.map, !!enemy.status.overloaded));
      if (risk >= AT_TERMINAL_SCORE) return risk;
      risk = Math.max(risk, runtimeMuzzleRiskFrom(enemyPos,
        turnDir(enemyDir, 1), target, targetDirection, targetSpeed,
        game.map, !!enemy.status.overloaded));
      if (risk >= AT_TERMINAL_SCORE) return risk;
    }

    // One-step trap check: do not enter a tile from which an ordinary enemy
    // advance creates a next-frame muzzle with no one-action escape.
    var enemyNext = advanceTankPosition(enemyPos, enemyDir,
      enemy.status.boosted ? 2 : 1, game.map, me.tank.position);
    if (!samePos(enemyNext, enemyPos)) {
      var trapRisk = runtimeMuzzleRiskFrom(enemyNext, enemyDir, target,
        targetDirection, targetSpeed, game.map, !!enemy.status.overloaded);
      if (trapRisk >= 50000) risk = Math.max(risk, 35000);
      else risk = Math.max(risk, trapRisk * 0.65);
    }
    return risk;
  }

  for (var i = 0; i < AT_HIDDEN_ENEMY_BELIEF.length; i++) {
    var candidate = AT_HIDDEN_ENEMY_BELIEF[i];
    risk = Math.max(risk, runtimeMuzzleRiskFrom(candidate.position,
      candidate.direction, target, targetDirection, targetSpeed, game.map,
      !!enemy.status.overloaded));
    if (risk >= AT_TERMINAL_SCORE) return risk;
    var next = advanceTankPosition(candidate.position, candidate.direction,
      enemy.status.boosted ? 2 : 1, game.map, me.tank.position);
    if (!samePos(next, candidate.position)) {
      var hiddenTrap = runtimeMuzzleRiskFrom(next, candidate.direction,
        target, targetDirection, targetSpeed, game.map,
        !!enemy.status.overloaded);
      if (hiddenTrap >= 50000) risk = Math.max(risk, 35000);
      else risk = Math.max(risk, hiddenTrap * 0.65);
      if (risk >= AT_TERMINAL_SCORE) return risk;
    }
  }
  if (AT_HIDDEN_ENEMY_MODE === 2 && AT_HIDDEN_GRASS_REGION) {
    risk = Math.max(risk, runtimeGrassRegionMuzzleRisk(target,
      targetDirection, targetSpeed, game.map));
  }
  return risk;
}

function runtimeCloakProjectileRiskAfterAction(me, game, action, pose,
    blocker) {
  if (!AT_CLOAK_PROJECTILE_BELIEF.length) return 0;
  var speed = me.status.boosted ? 2 : 1;
  var risk = 0;
  for (var i = 0; i < AT_CLOAK_PROJECTILE_BELIEF.length; i++) {
    risk = Math.max(risk, runtimeProjectileRiskAfterAction(
      AT_CLOAK_PROJECTILE_BELIEF[i], me.tank.position, pose.position,
      pose.direction, speed, game.map, blocker, action));
    if (risk >= AT_TERMINAL_SCORE) return risk;
  }
  return risk;
}

function runtimeOverloadProjectileRiskAfterAction(me, game, action, pose,
    blocker, primary) {
  if (!AT_OVERLOAD_PROJECTILE_TRACKS.length) return 0;
  var speed = me.status.boosted ? 2 : 1;
  var frame = game && typeof game.frames === "number" ? game.frames : 0;
  var risk = 0;
  for (var i = 0; i < AT_OVERLOAD_PROJECTILE_TRACKS.length; i++) {
    var track = AT_OVERLOAD_PROJECTILE_TRACKS[i];
    if (track.projectedFrame !== frame || frame - track.seenFrame >
        AT_OVERLOAD_PROJECTILE_TRACK_MAX_AGE) continue;
    if (primary && samePos(primary.position, track.position) &&
        primary.direction === track.direction) continue;
    risk = Math.max(risk, runtimeProjectileRiskAfterAction(track,
      me.tank.position, pose.position, pose.direction, speed, game.map,
      blocker, action));
    if (risk >= AT_TERMINAL_SCORE) return risk;
  }
  return risk;
}

function runtimeOverloadPairForcedRiskAfterAction(me, game, action, pose,
    blocker, primary) {
  var frame = game && typeof game.frames === "number" ? game.frames : 0;
  var pair = [];
  if (primary) pair.push(primary);
  for (var i = 0; i < AT_OVERLOAD_PROJECTILE_TRACKS.length &&
      pair.length < 2; i++) {
    var track = AT_OVERLOAD_PROJECTILE_TRACKS[i];
    if (track.projectedFrame !== frame || frame - track.seenFrame >
        AT_OVERLOAD_PROJECTILE_TRACK_MAX_AGE) continue;
    if (primary && samePos(primary.position, track.position) &&
        primary.direction === track.direction) continue;
    pair.push(track);
  }
  if (pair.length < 2 || pair[0].direction !== pair[1].direction) return 0;

  // Individual projectile scoring can call either parallel lane a valid
  // lateral escape even when that tile is occupied by the other Overload
  // projectile. Project both bullets one frame, then require at least one
  // concrete next action that remains non-terminal against the pair.
  var projected = [];
  for (var j = 0; j < 2; j++) {
    var position = advanceTrackedProjectile(pair[j].position,
      pair[j].direction, game.map);
    if (!position) return 0;
    projected.push({
      position: position,
      direction: pair[j].direction,
      damage: 1,
      observed: true
    });
  }

  var speed = me.status.boosted ? 2 : 1;
  var nextActions = ["GO", "LEFT", "RIGHT"];
  for (var actionIndex = 0; actionIndex < nextActions.length; actionIndex++) {
    var nextAction = nextActions[actionIndex];
    var nextDirection = pose.direction;
    var nextPosition = pose.position;
    if (nextAction === "LEFT") nextDirection = turnDir(nextDirection, -1);
    else if (nextAction === "RIGHT") {
      nextDirection = turnDir(nextDirection, 1);
    } else {
      nextPosition = advanceTankPosition(pose.position, pose.direction,
        speed, game.map, blocker);
    }
    var nextRisk = 0;
    for (var projectileIndex = 0; projectileIndex < 2;
        projectileIndex++) {
      nextRisk = Math.max(nextRisk, runtimeProjectileRiskAfterAction(
        projected[projectileIndex], pose.position, nextPosition,
        nextDirection, speed, game.map, blocker, nextAction));
    }
    // 50000 is projectileThreat's exact "escape actions exceed arrival"
    // class; 35000 still has zero slack but is physically survivable.
    if (nextRisk < 50000) return 0;
  }
  return AT_TERMINAL_SCORE;
}

function runtimeHiddenOccupancyRisk(me, game, action, pose, blocker) {
  if (action !== "GO" || AT_HIDDEN_ENEMY_MODE !== 1 ||
      !AT_HIDDEN_ENEMY_BELIEF.length) return 0;
  var speed = me.status.boosted ? 2 : 1;
  for (var i = 0; i < AT_HIDDEN_ENEMY_BELIEF.length; i++) {
    var occupied = AT_HIDDEN_ENEMY_BELIEF[i].position;
    if (samePos(pose.position, occupied) ||
        movementCrossesPosition(me.tank.position, me.tank.direction,
          speed, game.map, blocker, occupied)) {
      return AT_TERMINAL_SCORE;
    }
  }
  return 0;
}

function cloakTerminalThreatCount(start, target, targetDirection, action,
    speed, map, blocker) {
  var count = 0;
  for (var projectileIndex = 0;
      projectileIndex < AT_CLOAK_PROJECTILE_BELIEF.length;
      projectileIndex++) {
    if (runtimeProjectileRiskAfterAction(
        AT_CLOAK_PROJECTILE_BELIEF[projectileIndex], start, target,
        targetDirection, speed, map, blocker, action) >= AT_TERMINAL_SCORE) {
      count++;
    }
  }
  for (var candidateIndex = 0;
      candidateIndex < AT_HIDDEN_ENEMY_BELIEF.length; candidateIndex++) {
    var candidate = AT_HIDDEN_ENEMY_BELIEF[candidateIndex];
    if (runtimeMuzzleRiskFrom(candidate.position, candidate.direction,
        target, targetDirection, speed, map, false) >= AT_TERMINAL_SCORE) {
      count++;
    }
  }
  return count;
}

function cloakPreparedThreatCount(start, target, targetDirection, speed,
    map) {
  var count = 0;
  for (var projectileIndex = 0;
      projectileIndex < AT_CLOAK_PROJECTILE_BELIEF.length;
      projectileIndex++) {
    if (runtimeProjectileRiskAfterAction(
        AT_CLOAK_PROJECTILE_BELIEF[projectileIndex], start, target,
        targetDirection, speed, map, null, "GO") >= 35000) count++;
  }

  // Before our prepared GO executes, the hidden enemy gets one action to
  // advance or rotate. Score every unique resulting muzzle. This captures
  // GO -> turn -> FIRE preparations without expanding the general Minimax.
  var seen = [];
  for (var candidateIndex = 0;
      candidateIndex < AT_HIDDEN_ENEMY_BELIEF.length; candidateIndex++) {
    var candidate = AT_HIDDEN_ENEMY_BELIEF[candidateIndex];
    var positions = [candidate.position, candidate.position,
      candidate.position, advanceTankPosition(candidate.position,
        candidate.direction, 1, map, start)];
    var directions = [candidate.direction,
      turnDir(candidate.direction, -1),
      turnDir(candidate.direction, 1), candidate.direction];
    for (var actionIndex = 0; actionIndex < 4; actionIndex++) {
      var position = positions[actionIndex];
      var direction = directions[actionIndex];
      var key = positionCode(position) * 4 + AT_DIR_INDEX[direction];
      if (seen[key]) continue;
      seen[key] = 1;
      if (runtimeMuzzleRiskFrom(position, direction, target,
          targetDirection, speed, map, false) >= 35000) count++;
    }
  }
  return count;
}

function cloakActionTieScore(me, game, action, pose, blocker) {
  if (AT_HIDDEN_ENEMY_MODE !== 1) return 0;
  var speed = me.status.boosted ? 2 : 1;
  var immediate = cloakTerminalThreatCount(me.tank.position,
    pose.position, pose.direction, action, speed, game.map, blocker);
  if (action === "GO" && runtimeHiddenOccupancyRisk(me, game, action,
      pose, blocker) >= AT_TERMINAL_SCORE) immediate++;

  // A turn is valuable when it prepares a real lateral GO on the next frame.
  // Compare that future exit even when every current action has the same
  // worst-case risk; this prevents the old "all 100000 => requested GO" trap.
  var future = advanceTankPosition(pose.position, pose.direction, speed,
    game.map, null);
  var futureThreats = 999;
  if (!samePos(future, pose.position)) {
    futureThreats = cloakPreparedThreatCount(pose.position, future,
      pose.direction, speed, game.map);
  }
  var score = -immediate * 20000 - futureThreats * 1200;
  if (futureThreats === 0) score += 12000;
  if (action === "GO") score -= 120;
  return score;
}

function runtimeActionRisk(me, enemy, game, action, enemyProjectile,
    bombs, pose, blocker) {
  if (!pose) pose = runtimeActionPose(me, enemy, game, action);
  if (action === "GO" && samePos(pose.position, me.tank.position)) {
    return 50000;
  }
  var speed = me.status.boosted ? 2 : 1;
  if (blocker === undefined) blocker = runtimeEnemyBlockedPosition(enemy);
  var occupancyRisk = runtimeHiddenOccupancyRisk(me, game, action, pose,
    blocker);
  if (occupancyRisk >= AT_TERMINAL_SCORE) return occupancyRisk;
  var risk = runtimeProjectileRiskAfterAction(enemyProjectile,
    me.tank.position, pose.position, pose.direction, speed, game.map,
    blocker, action);
  if (risk >= AT_TERMINAL_SCORE) return risk;
  risk = Math.max(risk, runtimeOverloadProjectileRiskAfterAction(me, game,
    action, pose, blocker, enemyProjectile));
  if (risk >= AT_TERMINAL_SCORE) return risk;
  risk = Math.max(risk, runtimeOverloadPairForcedRiskAfterAction(me, game,
    action, pose, blocker, enemyProjectile));
  if (risk >= AT_TERMINAL_SCORE) return risk;
  risk = Math.max(risk, runtimeCloakProjectileRiskAfterAction(me, game,
    action, pose, blocker));
  if (risk >= AT_TERMINAL_SCORE) return risk;
  risk = Math.max(risk, runtimeCandidateMuzzleRisk(me, enemy, game,
    pose.position, pose.direction, enemyProjectile));
  if (bombs && bombs.length) {
    risk = Math.max(risk,
      runtimeBombCandidateRisk(me, enemy, game, bombs, action));
  }

  // Stun may reverse GO or a turn after the command is chosen. The final
  // guard must score both physical outcomes; Minimax already models this
  // uncertainty, but direct-return shortcuts reach this guard without a
  // search state.
  if (me.status.stunned &&
      (action === "GO" || action === "LEFT" || action === "RIGHT")) {
    var reversedPose = runtimeReversedActionPose(me, enemy, game, action,
      blocker);
    var reversedMovementDirection = action === "GO" ?
      oppositeDir(me.tank.direction) : reversedPose.direction;
    var reversedRisk = action === "GO" &&
      samePos(reversedPose.position, me.tank.position) ? 50000 :
      runtimeProjectileRiskAfterAction(enemyProjectile,
        me.tank.position, reversedPose.position, reversedPose.direction,
        speed, game.map, blocker, action, reversedMovementDirection);
    if (reversedRisk < AT_TERMINAL_SCORE) {
      reversedRisk = Math.max(reversedRisk,
        runtimeCandidateMuzzleRisk(me, enemy, game,
          reversedPose.position, reversedPose.direction, enemyProjectile));
    }
    if (bombs && bombs.length) {
      var reversedAction = action === "LEFT" ? "RIGHT" :
        action === "RIGHT" ? "LEFT" : null;
      if (reversedAction) {
        reversedRisk = Math.max(reversedRisk,
          runtimeBombCandidateRisk(me, enemy, game, bombs, reversedAction));
      }
    }
    risk = Math.max(risk, reversedRisk);
  }
  return risk;
}

function favorableImmediateRuntimeFire(me, enemy, game, action) {
  if (action !== "FIRE" || me.bullet ||
      me.status.fireLocked || enemy.status.shielded ||
      (me.stars || 0) <= (enemy.stars || 0)) return false;
  if (!enemy.tank) {
    if (AT_HIDDEN_ENEMY_MODE !== 1) return false;
    for (var i = 0; i < AT_HIDDEN_ENEMY_BELIEF.length; i++) {
      var candidate = AT_HIDDEN_ENEMY_BELIEF[i];
      var distance = manhattan(me.tank.position, candidate.position);
      if (distance <= 2 &&
          directionToAligned(me.tank.position, candidate.position) ===
            me.tank.direction &&
          directionToAligned(candidate.position, me.tank.position) ===
            candidate.direction &&
          clearLine(me.tank.position, candidate.position, game.map)) {
        return true;
      }
    }
    return false;
  }
  var ray = scanForwardRay(me.tank.position, me.tank.direction,
    enemy.tank.position, game.map);
  return ray.firstObject === "enemy" && ray.distance <= 2;
}

function unfavorableImmediateRuntimeFire(me, enemy, game, action) {
  if (action !== "FIRE" || me.bullet || me.status.fireLocked ||
      !enemy.tank || (me.stars || 0) > (enemy.stars || 0)) return false;
  var enemyProjectile = currentEnemyProjectile(enemy, game);
  if (enemyProjectile || enemy.status.fireLocked) return false;
  var myArrival = attackArrivalFrames(me.tank.position, me.tank.direction,
    enemy.tank.position, game.map, true, !!me.status.boosted,
    !!enemy.status.shielded);
  if (myArrival >= 99) return false;
  var enemyArrival = attackArrivalFrames(enemy.tank.position,
    enemy.tank.direction, me.tank.position, game.map, true,
    !!enemy.status.boosted, !!me.status.shielded);
  return enemyArrival <= myArrival;
}

function saferRuntimeAction(me, enemy, game, requested) {
  var projectile = currentEnemyProjectile(enemy, game);
  var overloadState = enemy.tank && enemy.status.overloaded &&
    !projectile && !enemy.status.fireLocked ?
    makeSearchState(me, enemy, game) : null;
  var blocker = runtimeEnemyBlockedPosition(enemy);
  var bombs = game.bombs && game.bombs.length ?
    normalizeVisibleBombs(game.bombs,
      typeof game.frames === "number" ? game.frames : 0) : null;
  var requestedPose = runtimeActionPose(me, enemy, game, requested, blocker);
  var requestedRisk = runtimeActionRisk(me, enemy, game, requested,
    projectile, bombs, requestedPose, blocker);
  if (overloadState && overloadForcesNextFrameLoss(
      overloadState, requested)) requestedRisk = AT_TERMINAL_SCORE;
  if (unfavorableImmediateRuntimeFire(me, enemy, game, requested)) {
    requestedRisk = Math.max(requestedRisk, AT_TERMINAL_SCORE);
  }

  // Final two-state lock breaker. Search/history scoring can be bypassed by a
  // direct shortcut or by this safety layer itself. Once three pure turns
  // have already executed, a fourth requested turn yields to a physically
  // possible GO whenever both normal and stun-reversed outcomes stay below
  // the hard danger threshold.
  if (AT_TURN_STREAK >= 3 &&
      (requested === "LEFT" || requested === "RIGHT")) {
    var breakPose = runtimeActionPose(me, enemy, game, "GO", blocker);
    if (!samePos(breakPose.position, me.tank.position)) {
      var breakRisk = runtimeActionRisk(me, enemy, game, "GO",
        projectile, bombs, breakPose, blocker);
      if (overloadState && overloadForcesNextFrameLoss(
          overloadState, "GO")) breakRisk = AT_TERMINAL_SCORE;
      if (breakRisk < 35000) return "GO";
    }
  }

  if ((requestedRisk < 35000 && AT_HIDDEN_ENEMY_MODE !== 1) ||
      favorableImmediateRuntimeFire(me, enemy, game, requested)) {
    return requested;
  }

  var candidates = ["GO", "LEFT", "RIGHT"];
  var bestAction = requested;
  var bestRisk = requestedRisk;
  var bestScore = -Infinity;
  var cloakSelection = AT_HIDDEN_ENEMY_MODE === 1;
  var bestRiskClass = 3;
  for (var i = 0; i < candidates.length; i++) {
    var candidate = candidates[i];
    var pose = runtimeActionPose(me, enemy, game, candidate, blocker);
    if (candidate === "GO" && samePos(pose.position, me.tank.position)) {
      continue;
    }
    var risk = runtimeActionRisk(me, enemy, game, candidate, projectile,
      bombs, pose, blocker);
    if (overloadState && overloadForcesNextFrameLoss(
        overloadState, candidate)) risk = AT_TERMINAL_SCORE;
    var score = -risk;
    if (candidate === requested) score += 180;
    if (candidate === "GO") score += 25;
    score += cloakActionTieScore(me, game, candidate, pose, blocker);
    if ((AT_LAST_ACTION === "LEFT" && candidate === "RIGHT") ||
        (AT_LAST_ACTION === "RIGHT" && candidate === "LEFT")) {
      score -= AT_TURN_REVERSAL_PENALTY;
    }
    score -= runtimeRepetitionPenalty(pose.position, pose.direction);
    score -= edgePositionPenalty(pose.position, pose.direction, game.map,
      enemy.tank && enemy.tank.position,
      (me.stars || 0) > (enemy.stars || 0), game.star) * 0.2;
    if (game.star) score -= manhattan(pose.position, game.star) * 2;
    var riskClass = risk >= AT_TERMINAL_SCORE ? 2 : risk >= 35000 ? 1 : 0;
    if ((cloakSelection && (riskClass < bestRiskClass ||
        (riskClass === bestRiskClass && score > bestScore))) ||
        (!cloakSelection && (risk < bestRisk ||
        (risk === bestRisk && score > bestScore)))) {
      bestRisk = risk;
      bestScore = score;
      bestAction = candidate;
      bestRiskClass = riskClass;
    }
  }
  if (cloakSelection) return bestAction;
  if (bestRisk < requestedRisk) return bestAction;
  return requested;
}

function executeAction(me, action, enemy, game) {
  var resolved = action;
  if (action === "STUN" && !(me.skill.type === "stun" &&
      me.skill.remainingCooldownFrames === 0)) resolved = "RIGHT";
  if (action === "BOMB" && (me.status.bombActive ||
      (typeof me.status.bombCooldownFrames === "number" &&
        me.status.bombCooldownFrames > 0))) resolved = "RIGHT";
  if (enemy && game) resolved = saferRuntimeAction(me, enemy, game, resolved);

  if (resolved === "LEFT" || resolved === "RIGHT") {
    AT_TURN_STREAK = (AT_LAST_ACTION === "LEFT" ||
      AT_LAST_ACTION === "RIGHT") ? AT_TURN_STREAK + 1 : 1;
  } else {
    AT_TURN_STREAK = 0;
  }
  AT_LAST_ACTION = resolved;
  if (AT_ACTIVE_HISTORY_RECORD) {
    AT_ACTIVE_HISTORY_RECORD.action = resolved;
    if (AT_ACTIVE_HISTORY_RECORD.intent) {
      AT_LAST_INTENT = AT_ACTIVE_HISTORY_RECORD.intent;
      AT_LAST_INTENT_EPOCH = AT_ACTIVE_HISTORY_RECORD.epoch;
    }
  }

  if (resolved === "GO") me.go();
  else if (resolved === "LEFT") me.turn("left");
  else if (resolved === "RIGHT") me.turn("right");
  else if (resolved === "FIRE") me.fire();
  else if (resolved === "STUN") me.stun();
  else if (resolved === "BOMB") me.throwBomb();
  else me.turn("right");
}

function stableStrategicStep(start, candidate, field, map, blocked) {
  var positionKey = positionCode(start);
  if (AT_STRATEGIC_POSITION_KEY === positionKey &&
      AT_STRATEGIC_EPOCH === AT_CONTEXT_EPOCH &&
      AT_STRATEGIC_WANTED_DIR) {
    var retained = addPos(start, AT_DELTAS[AT_STRATEGIC_WANTED_DIR]);
    if (isWalkable(retained, map) &&
        (!blocked || !samePos(retained, blocked)) &&
        distanceFromField(field, retained) < distanceFromField(field, start)) {
      return retained;
    }
  }
  AT_STRATEGIC_POSITION_KEY = positionKey;
  AT_STRATEGIC_WANTED_DIR = directionBetween(start, candidate);
  AT_STRATEGIC_EPOCH = AT_CONTEXT_EPOCH;
  return candidate;
}

function runtimeRepetitionPenalty(position, direction) {
  var key = physicalStateKey(position, direction);
  for (var offset = 0; offset < AT_HISTORY_COUNT; offset++) {
    var distance = offset + 1;
    var penalty = repetitionPenaltyForDistance(distance);
    if (penalty <= 0) continue;
    var record = recentHistoryRecord(offset);
    if (record && record.key === key) {
      return record.epoch === AT_CONTEXT_EPOCH ? penalty : penalty * 0.5;
    }
  }
  return 0;
}

function faceOrMove(me, enemy, game, next, targetField) {
  var wanted = directionBetween(me.tank.position, next);
  var actions = ["GO", "LEFT", "RIGHT"];
  var currentDistance = distanceFromField(targetField, me.tank.position);
  var runtimeBlocker = runtimeEnemyBlockedPosition(enemy);
  var bestAction = null;
  var bestScore = -Infinity;
  for (var i = 0; i < actions.length; i++) {
    var action = actions[i];
    var direction = me.tank.direction;
    var position = me.tank.position;
    if (action === "LEFT") direction = turnDir(direction, -1);
    if (action === "RIGHT") direction = turnDir(direction, 1);
    if (action === "GO") {
      position = advanceTankPosition(position, direction,
        me.status.boosted ? 2 : 1, game.map,
        runtimeBlocker);
      if (samePos(position, me.tank.position)) continue;
    }

    var afterDistance = distanceFromField(targetField, position);
    var score = (currentDistance - afterDistance) * 220;
    if (direction === wanted) score += 100;
    else score -= quarterTurns(direction, wanted) * 55;
    if (action === "GO") score += 30;
    else score -= 10 + AT_TURN_STREAK * 8;
    if ((AT_LAST_ACTION === "LEFT" && action === "RIGHT") ||
        (AT_LAST_ACTION === "RIGHT" && action === "LEFT")) {
      score -= AT_TURN_REVERSAL_PENALTY;
    }
    score -= runtimeRepetitionPenalty(position, direction);
    if (enemy.tank) {
      score -= Math.min(500, runtimeMuzzleRiskAt(position, enemy, game,
        direction, me.status.boosted ? 2 : 1));
    }
    if (score > bestScore ||
        (score === bestScore && actionPriority(action) >
          actionPriority(bestAction))) {
      bestScore = score;
      bestAction = action;
    }
  }
  executeAction(me, bestAction || (shortTurn(me.tank.direction, wanted) ===
    "left" ? "LEFT" : "RIGHT"), enemy, game);
}

function nextPathStep(start, goal, map, blocked) {
  var queue = [{ pos: copyPos(start), first: null }];
  var seen = {};
  seen[posKey(start)] = true;
  for (var head = 0; head < queue.length; head++) {
    var item = queue[head];
    if (samePos(item.pos, goal)) return item.first;
    for (var i = 0; i < AT_DIRS.length; i++) {
      var next = addPos(item.pos, dirDelta(AT_DIRS[i]));
      var key = posKey(next);
      if (seen[key] || !isWalkable(next, map) ||
          (blocked && samePos(next, blocked))) continue;
      seen[key] = true;
      queue.push({ pos: next, first: item.first || next });
    }
  }
  return null;
}

function buildDistanceField(map, goal) {
  if (!goal) return null;
  var width = map.length;
  var height = map[0] ? map[0].length : 0;
  if (!width || !height) return null;
  var mapId = mapCacheId(map);
  var goalIndex = goal[0] * height + goal[1];
  var table = AT_DISTANCE_FIELD_CACHE[mapId];
  if (!table) {
    table = [];
    AT_DISTANCE_FIELD_CACHE[mapId] = table;
  }
  if (table[goalIndex]) return table[goalIndex];

  var cellCount = width * height;
  var values = new Uint16Array(cellCount);
  var field = { values: values, height: height };
  if (!isWalkable(goal, map)) {
    table[goalIndex] = field;
    return field;
  }
  var QueueType = cellCount <= 65535 ? Uint16Array : Uint32Array;
  var queue = new QueueType(cellCount);
  var tail = 1;
  queue[0] = goalIndex;
  values[goalIndex] = 1;
  for (var head = 0; head < tail; head++) {
    var currentIndex = queue[head];
    var x = Math.floor(currentIndex / height);
    var y = currentIndex - x * height;
    var nextDistance = values[currentIndex] + 1;
    for (var i = 0; i < 4; i++) {
      var nextX = x;
      var nextY = y;
      if (i === 0) nextY--;
      else if (i === 1) nextX++;
      else if (i === 2) nextY++;
      else nextX--;
      var nextIndex = nextX * height + nextY;
      var column = map[nextX];
      var tile = column && column[nextY];
      if (values[nextIndex] || (tile !== "." && tile !== "o")) {
        continue;
      }
      values[nextIndex] = nextDistance;
      queue[tail++] = nextIndex;
    }
  }
  table[goalIndex] = field;
  return field;
}

function cloneState(state) {
  return {
    map: state.map,
    star: state.star,
    starDistance: state.starDistance,
    myPos: state.myPos,
    myDir: state.myDir,
    enemyPos: state.enemyPos,
    enemyDir: state.enemyDir,
    myStars: state.myStars,
    enemyStars: state.enemyStars,
    myCanFire: state.myCanFire,
    enemyCanFire: state.enemyCanFire,
    myFireLockedFrames: state.myFireLockedFrames,
    enemyFireLockedFrames: state.enemyFireLockedFrames,
    myProjectile: cloneProjectile(state.myProjectile),
    myProjectile2: cloneProjectile(state.myProjectile2),
    enemyProjectile: cloneProjectile(state.enemyProjectile),
    enemyProjectile2: cloneProjectile(state.enemyProjectile2),
    myMoveSpeed: state.myMoveSpeed,
    enemyMoveSpeed: state.enemyMoveSpeed,
    myBoosted: state.myBoosted,
    enemyBoosted: state.enemyBoosted,
    myBoostFrames: state.myBoostFrames,
    enemyBoostFrames: state.enemyBoostFrames,
    stunReady: state.stunReady,
    enemyStunned: state.enemyStunned,
    myStunned: state.myStunned,
    myFrozen: state.myFrozen,
    enemyFrozen: state.enemyFrozen,
    myPoisoned: state.myPoisoned,
    enemyPoisoned: state.enemyPoisoned,
    myCanActNow: state.myCanActNow,
    enemyCanActNow: state.enemyCanActNow,
    myShielded: state.myShielded,
    enemyShielded: state.enemyShielded,
    myShieldHits: state.myShieldHits,
    enemyShieldHits: state.enemyShieldHits,
    myShieldFrames: state.myShieldFrames,
    enemyShieldFrames: state.enemyShieldFrames,
    myOverloaded: state.myOverloaded,
    enemyOverloaded: state.enemyOverloaded,
    myOverloadFrames: state.myOverloadFrames,
    enemyOverloadFrames: state.enemyOverloadFrames,
    myCloaked: state.myCloaked,
    enemyCloaked: state.enemyCloaked,
    enemySkillType: state.enemySkillType,
    enemySkillReady: state.enemySkillReady,
    enemySkillCooldown: state.enemySkillCooldown,
    myBombReady: state.myBombReady,
    bombs: state.bombs,
    enemyStationaryStreak: state.enemyStationaryStreak,
    frame: state.frame,
    actionScore: state.actionScore,
    repetitionPenalty: state.repetitionPenalty,
    repeatReliefPenalty: state.repeatReliefPenalty,
    repeatReferenceValue: state.repeatReferenceValue,
    simPathKey1: state.simPathKey1,
    simPathKey2: state.simPathKey2,
    simPathKey3: state.simPathKey3,
    simPathDepth: state.simPathDepth,
    contextEpoch: state.contextEpoch,
    searchPly: state.searchPly + 1,
    proposedIntent: state.proposedIntent,
    committedIntent: state.committedIntent,
    lastMyAction: state.lastMyAction,
    myTurnStreak: state.myTurnStreak,
    myDead: state.myDead,
    enemyDead: state.enemyDead
  };
}

function fireUtility(state, forMe) {
  var cacheName = forMe ? "_myFireUtility" : "_enemyFireUtility";
  if (state[cacheName] !== undefined) return state[cacheName];
  if ((forMe && state.enemyCloaked > 0) ||
      (!forMe && state.myCloaked > 0)) {
    state[cacheName] = -Infinity;
    return state[cacheName];
  }
  var shooter = forMe ? state.myPos : state.enemyPos;
  var direction = forMe ? state.myDir : state.enemyDir;
  var target = forMe ? state.enemyPos : state.myPos;
  var targetDirection = forMe ? state.enemyDir : state.myDir;
  var ray = scanForwardRay(shooter, direction, target, state.map);
  var overloaded = forMe ? state.myOverloaded : state.enemyOverloaded;
  if (overloaded && ray.firstObject !== "enemy") {
    var secondaryRay = scanForwardRay(overloadSecondaryOrigin(shooter,
      direction), direction, target, state.map);
    if (secondaryRay.firstObject === "enemy") ray = secondaryRay;
  }

  // If a shot disappeared while we stayed in the same physical state and no
  // target or mound is now on the ray, repeating it can only recreate the
  // fixed wall-fire loop observed in mat_LjZo and mat_7no.
  if (forMe && state.lastMyAction === "FIRE" && state.myCanFire &&
      ray.firstObject !== "enemy" && ray.firstObject !== "m") {
    state[cacheName] = -Infinity;
    return state[cacheName];
  }

  if (ray.firstObject === "enemy") {
    if (forMe && state.enemyShielded) {
      state[cacheName] = -Infinity;
      return state[cacheName];
    }
    state[cacheName] = 260 + Math.max(0, 120 - ray.distance * 10) +
      longRangeHitScore(state, forMe);
    return state[cacheName];
  }
  var interceptScore = predictiveInterceptUtility(state, forMe);
  if (ray.firstObject !== "m") {
    state[cacheName] = interceptScore;
    return state[cacheName];
  }

  var openedMap = mapWithOpenedTile(state.map, ray.position);
  var score = -50 - ray.distance * 8;
  var openedRay = scanForwardRay(shooter, direction, target, openedMap);
  if (openedRay.firstObject === "enemy") score += 180;

  if (state.star) {
    var beforeShooter = distanceFromField(state.starDistance, shooter);
    var beforeTarget = distanceFromField(state.starDistance, target);
    var shooterViaMound = ray.distance + manhattan(ray.position, state.star);
    var targetViaMound = manhattan(target, ray.position) +
      manhattan(ray.position, state.star);
    if (beforeShooter >= 99 && shooterViaMound <=
        manhattan(shooter, state.star) + 3) score += 180;
    else score += Math.min(140,
      Math.max(0, beforeShooter - shooterViaMound) * 35);
    score -= Math.min(120,
      Math.max(0, beforeTarget - targetViaMound) * 40);
  }

  score += Math.max(0, openNeighborCount(shooter, openedMap) -
    openNeighborCount(shooter, state.map)) * 25;
  if (firesAt(target, targetDirection, shooter, state.map)) score -= 120;
  state[cacheName] = Math.max(score, interceptScore);
  return state[cacheName];
}

function scanForwardRay(start, direction, target, map, mapId) {
  if (mapId === undefined) mapId = mapCacheId(map);
  var directionIndex = AT_DIR_INDEX[direction];
  var startCode = positionCode(start);
  var staticKey = startCode * 4 + directionIndex;
  var targetTable = null;
  var targetKey = null;
  if (target) {
    targetTable = AT_TARGET_RAY_CACHE[mapId];
    if (!targetTable) {
      targetTable = {};
      AT_TARGET_RAY_CACHE[mapId] = targetTable;
    }
    targetKey = staticKey * 65536 + positionCode(target);
    if (targetTable[targetKey]) return targetTable[targetKey];
  }
  var staticTable = AT_STATIC_RAY_CACHE[mapId];
  if (!staticTable) {
    staticTable = [];
    AT_STATIC_RAY_CACHE[mapId] = staticTable;
  }
  var staticRay = staticTable[staticKey];
  if (!staticRay) {
    var x = start[0];
    var y = start[1];
    var delta = AT_DELTAS[direction];
    for (var staticDistance = 1; staticDistance <= 64; staticDistance++) {
      x += delta[0];
      y += delta[1];
      var column = map[x];
      var tile = column && column[y];
      if (!tile) {
        staticRay = {
          firstObject: "boundary", position: [x, y],
          distance: staticDistance
        };
        break;
      }
      if (tile === "x" || tile === "m") {
        staticRay = {
          firstObject: tile, position: [x, y], distance: staticDistance
        };
        break;
      }
    }
    if (!staticRay) {
      staticRay = {
        firstObject: "boundary", position: [x, y], distance: 64
      };
    }
    staticTable[staticKey] = staticRay;
  }

  if (!target) return staticRay;
  var wanted = directionToAligned(start, target);
  if (wanted !== direction) {
    targetTable[targetKey] = staticRay;
    return targetTable[targetKey];
  }
  var targetDistance = direction === "up" || direction === "down" ?
    Math.abs(target[1] - start[1]) : Math.abs(target[0] - start[0]);
  if (targetDistance >= staticRay.distance) {
    targetTable[targetKey] = staticRay;
    return targetTable[targetKey];
  }
  targetTable[targetKey] = {
    firstObject: "enemy", position: target, distance: targetDistance
  };
  return targetTable[targetKey];
}

function normalizeVisibleBombs(bombs, frame) {
  if (!Array.isArray(bombs)) return [];
  var result = [];
  for (var i = 0; i < bombs.length; i++) {
    var bomb = bombs[i] || {};
    var position = bomb.position || bomb.pos;
    if (!position || position.length < 2) continue;
    var explodeFrame = bomb.explodeFrame;
    if (typeof explodeFrame !== "number") {
      explodeFrame = bomb.explodesAtFrame;
    }
    if (typeof explodeFrame !== "number" &&
        typeof bomb.placedFrame === "number") {
      explodeFrame = bomb.placedFrame + 10;
    }
    if (typeof explodeFrame !== "number" &&
        typeof bomb.remainingFrames === "number") {
      explodeFrame = frame + bomb.remainingFrames;
    }
    if (typeof explodeFrame !== "number" &&
        typeof bomb.framesRemaining === "number") {
      explodeFrame = frame + bomb.framesRemaining;
    }
    // The runtime guide does not publish the bomb object schema. A visible
    // bomb with no timer is treated as newly seen, never as immediately fatal.
    if (typeof explodeFrame !== "number") explodeFrame = frame + 10;
    result.push({
      position: copyPos(position),
      placedFrame: typeof bomb.placedFrame === "number" ?
        bomb.placedFrame : explodeFrame - 10,
      explodeFrame: explodeFrame,
      owner: bomb.ownerId || bomb.tankId || bomb.owner || bomb.by || null
    });
  }
  return result;
}

function bombBlastEffect(position, map) {
  var mapId = mapCacheId(map);
  var table = AT_BOMB_BLAST_CACHE[mapId];
  if (!table) {
    table = [];
    AT_BOMB_BLAST_CACHE[mapId] = table;
  }
  var cacheKey = positionCode(position);
  if (table[cacheKey]) return table[cacheKey];
  var tiles = [copyPos(position)];
  var codes = {};
  var mounds = [];
  codes[positionCode(position)] = true;
  for (var i = 0; i < AT_DIRS.length; i++) {
    var delta = AT_DELTAS[AT_DIRS[i]];
    var cursor = copyPos(position);
    for (var distance = 1; distance <= 2; distance++) {
      cursor = [cursor[0] + delta[0], cursor[1] + delta[1]];
      var tile = tileAt(cursor, map);
      if (!tile || tile === "x") break;
      if (tile === "m") {
        mounds.push(copyPos(cursor));
        break;
      }
      tiles.push(copyPos(cursor));
      codes[positionCode(cursor)] = true;
    }
  }
  table[cacheKey] = {
    tiles: tiles, codes: codes, mounds: mounds
  };
  return table[cacheKey];
}

function positionInBombBlast(position, bomb, map) {
  return !!bombBlastEffect(bomb.position, map).codes[positionCode(position)];
}

function applyTankDamage(state, targetIsMe, damageType) {
  var hitsKey = targetIsMe ? "myShieldHits" : "enemyShieldHits";
  var shieldedKey = targetIsMe ? "myShielded" : "enemyShielded";
  var deadKey = targetIsMe ? "myDead" : "enemyDead";
  if (state[hitsKey] > 0) {
    state[hitsKey] = damageType === "bomb" ? 0 : state[hitsKey] - 1;
    state[shieldedKey] = state[hitsKey] > 0;
    return false;
  }
  state[deadKey] = true;
  return true;
}

function applyBombDetonations(state, detonationFrame) {
  var result = { mapChanged: false };
  if (!state.bombs || state.bombs.length === 0) return result;
  var remaining = [];
  var map = state.map;
  for (var i = 0; i < state.bombs.length; i++) {
    var bomb = state.bombs[i];
    if (bomb.explodeFrame > detonationFrame) {
      remaining.push(bomb);
      continue;
    }
    var effect = bombBlastEffect(bomb.position, map);
    if (effect.codes[positionCode(state.myPos)]) {
      applyTankDamage(state, true, "bomb");
    }
    if (effect.codes[positionCode(state.enemyPos)]) {
      applyTankDamage(state, false, "bomb");
    }
    for (var j = 0; j < effect.mounds.length; j++) {
      if (tileAt(effect.mounds[j], map) === "m") {
        map = mapWithOpenedTile(map, effect.mounds[j]);
        result.mapChanged = true;
      }
    }
  }
  if (remaining.length !== state.bombs.length) state.bombs = remaining;
  if (result.mapChanged) state.map = map;
  return result;
}

function minimumEscapeActionsFrom(position, direction, speed, map, blast,
    blocked, limit) {
  if (!blast.codes[positionCode(position)]) return 0;
  var queue = [{ position: copyPos(position), direction: direction, depth: 0 }];
  var seen = {};
  seen[physicalStateKey(position, direction)] = true;
  for (var cursor = 0; cursor < queue.length; cursor++) {
    var node = queue[cursor];
    if (node.depth >= limit) continue;
    var leftDir = turnDir(node.direction, -1);
    var rightDir = turnDir(node.direction, 1);
    var moved = advanceTankPosition(node.position, node.direction, speed,
      map, blocked);
    var candidates = [
      { position: moved, direction: node.direction },
      { position: node.position, direction: leftDir },
      { position: node.position, direction: rightDir }
    ];
    for (var i = 0; i < candidates.length; i++) {
      var candidate = candidates[i];
      if (!blast.codes[positionCode(candidate.position)]) {
        return node.depth + 1;
      }
      var key = physicalStateKey(candidate.position, candidate.direction);
      if (!seen[key]) {
        seen[key] = true;
        queue.push({
          position: copyPos(candidate.position),
          direction: candidate.direction,
          depth: node.depth + 1
        });
      }
    }
  }
  return 99;
}

function availableActionSlots(state, forMe, frames) {
  var frozen = forMe ? state.myFrozen : state.enemyFrozen;
  var poisoned = forMe ? state.myPoisoned : state.enemyPoisoned;
  var canActNow = forMe ? state.myCanActNow : state.enemyCanActNow;
  var count = 0;
  for (var frame = 0; frame < frames; frame++) {
    var canAct = canActNow && frozen <= 0 &&
      (poisoned <= 0 || poisoned % 2 === 1);
    if (canAct) count++;
    if (frozen > 0) frozen--;
    if (poisoned > 0) poisoned--;
    canActNow = true;
  }
  return count;
}

function shieldSurvivesUntilBomb(state, forMe, framesLeft) {
  var hits = forMe ? state.myShieldHits : state.enemyShieldHits;
  var shieldFrames = forMe ? state.myShieldFrames : state.enemyShieldFrames;
  return hits > 0 && shieldFrames >= framesLeft;
}

function bombDangerAtFrame(state, explodeFrame) {
  if (!state._bombDangerByFrame) state._bombDangerByFrame = {};
  if (state._bombDangerByFrame[explodeFrame]) {
    return state._bombDangerByFrame[explodeFrame];
  }
  var effect = { codes: {}, tiles: [], coveringBombs: 0 };
  for (var i = 0; i < state.bombs.length; i++) {
    var bomb = state.bombs[i];
    if (bomb.explodeFrame !== explodeFrame) continue;
    var blast = bombBlastEffect(bomb.position, state.map);
    for (var j = 0; j < blast.tiles.length; j++) {
      var code = positionCode(blast.tiles[j]);
      if (!effect.codes[code]) {
        effect.codes[code] = true;
        effect.tiles.push(blast.tiles[j]);
      }
    }
  }
  state._bombDangerByFrame[explodeFrame] = effect;
  return effect;
}

function bombsCoveringPositionAtFrame(state, position, explodeFrame) {
  var count = 0;
  for (var i = 0; i < state.bombs.length; i++) {
    if (state.bombs[i].explodeFrame === explodeFrame &&
        positionInBombBlast(position, state.bombs[i], state.map)) count++;
  }
  return count;
}

function hasForcedBombDeath(state, forMe) {
  var cacheName = forMe ? "_myForcedBombDeath" : "_enemyForcedBombDeath";
  if (state[cacheName] !== undefined) return state[cacheName];
  state[cacheName] = false;
  if (!state.bombs || state.bombs.length === 0) return false;
  var position = forMe ? state.myPos : state.enemyPos;
  var direction = forMe ? state.myDir : state.enemyDir;
  var speed = forMe ? state.myMoveSpeed : state.enemyMoveSpeed;
  var blocked = forMe ? state.enemyPos : state.myPos;
  var checkedFrames = {};
  for (var i = 0; i < state.bombs.length; i++) {
    var bomb = state.bombs[i];
    var framesLeft = bomb.explodeFrame - state.frame;
    if (checkedFrames[bomb.explodeFrame]) continue;
    checkedFrames[bomb.explodeFrame] = true;
    var danger = bombDangerAtFrame(state, bomb.explodeFrame);
    if (framesLeft < 0 || !danger.codes[positionCode(position)]) {
      continue;
    }
    var actionsUntilExplosion = framesLeft + 1;
    var coveringBombs = bombsCoveringPositionAtFrame(state, position,
      bomb.explodeFrame);
    if (coveringBombs === 1 &&
        shieldSurvivesUntilBomb(state, forMe, actionsUntilExplosion)) continue;
    if (!forMe && state.enemySkillReady &&
        (state.enemySkillType === "teleport" ||
          state.enemySkillType === "shield" ||
          (state.enemySkillType === "boost" && actionsUntilExplosion >= 2))) {
      continue;
    }
    var needed = minimumEscapeActionsFrom(position, direction, speed,
      state.map, danger, blocked,
      Math.min(10, actionsUntilExplosion));
    var available = availableActionSlots(state, forMe,
      actionsUntilExplosion);
    if (needed > available) {
      state[cacheName] = true;
      return true;
    }
  }
  return false;
}

function bombPressureScore(state, forMe) {
  var cacheName = forMe ? "_myBombPressure" : "_enemyBombPressure";
  if (state[cacheName] !== undefined) return state[cacheName];
  var score = 0;
  if (!state.bombs || state.bombs.length === 0) {
    state[cacheName] = 0;
    return 0;
  }
  var position = forMe ? state.myPos : state.enemyPos;
  var direction = forMe ? state.myDir : state.enemyDir;
  var speed = forMe ? state.myMoveSpeed : state.enemyMoveSpeed;
  var blocked = forMe ? state.enemyPos : state.myPos;
  var checkedFrames = {};
  for (var i = 0; i < state.bombs.length; i++) {
    var bomb = state.bombs[i];
    var framesLeft = bomb.explodeFrame - state.frame;
    if (checkedFrames[bomb.explodeFrame]) continue;
    checkedFrames[bomb.explodeFrame] = true;
    var danger = bombDangerAtFrame(state, bomb.explodeFrame);
    if (framesLeft < 0 || !danger.codes[positionCode(position)]) {
      continue;
    }
    var actionsUntilExplosion = framesLeft + 1;
    var coveringBombs = bombsCoveringPositionAtFrame(state, position,
      bomb.explodeFrame);
    if (coveringBombs === 1 &&
        shieldSurvivesUntilBomb(state, forMe, actionsUntilExplosion)) {
      score = Math.max(score, 900);
      continue;
    }
    var needed = minimumEscapeActionsFrom(position, direction, speed,
      state.map, danger, blocked,
      Math.min(10, actionsUntilExplosion));
    var available = availableActionSlots(state, forMe,
      actionsUntilExplosion);
    var slack = available - needed;
    var risk;
    if (slack < 0) risk = AT_TERMINAL_SCORE;
    else if (slack === 0) risk = 35000;
    else if (slack === 1) risk = 10000;
    else if (slack === 2) risk = 3500;
    else risk = Math.max(180, 1400 - slack * 180);
    var stunned = forMe ? state.myStunned : state.enemyStunned;
    if (stunned > 0 && risk < AT_TERMINAL_SCORE) risk *= 1.45;
    score = Math.max(score, risk);
  }
  state[cacheName] = score;
  return score;
}

function stateHasTerminalOutcome(state) {
  return state.myDead || state.enemyDead || hasForcedBombDeath(state, true) ||
    hasForcedBombDeath(state, false);
}

function stateIsLosingTerminal(state) {
  var myLoss = state.myDead || hasForcedBombDeath(state, true);
  var enemyLoss = state.enemyDead || hasForcedBombDeath(state, false);
  if (!myLoss) return false;
  if (!enemyLoss) return true;
  // Mutual destruction is safe only when the star tiebreak is ours. Treating
  // a tied/behind trade as safe let the root safety filter choose a known loss.
  return state.myStars <= state.enemyStars;
}

function positionBombRisk(state, position, forMe) {
  var risk = 0;
  if (!state.bombs) return risk;
  for (var i = 0; i < state.bombs.length; i++) {
    var bomb = state.bombs[i];
    if (!positionInBombBlast(position, bomb, state.map)) continue;
    var framesLeft = bomb.explodeFrame - state.frame;
    if (framesLeft <= 0) return AT_TERMINAL_SCORE;
    risk = Math.max(risk, Math.max(250, 9000 / (framesLeft + 1)));
  }
  return risk;
}

function positionImmediateRisk(state, position, direction, forMe) {
  var risk = positionBombRisk(state, position, forMe);
  if (forMe) {
    var wanted = directionToAligned(state.enemyPos, position);
    risk += muzzleRiskScore(state.enemyPos, state.enemyDir, position,
      state.map, state.enemyCanFire, state.enemyBoosted, direction,
      state.myMoveSpeed, wanted,
      wanted ? clearLine(state.enemyPos, position, state.map) : false,
      manhattan(state.enemyPos, position), state.enemyOverloaded);
    risk += edgePositionPenalty(position, direction, state.map,
      state.enemyPos, state.myStars > state.enemyStars, state.star) * 0.2;
  }
  return risk;
}

function runtimeActionPosition(me, enemyTank, game, action) {
  var position = copyPos(me.tank.position);
  var direction = me.tank.direction;
  if (action === "LEFT") direction = turnDir(direction, -1);
  else if (action === "RIGHT") direction = turnDir(direction, 1);
  else if (action === "GO") {
    position = advanceTankPosition(position, direction,
      me.status.boosted ? 2 : 1, game.map,
      enemyTank && enemyTank.position);
  }
  return { position: position, direction: direction };
}

function runtimeBombCandidateRisk(me, enemy, game, bombs, action) {
  var candidate = runtimeActionPosition(me, enemy.tank, game, action);
  var actionFrame = typeof game.frames === "number" ? game.frames : 0;
  var risk = 0;
  for (var i = 0; i < bombs.length; i++) {
    var bomb = bombs[i];
    if (!positionInBombBlast(candidate.position, bomb, game.map)) continue;
    var framesLeft = bomb.explodeFrame - actionFrame;
    if (framesLeft <= 0) {
      risk = Math.max(risk, me.status.shielded ? 900 : AT_TERMINAL_SCORE);
      continue;
    }
    var needed = minimumEscapeActionsFrom(candidate.position,
      candidate.direction, me.status.boosted ? 2 : 1, game.map,
      bombBlastEffect(bomb.position, game.map),
      enemy.tank && enemy.tank.position, Math.min(10, framesLeft));
    var available = framesLeft;
    if (me.status.frozen) available -= Math.min(framesLeft,
      effectFrames(me.effects && me.effects.debuff, 1));
    if (me.status.poisoned) available = Math.ceil(Math.max(0, available) / 2);
    if (enemy.skill && enemy.skill.remainingCooldownFrames === 0) {
      if (enemy.skill.type === "freeze") {
        available -= Math.min(2, Math.max(0, available));
      } else if (enemy.skill.type === "poison") {
        available = Math.ceil(Math.max(0, available) / 2);
      }
    }
    var slack = available - needed;
    if (slack < 0) risk = Math.max(risk, AT_TERMINAL_SCORE);
    else if (slack === 0) risk = Math.max(risk, 35000);
    else if (slack === 1) risk = Math.max(risk, 10000);
    else risk = Math.max(risk, 1200 / Math.max(1, slack));
    if (enemy.skill && enemy.skill.type === "stun" &&
        enemy.skill.remainingCooldownFrames === 0 && risk < AT_TERMINAL_SCORE) {
      risk *= 1.45;
    }
  }
  var enemyProjectile = currentEnemyProjectile(enemy, game);
  if (enemyProjectile) {
    risk += projectileThreat(enemyProjectile,
      candidate.position, candidate.direction,
      me.status.boosted ? 2 : 1, game.map);
  }
  if (enemy.tank) risk += runtimeMuzzleRiskAt(candidate.position, enemy,
    game, candidate.direction, me.status.boosted ? 2 : 1);
  risk += edgePositionPenalty(candidate.position, candidate.direction,
    game.map, enemy.tank && enemy.tank.position,
    (me.stars || 0) > (enemy.stars || 0), game.star) * 0.15;
  if (game.star) risk -= Math.max(0, 6 - manhattan(candidate.position,
    game.star)) * 8;
  return risk;
}

function chooseVisibleBombSafetyAction(me, enemy, game) {
  var frame = typeof game.frames === "number" ? game.frames : 0;
  var bombs = normalizeVisibleBombs(game.bombs, frame);
  if (bombs.length === 0) return null;
  var urgent = false;
  for (var i = 0; i < bombs.length; i++) {
    var remaining = bombs[i].explodeFrame - frame;
    if (remaining >= 0 && remaining <= AT_BOMB_EXACT_HORIZON) {
      var blast = bombBlastEffect(bombs[i].position, game.map);
      for (var tileIndex = 0; tileIndex < blast.tiles.length; tileIndex++) {
        if (manhattan(me.tank.position, blast.tiles[tileIndex]) <=
            (me.status.boosted ? 2 : 1)) {
          urgent = true;
          break;
        }
      }
      if (urgent) break;
    }
  }
  if (!urgent) return null;

  var actions = ["GO", "LEFT", "RIGHT"];
  if (!me.bullet && !me.status.fireLocked) actions.push("FIRE");
  if (me.skill && me.skill.type === "stun" &&
      me.skill.remainingCooldownFrames === 0 && enemy.tank) {
    actions.push("STUN");
  }
  var bestAction = null;
  var bestRisk = Infinity;
  for (var j = 0; j < actions.length; j++) {
    var risk = runtimeBombCandidateRisk(me, enemy, game, bombs, actions[j]);
    if (risk < bestRisk || (risk === bestRisk &&
        actionPriority(actions[j]) > actionPriority(bestAction))) {
      bestRisk = risk;
      bestAction = actions[j];
    }
  }
  return bestAction || "RIGHT";
}

function bombPlacementUtility(state, forMe) {
  if (!forMe) return 0;
  var blast = bombBlastEffect(state.myPos, state.map);
  var selfEscape = minimumEscapeActionsFrom(state.myPos, state.myDir,
    state.myMoveSpeed, state.map, blast, state.enemyPos, 8);
  if (selfEscape > 6) return -Infinity;
  var score = blast.mounds.length * 45;
  if (blast.codes[positionCode(state.enemyPos)]) score += 190;
  var enemyOpen = openNeighborCount(state.enemyPos, state.map);
  if (enemyOpen <= 2 && manhattan(state.myPos, state.enemyPos) <= 4) {
    score += (3 - enemyOpen) * 90;
  }
  score += Math.min(180, state.enemyStunned * 24);
  if (state.star && blast.codes[positionCode(state.star)]) {
    var myStar = distanceFromField(state.starDistance, state.myPos);
    var enemyStar = distanceFromField(state.starDistance, state.enemyPos);
    score += enemyStar <= myStar ? 90 : -80;
  }
  if (state.enemySkillReady && (state.enemySkillType === "teleport" ||
      state.enemySkillType === "boost" || state.enemySkillType === "shield")) {
    score *= 0.45;
  }
  if (state.enemyProjectile || state.enemyProjectile2 ||
      bombPressureScore(state, true) > 0) score -= 500;
  var geometry = stateGeometry(state);
  var muzzle = muzzleRiskScore(state.enemyPos, state.enemyDir, state.myPos,
    state.map, state.enemyCanFire, state.enemyBoosted, state.myDir,
    state.myMoveSpeed, geometry.enemyAim, geometry.lineOpen,
    geometry.distance, state.enemyOverloaded);
  if (muzzle >= 1800) score -= 600;
  if (fireUtility(state, true) >= 400) score -= 180;
  if (outerEdgeDistance(state.myPos, state.map) <= 1) score -= 160;
  return score;
}

function shouldConsiderBomb(state, forMe) {
  if (!forMe || !state.myBombReady || state.myDead || state.enemyDead) {
    return false;
  }
  // Grass hides even our own bomb from game.bombs, so the exact deadline
  // tracker could not guarantee self-escape after placement.
  if (tileAt(state.myPos, state.map) === "o") return false;
  // A newly placed bomb cannot explode within the bounded tactical horizon.
  // Search it only as a root commitment; reconsidering it at every descendant
  // adds branches without improving the current command.
  if (state.searchPly > 0) return false;
  if (state.myFrozen > 0 || state.myPoisoned > 0 ||
      bombPressureScore(state, true) > 0) return false;
  if (state.star && state.myStars <= state.enemyStars) {
    var myStarDeadline = distanceFromField(state.starDistance, state.myPos);
    var enemyStarDeadline = distanceFromField(state.starDistance,
      state.enemyPos);
    // A bomb explodes ten frames after placement. If the opponent is already
    // one or two moves from winning the current star race, BOMB cannot defend
    // that objective (mat_85U88IjKCkwEd5cRj frame 16).
    if (enemyStarDeadline <= 2 && enemyStarDeadline < myStarDeadline) {
      return false;
    }
  }
  return bombPlacementUtility(state, true) >= 140;
}

function mapWithOpenedTile(map, position) {
  var mapId = mapCacheId(map);
  var table = AT_OPENED_MAP_CACHE[mapId];
  if (!table) {
    table = [];
    AT_OPENED_MAP_CACHE[mapId] = table;
  }
  var key = positionCode(position);
  if (table[key]) return table[key];
  var result = map.slice();
  result[position[0]] = map[position[0]].slice();
  result[position[0]][position[1]] = ".";
  table[key] = result;
  return table[key];
}

function distanceGain(before, after) {
  if (before >= 99 && after < 99) return 4;
  if (before >= 99 || after >= 99) return 0;
  return Math.max(0, before - after);
}

function predictiveInterceptUtility(state, forMe) {
  var cacheName = forMe ? "_myInterceptUtility" : "_enemyInterceptUtility";
  if (state[cacheName] !== undefined) return state[cacheName];
  var shooter = forMe ? state.myPos : state.enemyPos;
  var direction = forMe ? state.myDir : state.enemyDir;
  var target = forMe ? state.enemyPos : state.myPos;
  var targetDir = forMe ? state.enemyDir : state.myDir;
  var targetSpeed = forMe ? state.enemyMoveSpeed : state.myMoveSpeed;
  var objective = state.star || shooter;
  var targetX = target[0];
  var targetY = target[1];
  var objectiveX = objective[0];
  var objectiveY = objective[1];
  var targetToObjective = Math.abs(targetX - objectiveX) +
    Math.abs(targetY - objectiveY);
  var x = shooter[0];
  var y = shooter[1];
  var step = AT_DELTAS[direction];
  var best = -Infinity;

  for (var distance = 1; distance <= 18; distance++) {
    x += step[0];
    y += step[1];
    var column = state.map[x];
    var tile = column && column[y];
    if (tile !== "." && tile !== "o") break;
    if (x === targetX && y === targetY) break;

    var pathDistance = Math.abs(targetX - x) + Math.abs(targetY - y);
    var arrivalFrame = Math.ceil(distance / 2);
    var firstDirection;
    if (x > targetX) firstDirection = "right";
    else if (x < targetX) firstDirection = "left";
    else if (y > targetY) firstDirection = "down";
    else firstDirection = "up";
    var turnFrames = quarterTurns(targetDir, firstDirection);
    var reachFrame = turnFrames + Math.ceil(pathDistance / targetSpeed);
    var timingDelta = Math.abs(reachFrame - arrivalFrame);
    if (reachFrame > arrivalFrame + 1 || timingDelta > 2) continue;

    var positionToObjective = Math.abs(x - objectiveX) +
      Math.abs(y - objectiveY);
    var onLikelyRoute = pathDistance + positionToObjective <=
      targetToObjective + 1;
    if (!onLikelyRoute && timingDelta > 0) continue;

    var firstStepMatches = firstDirection === targetDir;
    var hitChance = 0.12;
    if (timingDelta === 0) hitChance += 0.34;
    else if (timingDelta === 1) hitChance += 0.17;
    if (onLikelyRoute) hitChance += 0.24;
    if (firstStepMatches) hitChance += 0.16;
    hitChance = Math.min(0.88, hitChance);

    var value = hitChance * 320 - arrivalFrame * 7;
    if (value > best) best = value;
  }
  if (forMe && best !== -Infinity) best *= enemyMotionFactor(state);
  state[cacheName] = best;
  return state[cacheName];
}

function predictiveInterceptOutcomeScore(state, enemyAction, enemyReversed,
    enemyNext, postMoveRay) {
  var base = predictiveInterceptUtility(state, true);
  if (base <= 25) return Math.max(0, base);

  // If the joint enemy move actually enters our ray, reward the concrete
  // interception rather than the pre-move possibility estimate.
  if (postMoveRay.firstObject === "enemy") {
    var arrivalFrames = Math.ceil(postMoveRay.distance / 2);
    return Math.min(220, Math.max(base * 0.75, 95) +
      Math.max(0, 70 - arrivalFrames * 14));
  }

  var beforeDistance = distanceToShotLane(state.enemyPos, state.myPos,
    state.myDir);
  var afterDistance = distanceToShotLane(enemyNext, state.myPos, state.myDir);
  var multiplier = 0.35;

  // The minimizer now controls this multiplier through its actual joint
  // action. A supporting move keeps most of the value; turning away or moving
  // farther from the lane sharply discounts speculative long shots.
  if (enemyAction === "GO") {
    if (afterDistance < beforeDistance) multiplier = 1;
    else if (afterDistance === beforeDistance &&
        sameDirectionAxis(state.enemyDir, state.myDir)) multiplier = 0.55;
    else multiplier = enemyReversed ? 0.28 : 0.2;
  } else if (enemyAction === "LEFT" || enemyAction === "RIGHT") {
    multiplier = 0.38;
  } else if (enemyAction === "FIRE") {
    multiplier = 0.3;
  }
  return Math.min(180, Math.max(0, base * multiplier));
}

function distanceToShotLane(position, shooter, direction) {
  if (direction === "up" || direction === "down") {
    return Math.abs(position[0] - shooter[0]);
  }
  return Math.abs(position[1] - shooter[1]);
}

function longRangeHitScore(state, forMe) {
  var cacheName = forMe ? "_myLongRangeHitScore" :
    "_enemyLongRangeHitScore";
  if (state[cacheName] !== undefined) return state[cacheName];
  var shooter = forMe ? state.myPos : state.enemyPos;
  var direction = forMe ? state.myDir : state.enemyDir;
  var target = forMe ? state.enemyPos : state.myPos;
  var targetDir = forMe ? state.enemyDir : state.myDir;
  var targetSpeed = forMe ? state.enemyMoveSpeed : state.myMoveSpeed;
  var targetShielded = forMe ? state.enemyShielded : state.myShielded;
  var ray = scanForwardRay(shooter, direction, target, state.map);
  if (targetShielded || ray.firstObject !== "enemy" || ray.distance <= 4) {
    state[cacheName] = 0;
    return state[cacheName];
  }

  var arrivalFrames = Math.ceil(ray.distance / 2);
  var forward = advanceTankPosition(target, targetDir, targetSpeed,
    state.map, shooter);
  var continuesInLane = sameBulletAxis(target, forward, direction);
  var parallel = sameDirectionAxis(targetDir, direction);
  var lateralExits = perpendicularEscapeCount(target, direction, state.map);
  var hitChance = 0.14;

  // A target already travelling along the firing lane is catchable because a
  // bullet advances two tiles per frame. Constrained lateral exits raise the
  // chance further; long, open-field shots remain possible but low-valued.
  if (parallel && continuesInLane && !samePos(forward, target)) hitChance += 0.27;
  if (lateralExits === 0) hitChance += 0.36;
  else if (lateralExits === 1) hitChance += 0.16;
  if (arrivalFrames <= 3) hitChance += 0.18;
  else if (arrivalFrames >= 6) hitChance -= 0.06;

  if (state.star) {
    var before = manhattan(target, state.star);
    var after = manhattan(forward, state.star);
    if (continuesInLane && after < before) hitChance += 0.12;
  }
  hitChance = Math.max(0.05, Math.min(0.92, hitChance));
  state[cacheName] = Math.min(260,
    Math.max(0, hitChance * 380 - arrivalFrames * 6));
  return state[cacheName];
}

function runtimePredictiveShotOpportunity(me, enemy, game) {
  if (!enemy.tank || enemy.status.shielded || me.bullet ||
      me.status.fireLocked) return false;
  var state = {
    map: game.map,
    star: game.star ? copyPos(game.star) : null,
    myPos: copyPos(me.tank.position),
    myDir: me.tank.direction,
    enemyPos: copyPos(enemy.tank.position),
    enemyDir: enemy.tank.direction,
    myMoveSpeed: me.status.boosted ? 2 : 1,
    enemyMoveSpeed: enemy.status.boosted ? 2 : 1
  };
  return predictiveInterceptUtility(state, true) > 45;
}

function sameDirectionAxis(a, b) {
  var aVertical = a === "up" || a === "down";
  var bVertical = b === "up" || b === "down";
  return aVertical === bVertical;
}

function perpendicularEscapeCount(position, bulletDirection, map) {
  var directions = (bulletDirection === "up" || bulletDirection === "down") ?
    ["left", "right"] : ["up", "down"];
  var count = 0;
  for (var i = 0; i < directions.length; i++) {
    var delta = AT_DELTAS[directions[i]];
    var x = position[0] + delta[0];
    var y = position[1] + delta[1];
    var column = map[x];
    var tile = column && column[y];
    if (tile === "." || tile === "o") count++;
  }
  return count;
}

function projectileFromRuntime(bullet) {
  if (!bullet || !bullet.position || !bullet.direction) return null;
  return {
    position: copyPos(bullet.position),
    direction: bullet.direction,
    // Overload creates two independent parallel bullets. A singular runtime
    // bullet is one physical projectile, never two damage on the same ray.
    damage: 1,
    observed: true
  };
}

// Replay evidence across all four directions is exact: horizontal overload
// shots use y and y+1, while vertical shots use x and x+1. The offset is in
// global map coordinates rather than relative to the tank's facing.
function overloadSecondaryOrigin(position, direction) {
  return direction === "left" || direction === "right" ?
    [position[0], position[1] + 1] :
    [position[0] + 1, position[1]];
}

function cloneProjectile(projectile) {
  if (!projectile) return null;
  return {
    position: copyPos(projectile.position),
    direction: projectile.direction,
    damage: projectile.damage || 1,
    observed: !!projectile.observed
  };
}

function advanceTankPosition(start, direction, speed, map, blocked) {
  var x = start[0];
  var y = start[1];
  var step = AT_DELTAS[direction];
  for (var i = 0; i < speed; i++) {
    var nextX = x + step[0];
    var nextY = y + step[1];
    var column = map[nextX];
    var tile = column && column[nextY];
    if ((tile !== "." && tile !== "o") ||
        (blocked && nextX === blocked[0] && nextY === blocked[1])) break;
    x = nextX;
    y = nextY;
  }
  return [x, y];
}

function movementCrossesPosition(start, direction, speed, map, blocked,
    dangerousPosition) {
  if (!dangerousPosition) return false;
  var x = start[0];
  var y = start[1];
  var step = AT_DELTAS[direction];
  for (var i = 0; i < speed; i++) {
    var nextX = x + step[0];
    var nextY = y + step[1];
    var column = map[nextX];
    var tile = column && column[nextY];
    if ((tile !== "." && tile !== "o") ||
        (blocked && nextX === blocked[0] && nextY === blocked[1])) break;
    if (nextX === dangerousPosition[0] && nextY === dangerousPosition[1]) {
      return true;
    }
    x = nextX;
    y = nextY;
  }
  return false;
}

function advanceProjectile(projectile, owner, map, myPos, enemyPos,
    alreadyCloned) {
  var result = {
    projectile: alreadyCloned ? projectile : cloneProjectile(projectile),
    map: map,
    mapChanged: false,
    hitTarget: false,
    damage: projectile && projectile.damage || 1
  };
  if (!result.projectile) return result;

  var x = result.projectile.position[0];
  var y = result.projectile.position[1];
  var step = AT_DELTAS[result.projectile.direction];
  for (var i = 0; i < 2; i++) {
    x += step[0];
    y += step[1];
    var column = result.map[x];
    var tile = column && column[y];
    if (!tile || tile === "x") {
      result.projectile = null;
      return result;
    }
    if (tile === "m") {
      result.map = mapWithOpenedTile(result.map, [x, y]);
      result.mapChanged = true;
      result.projectile = null;
      return result;
    }

    var target = owner === "my" ? enemyPos : myPos;
    if (x === target[0] && y === target[1]) {
      result.hitTarget = true;
      result.projectile = null;
      return result;
    }
  }
  result.projectile.position = [x, y];
  return result;
}

function projectileThreat(projectile, targetPos, targetDir, targetSpeed, map) {
  if (!projectile) return 0;
  var ray = scanForwardRay(projectile.position, projectile.direction,
    targetPos, map);
  if (ray.firstObject !== "enemy") return 0;
  var frames = Math.ceil(ray.distance / 2);
  var needed = minimumProjectileEscapeActions(targetPos, targetDir,
    targetSpeed, projectile.direction, map, null);
  if (projectile.observed) {
    if (needed > frames) return 50000;
    var slack = frames - needed;
    if (slack === 0) return 35000;
    if (slack === 1) return 10000;
  } else if (frames === 1) {
    return needed <= frames ? 1200 : 50000;
  }
  var value = Math.max(80, 420 - (frames - 1) * 75);
  if (needed < 99) value *= 0.35;
  return value;
}

function projectilePairThreat(primary, secondary, targetPos, targetDir,
    targetSpeed, map) {
  var primaryThreat = projectileThreat(primary, targetPos, targetDir,
    targetSpeed, map);
  if (!secondary) return primaryThreat;
  return primaryThreat + projectileThreat(secondary, targetPos, targetDir,
    targetSpeed, map);
}

function lineFireValue(shooter, direction, target, targetDir, targetSpeed, map) {
  var ray = scanForwardRay(shooter, direction, target, map);
  if (ray.firstObject !== "enemy") return 0;
  var frames = Math.ceil(ray.distance / 2);
  var canDodge = canDodgeBeforeImpact(target, targetDir, targetSpeed,
    direction, frames, map);
  if (frames === 1) return canDodge ? 900 : 30000;
  var value = Math.max(70, 360 - (frames - 1) * 65);
  if (canDodge) value *= 0.4;
  return value;
}

function muzzleRiskScore(shooter, shooterDir, target, map, canFire, boosted,
    targetDir, targetSpeed, wanted, lineOpen, distance, overloaded) {
  var risk = singleMuzzleRiskScore(shooter, shooterDir, target, map, canFire,
    boosted, targetDir, targetSpeed, wanted, lineOpen, distance);
  if (!overloaded || !canFire) return risk;
  var secondary = overloadSecondaryOrigin(shooter, shooterDir);
  var secondaryWanted = directionToAligned(secondary, target);
  var secondaryLine = secondaryWanted ?
    clearLine(secondary, target, map) : false;
  var secondaryDistance = manhattan(secondary, target);
  return Math.max(risk, singleMuzzleRiskScore(secondary, shooterDir, target,
    map, canFire, boosted, targetDir, targetSpeed, secondaryWanted,
    secondaryLine, secondaryDistance));
}

function singleMuzzleRiskScore(shooter, shooterDir, target, map, canFire,
    boosted, targetDir, targetSpeed, wanted, lineOpen, distance) {
  if (!canFire) return 0;
  if (distance === undefined) distance = manhattan(shooter, target);
  if (wanted === undefined) wanted = directionToAligned(shooter, target);
  if (lineOpen === undefined) {
    lineOpen = wanted ? clearLine(shooter, target, map) : false;
  }
  if (wanted && lineOpen) {
    var turns = quarterTurns(shooterDir, wanted);
    if (turns === 0 && distance <= 2) {
      if (targetDir && canDodgeBeforeImpact(target, targetDir,
          targetSpeed || 1, shooterDir, 1, map)) return 1200;
      return 50000;
    }
    if (turns === 0 && distance <= 4) {
      var impactFrames = Math.ceil(distance / 2);
      var hasEscape = targetDir && canDodgeBeforeImpact(target, targetDir,
        targetSpeed || 1, shooterDir, impactFrames, map);
      if (distance === 3) return hasEscape ? 4000 : 22000;
      return hasEscape ? 1800 : 10000;
    }
    if (boosted && turns === 1 && distance <= 2) return 35000;
    if (distance === 1) return 1200;
  }
  if (distance <= 2) return 650;
  if (distance === 3) return 400;
  return 0;
}

function canDodgeBeforeImpact(position, direction, speed, bulletDirection,
    frames, map) {
  return minimumProjectileEscapeActions(position, direction, speed,
    bulletDirection, map, null) <= frames;
}

function minimumProjectileEscapeActions(position, direction, speed,
    bulletDirection, map, blocked) {
  var forward = advanceTankPosition(position, direction, speed, map, blocked);
  if (!samePos(forward, position) &&
      (!blocked || !samePos(forward, blocked)) &&
      !sameBulletAxis(position, forward, bulletDirection)) return 1;

  var left = turnDir(direction, -1);
  var right = turnDir(direction, 1);
  var leftPos = advanceTankPosition(position, left, speed, map, blocked);
  var rightPos = advanceTankPosition(position, right, speed, map, blocked);
  if ((!samePos(leftPos, position) &&
      !sameBulletAxis(position, leftPos, bulletDirection)) ||
      (!samePos(rightPos, position) &&
      !sameBulletAxis(position, rightPos, bulletDirection))) return 2;
  return 99;
}

function sameBulletAxis(origin, candidate, bulletDirection) {
  if (bulletDirection === "up" || bulletDirection === "down") {
    return origin[0] === candidate[0];
  }
  return origin[1] === candidate[1];
}

function quarterTurns(from, to) {
  return AT_QUARTER_TURN_TABLE[AT_DIR_INDEX[from]][AT_DIR_INDEX[to]];
}

function firesAt(shooter, direction, target, map) {
  var wanted = directionToAligned(shooter, target);
  return wanted === direction && clearLine(shooter, target, map);
}

function clearLine(a, b, map, mapId) {
  var direction = directionToAligned(a, b);
  if (!direction) return false;
  return scanForwardRay(a, direction, b, map, mapId).firstObject === "enemy";
}

function bulletPath(start, direction, map, limit) {
  var result = [];
  var x = start[0];
  var y = start[1];
  var step = AT_DELTAS[direction];
  for (var i = 0; i < limit; i++) {
    x += step[0];
    y += step[1];
    var column = map[x];
    var tile = column && column[y];
    if (tile !== "." && tile !== "o") break;
    result.push([x, y]);
  }
  return result;
}

function openNeighborCount(pos, map, mapId) {
  if (mapId === undefined) mapId = mapCacheId(map);
  var cache = AT_OPEN_NEIGHBOR_CACHE[mapId];
  if (!cache) {
    cache = [];
    AT_OPEN_NEIGHBOR_CACHE[mapId] = cache;
  }
  var code = positionCode(pos);
  if (cache[code] !== undefined) {
    return cache[code];
  }
  var count = 0;
  for (var i = 0; i < AT_DIRS.length; i++) {
    var delta = AT_DELTAS[AT_DIRS[i]];
    var x = pos[0] + delta[0];
    var y = pos[1] + delta[1];
    var column = map[x];
    var tile = column && column[y];
    if (tile === "." || tile === "o") count++;
  }
  cache[code] = count;
  return cache[code];
}

function outerEdgeDistance(position, map, mapId) {
  if (mapId === undefined) mapId = mapCacheId(map);
  var cache = AT_EDGE_DISTANCE_CACHE[mapId];
  if (!cache) {
    cache = [];
    AT_EDGE_DISTANCE_CACHE[mapId] = cache;
  }
  var code = positionCode(position);
  if (cache[code] !== undefined) return cache[code];
  var width = map.length;
  var column = map[position[0]] || [];
  var height = column.length;
  if (!width || !height) return 0;
  cache[code] = Math.max(0, Math.min(position[0] - 1,
    width - 2 - position[0], position[1] - 1,
    height - 2 - position[1]));
  return cache[code];
}

function edgePositionPenalty(position, direction, map, enemyPosition,
    protectingLead, star, ring, exits) {
  if (ring === undefined || exits === undefined) {
    var mapId = mapCacheId(map);
    if (ring === undefined) ring = outerEdgeDistance(position, map, mapId);
    if (exits === undefined) exits = openNeighborCount(position, map, mapId);
  }
  var penalty = 0;

  // Ring 1 is the outer playable strip, ring 2 still has little reaction
  // space, and ring 3 only receives a small positional warning.
  if (ring <= 1) penalty += 105;
  else if (ring === 2) penalty += 48;
  else if (ring === 3) penalty += 16;

  if (exits <= 1) penalty += 145;
  else if (exits === 2) penalty += ring <= 2 ? 58 : 26;

  if (ring <= 2) {
    var delta = AT_DELTAS[direction];
    var forwardX = position[0] + delta[0];
    var forwardY = position[1] + delta[1];
    var forwardColumn = map[forwardX];
    var forwardTile = forwardColumn && forwardColumn[forwardY];
    if (forwardTile !== "." && forwardTile !== "o") penalty += 34;
  }

  if (enemyPosition) {
    var pressureDistance = manhattan(position, enemyPosition);
    if (pressureDistance <= 3) penalty *= 1.65;
    else if (pressureDistance <= 5) penalty *= 1.3;
  }
  if (protectingLead) penalty *= 1.35;

  // A nearby edge star is still worth contesting. Collection itself is worth
  // 900, while this relief prevents the approach path from being rejected too
  // early without erasing the danger completely.
  if (star && manhattan(position, star) <= 2) penalty *= 0.5;
  return penalty;
}

function effectFrames(effect, fallback) {
  return effect && typeof effect.remainingFrames === "number" ?
    effect.remainingFrames : fallback;
}

function distanceFromField(field, pos) {
  if (!field || !field.values) return 99;
  var value = field.values[pos[0] * field.height + pos[1]];
  return value ? value - 1 : 99;
}

function finiteDistance(value) {
  return value >= 99 ? 30 : value;
}

function directionToAligned(a, b) {
  if (a[0] === b[0]) {
    if (b[1] > a[1]) return "down";
    if (b[1] < a[1]) return "up";
  }
  if (a[1] === b[1]) {
    if (b[0] > a[0]) return "right";
    if (b[0] < a[0]) return "left";
  }
  return null;
}

function directionBetween(a, b) {
  if (b[0] > a[0]) return "right";
  if (b[0] < a[0]) return "left";
  if (b[1] > a[1]) return "down";
  return "up";
}

function shortTurn(current, target) {
  var currentIndex = AT_DIR_INDEX[current];
  var targetIndex = AT_DIR_INDEX[target];
  return targetIndex === (currentIndex + 3) % 4 ? "left" : "right";
}

function turnDir(direction, amount) {
  if (amount === -1) return AT_TURN_LEFT[direction];
  if (amount === 1) return AT_TURN_RIGHT[direction];
  if (amount === 2 || amount === -2) return AT_OPPOSITE[direction];
  return AT_DIRS[(AT_DIR_INDEX[direction] + amount + 8) % 4];
}

function oppositeDir(direction) {
  return AT_OPPOSITE[direction];
}

function dirDelta(direction) {
  return AT_DELTAS[direction] || AT_DELTAS.left;
}

function tileAt(pos, map) {
  return map[pos[0]] && map[pos[0]][pos[1]];
}

function isWalkable(pos, map) {
  var tile = tileAt(pos, map);
  return tile === "." || tile === "o";
}

function isBulletOpen(pos, map) {
  var tile = tileAt(pos, map);
  return tile === "." || tile === "o";
}

function addPos(pos, delta) {
  return [pos[0] + delta[0], pos[1] + delta[1]];
}

function copyPos(pos) {
  return [pos[0], pos[1]];
}

function samePos(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

function manhattan(a, b) {
  var dx = a[0] - b[0];
  var dy = a[1] - b[1];
  if (dx < 0) dx = -dx;
  if (dy < 0) dy = -dy;
  return dx + dy;
}

function posKey(pos) {
  return pos[0] + "," + pos[1];
}

function indexOfPos(list, pos) {
  for (var i = 0; i < list.length; i++) {
    if (samePos(list[i], pos)) return i;
  }
  return -1;
}
