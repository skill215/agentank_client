"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { INFORMATION_SUPPORT_LOSS, InformationSupportProbe } = require(
  "../../tools/agentank/diagnostics/information-support-probe");

function fakeSearch() {
  return {
    workInterruptedCount: 0,
    rootRestoreFailures: 0,
    lastSelectedWorldCount: 0,
    lastEffectiveEnemyCount: 0,
    lastContinuationPool: 0,
    supportComplete: 0,
    approximate: 1,
    search(...args) {
      this.lastSelectedWorldCount = args[10];
      this.lastEffectiveEnemyCount = args[7];
      this.supportComplete = args[11] && args[15] ? 1 : 0;
      this.approximate = this.supportComplete ? 0 : 1;
      return 1;
    },
    applyRiskEnvelopes() {
      this.supportComplete = 0;
      this.approximate = 1;
      return 1;
    }
  };
}

function call(search, inputSupport = 1, directionComplete = 1) {
  const mass = new Uint16Array([10000]);
  return search.search({}, {}, new Uint8Array(1), new Uint16Array(1), 1,
    new Uint8Array(1), new Uint16Array(1), 1,
    new Uint16Array(1), mass, 1, inputSupport, 32, 50, 0,
    directionComplete, new Uint16Array([10000]), 1, 0);
}

test("Information support probe observes support loss without changing values", () => {
  const search = fakeSearch();
  const probe = new InformationSupportProbe({ informationSearch: search });
  assert.equal(call(search), 1);
  assert.equal(search.supportComplete, 1);
  assert.deepEqual(probe.summary().lossCounts, {
    INPUT_SUPPORT: 0, WORLD_SELECTION: 0, WORLD_MASS: 0,
    DIRECTION_SUPPORT: 0, ENEMY_COLUMNS: 0, RECURSIVE_POLICY: 0,
    WORK_INTERRUPTED: 0, NO_RESULT: 0, ROOT_RESTORE: 0
  });
  assert.equal(probe.summary().exactAfterSearch, 1);
  search.applyRiskEnvelopes();
  assert.equal(probe.summary().exactLostToRiskEnvelope, 1);
});

test("Information support probe records overlapping input and direction losses", () => {
  const search = fakeSearch();
  const probe = new InformationSupportProbe({ informationSearch: search });
  call(search, 0, 0);
  const summary = probe.summary();
  const mask = INFORMATION_SUPPORT_LOSS.INPUT_SUPPORT |
    INFORMATION_SUPPORT_LOSS.DIRECTION_SUPPORT;
  assert.equal(summary.maskCounts[mask], 1);
  assert.equal(summary.lossCounts.INPUT_SUPPORT, 1);
  assert.equal(summary.lossCounts.DIRECTION_SUPPORT, 1);
  assert.equal(summary.inexactAfterSearch, 1);
});
