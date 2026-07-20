"use strict";

const codes = require("../abi/cache-runtime-codes");
const cache = require("./canonical-cache");

module.exports = { ...codes, ...cache };
