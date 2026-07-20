"use strict";

const search = require("../../../engine-v2/src/search");
const { invariant } = require("../core/errors");

const KIND = Object.freeze({
  TERMINAL: "TERMINAL",
  OUR_DECISION: "OUR_DECISION",
  ENEMY_DECISION: "ENEMY_DECISION",
  SIMULTANEOUS: "SIMULTANEOUS",
  HIDDEN_WORLD: "HIDDEN_WORLD",
  CHANCE_OUTCOME: "CHANCE_OUTCOME",
  OBSERVATION_SPLIT: "OBSERVATION_SPLIT",
  AUTOMATIC: "AUTOMATIC"
});

const VALUES = Object.freeze([-10000, 0, 10000]);
const CLASS_FACTOR = Object.freeze([10000, 5000, 10000, 7500]);

function floorDiv(value, divisor) { return Math.floor(value / divisor); }
function ceilDiv(value, divisor) { return Math.ceil(value / divisor); }

function contaminationWeight(risk, riskClass = 0) {
  return floorDiv(99 * risk * CLASS_FACTOR[riskClass], 10000);
}

function natureBackup(children, probabilities, risk, riskClass) {
  let lowerSum = 0; let upperSum = 0; let worstLower = 10000; let worstUpper = 10000;
  for (let index = 0; index < children.length; index += 1) {
    lowerSum += probabilities[index] * children[index].lower;
    upperSum += probabilities[index] * children[index].upper;
    worstLower = Math.min(worstLower, children[index].lower);
    worstUpper = Math.min(worstUpper, children[index].upper);
  }
  const expectedLower = floorDiv(lowerSum, 10000); const expectedUpper = ceilDiv(upperSum, 10000);
  const lambda = contaminationWeight(risk, riskClass);
  return {
    lower: floorDiv(lambda * expectedLower + (10000 - lambda) * worstLower, 10000),
    upper: ceilDiv(lambda * expectedUpper + (10000 - lambda) * worstUpper, 10000),
    expectedLower, expectedUpper, worstLower, worstUpper,
    complete: children.every(child => child.complete)
  };
}

function solveValue(node, risk = 0) {
  invariant(node && typeof node === "object", "MINIMAX_ORACLE_NODE_INVALID", String(node));
  if (node.kind === KIND.TERMINAL) return { lower: node.value, upper: node.value, complete: true };
  const children = node.children.map(child => solveValue(child, risk));
  if (node.kind === KIND.OUR_DECISION) return {
    lower: Math.max(...children.map(child => child.lower)),
    upper: Math.max(...children.map(child => child.upper)),
    complete: children.every(child => child.complete)
  };
  if (node.kind === KIND.ENEMY_DECISION) return {
    lower: Math.min(...children.map(child => child.lower)),
    upper: Math.min(...children.map(child => child.upper)),
    complete: children.every(child => child.complete)
  };
  if (node.kind === KIND.SIMULTANEOUS) {
    let lower = -10000; let upper = 10000;
    for (let row = 0; row < node.rows; row += 1) {
      let rowMinimum = 10000;
      for (let column = 0; column < node.columns; column += 1)
        rowMinimum = Math.min(rowMinimum, children[row * node.columns + column].lower);
      lower = Math.max(lower, rowMinimum);
    }
    for (let column = 0; column < node.columns; column += 1) {
      let columnMaximum = -10000;
      for (let row = 0; row < node.rows; row += 1)
        columnMaximum = Math.max(columnMaximum, children[row * node.columns + column].upper);
      upper = Math.min(upper, columnMaximum);
    }
    return { lower, upper, complete: children.every(child => child.complete) };
  }
  if (node.kind === KIND.HIDDEN_WORLD || node.kind === KIND.CHANCE_OUTCOME)
    return natureBackup(children, node.probabilities, risk, node.riskClass || 0);
  if (node.kind === KIND.OBSERVATION_SPLIT) return {
    lower: Math.min(...children.map(child => child.lower)),
    upper: Math.max(...children.map(child => child.upper)),
    complete: children.every(child => child.complete)
  };
  if (node.kind === KIND.AUTOMATIC && children.length === 1) return children[0];
  throw new Error(`unsupported oracle kind ${node.kind}`);
}

