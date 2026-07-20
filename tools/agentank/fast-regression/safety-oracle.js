"use strict";

// This oracle deliberately shares no implementation with InformationSafetyClosure.
// It enumerates deterministic observation-consistent policies over a tiny 1-4 frame
// game and then applies the safety quantifiers exhaustively.
const SAFETY_ORACLE_STATUS = Object.freeze({ UNKNOWN: 0, PROVEN_SAFE: 1,
  PROVEN_DEAD: 2, POSSIBLE_DEATH: 3 });
const SAFETY_ORACLE_KIND = Object.freeze({ TERMINAL: "TERMINAL", OUR_DECISION: "OUR_DECISION",
  ENEMY_ACTION: "ENEMY_ACTION", CHANCE_OUTCOME: "CHANCE_OUTCOME",
  HIDDEN_WORLD: "HIDDEN_WORLD", OBSERVATION_SPLIT: "OBSERVATION_SPLIT",
  AUTOMATIC: "AUTOMATIC", UNKNOWN: "UNKNOWN" });
const SUPPORT_KINDS = new Set([SAFETY_ORACLE_KIND.ENEMY_ACTION,
  SAFETY_ORACLE_KIND.CHANCE_OUTCOME, SAFETY_ORACLE_KIND.HIDDEN_WORLD,
  SAFETY_ORACLE_KIND.OBSERVATION_SPLIT, SAFETY_ORACLE_KIND.AUTOMATIC]);

function validateNode(node, seen, informationSets, maximumFrame) {
  if (!node || typeof node !== "object" || seen.has(node))
    throw new TypeError("safety oracle node must be a finite tree");
  seen.add(node);
  if (!Object.values(SAFETY_ORACLE_KIND).includes(node.kind))
    throw new TypeError(`unsupported safety oracle kind: ${node.kind}`);
  if (node.frame != null && (!Number.isSafeInteger(node.frame) || node.frame < 0 ||
      node.frame > maximumFrame)) throw new TypeError(`invalid safety oracle frame: ${node.frame}`);
  if (node.kind === SAFETY_ORACLE_KIND.TERMINAL) {
    if (node.dead !== true && node.dead !== false) throw new TypeError("terminal.dead must be boolean");
    return;
  }
  if (node.kind === SAFETY_ORACLE_KIND.UNKNOWN) return;
  if (!Array.isArray(node.children) || node.children.length === 0)
    throw new TypeError(`${node.kind} requires non-empty children`);
  if (node.kind === SAFETY_ORACLE_KIND.OUR_DECISION) {
    if (typeof node.informationSet !== "string" || node.informationSet.length === 0)
      throw new TypeError("OUR_DECISION requires informationSet");
    let actions = informationSets.get(node.informationSet);
    if (!actions) { actions = new Set(); informationSets.set(node.informationSet, actions); }
    for (const edge of node.children) {
      if (!edge || typeof edge.action !== "string" || edge.action.length === 0 || !edge.node)
        throw new TypeError("OUR_DECISION children require action and node");
      actions.add(edge.action); validateNode(edge.node, seen, informationSets, maximumFrame);
    }
    return;
  }
  for (const child of node.children) validateNode(child, seen, informationSets, maximumFrame);
}

function combineSupport(statuses, complete) {
  if (!complete || statuses.includes(SAFETY_ORACLE_STATUS.UNKNOWN))
    return SAFETY_ORACLE_STATUS.UNKNOWN;
  if (statuses.every(status => status === SAFETY_ORACLE_STATUS.PROVEN_SAFE))
    return SAFETY_ORACLE_STATUS.PROVEN_SAFE;
  if (statuses.every(status => status === SAFETY_ORACLE_STATUS.PROVEN_DEAD))
    return SAFETY_ORACLE_STATUS.PROVEN_DEAD;
  return SAFETY_ORACLE_STATUS.POSSIBLE_DEATH;
}

