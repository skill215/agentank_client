"use strict";

const { rebuildCorpus } = require("../../tools/agentank/corpus/analyzer");
let memo;
function imp7Evidence() { if (!memo) memo = rebuildCorpus(); return memo; }
module.exports = { imp7Evidence };
