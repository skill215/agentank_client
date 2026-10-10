"use strict";

const ANCHOR = "  applyMonteCarloLeafExtension(state, evaluated, hasSafeAction);\n";
const CLOCK_ANCHOR = `function runtimeClockMs() {
  return typeof Date === "function" && typeof Date.now === "function" ?
    Date.now() : 0;
}`;
const ROOT_BUDGET_ANCHOR = `  // Give every root action the same search allowance.
  AT_NODE_LIMIT = Math.max(12, Math.floor(AT_MAX_NODES / actions.length));`;
const ROOT_VALUE_ANCHOR = `    var value = worstEnemyReply(state, actions[i], rounds, -Infinity,
      safetyProfile);`;
const MINIMAX_PREFIX_ANCHOR = `function minimaxValue(state, rounds, alpha) {
  AT_SEARCH_NODES++;
  if (rounds <= 0 || stateHasTerminalOutcome(state) ||
      AT_SEARCH_NODES >= AT_NODE_LIMIT) {
    return evaluateState(state);
  }

  var actions = tacticalActions(state, true);`;
const WORST_PREFIX_ANCHOR = `function worstEnemyReply(state, myAction, rounds, alpha, safetyProfile) {
  var enemyActions = tacticalActions(state, false);`;
const SELECTED_ACTION_ANCHOR = `  return bestAction;
}

function armedOverloadForcesNextFrameLoss`;

