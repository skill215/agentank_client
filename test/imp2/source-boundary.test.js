"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const ref = require("../../engine-v2/src/reference");

const root = path.resolve(__dirname, "../..");
const loaded = ref.loadRuleCorpus(root);

test("downloaded Guide bytes match the RuleCorpus authority hash", () => {
  const bytes = fs.readFileSync(path.join(root, "docs", "agent-guide.md"));
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"),
    loaded.corpus.evidence.guideSha256);
});

test("external simulator and framework records are frozen to exact commits", () => {
  const simulator = ref.createSourceRecord("EXTERNAL_SIMULATOR",
    { commit: loaded.corpus.evidence.externalSimulatorCommit }, { state: "candidate" }, loaded);
  const framework = ref.createSourceRecord("FRAMEWORK",
    { commit: loaded.corpus.evidence.frameworkCommit }, { architecture: "candidate" }, loaded);
  assert.equal(simulator.authority, "CANDIDATE_ONLY");
  assert.equal(framework.authority, "CANDIDATE_ONLY");
  assert.throws(() => ref.createSourceRecord("FRAMEWORK", { commit: "main" }, {}, loaded), /not frozen/);
});

test("candidate-only external evidence cannot be promoted to strict platform truth", () => {
  const record = ref.createSourceRecord("EXTERNAL_SIMULATOR",
    { commit: loaded.corpus.evidence.externalSimulatorCommit }, { winner: 0 }, loaded);
  assert.throws(() => ref.assertStrictSource(record), error =>
    error.code === "CANDIDATE_SOURCE_PROMOTION_REJECTED");
  const platform = ref.createSourceRecord("PLATFORM_REPLAY", { matchId: "fixture" }, {}, loaded);
  assert.equal(ref.assertStrictSource(platform), platform);
});

test("rejected external defaults cannot overwrite shield poison frame-limit or chance semantics", () => {
  assert.deepEqual(loaded.corpus.rejectedExternalDefaults.map(item => item.id), [
    "EXTERNAL_BOMB_BEFORE_ACTION", "EXTERNAL_POISON_COOLDOWN_25", "EXTERNAL_FRAME_LIMIT_300",
    "EXTERNAL_STUN_50_50", "EXTERNAL_TELEPORT_UNIFORM", "EXTERNAL_TELEPORT_REVEAL_ONE_FRAME"]);
  assert.equal(loaded.corpus.constants.shieldBulletHits, 2);
  assert.equal(loaded.corpus.constants.skillCooldownFrames.poison, 20);
  assert.equal(loaded.corpus.constants.frameRecordLimit, 128);
});
