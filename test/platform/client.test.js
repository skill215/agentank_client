"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPlatformClient } = require("../../tools/agentank/platform/client");

test("platform client uses bearer auth in memory and parses context", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return { ok: true, status: 200, text: async () => JSON.stringify({ tank: { id: 1 } }) };
  };
  const secret = "test-secret-value-long-enough";
  const client = createPlatformClient({ secret, fetchImpl, apiRoot: "https://example.invalid/api" });
  const value = await client.getTankContext("main");
  assert.equal(value.tank.id, 1);
  assert.equal(captured.url, "https://example.invalid/api/agent/tank");
  assert.equal(captured.options.headers.Authorization, `Bearer ${secret}`);
});

test("platform HTTP errors do not expose key-like response values", async () => {
  const keyLike = "agtk_" + "c".repeat(24);
  const fetchImpl = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ message: `bad ${keyLike}` })
  });
  const client = createPlatformClient({
    secret: "test-secret-value-long-enough",
    fetchImpl,
    apiRoot: "https://example.invalid/api"
  });
  await assert.rejects(client.getTankContext("main"), error => {
    assert.equal(error.status, 401);
    assert.equal(JSON.stringify(error.details).includes(keyLike), false);
    return true;
  });
});
