"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { measureCodeSize, assertCodeSize, PLATFORM_CODE_LIMIT_BYTES,
  PLATFORM_CODE_WARNING_BYTES } = require("../../tools/agentank/platform/code-size-policy");
const { createReleaseClient } = require("../../tools/agentank/platform/release-client");

test("platform code size is measured as exact UTF8 bytes at the 200 KiB boundary", () => {
  assert.equal(PLATFORM_CODE_LIMIT_BYTES, 204800);
  assert.equal(PLATFORM_CODE_WARNING_BYTES, 190000);
  const exact = "a".repeat(204800);
  assert.deepEqual(measureCodeSize(exact), {
    measurement: "UTF8_BYTES", utf8Bytes: 204800, maximumCodeBytes: 204800,
    warningCodeBytes: 190000, headroomBytes: 0, withinLimit: true, warning: true
  });
  assert.equal(assertCodeSize(exact, "publish").withinLimit, true);
  assert.throws(() => assertCodeSize(`${exact}a`, "publish"),
    { code: "PLATFORM_CODE_SIZE_LIMIT_EXCEEDED" });
});

test("multibyte code cannot bypass the UTF8 byte gate", () => {
  const code = `/*${"坦".repeat(70000)}*/function onIdle(){}`;
  const measured = measureCodeSize(code);
  assert.equal(measured.utf8Bytes, Buffer.byteLength(code, "utf8"));
  assert.ok(measured.utf8Bytes > code.length);
  assert.equal(measured.withinLimit, false);
  assert.throws(() => assertCodeSize(code, "simulate"),
    { code: "PLATFORM_CODE_SIZE_LIMIT_EXCEEDED" });
});

test("simulate and publish reject oversized bytes before any network request", () => {
  let requests = 0;
  const client = createReleaseClient({ secret: `agtk_${"a".repeat(32)}`,
    fetchImpl: async () => { requests += 1; throw new Error("must not request"); } });
  const code = "a".repeat(204801);
  assert.throws(() => client.simulate({ code, opponentBot: "nova-scout", mapId: "classic" }),
    { code: "PLATFORM_CODE_SIZE_LIMIT_EXCEEDED" });
  assert.throws(() => client.publish({ code, submittedBy: "Codex", branch: "main" }),
    { code: "PLATFORM_CODE_SIZE_LIMIT_EXCEEDED" });
  assert.equal(requests, 0);
});

test("publish rejects an unknown branch locally before any network request", () => {
  let requests = 0;
  const client = createReleaseClient({ secret: `agtk_${"a".repeat(32)}`,
    fetchImpl: async () => { requests += 1; throw new Error("must not request"); } });
  assert.throws(() => client.publish({ code: "function onIdle(){}",
    submittedBy: "Codex", branch: "__invalid__" }),
  { code: "IMP9_PUBLISH_REQUEST_INVALID" });
  assert.equal(requests, 0);
});
