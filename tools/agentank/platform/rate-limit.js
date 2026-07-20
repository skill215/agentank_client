"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { writeJsonAtomic, ensureDirectory } = require("../core/atomic-file");
const { sha256Text } = require("../core/hash");
const { AgentankToolError, invariant } = require("../core/errors");
const { workspacePaths } = require("../core/paths");

function ownerScopeFiles(workspaceRoot, ownerScopeId) {
  invariant(typeof ownerScopeId === "string" && ownerScopeId.length > 0,
    "INVALID_OWNER_SCOPE", "ownerScopeId is required");
  const paths = workspacePaths(workspaceRoot);
  const suffix = sha256Text(ownerScopeId).slice(0, 20);
  return {
    state: path.join(paths.control, "rate-limit", `owner-${suffix}.json`),
    lock: path.join(paths.control, "locks", `owner-${suffix}.lock`)
  };
}

function readState(file, ownerScopeId) {
  if (!fs.existsSync(file)) {
    return { schemaVersion: 1, ownerScopeId, nextAllowedAtMs: 0, lastOperation: null,
      updatedAt: null };
  }
  const state = JSON.parse(fs.readFileSync(file, "utf8"));
  invariant(state.schemaVersion === 1 && state.ownerScopeId === ownerScopeId,
    "RATE_LIMIT_STATE_MISMATCH", "owner-scope rate-limit state is invalid");
  invariant(Number.isSafeInteger(state.nextAllowedAtMs) && state.nextAllowedAtMs >= 0,
    "RATE_LIMIT_STATE_INVALID_TIME", "rate-limit nextAllowedAtMs is invalid");
  return state;
}

function withOwnerLock(lockFile, callback, options = {}) {
  ensureDirectory(path.dirname(lockFile));
  const nowMs = options.nowMs ?? Date.now();
  const staleAfterMs = options.staleAfterMs || 30000;
  const token = crypto.randomUUID();
  let descriptor;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      descriptor = fs.openSync(lockFile, "wx", 0o600);
      fs.writeFileSync(descriptor, JSON.stringify({ token, pid: process.pid, acquiredAtMs: nowMs }));
      fs.closeSync(descriptor);
      descriptor = undefined;
      break;
    } catch (error) {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      if (error.code !== "EEXIST") throw error;
      let existing;
      try { existing = JSON.parse(fs.readFileSync(lockFile, "utf8")); } catch { existing = null; }
      if (attempt === 0 && existing && Number.isSafeInteger(existing.acquiredAtMs) &&
          nowMs - existing.acquiredAtMs > staleAfterMs) {
        try { fs.renameSync(lockFile, `${lockFile}.stale-${nowMs}`); } catch {}
        continue;
      }
      throw new AgentankToolError("OWNER_SCOPE_LOCKED", "owner-scope mutation lock is already held",
        { exitCode: 9, retryClass: "RATE_LIMIT_WAIT" });
    }
  }
  try {
    return callback();
  } finally {
    try {
      const existing = JSON.parse(fs.readFileSync(lockFile, "utf8"));
      if (existing.token === token) fs.unlinkSync(lockFile);
    } catch {}
  }
}

function reserveOwnerScope(workspaceRoot, ownerScopeId, operation, options = {}) {
  const files = ownerScopeFiles(workspaceRoot, ownerScopeId);
  const nowMs = options.nowMs ?? Date.now();
  const intervalMs = options.intervalMs || 2000;
  return withOwnerLock(files.lock, () => {
    const state = readState(files.state, ownerScopeId);
    const waitMs = Math.max(0, state.nextAllowedAtMs - nowMs);
    if (waitMs > 0) {
      throw new AgentankToolError("OWNER_SCOPE_RATE_LIMITED",
        `owner scope is not ready for another mutation; wait ${waitMs}ms`, {
          exitCode: 6,
          retryClass: "RATE_LIMIT_WAIT",
          details: { waitMs, nextAllowedAtMs: state.nextAllowedAtMs }
        });
    }
    const updated = {
      schemaVersion: 1,
      ownerScopeId,
      nextAllowedAtMs: nowMs + intervalMs,
      lastOperation: operation,
      updatedAt: new Date(nowMs).toISOString()
    };
    writeJsonAtomic(files.state, updated);
    return { waitMs: 0, ...updated, stateFile: files.state };
  }, { nowMs, staleAfterMs: options.staleAfterMs });
}

function recordServerNextAllowed(workspaceRoot, ownerScopeId, nextAllowedAtMs, operation,
  options = {}) {
  invariant(Number.isSafeInteger(nextAllowedAtMs) && nextAllowedAtMs >= 0,
    "INVALID_SERVER_NEXT_ALLOWED", "server next allowed timestamp is invalid");
  const files = ownerScopeFiles(workspaceRoot, ownerScopeId);
  const nowMs = options.nowMs ?? Date.now();
  return withOwnerLock(files.lock, () => {
    const state = readState(files.state, ownerScopeId);
    const updated = {
      schemaVersion: 1,
      ownerScopeId,
      nextAllowedAtMs: Math.max(state.nextAllowedAtMs, nextAllowedAtMs),
      lastOperation: operation,
      updatedAt: new Date(nowMs).toISOString()
    };
    writeJsonAtomic(files.state, updated);
    return updated;
  }, { nowMs, staleAfterMs: options.staleAfterMs });
}

module.exports = {
  ownerScopeFiles,
  readState,
  withOwnerLock,
  reserveOwnerScope,
  recordServerNextAllowed
};
