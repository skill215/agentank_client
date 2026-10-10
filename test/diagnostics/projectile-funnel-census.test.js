"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { collectProjectileFunnel } = require(
  "../../tools/agentank/diagnostics/v2-native-initiative-arena");

function eventReplay(records) {
  return { replayData: { replay: { meta: { players: [
    { tank: { id: "a" } }, { tank: { id: "b" } }
  ] }, records } } };
}

test("projectile funnel attributes kills only to the exact go-crash sequence", () => {
  const replay = eventReplay([
    [
      { type: "bullet", action: "created", objectId: "p1",
        tank: { id: "a" } },
      { type: "bullet", action: "created", objectId: "p2",
        tank: { id: "b" } },
      { type: "bullet", action: "crashed", objectId: "p2",
        tank: { id: "b" } }
    ],
    [
      { type: "bullet", action: "go", objectId: "p1",
        tank: { id: "a" } },
      { type: "tank", action: "crashed", objectId: "b", index: 1 },
      { type: "bullet", action: "crashed", objectId: "p1",
        tank: { id: "a" } }
    ],
    [],
    [{ type: "tank", action: "crashed", objectId: "a", index: 0 }]
  ]);
  const result = collectProjectileFunnel(replay);
  assert.deepEqual(result.created, [1, 1]);
  assert.deepEqual(result.tankKills, [1, 0]);
  assert.deepEqual(result.noTankImpact, [0, 1]);
  assert.deepEqual(result.lifetimeFrames, [2, 1]);
  assert.equal(result.lifetimeHistogram[0][2], 1);
  assert.equal(result.lifetimeHistogram[1][1], 1);
  assert.deepEqual(result.counterCrashWithin4, [1, 1]);
});

test("projectile funnel separates terrain destruction and terminal survivors", () => {
  const replay = eventReplay([
    [
      { type: "bullet", action: "created", objectId: "p1",
        tank: { id: "a" } },
      { type: "bullet", action: "created", objectId: "p2",
        tank: { id: "b" } }
    ],
    [
      { type: "bullet", action: "go", objectId: "p1",
        tank: { id: "a" } },
      { type: "map", action: "destroyed", position: [2, 2] },
      { type: "bullet", action: "crashed", objectId: "p1",
        tank: { id: "a" } }
    ]
  ]);
  const result = collectProjectileFunnel(replay);
  assert.deepEqual(result.terrainHits, [1, 0]);
  assert.deepEqual(result.survivedAtTerminal, [0, 1]);
  assert.deepEqual(result.counterCrashWithin4, [0, 0]);
});
