"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ProductionRootEngine } = require("../../engine-v2/src/runtime/production-root");
const { productionRootFixture } = require("../../tools/agentank/build/imp6-builder");
const { actionProxy } = require("../../tools/agentank/simulation/production-diagnostic-bot");
const { decisionMemoryFingerprint } =
  require("../../tools/agentank/fast-regression/memory-fingerprint");

function copy(value) { return JSON.parse(JSON.stringify(value)); }

test("observeOnly reconstructs fact memory without executing Minimax, plans, or caches", () => {
  const full = new ProductionRootEngine(); const restored = new ProductionRootEngine();
  for (let frame = 1; frame <= 6; frame += 1) {
    const fixture = productionRootFixture(); fixture.game.frames = frame; fixture.game.frame = frame;
    fixture.me = copy(fixture.me); fixture.enemy = copy(fixture.enemy); fixture.game = copy(fixture.game);
    const actions = []; const proxy = actionProxy(fixture.me, actions);
    full.decide(proxy, fixture.enemy, fixture.game);
    restored.observeOnly(fixture.me, fixture.enemy, fixture.game, actions[0]);
    assert.equal(decisionMemoryFingerprint(restored), decisionMemoryFingerprint(full), `frame=${frame}`);
    assert.equal(restored.depthSearch.nodes, 0); assert.equal(restored.informationSearch.nodes, 0);
    assert.equal(restored.forcedWinSearch.nodes, 0); assert.equal(restored.policy.plans.materializedCount, 0);
  }
});
