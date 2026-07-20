"use strict";

const { AgentankToolError } = require("../core/errors");

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new AgentankToolError("UNEXPECTED_POSITIONAL_ARGUMENT", `unexpected argument: ${argument}`);
    }
    const equal = argument.indexOf("=");
    if (equal >= 0) {
      options[argument.slice(2, equal)] = argument.slice(equal + 1);
      continue;
    }
    const name = argument.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[name] = next;
      index++;
    } else {
      options[name] = true;
    }
  }
  return options;
}

function onlyOptions(options, allowed) {
  const allowedSet = new Set(allowed);
  for (const name of Object.keys(options)) {
    if (!allowedSet.has(name)) {
      throw new AgentankToolError("UNKNOWN_OPTION", `unknown option --${name}`);
    }
  }
  return options;
}

module.exports = { parseOptions, onlyOptions };
