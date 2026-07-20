"use strict";

const { AgentankToolError, invariant } = require("../core/errors");
const { SECRET_PATTERN } = require("../core/sanitize");

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const FORBIDDEN_OPTIONS = new Set(["--key", "--tank-key", "--token", "--authorization"]);

function assertSafeArgv(argv) {
  for (const argument of argv) {
    const option = String(argument).split("=", 1)[0].toLowerCase();
    if (FORBIDDEN_OPTIONS.has(option)) {
      throw new AgentankToolError("SECRET_ON_COMMAND_LINE",
        "key/token command-line options are forbidden; use a TankProfile secretRef");
    }
    SECRET_PATTERN.lastIndex = 0;
    if (SECRET_PATTERN.test(String(argument))) {
      throw new AgentankToolError("SECRET_ON_COMMAND_LINE",
        "a value resembling a Tank Key was found on the command line");
    }
  }
}

function validateSecretRef(secretRef) {
  invariant(secretRef && typeof secretRef === "object", "INVALID_SECRET_REF", "secretRef is required");
  invariant(secretRef.provider === "ENV", "UNSUPPORTED_SECRET_PROVIDER",
    "only ENV secret references are implemented in the first platform toolchain");
  invariant(ENV_NAME.test(secretRef.name || ""), "INVALID_SECRET_ENV_NAME",
    "ENV secretRef name must be an uppercase environment variable name");
  invariant(typeof secretRef.keyGenerationId === "string" && secretRef.keyGenerationId.length > 0,
    "INVALID_KEY_GENERATION", "keyGenerationId is required");
  return secretRef;
}

function resolveSecret(secretRef, environment = process.env) {
  validateSecretRef(secretRef);
  const value = environment[secretRef.name];
  invariant(typeof value === "string" && value.length >= 16, "SECRET_NOT_AVAILABLE",
    `Tank Key environment variable ${secretRef.name} is missing or invalid`, { exitCode: 4 });
  return value;
}

module.exports = { ENV_NAME, assertSafeArgv, validateSecretRef, resolveSecret };
