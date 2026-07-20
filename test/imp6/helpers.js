"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const fast = require("../../engine-v2/src/fast");
const search = require("../../engine-v2/src/search");
const policy = require("../../engine-v2/src/policy");
const cache = require("../../engine-v2/src/cache");
const runtime = require("../../engine-v2/src/runtime");
const cacheCodes = require("../../engine-v2/src/abi/cache-runtime-codes");
const runtimeConfig = require("../../engine-v2/src/generated/runtime-config");
const { buildImp6Production } = require("../../tools/agentank/build/imp6-builder");
const { runImp6Benchmark } = require("../../tools/agentank/benchmark/imp6-runner");

function boxedMap(width = 7, height = 5) {
  return Array.from({ length: width }, (_, x) => Array.from({ length: height }, (_, y) =>
    x === 0 || y === 0 || x === width - 1 || y === height - 1 ? "x" : "."));
}
function tank(seat, cell, direction, extra = {}) {
  return { entityId: seat + 1, seat, cell, direction, crashed: false, stars: 0, runtimeMs: 0,
    skillId: null, skillReadyFrame: 0, shieldHitsRemaining: 0, shieldUntilFrame: null,
    frozenUntilFrame: null, stunUntilFrame: null, overloadUntilFrame: null,
    cloakUntilFrame: null, poisonAppliedFrame: null, poisonUntilFrame: null,
    boostUntilFrame: null, revealUntilFrame: null, pickupLockUntilFrame: null,
    fireLockUntilFrame: null, bombCooldownReadyFrame: 0, ...extra };
}
function physical(overrides = {}) {
  return { platformFrame: 0, recordIndex: 0,
    map: { width: 7, height: 5, terrainColumnMajor: boxedMap() },
    tanks: [tank(0, [1, 1], "right", { skillId: "poison" }),
      tank(1, [5, 3], "left", { skillId: "overload" })],
    projectiles: [], bombs: [], star: null,
    terminalFlags: { timeoutSeat: null, scriptErrorSeat: null }, ...overrides };
}
function terminalMatrixGraph(values) {
  const graph = new search.InformationGraph(); const children = [];
  for (let row = 0; row < values.length; row += 1)
    for (let column = 0; column < values[row].length; column += 1)
      children.push(graph.addTerminal(values[row][column]));
  return { graph, root: graph.addSimultaneous(values.length, values[0].length, children) };
}

let evidencePromise = null;
function imp6Evidence() {
  if (!evidencePromise) evidencePromise = (async () => {
    const workspaceRoot = path.resolve(__dirname, "../..");
    const leftDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-imp6-build-a-"));
    const rightDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-imp6-build-b-"));
    const benchmarkDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "agentank-imp6-bench-"));
    const left = await buildImp6Production({ workspaceRoot, outputDirectory: leftDirectory });
    const right = await buildImp6Production({ workspaceRoot, outputDirectory: rightDirectory });
    const benchmark = await runImp6Benchmark({ workspaceRoot, outputDirectory: benchmarkDirectory,
      buildResult: left });
    return { workspaceRoot, left, right, benchmark };
  })();
  return evidencePromise;
}

module.exports = { fast, search, policy, cache, runtime, cacheCodes, runtimeConfig,
  boxedMap, tank, physical, terminalMatrixGraph, imp6Evidence };
