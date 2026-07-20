"use strict";

const search = require("../../engine-v2/src/search");
const fast = require("../../engine-v2/src/fast");
const imp3 = require("../imp3/helpers");

function exactMatrix(values) {
  const matrix = new search.StageMatrix(); matrix.initialize(values.length, values[0].length);
  for (let row = 0; row < values.length; row += 1)
    for (let column = 0; column < values[row].length; column += 1)
      matrix.setCell(row, column, values[row][column], values[row][column], 1);
  return matrix;
}

function terminalMatrixGraph(values, options = {}) {
  const graph = new search.InformationGraph(); const children = [];
  for (let row = 0; row < values.length; row += 1)
    for (let column = 0; column < values[row].length; column += 1)
      children.push(values[row][column] === search.VALUE_MIN || values[row][column] === 0 ||
        values[row][column] === search.VALUE_MAX ? graph.addTerminal(values[row][column]) :
        graph.addLeaf(values[row][column], values[row][column],
          { kind: search.LEAF_KIND.HORIZON_EXACT }));
  const root = graph.addSimultaneous(values.length, values[0].length, children, options);
  return { graph, root, children };
}

module.exports = { search, fast, ...imp3, exactMatrix, terminalMatrixGraph };
