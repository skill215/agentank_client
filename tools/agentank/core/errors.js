"use strict";

class AgentankToolError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "AgentankToolError";
    this.code = code;
    this.exitCode = options.exitCode || 2;
    this.retryClass = options.retryClass || "NO_RETRY";
    this.details = options.details || null;
  }
}

function invariant(condition, code, message, options) {
  if (!condition) throw new AgentankToolError(code, message, options);
}

module.exports = { AgentankToolError, invariant };