const TRANSITION_CENSUS_SOURCE = `
var AT_V3_POLICY_RECURSION = null;

function v3BeginPolicyRecursion(state, rootActionCount) {
  var rootEnemyActions = tacticalActions(state, false);
  AT_V3_POLICY_RECURSION = { rootActionCount: rootActionCount,
    rootEnemyActionCount: rootEnemyActions.length,
    rootEnemyActions: rootEnemyActions.slice(),
    nodeLimit: AT_NODE_LIMIT, nodeCount: 0, depthLeafCount: 0,
    budgetLeafCount: 0, terminalLeafCount: 0, ownExpansionCount: 0,
    enemyExpansionCount: 0, transitionCount: 0, outcomeCount: 0,
    ownActions: {}, enemyActions: {}, roots: [],
    deepTransitions: [], deepSampleCountByPly: [0, 0, 0, 0],
    deepSampleCountByRootAction: {}, deepSampleLimitPerRootAction: 2,
    opponentCounts: { GO: AT_ENEMY_COUNTS.GO, LEFT: AT_ENEMY_COUNTS.LEFT,
      RIGHT: AT_ENEMY_COUNTS.RIGHT, FIRE: AT_ENEMY_COUNTS.FIRE },
    opponentObservations: AT_ENEMY_OBSERVATIONS,
    opponentGoStreak: AT_ENEMY_GO_STREAK,
    enemyStationaryStreak: state.enemyStationaryStreak || 0,
    expectationBlend: opponentExpectationBlend() };
}

function v3CaptureDeepPolicyTransition(parent, next, myAction, enemyAction,
    reversed, probability, rounds) {
  if (!AT_V3_POLICY_RECURSION) return;
  var parentPath = parent._v3PolicyPath || [];
  var myReversed = parent.myStunned > 0 &&
    shouldReverseMyActionForRisk(parent, myAction);
  var teleportTarget = enemyAction === "TELEPORT" ?
    bestEnemyTeleportTarget(parent) : null;
  var path = parentPath.slice();
  path.push({ myAction: myAction, enemyAction: enemyAction,
    reversed: reversed, myReversed: myReversed,
    teleportTarget: teleportTarget });
  next._v3PolicyPath = path;
  var ply = path.length;
  if (ply < 2 || ply > 3) return;
  // A single global quota sampled only the first root action in V1 traversal
  // order and therefore supplied no deep FIRE evidence. Keep a tiny balanced
  // quota per root action instead; this remains diagnostic-only and bounded.
  var rootAction = path[0].myAction;
  var sampleKey = rootAction + ":" + ply;
  var rootActionSamples =
    AT_V3_POLICY_RECURSION.deepSampleCountByRootAction[sampleKey] || 0;
  if (rootActionSamples >=
      AT_V3_POLICY_RECURSION.deepSampleLimitPerRootAction) return;
  var snapshot = v3PolicyTransitionSnapshot(next, myAction, enemyAction,
    reversed, probability, myReversed, teleportTarget);
  // Capture the ordered policy domain on the exact child state.  Ordering is
  // part of V1 semantics because equal maximin values retain the first row.
  // tacticalActions caches on the state, so a branch that is expanded later
  // observes the same arrays rather than a second, perturbed generation.
  if (rounds > 1 && !stateHasTerminalOutcome(next)) {
    snapshot.ownTacticalActions = tacticalActions(next, true).slice();
    snapshot.enemyTacticalActions = tacticalActions(next, false).slice();
  }
  snapshot.path = path;
  snapshot.ply = ply;
  snapshot.rounds = rounds;
  AT_V3_POLICY_RECURSION.deepTransitions.push(snapshot);
  AT_V3_POLICY_RECURSION.deepSampleCountByPly[ply]++;
  AT_V3_POLICY_RECURSION.deepSampleCountByRootAction[sampleKey] =
    rootActionSamples + 1;
}

function v3CountPolicyActions(target, actions) {
  if (!AT_V3_POLICY_RECURSION) return;
  for (var actionIndex = 0; actionIndex < actions.length; actionIndex++) {
    var action = actions[actionIndex];
    target[action] = (target[action] || 0) + 1;
  }
}

function v3RecordPolicyRoot(action, nodes, value) {
  if (!AT_V3_POLICY_RECURSION) return;
  AT_V3_POLICY_RECURSION.roots.push({ action: action, nodes: nodes,
    value: value });
}

function v3PolicyProjectileSnapshot(projectile, owner) {
  if (!projectile) return null;
  return { owner: owner, x: projectile.position[0], y: projectile.position[1],
    direction: projectile.direction };
}

function v3PolicyTransitionSnapshot(state, myAction, enemyAction, reversed,
    probability, myReversed, teleportTarget) {
  state._captureEvaluationComponents = true;
  var value = evaluateState(state);
  var projectiles = [];
  var projectile = v3PolicyProjectileSnapshot(state.myProjectile, 0);
  if (projectile) projectiles.push(projectile);
  projectile = v3PolicyProjectileSnapshot(state.myProjectile2, 0);
  if (projectile) projectiles.push(projectile);
  projectile = v3PolicyProjectileSnapshot(state.enemyProjectile, 1);
  if (projectile) projectiles.push(projectile);
  projectile = v3PolicyProjectileSnapshot(state.enemyProjectile2, 1);
  if (projectile) projectiles.push(projectile);
  var bombs = [];
  for (var bombIndex = 0; bombIndex < state.bombs.length; bombIndex++) {
    var bomb = state.bombs[bombIndex];
    bombs.push({ owner: bomb.owner === "my" ? 0 : 1,
      x: bomb.position[0], y: bomb.position[1], explodeFrame: bomb.explodeFrame });
  }
  var dirtCount = 0;
  for (var x = 0; x < state.map.length; x++) {
    var column = state.map[x];
    for (var y = 0; column && y < column.length; y++)
      if (column[y] === "m") dirtCount++;
  }
  return { myAction: myAction, enemyAction: enemyAction,
    reversed: reversed, myReversed: myReversed, probability: probability,
    teleportTarget: teleportTarget,
    frame: state.frame, myX: state.myPos[0], myY: state.myPos[1],
    enemyX: state.enemyPos[0], enemyY: state.enemyPos[1],
    myDir: state.myDir, enemyDir: state.enemyDir,
    myStars: state.myStars, enemyStars: state.enemyStars,
    myDead: state.myDead, enemyDead: state.enemyDead,
    starX: state.star ? state.star[0] : -1,
    starY: state.star ? state.star[1] : -1,
    projectiles: projectiles, bombs: bombs, dirtCount: dirtCount,
    myStunned: state.myStunned, enemyStunned: state.enemyStunned,
    myFrozen: state.myFrozen, enemyFrozen: state.enemyFrozen,
    myPoisoned: state.myPoisoned, enemyPoisoned: state.enemyPoisoned,
    myShieldHits: state.myShieldHits, enemyShieldHits: state.enemyShieldHits,
    myOverloadFrames: state.myOverloadFrames,
    enemyOverloadFrames: state.enemyOverloadFrames,
    myBoostFrames: state.myBoostFrames, enemyBoostFrames: state.enemyBoostFrames,
    myCloaked: state.myCloaked, enemyCloaked: state.enemyCloaked,
    value: value, components: copyScoreComponents(state._evaluationComponents) };
}

function v3CapturePolicyTransitions(state, actions) {
  var transitions = [];
  var enemyActions = tacticalActions(state, false);
  for (var myIndex = 0; myIndex < actions.length; myIndex++) {
    var myAction = actions[myIndex];
    var myReversed = state.myStunned > 0 &&
      shouldReverseMyActionForRisk(state, myAction);
    for (var enemyIndex = 0; enemyIndex < enemyActions.length; enemyIndex++) {
      var outcomes = enemyActionOutcomes(state, enemyActions[enemyIndex]);
      for (var outcomeIndex = 0; outcomeIndex < outcomes.length; outcomeIndex++) {
        var outcome = outcomes[outcomeIndex];
        var teleportTarget = outcome.action === "TELEPORT" ?
          bestEnemyTeleportTarget(state) : null;
        var next = applyJointActions(state, myAction, outcome.action,
          outcome.reversed);
        transitions.push(v3PolicyTransitionSnapshot(next, myAction,
          outcome.action, outcome.reversed, outcome.probability, myReversed,
          teleportTarget));
      }
    }
  }
  return transitions;
}
`;