function evaluateFixedPolicy(node, policy) {
  if (node.kind === SAFETY_ORACLE_KIND.TERMINAL)
    return node.dead ? SAFETY_ORACLE_STATUS.PROVEN_DEAD : SAFETY_ORACLE_STATUS.PROVEN_SAFE;
  if (node.kind === SAFETY_ORACLE_KIND.UNKNOWN) return SAFETY_ORACLE_STATUS.UNKNOWN;
  if (node.kind === SAFETY_ORACLE_KIND.OUR_DECISION) {
    const action = policy[node.informationSet];
    const edge = node.children.find(item => item.action === action);
    return edge ? evaluateFixedPolicy(edge.node, policy) : SAFETY_ORACLE_STATUS.PROVEN_DEAD;
  }
  if (SUPPORT_KINDS.has(node.kind)) return combineSupport(
    node.children.map(child => evaluateFixedPolicy(child, policy)), node.supportComplete !== false);
  throw new TypeError(`unsupported safety oracle kind: ${node.kind}`);
}

function enumeratePolicies(entries, index, policy, visit) {
  if (index === entries.length) { visit({ ...policy }); return; }
  const [informationSet, actions] = entries[index];
  for (const action of actions) { policy[informationSet] = action;
    enumeratePolicies(entries, index + 1, policy, visit); }
  delete policy[informationSet];
}

function collectObligations(node, policy, output, seenSets = new Set()) {
  if (!node || node.kind === SAFETY_ORACLE_KIND.TERMINAL ||
      node.kind === SAFETY_ORACLE_KIND.UNKNOWN) return output;
  if (node.kind === SAFETY_ORACLE_KIND.OUR_DECISION) {
    if (!seenSets.has(node.informationSet)) {
      seenSets.add(node.informationSet); output.push({ informationSet: node.informationSet,
        frame: node.frame ?? 0, action: policy[node.informationSet] });
    }
    const edge = node.children.find(item => item.action === policy[node.informationSet]);
    if (edge) collectObligations(edge.node, policy, output, seenSets);
    return output;
  }
  for (const child of node.children) collectObligations(child, policy, output, seenSets);
  return output;
}

function solveSafetyStrategy(root, options = {}) {
  const maximumFrame = options.maximumFrame ?? 4;
  if (!Number.isSafeInteger(maximumFrame) || maximumFrame < 1 || maximumFrame > 4)
    throw new TypeError("maximumFrame must be an integer from 1 through 4");
  const informationSets = new Map(); validateNode(root, new Set(), informationSets, maximumFrame);
  const entries = [...informationSets.entries()].map(([name, actions]) =>
    [name, [...actions].sort()]).sort((left, right) => left[0].localeCompare(right[0]));
  const evaluated = []; let witness = null;
  enumeratePolicies(entries, 0, {}, policy => {
    const status = evaluateFixedPolicy(root, policy); evaluated.push(status);
    if (!witness && status === SAFETY_ORACLE_STATUS.PROVEN_SAFE) witness = policy;
  });
  let status;
  if (witness) status = SAFETY_ORACLE_STATUS.PROVEN_SAFE;
  else if (evaluated.length > 0 && evaluated.every(item => item === SAFETY_ORACLE_STATUS.PROVEN_DEAD))
    status = SAFETY_ORACLE_STATUS.PROVEN_DEAD;
  else if (evaluated.includes(SAFETY_ORACLE_STATUS.UNKNOWN)) status = SAFETY_ORACLE_STATUS.UNKNOWN;
  else status = SAFETY_ORACLE_STATUS.POSSIBLE_DEATH;
  return { status, policy: witness, obligations: witness ? collectObligations(root, witness, []) : [],
    policyCount: evaluated.length, maximumFrame };
}

module.exports = { SAFETY_ORACLE_STATUS, SAFETY_ORACLE_KIND, combineSupport,
  evaluateFixedPolicy, solveSafetyStrategy };
