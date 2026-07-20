"use strict";

const { WINDOW } = require("./codes");

function frameEvents(records) { const output = []; for (let frame = 0; frame < records.length; frame += 1)
  for (const event of records[frame] || []) output.push({ frame, event }); return output; }
function metricVector(records, tankIds) {
  const values = { frames: records.length, moves: 0, turns: 0, fires: 0, bombs: 0,
    skills: 0, stars: 0, crashes: 0 };
  for (const { event } of frameEvents(records)) { if (event.type === "tank" && event.action === "go") values.moves += 1;
    else if (event.type === "tank" && event.action === "turn") values.turns += 1;
    else if (event.type === "bullet" && event.action === "created") values.fires += 1;
    else if (event.type === "bomb" && event.action === "created") values.bombs += 1;
    else if (event.type === "skill" && event.action === "cast") values.skills += 1;
    else if (event.type === "star" && event.action === "collected") values.stars += 1;
    else if (event.type === "tank" && event.action === "crashed") values.crashes += 1; }
  return values;
}
function originForFailure(records) {
  let origin = Math.max(0, records.length - 4); let cause = "TERMINAL";
  for (let frame = records.length - 1; frame >= 0; frame -= 1) for (const event of records[frame] || []) {
    if (event.type === "bomb" && event.action === "created") return { frame, cause: "BOMB" };
    if (cause === "TERMINAL" && event.type === "bullet" && event.action === "created") { origin = frame; cause = "PROJECTILE"; }
  } return { frame: origin, cause };
}
function extractWindows(entry, records) {
  const windows = []; const terminal = entry.terminal; const subjectSeat = entry.subject.seat;
  const won = terminal.winnerSeat === subjectSeat; const lost = terminal.winnerSeat === entry.opponent.seat;
  const origin = originForFailure(records);
  if (lost || ["SCRIPT_ERROR", "RUNTIME_TIMEOUT"].includes(terminal.terminalClass)) windows.push({
    windowType: WINDOW.FAILURE, startFrame: ["SCRIPT_ERROR", "RUNTIME_TIMEOUT"].includes(terminal.terminalClass) ? 0 : origin.frame,
    endFrame: terminal.recordCount, cause: ["SCRIPT_ERROR", "RUNTIME_TIMEOUT"].includes(terminal.terminalClass) ?
      terminal.terminalClass : origin.cause, strictLabel: "UNKNOWN", evidenceLevel: "L3" });
  if (won && terminal.terminalClass === "SINGLE_CRASH") windows.push({ windowType: WINDOW.KILL,
    startFrame: origin.frame, endFrame: terminal.recordCount, strictLabel: "FACTUAL", evidenceLevel: "L3" });
  if (terminal.terminalClass.startsWith("MUTUAL_CRASH")) windows.push({ windowType: WINDOW.TERMINAL_TRADE,
    startFrame: Math.max(0, terminal.recordCount - 4), endFrame: terminal.recordCount, strictLabel: "FACTUAL", evidenceLevel: "L3" });
  if (terminal.terminalClass.includes("STAR")) windows.push({ windowType: WINDOW.STAR_DEADLINE,
    startFrame: Math.max(0, terminal.recordCount - 8), endFrame: terminal.recordCount, strictLabel: "FACTUAL", evidenceLevel: "L3" });
  if (terminal.terminalClass.includes("RUNTIME") || terminal.terminalClass === "RUNTIME_TIMEOUT") windows.push({
    windowType: WINDOW.PERFORMANCE_HOT, startFrame: 0, endFrame: terminal.recordCount,
    strictLabel: "FACTUAL", evidenceLevel: "L3" });
  let ownSkill = false; let bomb = false; let hostileFire = false;
  for (const { event } of frameEvents(records)) { if (event.type === "skill" && event.action === "cast" && event.by === subjectSeat) ownSkill = true;
    if (event.type === "bomb") bomb = true; if (event.type === "bullet" && event.action === "created") hostileFire = true; }
  if (ownSkill) windows.push({ windowType: WINDOW.SKILL_VALUE, startFrame: 0, endFrame: terminal.recordCount,
    strictLabel: "FACTUAL", evidenceLevel: "L3" });
  if (bomb && !lost) windows.push({ windowType: WINDOW.BOMB_ESCAPE, startFrame: 0, endFrame: terminal.recordCount,
    strictLabel: "FACTUAL", evidenceLevel: "L3" });
  if (hostileFire && !lost) windows.push({ windowType: WINDOW.ESCAPE, startFrame: 0, endFrame: terminal.recordCount,
    strictLabel: "FACTUAL", evidenceLevel: "L3" });
  return { windows, metrics: metricVector(records) };
}

function positiveProtection(baseline, candidate) {
  const types = [WINDOW.KILL, WINDOW.ESCAPE, WINDOW.BOMB_ESCAPE, WINDOW.SKILL_VALUE,
    WINDOW.TERMINAL_TRADE, WINDOW.STAR_DEADLINE]; const regressions = [];
  for (const type of types) { const before = baseline.filter(x => x.windowType === type).length;
    const after = candidate.filter(x => x.windowType === type).length;
    if (before > 0 && after < before) regressions.push({ windowType: type, before, after }); }
  return { status: regressions.length ? "FAIL" : "PASS", regressions };
}

module.exports = { metricVector, extractWindows, positiveProtection };
