"use strict";

// Diagnostic-only causal intervention.  A label can own an action only when
// frame + both FastState hashes match exactly and its full RESET_SUFFIX matrix
// strictly dominates the action selected by the current V2 continuation.
// This is an oracle experiment, never a runtime strategy.

const fs = require("node:fs");
const path = require("node:path");
const { ACTION, NONE_CELL } = require("../../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require("../../../engine-v2/src/state/fast-state");
const { matrixQuality, qualityBetter, qualityStrictlyBetter,
  terminalUnits, terminalStarDelta } = require(
  "./decision-quality-arena");

const documentCache = new Map();

function loadDocuments(files) {
  const key = files.map(file => path.resolve(file)).join("\n");
  if (!documentCache.has(key)) documentCache.set(key, files.map(file =>
    JSON.parse(fs.readFileSync(path.resolve(file), "utf8"))));
  return documentCache.get(key);
}

function actionCode(action) {
  if (!action) return -1;
  if (action.type === "go") return ACTION.GO;
  if (action.type === "turn") return action.side === "left" ?
    ACTION.TURN_LEFT : ACTION.TURN_RIGHT;
  if (action.type === "fire") return ACTION.FIRE;
  if (action.type === "throwBomb") return ACTION.THROW_BOMB;
  const skill = { shield: ACTION.CAST_SHIELD, freeze: ACTION.CAST_FREEZE,
    stun: ACTION.CAST_STUN, overload: ACTION.CAST_OVERLOAD,
    cloak: ACTION.CAST_CLOAK, poison: ACTION.CAST_POISON,
    teleport: ACTION.CAST_TELEPORT, boost: ACTION.CAST_BOOST }[action.type];
  return skill === undefined ? -1 : skill;
}

function responseQuality(label, mode = "robust-lex") {
  const robust = matrixQuality(label, "V2");
  if (!robust) return null;
  if (mode === "robust-lex") return { values: [robust.robustUnits,
    robust.robustStarDelta, robust.totalUnits, robust.totalStarDelta] };
  if (mode === "expected") return { values: [robust.totalUnits,
    robust.totalStarDelta, robust.robustUnits, robust.robustStarDelta] };
  if (mode === "epsilon-1") return { values: [
    robust.totalUnits * 99 + robust.robustUnits * robust.cells,
    robust.totalStarDelta * 99 + robust.robustStarDelta * robust.cells,
    robust.robustUnits, robust.robustStarDelta ] };
  if (mode === "v3-only") {
    const cells = (label.responseMatrix?.cells || []).filter(item =>
      item.ownPolicy === "V2" && item.enemyPolicy === "V3");
    if (!cells.length) return null;
    let robustUnits = 3; let robustStars = 32767;
    let totalUnits = 0; let totalStars = 0;
    for (const cell of cells) {
      const units = terminalUnits(cell.terminal);
      const stars = terminalStarDelta(cell.terminal);
      totalUnits += units; totalStars += stars;
      if (units < robustUnits || units === robustUnits && stars < robustStars) {
        robustUnits = units; robustStars = stars;
      }
    }
    return { values: [robustUnits, robustStars, totalUnits, totalStars] };
  }
  throw new Error(`TERMINAL_ORACLE_QUALITY_MODE_INVALID:${mode}`);
}

function qualityCompare(left, right) {
  if (!left) return -1;
  if (!right) return 1;
  const count = Math.max(left.values.length, right.values.length);
  for (let index = 0; index < count; index += 1) {
    const a = left.values[index] || 0; const b = right.values[index] || 0;
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}

function bestSamePolicy(root, mode = "robust-lex") {
  const selected = (root.labels || []).find(label =>
    label.row === root.selectedRow) || null;
  if (mode === "robust-lex") {
    const selectedQuality = matrixQuality(selected, "V2");
    let best = null; let bestQuality = null;
    for (const label of root.labels || []) {
      if (!label.acceptable || label.dominated) continue;
      const candidate = matrixQuality(label, "V2");
      if (qualityBetter(candidate, bestQuality, label.row, best?.row ?? 0x7fff)) {
        best = label; bestQuality = candidate;
      }
    }
    return best && selectedQuality &&
      qualityStrictlyBetter(bestQuality, selectedQuality) ? best : null;
  }
  const selectedQuality = responseQuality(selected, mode);
  let best = null; let bestQuality = null;
  for (const label of root.labels || []) {
    if (!label.acceptable || label.dominated) continue;
    const candidate = responseQuality(label, mode);
    const comparison = qualityCompare(candidate, bestQuality);
    if (comparison > 0 || comparison === 0 && label.row < (best?.row ?? 0x7fff)) {
      best = label; bestQuality = candidate;
    }
  }
  return best && qualityCompare(bestQuality, selectedQuality) > 0 ? best : null;
}

function entriesFor(documents, scenarioFingerprint, candidateSeat,
    mode = "robust-lex") {
  const entries = [];
  for (const document of documents) for (const match of document.matches || []) {
    if (match.scenarioFingerprint !== scenarioFingerprint ||
        match.candidateSeat !== candidateSeat) continue;
    for (const root of match.roots || []) {
      const best = bestSamePolicy(root, mode); const action = actionCode(best?.action);
      if (!best || action < 0 || action === ACTION.CAST_TELEPORT) continue;
      entries.push({ frame: root.frame, hashLo: root.hashLo >>> 0,
        hashHi: root.hashHi >>> 0, action, argument: NONE_CELL,
        selectedRow: root.selectedRow, oracleRow: best.row });
    }
  }
  entries.sort((left, right) => left.frame - right.frame ||
    left.hashLo - right.hashLo || left.hashHi - right.hashHi);
  return entries;
}

class TerminalOracleInterventionPoc {
  constructor(documents, scenarioFingerprint, candidateSeat,
      mode = "robust-lex") {
    this.mode = mode;
    const entries = entriesFor(documents, scenarioFingerprint, candidateSeat,
      mode);
    this.count = entries.length;
    this.frame = new Uint8Array(this.count);
    this.hashLo = new Uint32Array(this.count);
    this.hashHi = new Uint32Array(this.count);
    this.action = new Uint8Array(this.count);
    this.argument = new Uint16Array(this.count);
    this.used = new Uint8Array(this.count);
    for (let index = 0; index < this.count; index += 1) {
      const entry = entries[index]; this.frame[index] = entry.frame;
      this.hashLo[index] = entry.hashLo; this.hashHi[index] = entry.hashHi;
      this.action[index] = entry.action; this.argument[index] = entry.argument;
    }
    this.result = { action: ACTION.NONE, argument: NONE_CELL };
    this.checkCount = 0; this.exactMatchCount = 0; this.overrideCount = 0;
    this.sameActionCount = 0; this.rowMissingCount = 0;
    this.finalBlockedCount = 0; this.hotAllocationCount = 0;
  }

  selectOverride(engine, incumbentAction, incumbentArgument) {
    this.checkCount += 1;
    const state = engine?.adapter?.state;
    if (!state) return null;
    const frame = state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
    for (let index = 0; index < this.count; index += 1) {
      if (this.used[index] || this.frame[index] !== frame ||
          this.hashLo[index] !== state.hashLo ||
          this.hashHi[index] !== state.hashHi) continue;
      this.used[index] = 1; this.exactMatchCount += 1;
      const action = this.action[index]; const argument = this.argument[index];
      if (action === incumbentAction && argument === (incumbentArgument ?? NONE_CELL)) {
        this.sameActionCount += 1; return null;
      }
      let row = -1;
      for (let at = 0; at < engine.ourCount; at += 1)
        if (engine.ourActions[at] === action && engine.ourArguments[at] === argument) {
          row = at; break;
        }
      if (row < 0) { this.rowMissingCount += 1; return null; }
      if (!engine.finalGate.finalAllows(engine.adapter.bundle,
          engine.ourActions, engine.ourArguments, row, engine.ourCount)) {
        this.finalBlockedCount += 1; return null;
      }
      this.overrideCount += 1; this.result.action = action;
      this.result.argument = argument; return this.result;
    }
    return null;
  }

  summary() {
    return { qualityMode: this.mode, roots: this.count,
      checkCount: this.checkCount,
      exactMatchCount: this.exactMatchCount, overrideCount: this.overrideCount,
      sameActionCount: this.sameActionCount, rowMissingCount: this.rowMissingCount,
      finalBlockedCount: this.finalBlockedCount,
      hotAllocationCount: this.hotAllocationCount };
  }
}

module.exports = { loadDocuments, actionCode, responseQuality, qualityCompare,
  bestSamePolicy, entriesFor,
  TerminalOracleInterventionPoc };
