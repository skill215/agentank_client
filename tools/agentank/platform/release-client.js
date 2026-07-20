"use strict";

const { AgentankToolError, invariant } = require("../core/errors");
const { redactText, sanitizeForStorage } = require("../core/sanitize");
const { OFFICIAL_API_ROOT } = require("./client");
const { assertCodeSize } = require("./code-size-policy");

function createReleaseClient(options) {
  const secret = options.secret; const fetchImpl = options.fetchImpl || globalThis.fetch;
  invariant(typeof secret === "string" && secret.length >= 16, "INVALID_PLATFORM_SECRET",
    "platform secret is missing");
  invariant(typeof fetchImpl === "function", "FETCH_UNAVAILABLE", "Node fetch is unavailable");
  async function request(relativePath, method, body) {
    const allowed = (relativePath === "/agent/tank" && method === "GET") ||
      (relativePath === "/agent/tank/simulate" && method === "POST") ||
      (relativePath === "/agent/tank/code" && method === "POST");
    invariant(allowed, "IMP9_ENDPOINT_REJECTED", "IMP9 client excludes challenge and unrelated endpoints");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(),
      options.timeoutMs || 30000);
    try {
      const response = await fetchImpl(`${options.apiRoot || OFFICIAL_API_ROOT}${relativePath}`, {
        method, headers: { Accept: "application/json", Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json", "User-Agent": "Codex-AgenTank-release/0.1" },
        body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
      const text = await response.text(); let value;
      try { value = text ? JSON.parse(text) : null; } catch {
        throw new AgentankToolError("PLATFORM_NON_JSON", `${method} ${relativePath} returned non-JSON`,
          { exitCode: 6, retryClass: method === "GET" ? "SAFE_GET_RETRY" : "RECONCILE_BEFORE_RETRY" });
      }
      if (!response.ok) throw new AgentankToolError("PLATFORM_HTTP_ERROR",
        `platform ${method} ${relativePath} failed with HTTP ${response.status}`, {
          exitCode: 6, retryClass: response.status === 429 ? "RATE_LIMIT_WAIT" :
            method === "GET" ? "SAFE_GET_RETRY" : "RECONCILE_BEFORE_RETRY",
          details: { status: response.status,
            response: redactText(JSON.stringify(sanitizeForStorage(value))).slice(0, 500) } });
      return value;
    } catch (error) {
      if (error instanceof AgentankToolError) throw error;
      const aborted = error?.name === "AbortError";
      throw new AgentankToolError(aborted ? "PLATFORM_TIMEOUT" : "PLATFORM_NETWORK_ERROR",
        `platform ${method} ${relativePath} ${aborted ? "timed out" : "failed"}`, {
          exitCode: 6, retryClass: method === "GET" ? "SAFE_GET_RETRY" : "RECONCILE_BEFORE_RETRY" });
    } finally { clearTimeout(timer); }
  }
  return {
    getContext: () => request("/agent/tank", "GET"),
    simulate(body) {
      invariant(typeof body?.code === "string" && body.code.length > 0 &&
        typeof body.opponentBot === "string" && typeof body.mapId === "string",
      "IMP9_SIMULATION_REQUEST_INVALID", "simulation requires exact code, opponentBot and mapId");
      assertCodeSize(body.code, "simulate");
      return request("/agent/tank/simulate", "POST", body);
    },
    publish(body) {
      invariant(typeof body?.code === "string" && body.code.length > 0 &&
        typeof body.submittedBy === "string" && body.submittedBy.length > 0 &&
        ["main", "raid", "multiplayer"].includes(body.branch),
      "IMP9_PUBLISH_REQUEST_INVALID", "publish requires code, submittedBy and branch");
      assertCodeSize(body.code, "publish");
      return request("/agent/tank/code", "POST", body);
    }
  };
}

module.exports = { createReleaseClient };
