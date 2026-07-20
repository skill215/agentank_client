"use strict";

const policy = require("../../../config/agentank/platform-code-size-policy.json");
const { invariant } = require("../core/errors");

const PLATFORM_CODE_LIMIT_BYTES = policy.maximumCodeBytes;
const PLATFORM_CODE_WARNING_BYTES = policy.warningCodeBytes;

function measureCodeSize(code) {
  invariant(typeof code === "string" && code.length > 0,
    "PLATFORM_CODE_EMPTY", "candidate code must be a non-empty string");
  const utf8Bytes = Buffer.byteLength(code, "utf8");
  return Object.freeze({
    measurement: policy.measurement,
    utf8Bytes,
    maximumCodeBytes: PLATFORM_CODE_LIMIT_BYTES,
    warningCodeBytes: PLATFORM_CODE_WARNING_BYTES,
    headroomBytes: PLATFORM_CODE_LIMIT_BYTES - utf8Bytes,
    withinLimit: utf8Bytes <= PLATFORM_CODE_LIMIT_BYTES,
    warning: utf8Bytes >= PLATFORM_CODE_WARNING_BYTES
  });
}

function assertCodeSize(code, operation) {
  invariant(policy.appliesTo.includes(operation), "PLATFORM_CODE_OPERATION_INVALID",
    `unsupported code-size operation: ${operation}`);
  const measured = measureCodeSize(code);
  invariant(measured.withinLimit, "PLATFORM_CODE_SIZE_LIMIT_EXCEEDED",
    `${operation} code is ${measured.utf8Bytes} UTF-8 bytes; maximum is ` +
      `${measured.maximumCodeBytes} bytes`);
  return measured;
}

module.exports = { policy, PLATFORM_CODE_LIMIT_BYTES, PLATFORM_CODE_WARNING_BYTES,
  measureCodeSize, assertCodeSize };
