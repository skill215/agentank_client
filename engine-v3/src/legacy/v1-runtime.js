"use strict";

const vm = require("node:vm");
const { V3_PORTS } = require("../contracts");

const FRAME_PREPARE_ANCHOR = "  updateEnemyProjectileTracking(me, enemy, game);\n";
const ACTION_CAPTURE_ANCHOR =
  "  if (enemy && game) resolved = saferRuntimeAction(me, enemy, game, resolved);\n";
const TACTICAL_CONTACT_ANCHOR = `  var tacticalContact = enemyTank &&
    (enemy.status.stunned ||
      (game.bombs && game.bombs.length > 0) ||
      manhattan(myPos, enemyTank.position) <= 9 ||
      clearLine(myPos, enemyTank.position, game.map) ||
      runtimePredictiveShotOpportunity(me, enemy, game));`;

function replaceUnique(source, anchor, replacement, label) {
  const first = source.indexOf(anchor);
  if (first < 0 || source.indexOf(anchor, first + anchor.length) >= 0)
    throw new Error(`V3_V1_INSTRUMENTATION_ANCHOR:${label}`);
  return source.slice(0, first) + replacement + source.slice(first + anchor.length);
}

function instrumentV1Source(source) {
  let instrumented = replaceUnique(source, FRAME_PREPARE_ANCHOR,
    FRAME_PREPARE_ANCHOR + "  v3FramePrepare(me, enemy, game);\n", "FRAME_PREPARE");
  instrumented = replaceUnique(instrumented, TACTICAL_CONTACT_ANCHOR,
    `  var tacticalContact = v3TacticalContact(me, enemy, game, enemyTank &&
    (enemy.status.stunned ||
      (game.bombs && game.bombs.length > 0) ||
      manhattan(myPos, enemyTank.position) <= 9 ||
      clearLine(myPos, enemyTank.position, game.map) ||
      runtimePredictiveShotOpportunity(me, enemy, game)));`, "TACTICAL_CONTACT");
  instrumented = replaceUnique(instrumented, ACTION_CAPTURE_ANCHOR,
    ACTION_CAPTURE_ANCHOR + "  if (v3CaptureResolvedAction(resolved)) return;\n",
    "ACTION_CAPTURE");
  return instrumented + `
var V3_CAPTURE_ACTION = false;
var V3_CAPTURED_ACTION = null;
function v3CaptureResolvedAction(action) {
  if (!V3_CAPTURE_ACTION) return false;
  V3_CAPTURED_ACTION = action;
  return true;
}
function v3FramePrepare(me, enemy, game) {}
function v3TacticalContact(me, enemy, game, legacyContact) { return legacyContact; }
`;
}

class LegacyV1Runtime {
  constructor(options) {
    if (!options || typeof options.source !== "string")
      throw new Error("V3_V1_SOURCE_REQUIRED");
    this.sourceIdentity = options.sourceIdentity || "UNBOUND";
    this.registry = options.registry || null;
    this.decisions = 0;
    this.sandbox = Object.create(null);
    this.sandbox.console = options.console || console;
    vm.createContext(this.sandbox, { name: options.contextName || "agentank-v3-v1" });
    const runtimeSource = this.registry ? instrumentV1Source(options.source) : options.source;
    vm.runInContext(runtimeSource, this.sandbox,
      { filename: options.filename || "frozen-v1.js", displayErrors: true });
    if (typeof this.sandbox.onIdle !== "function") throw new Error("V3_V1_ENTRY_MISSING");
    this.entry = this.sandbox.onIdle;
    this.originals = Object.create(null);
    if (this.registry) this.installPorts();
  }

  installPorts() {
    for (const port of V3_PORTS) {
      const original = this.sandbox[port.legacyName];
      if (typeof original !== "function")
        throw new Error(`V3_V1_PORT_MISSING:${port.legacyName}`);
      this.originals[port.legacyName] = original;
      const runtime = this;
      if (port.arity === 2) {
        this.sandbox[port.legacyName] = function v3Port2(a, b) {
          return runtime.registry.dispatch(port.slot, runtime, original, 2, a, b);
        };
      } else if (port.arity === 3) {
        this.sandbox[port.legacyName] = function v3Port3(a, b, c) {
          return runtime.registry.dispatch(port.slot, runtime, original, 3, a, b, c);
        };
      } else {
        this.sandbox[port.legacyName] = function v3Port4(a, b, c, d) {
          return runtime.registry.dispatch(port.slot, runtime, original, 4, a, b, c, d);
        };
      }
    }
  }

  decide(me, enemy, game) {
    if (this.registry) this.registry.beginDecision();
    this.decisions += 1;
    return this.entry.call(this.sandbox, me, enemy, game);
  }

  callLegacy(name, a, b, c, d) {
    const target = this.originals[name] || this.sandbox[name];
    if (typeof target !== "function") throw new Error(`V3_V1_FUNCTION_MISSING:${name}`);
    if (arguments.length === 2) return target.call(this.sandbox, a);
    if (arguments.length === 3) return target.call(this.sandbox, a, b);
    if (arguments.length === 4) return target.call(this.sandbox, a, b, c);
    return target.call(this.sandbox, a, b, c, d);
  }
}

module.exports = { LegacyV1Runtime, instrumentV1Source };
