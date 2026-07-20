"use strict";

const { VALUE_MIN, VALUE_MAX, PROBABILITY_SCALE } = require("../abi/search-codes");

function floorDiv(numerator, denominator) {
  return Math.floor(numerator / denominator);
}
function ceilDiv(numerator, denominator) {
  return Math.ceil(numerator / denominator);
}
function clampValue(value) {
  return value < VALUE_MIN ? VALUE_MIN : value > VALUE_MAX ? VALUE_MAX : value;
}
function weightedLower(sum) { return clampValue(floorDiv(sum, PROBABILITY_SCALE)); }
function weightedUpper(sum) { return clampValue(ceilDiv(sum, PROBABILITY_SCALE)); }
function contaminatedLower(lambda, expected, worst) {
  return clampValue(floorDiv(lambda * expected + (PROBABILITY_SCALE - lambda) * worst,
    PROBABILITY_SCALE));
}
function contaminatedUpper(lambda, expected, worst) {
  return clampValue(ceilDiv(lambda * expected + (PROBABILITY_SCALE - lambda) * worst,
    PROBABILITY_SCALE));
}
function saturatedAdd(left, right, limit) {
  const value = left + right; return value >= limit ? limit : value;
}

module.exports = { floorDiv, ceilDiv, clampValue, weightedLower, weightedUpper,
  contaminatedLower, contaminatedUpper, saturatedAdd };
