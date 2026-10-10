"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ENTRY, PLATFORM_RESERVED_PROPERTIES, UPLOAD_OPTIONS } = require(
  "../../tools/agentank/build/native-base-policy-upload-builder");

test("native upload build targets the standalone root", () => {
  assert.equal(ENTRY,
    "engine-v2/src/runtime/native-base-policy-production-entry.js");
  assert.equal(UPLOAD_OPTIONS.mangle.toplevel, true);
  assert.equal(UPLOAD_OPTIONS.mangle.properties.builtins, false);
  assert.equal(UPLOAD_OPTIONS.compress.passes, 5);
});

test("property mangle preserves every dynamic platform boundary", () => {
  const reserved = new Set(PLATFORM_RESERVED_PROPERTIES);
  for (const property of ["onIdle", "tank", "position", "direction", "bullet",
    "remainingCooldownFrames", "remainingFrames", "effects", "status",
    "canActThisFrame", "actionSpeed", "bombs", "explodeFrame", "placedFrame",
    "ownerId", "go", "turn", "fire", "throwBomb", "shield", "freeze",
    "stun", "overload", "cloak", "teleport", "poison", "boost", "up",
    "right", "down", "left"])
    assert.equal(reserved.has(property), true, property);
});