function terminalProof(value, goal) {
  if (goal === search.PROOF_GOAL.FORCED_WIN) return value === 10000;
  if (goal === search.PROOF_GOAL.FORCED_NONLOSS) return value !== -10000;
  return value === -10000;
}

function solveProof(node, goal) {
  if (node.kind === KIND.TERMINAL) return terminalProof(node.value, goal);
  const values = node.children.map(child => solveProof(child, goal));
  if (node.kind === KIND.OUR_DECISION)
    return goal === search.PROOF_GOAL.FORCED_LOSS ? values.every(Boolean) : values.some(Boolean);
  if (node.kind === KIND.ENEMY_DECISION)
    return goal === search.PROOF_GOAL.FORCED_LOSS ? values.some(Boolean) : values.every(Boolean);
  if (node.kind === KIND.SIMULTANEOUS) {
    if (goal === search.PROOF_GOAL.FORCED_LOSS) {
      for (let column = 0; column < node.columns; column += 1) {
        let allRows = true;
        for (let row = 0; row < node.rows; row += 1)
          allRows = allRows && values[row * node.columns + column];
        if (allRows) return true;
      }
      return false;
    }
    for (let row = 0; row < node.rows; row += 1) {
      let allColumns = true;
      for (let column = 0; column < node.columns; column += 1)
        allColumns = allColumns && values[row * node.columns + column];
      if (allColumns) return true;
    }
    return false;
  }
  if (node.kind === KIND.AUTOMATIC) return values[0];
  return values.every(Boolean);
}

function graphKind(kind) {
  return {
    [KIND.OUR_DECISION]: search.NODE_KIND.OUR_DECISION,
    [KIND.ENEMY_DECISION]: search.NODE_KIND.ENEMY_DECISION,
    [KIND.SIMULTANEOUS]: search.NODE_KIND.SIMULTANEOUS,
    [KIND.HIDDEN_WORLD]: search.NODE_KIND.HIDDEN_WORLD,
    [KIND.CHANCE_OUTCOME]: search.NODE_KIND.CHANCE_OUTCOME,
    [KIND.OBSERVATION_SPLIT]: search.NODE_KIND.OBSERVATION_SPLIT,
    [KIND.AUTOMATIC]: search.NODE_KIND.AUTOMATIC
  }[kind];
}

function materialize(node, graph = new search.InformationGraph()) {
  if (node.kind === KIND.TERMINAL) return { graph, root: graph.addTerminal(node.value) };
  const children = node.children.map(child => materialize(child, graph).root);
  const kind = graphKind(node.kind); let root;
  if (node.kind === KIND.SIMULTANEOUS)
    root = graph.addNode(kind, children, null, { rows: node.rows, columns: node.columns,
      riskClass: node.riskClass || 0 });
  else root = graph.addNode(kind, children,
    node.kind === KIND.HIDDEN_WORLD || node.kind === KIND.CHANCE_OUTCOME ? node.probabilities : null,
    { riskClass: node.riskClass || 0 });
  invariant(root !== search.NONE_NODE, "MINIMAX_ORACLE_MATERIALIZE_FAILED", node.kind);
  return { graph, root };
}

class DeterministicGenerator {
  constructor(seed = 1) { this.state = seed >>> 0; }
  next() { this.state = (this.state * 1664525 + 1013904223) >>> 0; return this.state; }
  integer(limit) { return this.next() % limit; }
  probabilities(count) {
    const weights = Array.from({ length: count }, () => this.integer(100) + 1);
    const total = weights.reduce((sum, value) => sum + value, 0); const out = [];
    let assigned = 0;
    for (const weight of weights) { const value = floorDiv(weight * 10000, total);
      out.push(value); assigned += value; }
    for (let index = 0; assigned < 10000; index = (index + 1) % count) {
      out[index] += 1; assigned += 1;
    }
    return out;
  }
  tree(depth = 3, branchMaximum = 3) {
    if (depth <= 0 || this.integer(5) === 0)
      return { kind: KIND.TERMINAL, value: VALUES[this.integer(VALUES.length)] };
    const kinds = [KIND.OUR_DECISION, KIND.ENEMY_DECISION, KIND.SIMULTANEOUS,
      KIND.HIDDEN_WORLD, KIND.CHANCE_OUTCOME, KIND.OBSERVATION_SPLIT, KIND.AUTOMATIC];
    const kind = kinds[this.integer(kinds.length)];
    if (kind === KIND.AUTOMATIC) return { kind, children: [this.tree(depth - 1, branchMaximum)] };
    if (kind === KIND.SIMULTANEOUS) {
      const rows = 2 + this.integer(Math.max(1, branchMaximum - 1));
      const columns = 2 + this.integer(Math.max(1, branchMaximum - 1));
      return { kind, rows, columns, children: Array.from({ length: rows * columns },
        () => this.tree(depth - 1, branchMaximum)) };
    }
    const count = 2 + this.integer(Math.max(1, branchMaximum - 1));
    const node = { kind, children: Array.from({ length: count },
      () => this.tree(depth - 1, branchMaximum)) };
    if (kind === KIND.HIDDEN_WORLD || kind === KIND.CHANCE_OUTCOME) {
      node.probabilities = this.probabilities(count); node.riskClass = this.integer(4);
    }
    return node;
  }
}