function instrumentV1PolicyValues(source) {
  const first = source.indexOf(ANCHOR);
  if (first < 0 || source.indexOf(ANCHOR, first + ANCHOR.length) >= 0)
    throw new Error("V1_POLICY_VALUE_INSTRUMENTATION_ANCHOR");
  let replacement =
    "  for (var v3PreMonteCarloIndex = 0; v3PreMonteCarloIndex < evaluated.length; " +
    "v3PreMonteCarloIndex++) evaluated[v3PreMonteCarloIndex].preMonteCarloValue = " +
    "evaluated[v3PreMonteCarloIndex].value;\n" +
    "  evaluated._v3CommittedAction = committedAction;\n" +
    "  evaluated._v3CommittedIntent = state.committedIntent;\n" +
    "  evaluated._v3ProposedIntent = state.proposedIntent;\n" +
    `${ANCHOR}  state._v3PolicyEvaluated = evaluated;\n` +
    "  state._v3PolicyRootSnapshot = v3PolicyTransitionSnapshot(state, \"ROOT\", \"ROOT\", false, 1, false, null);\n" +
    "  state._v3PolicyTransitionCensus = v3CapturePolicyTransitions(state, actions);\n" +
    "  state._v3PolicyRecursionCensus = AT_V3_POLICY_RECURSION;\n";
  let result = source.slice(0, first) + replacement +
    source.slice(first + ANCHOR.length);
  if (result.includes(ROOT_BUDGET_ANCHOR) && result.includes(ROOT_VALUE_ANCHOR) &&
      result.includes(MINIMAX_PREFIX_ANCHOR) && result.includes(WORST_PREFIX_ANCHOR)) {
    result = result.replace(ROOT_BUDGET_ANCHOR,
      `${ROOT_BUDGET_ANCHOR}\n  v3BeginPolicyRecursion(state, actions.length);\n` +
      "  AT_V3_POLICY_RECURSION.nodeLimit = AT_NODE_LIMIT;");
    result = result.replace(ROOT_VALUE_ANCHOR,
      "    var v3PolicyNodesBefore = AT_SEARCH_NODES;\n" + ROOT_VALUE_ANCHOR +
      "\n    v3RecordPolicyRoot(actions[i], AT_SEARCH_NODES - v3PolicyNodesBefore, value);");
    result = result.replace(MINIMAX_PREFIX_ANCHOR, `function minimaxValue(state, rounds, alpha) {
  AT_SEARCH_NODES++;
  if (AT_V3_POLICY_RECURSION) AT_V3_POLICY_RECURSION.nodeCount++;
  if (rounds <= 0) {
    if (AT_V3_POLICY_RECURSION) AT_V3_POLICY_RECURSION.depthLeafCount++;
    return evaluateState(state);
  }
  if (stateHasTerminalOutcome(state)) {
    if (AT_V3_POLICY_RECURSION) AT_V3_POLICY_RECURSION.terminalLeafCount++;
    return evaluateState(state);
  }
  if (AT_SEARCH_NODES >= AT_NODE_LIMIT) {
    if (AT_V3_POLICY_RECURSION) AT_V3_POLICY_RECURSION.budgetLeafCount++;
    return evaluateState(state);
  }

  var actions = tacticalActions(state, true);
  if (AT_V3_POLICY_RECURSION) {
    AT_V3_POLICY_RECURSION.ownExpansionCount++;
    v3CountPolicyActions(AT_V3_POLICY_RECURSION.ownActions, actions);
  }`);
    result = result.replace(WORST_PREFIX_ANCHOR, `${WORST_PREFIX_ANCHOR}
  if (AT_V3_POLICY_RECURSION) {
    AT_V3_POLICY_RECURSION.enemyExpansionCount++;
    v3CountPolicyActions(AT_V3_POLICY_RECURSION.enemyActions, enemyActions);
  }`);
    result = result.replace(
      "    var outcomes = enemyActionOutcomes(state, enemyActions[i]);\n    var expected = 0;",
      "    var outcomes = enemyActionOutcomes(state, enemyActions[i]);\n" +
      "    if (AT_V3_POLICY_RECURSION) { AT_V3_POLICY_RECURSION.transitionCount++; " +
      "AT_V3_POLICY_RECURSION.outcomeCount += outcomes.length; }\n    var expected = 0;");
    result = result.replace(
      "      var next = applyJointActions(state, myAction, outcomes[j].action,\n" +
      "        outcomes[j].reversed);",
      "      var next = applyJointActions(state, myAction, outcomes[j].action,\n" +
      "        outcomes[j].reversed);\n" +
      "      v3CaptureDeepPolicyTransition(state, next, myAction, " +
      "outcomes[j].action, outcomes[j].reversed, outcomes[j].probability, rounds);");
  }
  if (result.includes(SELECTED_ACTION_ANCHOR))
    result = result.replace(SELECTED_ACTION_ANCHOR,
      "  evaluated._v3ChosenAction = bestAction;\n" +
      "  evaluated._v3SelectedIntent = state._selectedIntent;\n" +
      SELECTED_ACTION_ANCHOR);
  return result + TRANSITION_CENSUS_SOURCE;
}

function instrumentV1DeterministicPolicyOracle(source) {
  const instrumented = instrumentV1PolicyValues(source);
  const first = instrumented.indexOf(CLOCK_ANCHOR);
  if (first < 0 || instrumented.indexOf(CLOCK_ANCHOR,
    first + CLOCK_ANCHOR.length) >= 0)
    throw new Error("V1_POLICY_RUNTIME_CLOCK_INSTRUMENTATION_ANCHOR");
  const replacement = `function runtimeClockMs() {
  return 0;
}`;
  return instrumented.slice(0, first) + replacement +
    instrumented.slice(first + CLOCK_ANCHOR.length);
}

module.exports = { instrumentV1PolicyValues, instrumentV1DeterministicPolicyOracle };
