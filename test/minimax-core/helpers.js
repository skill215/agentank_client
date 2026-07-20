"use strict";

const search = require("../../engine-v2/src/search");

const VALUES = Object.freeze([search.VALUE_MIN, 0, search.VALUE_MAX]);

function forEachVector(length, callback) {
  const vector = new Int16Array(length); const indexes = new Uint8Array(length);
  for (;;) {
    for (let index = 0; index < length; index += 1) vector[index] = VALUES[indexes[index]];
    callback(vector);
    let cursor = length - 1;
    while (cursor >= 0 && indexes[cursor] === VALUES.length - 1) {
      indexes[cursor] = 0; cursor -= 1;
    }
    if (cursor < 0) break;
    indexes[cursor] += 1;
  }
}

function exactLeaf(graph, value) {
  return value === search.VALUE_MIN || value === 0 || value === search.VALUE_MAX ?
    graph.addTerminal(value) : graph.addLeaf(value, value, { kind: search.LEAF_KIND.HORIZON_EXACT });
}

function exactMatrix(values, rows = 2, columns = 2) {
  const matrix = new search.StageMatrix({ maxRows: Math.max(3, rows),
    maxColumns: Math.max(3, columns) });
  matrix.initialize(rows, columns);
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1) {
      const value = values[row * columns + column]; matrix.setCell(row, column, value, value, 1);
    }
  return matrix;
}

function terminalMatrixGraph(values, rows = 2, columns = 2, options = {}) {
  const graph = new search.InformationGraph(); const children = new Uint16Array(rows * columns);
  for (let index = 0; index < children.length; index += 1)
    children[index] = exactLeaf(graph, values[index]);
  const root = graph.addSimultaneousFromBuffer(rows, columns, children, 0,
    options.riskClass || 0);
  if (options.supportComplete === false) {
    graph.coverageMask[root] &= ~(search.COVERAGE.OUR_ACTIONS |
      search.COVERAGE.ENEMY_POLICIES | search.COVERAGE.NO_CAPACITY_TRUNCATION);
    graph.incompleteReason[root] |= search.INCOMPLETE.SUPPORT;
  }
  return { graph, root, children };
}

function terminalPredicate(value, goal) {
  if (goal === search.PROOF_GOAL.FORCED_WIN) return value === search.VALUE_MAX;
  if (goal === search.PROOF_GOAL.FORCED_NONLOSS) return value !== search.VALUE_MIN;
  return value === search.VALUE_MIN;
}

function proofBoolean(kind, goal, children) {
  const isOr = kind === search.NODE_KIND.OUR_DECISION ?
    goal !== search.PROOF_GOAL.FORCED_LOSS :
    kind === search.NODE_KIND.ENEMY_DECISION ? goal === search.PROOF_GOAL.FORCED_LOSS : false;
  return isOr ? children.some(Boolean) : children.every(Boolean);
}

module.exports = { search, VALUES, forEachVector, exactLeaf, exactMatrix,
  terminalMatrixGraph, terminalPredicate, proofBoolean };
