#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function same(left, right) {
  return Boolean(left && right && left[0] === right[0] && left[1] === right[1]);
}

function analyzeReplay(replay, source = "") {
  const records = replay?.records; const players = replay?.meta?.players;
  if (!Array.isArray(records) || !Array.isArray(players) || players.length !== 2) return null;
  const ids = players.map(player => player?.tank?.id);
  const positions = players.map(player => player?.tank?.position?.slice());
  if (!ids[0] || !ids[1] || !positions[0] || !positions[1]) return null;
  const result = { records: records.length, dualMoveFrames: 0, allUnitDualMoveFrames: 0,
    followsVacatedStart: 0, seat0Follows: 0, seat1Follows: 0,
    successfulSwap: 0, successfulSameTarget: 0, dualCrash: 0, evidence: [] };
  for (let frame = 0; frame < records.length; frame += 1) {
    const events = records[frame]; if (!Array.isArray(events)) continue;
    const start = positions.map(value => value.slice());
    const cursor = start.map(value => value.slice()); const moves = [];
    for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
      const event = events[eventIndex]; const seat = ids.indexOf(event?.objectId);
      if (seat < 0 || event?.type !== "tank" || event?.action !== "go" ||
          !Array.isArray(event.position)) continue;
      const from = cursor[seat].slice(); const to = event.position.slice();
      moves.push({ seat, eventIndex, from, to,
        unit: Math.abs(from[0] - to[0]) + Math.abs(from[1] - to[1]) === 1 });
      cursor[seat] = to.slice(); positions[seat] = to.slice();
    }
    const bySeat = [moves.filter(value => value.seat === 0),
      moves.filter(value => value.seat === 1)];
    if (!bySeat[0].length || !bySeat[1].length) continue;
    result.dualMoveFrames += 1;
    const allUnit = moves.every(value => value.unit);
    if (allUnit) result.allUnitDualMoveFrames += 1;
    const final = [bySeat[0][bySeat[0].length - 1].to,
      bySeat[1][bySeat[1].length - 1].to];
    const enter = [bySeat[0].some(value => same(value.to, start[1])),
      bySeat[1].some(value => same(value.to, start[0]))];
    const swap = enter[0] && enter[1]; const sameTarget = same(final[0], final[1]);
    const follows = allUnit && !swap && !sameTarget &&
      ((enter[0] && !same(final[1], start[1])) || (enter[1] && !same(final[0], start[0])));
    if (swap) result.successfulSwap += 1;
    if (sameTarget) result.successfulSameTarget += 1;
    const crashes = events.filter(event => event?.type === "tank" &&
      event?.action === "crashed" && ids.includes(event.objectId)).length;
    if (crashes === 2) result.dualCrash += 1;
    if (!follows) continue;
    result.followsVacatedStart += 1;
    if (enter[0]) result.seat0Follows += 1;
    if (enter[1]) result.seat1Follows += 1;
    result.evidence.push({ source, frame, start, final, enterSeat0: enter[0],
      enterSeat1: enter[1], eventOrder: moves.map(value => value.seat) });
  }
  return result;
}

function rawFiles(root) {
  const output = []; const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === "raw.json") output.push(full);
    }
  }
  return output.sort();
}

function scanCorpus(root) {
  const files = rawFiles(root); const seen = new Set();
  const report = { schemaVersion: 1, objectKind: "JOINT_MOVEMENT_CORPUS_EVIDENCE_V1",
    corpusRoot: path.resolve(root), files: files.length, uniqueReplays: 0, replayRecords: 0,
    dualMoveFrames: 0, allUnitDualMoveFrames: 0, followsVacatedStart: 0,
    seat0Follows: 0, seat1Follows: 0, successfulSwap: 0,
    successfulSameTarget: 0, dualCrash: 0, evidence: [] };
  for (const file of files) {
    let outer; try { outer = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    const replay = outer?.replayData?.replay || outer?.replay || outer;
    const replayBytes = JSON.stringify(replay); const replaySha256 = sha256(replayBytes);
    if (seen.has(replaySha256)) continue;
    const analyzed = analyzeReplay(replay, path.relative(root, file)); if (!analyzed) continue;
    seen.add(replaySha256); report.uniqueReplays += 1; report.replayRecords += analyzed.records;
    for (const key of ["dualMoveFrames", "allUnitDualMoveFrames", "followsVacatedStart",
      "seat0Follows", "seat1Follows", "successfulSwap", "successfulSameTarget", "dualCrash"])
      report[key] += analyzed[key];
    for (const item of analyzed.evidence) if (report.evidence.length < 64)
      report.evidence.push({ ...item, replaySha256 });
  }
  report.fingerprint = sha256(JSON.stringify({ ...report, corpusRoot: undefined }));
  return report;
}

if (require.main === module) {
  const root = path.resolve(process.argv[2] || "battle-records");
  process.stdout.write(`${JSON.stringify(scanCorpus(root), null, 2)}\n`);
}

module.exports = { analyzeReplay, scanCorpus };

