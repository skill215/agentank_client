"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { assertProfileId, contained } = require("../../tools/agentank/core/paths");
const { redactText, sanitizeForStorage } = require("../../tools/agentank/core/sanitize");
const { assertSafeArgv, resolveSecret } = require("../../tools/agentank/profiles/secret-ref");

test("profile ids and contained paths reject traversal", () => {
  assert.throws(() => assertProfileId("../v2"), { code: "INVALID_TANK_PROFILE_ID" });
  assert.throws(() => contained("/tmp/root", "..", "escape"), { code: "PATH_ESCAPE" });
});

test("command line rejects key options and values resembling production keys", () => {
  assert.throws(() => assertSafeArgv(["context", "--key", "value"]),
    { code: "SECRET_ON_COMMAND_LINE" });
  const keyLike = "agtk_" + "a".repeat(24);
  assert.throws(() => assertSafeArgv(["context", keyLike]), { code: "SECRET_ON_COMMAND_LINE" });
});

test("secret references read environment values without persisting them", () => {
  const ref = { provider: "ENV", name: "AGENTANK_KEY_V2", keyGenerationId: "g1" };
  assert.equal(resolveSecret(ref, { AGENTANK_KEY_V2: "test-secret-value-long-enough" }),
    "test-secret-value-long-enough");
  assert.throws(() => resolveSecret(ref, {}), { code: "SECRET_NOT_AVAILABLE" });
});

test("sanitizers redact key-like strings and sensitive fields", () => {
  const keyLike = "agtk_" + "b".repeat(24);
  assert.equal(redactText(`before ${keyLike} after`), "before [REDACTED_TANK_KEY] after");
  assert.deepEqual(sanitizeForStorage({ Authorization: "Bearer hidden", nested: keyLike }),
    { Authorization: "[REDACTED]", nested: "[REDACTED_TANK_KEY]" });
});
