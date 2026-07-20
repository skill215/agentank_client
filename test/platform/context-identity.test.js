"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { extractContextIdentity, verifyProfileIdentity } =
  require("../../tools/agentank/profiles/context-identity");

function profile(overrides = {}) {
  return { status: "ACTIVE", tankId: 42, skillId: "shield", ...overrides };
}

test("context identity extracts tank, skill, branch, and published code hash", () => {
  const identity = extractContextIdentity({
    tank: { id: 42, urlId: "tnk_test", skillType: "shield" },
    skill: { type: "shield" },
    latestCode: { code: "function onIdle() {}", version: 7 }
  }, "main");
  assert.equal(identity.tankId, 42);
  assert.equal(identity.skillId, "shield");
  assert.equal(identity.publishedVersion, 7);
  assert.match(identity.publishedCodeHash, /^[0-9a-f]{64}$/);
  assert.equal(identity.baselineStatus, "VERIFIED_BASELINE");
});

test("identity verification rejects cross-tank and cross-skill use", () => {
  const identity = { tankId: 43, skillId: "shield" };
  assert.throws(() => verifyProfileIdentity(profile(), identity), { code: "TANK_IDENTITY_MISMATCH" });
  assert.throws(() => verifyProfileIdentity(profile(), { tankId: 42, skillId: "boost" }),
    { code: "TANK_SKILL_MISMATCH" });
});

test("bootstrap identity may be bound exactly once", () => {
  assert.equal(verifyProfileIdentity(profile({ status: "BOOTSTRAP", tankId: null, skillId: "UNKNOWN" }),
    { tankId: 99, skillId: "stun" }, { allowBootstrap: true }), true);
});
