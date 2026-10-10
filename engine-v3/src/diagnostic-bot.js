"use strict";

const { StructuredV1Controller } = require("./controller");
const { NativeHierarchicalRoot } = require("./native-hierarchical-root");

function actionProxy(snapshot, actions) {
  const proxy = {
    tank: snapshot.tank, stars: snapshot.stars, bullet: snapshot.bullet,
    skill: snapshot.skill, status: snapshot.status, effects: snapshot.effects,
    go() { actions.push({ type: "go" }); },
    turn(side) { actions.push({ type: "turn", side: side === "left" ? "left" : "right" }); },
    fire() { actions.push({ type: "fire" }); },
    throwBomb() { actions.push({ type: "throwBomb" }); }
  };
  const skill = snapshot.skill && snapshot.skill.type;
  if (skill) proxy[skill] = (...values) => actions.push(skill === "teleport" ?
    { type: skill, x: Number(values[0]), y: Number(values[1]) } : { type: skill });
  return proxy;
}

class V3DiagnosticBot {
  constructor(options = {}) {
    this.controller = options.controller || (options.native ?
      new NativeHierarchicalRoot(options) : new StructuredV1Controller(options));
    this.decisions = 0;
    this.runtimeMicros = 0;
    this.actionCounts = Object.create(null);
  }

  decide(context) {
    const actions = [];
    const me = actionProxy(context.me, actions);
    const started = process.hrtime.bigint();
    this.controller.decide(me, context.enemy, context.game);
    const runtimeMicros = Number((process.hrtime.bigint() - started) / 1000n);
    const action = actions[0] || null;
    const name = action ? action.type : "none";
    this.decisions += 1;
    this.runtimeMicros += runtimeMicros;
    this.actionCounts[name] = (this.actionCounts[name] || 0) + 1;
    return { action, runtimeMs: runtimeMicros / 1000, logs: [] };
  }

  summary() {
    return { decisions: this.decisions, runtimeMicros: this.runtimeMicros,
      actionCounts: { ...this.actionCounts }, controller: this.controller.summary() };
  }
}

module.exports = { actionProxy, V3DiagnosticBot };
