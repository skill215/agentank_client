"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SUPPORT_STATUS } = require("../../engine-v2/src/runtime/escape-obligation");
const { ROOT_CONTROL_MODE, ROOT_CONTROL_REASON, TACTICAL_TRIGGER, ControlModeRouter } =
  require("../../engine-v2/src/runtime/root-control-mode");
const { TacticalEnvelopeView } = require("../../engine-v2/src/search/tactical-envelope");
const { RiskAcceptanceController } =
  require("../../engine-v2/src/search/risk-acceptance-controller");
const { HARD_STATUS } = require("../../engine-v2/src/abi/fast-codes");
const { SAFETY_STATUS } = require("../../engine-v2/src/search/information-safety-closure");

function escape(status, entities, members) {
  return { supportStatus: status, committedEntityCount: entities,
    firstActionCount: members };
}

test("RST2 committed restriction owns the root and runtime mode stays orthogonal", () => {
  const router = new ControlModeRouter();
  const mode = router.classify(escape(SUPPORT_STATUS.COMPLETE, 1, 2),
    4, 1, 2, 1, 2);
  assert.equal(mode, ROOT_CONTROL_MODE.COMMITTED_ESCAPE);
  assert.equal(router.context.reason, ROOT_CONTROL_REASON.COMMITTED_RESTRICTION);
  assert.equal(router.context.runtimeMode, 2);
});

test("RST2 possible or incomplete danger never manufactures committed escape", () => {
  const router = new ControlModeRouter();
  assert.equal(router.classify(escape(SUPPORT_STATUS.INCOMPLETE, 4, 0),
    4, 0, 0xffff, 0, 0), ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION);
  assert.equal(router.classify(escape(SUPPORT_STATUS.NONE, 0, 0),
    4, 1, 12, 0, 0), ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION);
});

test("RST2 tactical contact requires a visible near pose or visible ray", () => {
  const router = new ControlModeRouter(); const none = escape(SUPPORT_STATUS.NONE, 0, 0);
  assert.equal(router.classify(none, 4, 1, 9, 0, 0), ROOT_CONTROL_MODE.TACTICAL_CONTACT);
  assert.equal(router.classify(none, 4, 1, 15, 1, 0), ROOT_CONTROL_MODE.TACTICAL_CONTACT);
  assert.equal(router.classify(none, 4, 0, 1, 1, 0), ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION);
});

test("expanded tactical triggers require visibility and stay below committed escape", () => {
  const router = new ControlModeRouter(); const none = escape(SUPPORT_STATUS.NONE, 0, 0);
  assert.equal(router.classify(none, 4, 1, 15, 0, 0,
    TACTICAL_TRIGGER.PREDICTIVE_ATTACK), ROOT_CONTROL_MODE.TACTICAL_CONTACT);
  assert.equal(router.context.reason, ROOT_CONTROL_REASON.PREDICTIVE_ATTACK);
  assert.equal(router.classify(none, 4, 0, 15, 0, 0,
    TACTICAL_TRIGGER.PREDICTIVE_ATTACK), ROOT_CONTROL_MODE.STRATEGIC_NAVIGATION);
  assert.equal(router.classify(escape(SUPPORT_STATUS.COMPLETE, 1, 1), 4,
    1, 15, 0, 0, TACTICAL_TRIGGER.PREDICTIVE_ATTACK),
  ROOT_CONTROL_MODE.COMMITTED_ESCAPE);
});

test("committed viable membership constrains contact search but still owns non-contact escape", () => {
  const router = new ControlModeRouter();
  const restricted = escape(SUPPORT_STATUS.COMPLETE, 1, 2);
  assert.equal(router.classify(restricted, 4, 1, 2, 1, 2, 0, 1),
    ROOT_CONTROL_MODE.TACTICAL_CONTACT);
  assert.equal(router.context.reason, ROOT_CONTROL_REASON.VISIBLE_RAY);
  assert.equal(router.context.contactSearchWithinEscape, 1);
  assert.equal(router.classify(restricted, 4, 0, 0xffff, 0, 2, 0, 1),
    ROOT_CONTROL_MODE.COMMITTED_ESCAPE);
  assert.equal(router.context.reason, ROOT_CONTROL_REASON.COMMITTED_RESTRICTION);
  assert.equal(router.classify(escape(SUPPORT_STATUS.TRAPPED, 1, 0),
    4, 1, 2, 1, 2, 0, 1), ROOT_CONTROL_MODE.COMMITTED_ESCAPE);
  assert.equal(router.context.reason, ROOT_CONTROL_REASON.COMMITTED_TRAPPED);
});

test("RST3 TacticalEnvelope is zero-copy and only exact death refutes", () => {
  const controller = new RiskAcceptanceController(); const o = controller.outcome;
  o.reset(2); o.hard[0] = HARD_STATUS.ALLOW; o.hard[1] = HARD_STATUS.ALLOW;
  o.safety[0] = SAFETY_STATUS.UNKNOWN; o.coverage[0] = 0;
  o.safety[1] = SAFETY_STATUS.PROVEN_DEAD; o.coverage[1] = 10000;
  const view = new TacticalEnvelopeView().bind(o, null, null, 0);
  assert.equal(view.outcome, o); assert.equal(view.completedDepth, 0);
  assert.equal(view.refuted(0), 0); assert.equal(view.refuted(1), 1);
});
