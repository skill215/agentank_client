"use strict";

const { AgentankToolError, invariant } = require("../core/errors");
const { redactText, sanitizeForStorage } = require("../core/sanitize");
const { OFFICIAL_API_ROOT, PlatformHttpError } = require("./client");

function createOfficialProbeClient(options) {
  const secret = options.secret; const fetchImpl = options.fetchImpl || globalThis.fetch;
  invariant(typeof secret === "string" && secret.length >= 16, "INVALID_PLATFORM_SECRET",
    "platform secret is missing");
  invariant(typeof fetchImpl === "function", "FETCH_UNAVAILABLE", "Node fetch is unavailable");
  async function request(relativePath, method, body) {
    invariant(relativePath === "/agent/tank" || relativePath === "/agent/tank/simulate",
      "IMP2_PROBE_ENDPOINT_REJECTED", "IMP2 probe client only permits context and simulate endpoints");
    invariant((relativePath === "/agent/tank" && method === "GET") ||
      (relativePath === "/agent/tank/simulate" && method === "POST"),
    "IMP2_PROBE_METHOD_REJECTED", "endpoint/method pair is not allowed");
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(),
      options.timeoutMs || 30000);
    try {
      const response = await fetchImpl(`${OFFICIAL_API_ROOT}${relativePath}`, { method,
        headers: { Accept: "application/json", Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json", "User-Agent": "Codex-AgenTank-rule-probe/0.1" },
        body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
      const text = await response.text(); let value;
      try { value = text ? JSON.parse(text) : null; } catch {
        throw new PlatformHttpError(response.status || 0, `platform returned non-JSON for ${method}`);
      }
      if (!response.ok) throw new PlatformHttpError(response.status,
        `platform ${method} ${relativePath} failed with HTTP ${response.status}`,
        { response: redactText(JSON.stringify(sanitizeForStorage(value))).slice(0, 500) });
      return value;
    } catch (error) {
      if (error instanceof AgentankToolError) throw error;
      if (error?.name === "AbortError") throw new AgentankToolError("PLATFORM_TIMEOUT",
        `platform ${method} ${relativePath} timed out`, { exitCode: 6,
          retryClass: method === "GET" ? "SAFE_GET_RETRY" : "RECONCILE_BEFORE_RETRY" });
      throw new AgentankToolError("PLATFORM_NETWORK_ERROR",
        `platform ${method} ${relativePath} failed: ${redactText(error?.message || "network error")}`,
        { exitCode: 6, retryClass: method === "GET" ? "SAFE_GET_RETRY" : "RECONCILE_BEFORE_RETRY" });
    } finally { clearTimeout(timer); }
  }
  return { getContext: () => request("/agent/tank", "GET"),
    simulate: body => request("/agent/tank/simulate", "POST", body) };
}

module.exports = { createOfficialProbeClient };