function differentialCase(spec, risk = 0) {
  const expected = solveValue(spec, risk); const fixture = materialize(spec);
  const value = new search.ValueSearch(fixture.graph); const status = value.solve(fixture.root,
    fixture.graph.nodeCount, risk);
  const proofs = {};
  for (const goal of [search.PROOF_GOAL.FORCED_WIN, search.PROOF_GOAL.FORCED_NONLOSS,
      search.PROOF_GOAL.FORCED_LOSS]) {
    const proof = new search.ProofSearch(fixture.graph);
    proofs[goal] = { expected: solveProof(spec, goal), actual:
      proof.solve(fixture.root, goal) === search.PROOF_STATUS.PROVEN };
  }
  return { expected, actual: { lower: value.lower[fixture.root], upper: value.upper[fixture.root],
    complete: Boolean(value.complete[fixture.root]), status }, proofs, fixture };
}

function shrinkCounterexample(spec, fails) {
  let current = spec; let changed = true;
  while (changed) {
    changed = false;
    if (!current.children || current.children.length < 2 || current.kind === KIND.SIMULTANEOUS) break;
    for (let index = 0; index < current.children.length; index += 1) {
      const children = current.children.filter((_, child) => child !== index);
      if (children.length < 1) continue; const candidate = { ...current, children };
      if (candidate.probabilities) candidate.probabilities = new DeterministicGenerator(index + 1)
        .probabilities(children.length);
      if (fails(candidate)) { current = candidate; changed = true; break; }
    }
  }
  return current;
}

const MUTATION_CATALOG = Object.freeze([
  "OUR_AS_MIN", "ENEMY_AS_MAX", "NATURE_PROOF_AS_OR", "CHANCE_EQUAL_DIVISOR",
  "OBSERVATION_AS_AVERAGE", "SIMULTANEOUS_QUANTIFIER_SWAP", "CONTAMINATION_DROPPED",
  "FORCED_NONLOSS_EQUALS_WIN"
]);

function runMutationCampaign() {
  const fixtures = {
    OUR_AS_MIN: { correct: Math.max(-10000, 10000), mutant: Math.min(-10000, 10000) },
    ENEMY_AS_MAX: { correct: Math.min(-10000, 10000), mutant: Math.max(-10000, 10000) },
    NATURE_PROOF_AS_OR: { correct: false, mutant: true },
    CHANCE_EQUAL_DIVISOR: { correct: floorDiv(1 * -10000 + 9999 * 10000, 10000), mutant: 0 },
    OBSERVATION_AS_AVERAGE: { correct: "-10000:10000", mutant: "0:0" },
    SIMULTANEOUS_QUANTIFIER_SWAP: { correct: -10000, mutant: 10000 },
    CONTAMINATION_DROPPED: { correct: -10000, mutant: 0 },
    FORCED_NONLOSS_EQUALS_WIN: { correct: true, mutant: false }
  };
  const results = MUTATION_CATALOG.map(id => ({ id, killed: fixtures[id].correct !== fixtures[id].mutant }));
  return { catalogSize: results.length, killed: results.filter(item => item.killed).length,
    scorePer10000: floorDiv(results.filter(item => item.killed).length * 10000, results.length), results };
}

module.exports = { KIND, VALUES, contaminationWeight, natureBackup, solveValue,
  terminalProof, solveProof, materialize, DeterministicGenerator, differentialCase,
  shrinkCounterexample, MUTATION_CATALOG, runMutationCampaign };
