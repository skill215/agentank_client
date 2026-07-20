"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { reserveOwnerScope, ownerScopeFiles, recordServerNextAllowed } =
  require("../../tools/agentank/platform/rate-limit");

test("different tank profiles sharing an owner also share one cooldown", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-rate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = reserveOwnerScope(root, "same-owner", "v1:simulate", { nowMs: 1000, intervalMs: 2000 });
  assert.equal(first.nextAllowedAtMs, 3000);
  assert.throws(() => reserveOwnerScope(root, "same-owner", "v2:simulate",
    { nowMs: 1500, intervalMs: 2000 }), error => {
      assert.equal(error.code, "OWNER_SCOPE_RATE_LIMITED");
      assert.equal(error.details.waitMs, 1500);
      return true;
    });
  assert.doesNotThrow(() => reserveOwnerScope(root, "other-owner", "v3:simulate",
    { nowMs: 1500, intervalMs: 2000 }));
  assert.notEqual(ownerScopeFiles(root, "same-owner").state, ownerScopeFiles(root, "other-owner").state);
});

test("server nextSimulationAt can only extend the local cooldown", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-rate-server-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  reserveOwnerScope(root, "same-owner", "simulate", { nowMs: 1000, intervalMs: 2000 });
  const state = recordServerNextAllowed(root, "same-owner", 5000, "server:429", { nowMs: 1200 });
  assert.equal(state.nextAllowedAtMs, 5000);
  const lower = recordServerNextAllowed(root, "same-owner", 4000, "server:context", { nowMs: 1300 });
  assert.equal(lower.nextAllowedAtMs, 5000);
});
