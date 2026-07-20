"use strict";

const { AgentankToolError, invariant } = require("../core/errors");
const { redactText, sanitizeForStorage } = require("../core/sanitize");

const OFFICIAL_API_ROOT = "https://agentank.ai/api";

class PlatformHttpError extends AgentankToolError {
  constructor(status, message, details = null) {
    const retryClass = status === 429 ? "RATE_LIMIT_WAIT" :
      status >= 500 ? "SAFE_GET_RETRY" : "NO_RETRY";
    super("PLATFORM_HTTP_ERROR", message, { exitCode: 6, retryClass, details });
    this.status = status;
  }
}

function createPlatformClient(options) {
  const secret = options.secret;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const apiRoot = options.apiRoot || OFFICIAL_API_ROOT;
  const timeoutMs = options.timeoutMs || 15000;
  invariant(typeof secret === "string" && secret.length >= 16,
    "INVALID_PLATFORM_SECRET", "platform secret is missing");
  invariant(typeof fetchImpl === "function", "FETCH_UNAVAILABLE", "Node fetch is unavailable");

  async function requestJson(relativePath, requestOptions = {}) {
    invariant(relativePath.startsWith("/"), "INVALID_API_PATH", "API path must be relative to the API root");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const method = requestOptions.method || "GET";
    invariant(method === "GET", "IMP1_READ_ONLY_METHOD_REJECTED",
      "IMP1 platform client permits authenticated GET only");
    const headers = {
      Accept: "application/json",
      Authorization: `Bearer ${secret}`,
      "User-Agent": "Codex-AgenTank-platform-toolchain/0.1",
      ...(requestOptions.body === undefined ? {} : { "Content-Type": "application/json" })
    };
    try {
      const response = await fetchImpl(`${apiRoot}${relativePath}`, {
        method,
        headers,
        body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body),
        signal: controller.signal
      });
      const text = await response.text();
      let value = null;
      if (text.length > 0) {
        try {
          value = JSON.parse(text);
        } catch {
          throw new PlatformHttpError(response.status || 0,
            `platform returned non-JSON for ${method} ${relativePath}`);
        }
      }
      if (!response.ok) {
        const safeBody = redactText(JSON.stringify(sanitizeForStorage(value))).slice(0, 500);
        throw new PlatformHttpError(response.status,
          `platform ${method} ${relativePath} failed with HTTP ${response.status}`,
          { response: safeBody });
      }
      return value;
    } catch (error) {
      if (error instanceof AgentankToolError) throw error;
      if (error && error.name === "AbortError") {
        throw new AgentankToolError("PLATFORM_TIMEOUT", `platform ${method} ${relativePath} timed out`,
          { exitCode: 6, retryClass: method === "GET" ? "SAFE_GET_RETRY" : "RECONCILE_BEFORE_RETRY" });
      }
      throw new AgentankToolError("PLATFORM_NETWORK_ERROR",
        `platform ${method} ${relativePath} failed: ${redactText(error?.message || "network error")}`,
        { exitCode: 6, retryClass: method === "GET" ? "SAFE_GET_RETRY" : "RECONCILE_BEFORE_RETRY" });
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    requestJson,
    getTankContext(branch = "main") {
      const query = branch === "main" ? "" : `?branch=${encodeURIComponent(branch)}`;
      return requestJson(`/agent/tank${query}`);
    },
    listTankMatches(limit = 100, offset = 0) {
      invariant(Number.isSafeInteger(limit) && limit > 0 && limit <= 100,
        "INVALID_MATCH_LIMIT", "match limit must be 1..100");
      invariant(Number.isSafeInteger(offset) && offset >= 0,
        "INVALID_MATCH_OFFSET", "match offset must be non-negative");
      return requestJson(`/agent/tank/matches?limit=${limit}&offset=${offset}`);
    }
  };
}

module.exports = { OFFICIAL_API_ROOT, PlatformHttpError, createPlatformClient };
