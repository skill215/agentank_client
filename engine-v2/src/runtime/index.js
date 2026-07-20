"use strict";

const codes = require("../abi/cache-runtime-codes");
const controller = require("./controller");

module.exports = { ...codes, ...controller };
