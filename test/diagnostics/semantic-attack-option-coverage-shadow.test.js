"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTION, HARD_STATUS } = require(
  "../../engine-v2/src/abi/fast-codes");
const { COMBAT_PURPOSE } = require(
  "../../engine-v2/src/abi/policy-codes");
const { OPTION_KIND } = require(
  "../../engine-v2/src/policy/option-portfolio");
const { LONG_OPTION } = require(
  "../../tools/agentank/diagnostics/event-driven-option-shadow");
const { SemanticAttackOptionCoverageShadow } = require(
  "../../tools/agentank/diagnostics/semantic-attack-option-coverage-shadow");

function engine(options = {}) {
  const actions = options.actions || [ACTION.GO, ACTION.FIRE];
  const flags = options.flags || [0, COMBAT_PURPOSE.DIRECT_KILL];
  const completeness = options.completeness || [0, 10000];
  const support = options.support ?? 1;
  return {
    ourCount: actions.length, ourActions: actions,
    diagnosticInternalSelectedIndex: options.selected ?? 0,
    adapter: { enemyVisible: options.visible ?? 1 },
    combat: { vector: { purposeFlags: Uint8Array.from(flags),
      purposeCompleteness: Uint16Array.from(completeness),
      postFireEscape: Uint8Array.from([0, options.postFireEscape ?? 1]) } },
    optionPortfolio: { count: 1, primitiveRow: Uint8Array.from([1]),
      kind: Uint8Array.from([OPTION_KIND.DIRECT_KILL]),
      supportComplete: Uint8Array.from([support]) },
    hardStatus: Uint8Array.from(actions.map(() => HARD_STATUS.ALLOW)),
    riskController: { outcome: { count: actions.length,
      acceptable: Uint8Array.from(actions.map(() => 1)),
      dominated: Uint8Array.from(actions.map(() => 0)) } }
  };
}

test("strict ATTACK funnel remains behavior neutral and counts selected outside", () => {
  const epoch = { activeGeneration: 1, activeKind: LONG_OPTION.ATTACK };
  const census = new SemanticAttackOptionCoverageShadow(epoch);
  const subject = engine();
  census.observe(subject, ACTION.GO);
  const summary = census.summary();
  assert.equal(subject.diagnosticInternalSelectedIndex, 0);
  assert.equal(summary.funnel.STRICT, 1);
  assert.equal(summary.strictByAction.FIRE, 1);
  assert.equal(summary.selectedOutsideStrictAttackCount, 1);
  assert.equal(summary.attackEpochStrictSupportCount, 1);
});

test("incomplete FIRE escape is separated before portfolio support", () => {
  const census = new SemanticAttackOptionCoverageShadow(null);
  census.observe(engine({ postFireEscape: 0, support: 0 }), ACTION.GO);
  const summary = census.summary();
  assert.equal(summary.funnel.INCOMPLETE_PURPOSE_OR_ESCAPE, 1);
  assert.equal(summary.strictAttackRootCount, 0);
});

test("zone denial is soft-only evidence and cannot masquerade as strict ATTACK", () => {
  const subject = engine({ flags: [0, COMBAT_PURPOSE.ZONE_DENIAL], support: 0 });
  const census = new SemanticAttackOptionCoverageShadow(null);
  census.observe(subject, ACTION.GO);
  const summary = census.summary();
  assert.equal(summary.funnel.SOFT_ONLY_EVIDENCE, 1);
  assert.equal(summary.generatorEvidenceRootCount, 0);
  assert.equal(summary.strictAttackRootCount, 0);
});

test("terminal NONE sentinel is excluded from the production selection domain", () => {
  const subject = engine({
    actions: [ACTION.GO, ACTION.NONE],
    flags: [0, COMBAT_PURPOSE.DIRECT_KILL],
    completeness: [0, 10000], support: 0
  });
  subject.optionPortfolio.count = 0;
  const census = new SemanticAttackOptionCoverageShadow(null);
  census.observe(subject, ACTION.GO);
  const summary = census.summary();
  assert.equal(summary.funnel.NO_COMBAT_EVIDENCE, 1);
  assert.equal(summary.generatorEvidenceRootCount, 0);
  assert.equal(summary.portfolioAttackRootCount, 0);
});
