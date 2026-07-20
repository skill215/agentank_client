"use strict";

const SECRET_PATTERN = /agtk_[A-Za-z0-9_-]{20,}/g;
const SENSITIVE_NAMES = new Set([
  "authorization", "password", "secret", "token", "tankkey", "apikey", "api_key"
]);

function redactText(value) {
  return String(value).replace(SECRET_PATTERN, "[REDACTED_TANK_KEY]");
}

function sanitizeForStorage(value, seen = new WeakSet()) {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[REDACTED_CYCLE]";
  seen.add(value);
  if (Array.isArray(value)) return value.map(item => sanitizeForStorage(item, seen));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
    output[key] = SENSITIVE_NAMES.has(normalized) ? "[REDACTED]" : sanitizeForStorage(item, seen);
  }
  return output;
}

module.exports = { SECRET_PATTERN, redactText, sanitizeForStorage };
