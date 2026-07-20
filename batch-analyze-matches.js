#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const root = process.argv[2];
if (!root) throw new Error("usage: node batch-analyze-matches.js <batch-dir>");
const tankId = 6821;
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const DIRS = ["up", "right", "down", "left"];
let tankSkillIndex = { tanks: {} };
try {
  tankSkillIndex = JSON.parse(fs.readFileSync(
    path.join(path.dirname(root), "index", "tank-skills.json"), "utf8"));
} catch (_) {}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function turn(direction, action) {
  const index = DIRS.indexOf(direction);
  if (index < 0) return direction;
  return DIRS[(index + (action === "left" ? 3 : 1)) % 4];
}

function samePos(a, b) {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

function tileAt(map, position) {
  return position && map[position[0]] && map[position[0]][position[1]];
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function summarizeMatch(entry) {
  const dir = path.join(root, entry.directory || entry.urlId);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, "summary.json"), "utf8"));
  const eventsView = JSON.parse(fs.readFileSync(path.join(dir, "events.json"), "utf8"));
  const rawView = JSON.parse(fs.readFileSync(path.join(dir, "raw.json"), "utf8"));
  const data = rawView.replayData;
  const replay = data.replay;
  const records = replay.records;
  const map = data.map.map;
  const names = data.names;
  const mine = entry.challengerTankId === tankId ? 0 : 1;
  const foe = 1 - mine;
  const playerIds = replay.meta.players.map(player => player.tank.id);
  const myObjectId = playerIds[mine];
  const enemyObjectId = playerIds[foe];
  const myName = names[mine];
  const enemyName = names[foe];
  const winner = entry.winnerTankId === tankId;
  const resultReason = entry.resultReason;
  const frameCount = records.length;
  const runtimeMs = replay.meta.players[mine].runTime || 0;
  const enemyRuntimeMs = replay.meta.players[foe].runTime || 0;

  const positions = replay.meta.players.map(player => player.tank.position.slice());
  const directions = replay.meta.players.map(player => player.tank.direction);
  const bulletOwners = new Map();
  const bulletFireFrame = new Map();
  const bulletFirePosition = new Map();
  const actions = [[], []];
  const frameActions = Array.from({ length: frameCount }, () => [[], []]);
  const starCounts = [0, 0];
  const skillCasts = [[], []];
  const skillIntervals = [];
  const placedBombs = new Map();
  const bombEvents = [];
  const stateAfterFrame = [];
  let moves = [0, 0];
  let turns = [0, 0];
  let shots = [0, 0];
  let walls = [0, 0];
  let hits = [0, 0];
  let bombsPlaced = [0, 0];
  let bombsExploded = [0, 0];
  let death = null;

  for (let frame = 0; frame < records.length; frame++) {
    for (const event of records[frame]) {
      if (event.type === "tank" && (event.action === "go" || event.action === "turn")) {
        const player = event.objectId === playerIds[0] ? 0 :
          event.objectId === playerIds[1] ? 1 : -1;
        if (player < 0) continue;
        if (event.action === "go") {
          moves[player]++;
          positions[player] = event.position.slice();
          actions[player].push({ frame, action: "GO", position: positions[player].slice() });
          frameActions[frame][player].push("GO");
        } else {
          turns[player]++;
          directions[player] = turn(directions[player], event.direction);
          const action = event.direction === "left" ? "LEFT" : "RIGHT";
          actions[player].push({ frame, action, position: positions[player].slice() });
          frameActions[frame][player].push(action);
        }
      } else if (event.type === "bullet" && event.action === "created") {
        const shooterId = event.tank && event.tank.id;
        const player = shooterId === playerIds[0] ? 0 : shooterId === playerIds[1] ? 1 : -1;
        if (player < 0) continue;
        bulletOwners.set(event.objectId, player);
        bulletFireFrame.set(event.objectId, frame);
        bulletFirePosition.set(event.objectId,
          event.tank && event.tank.position ? event.tank.position.slice() : positions[player].slice());
        shots[player]++;
        actions[player].push({ frame, action: "FIRE", position: positions[player].slice() });
        frameActions[frame][player].push("FIRE");
      } else if (event.type === "bullet" && event.action === "crashed") {
        const player = bulletOwners.get(event.objectId);
        if (player !== undefined) walls[player]++;
      } else if (event.type === "star" && event.action === "collected") {
        if (event.by === 0 || event.by === 1) starCounts[event.by]++;
      } else if (event.type === "skill" && event.action === "cast") {
        const player = event.by;
        if (player !== 0 && player !== 1) continue;
        skillCasts[player].push({ frame, skill: event.skillType });
        actions[player].push({ frame, action: `SKILL:${event.skillType}`, position: positions[player].slice() });
        frameActions[frame][player].push(`SKILL:${event.skillType}`);
      } else if (event.type === "skill" && event.action === "applied") {
        const source = event.by;
        const target = event.targetObjectId === playerIds[0] ? 0 :
          event.targetObjectId === playerIds[1] ? 1 : source;
        skillIntervals.push({
          source,
          target,
          skill: event.skillType,
          start: frame,
          end: frame + (event.durationFrames || 0)
        });
      } else if (event.type === "bomb" && event.action === "placed") {
        const player = event.by;
        placedBombs.set(event.objectId, { player, frame, position: event.position.slice() });
        bombsPlaced[player]++;
        actions[player].push({ frame, action: "BOMB", position: positions[player].slice() });
        frameActions[frame][player].push("BOMB");
      } else if (event.type === "bomb" && event.action === "exploded") {
        const player = event.by;
        bombsExploded[player]++;
        bombEvents.push({
          player,
          frame,
          position: event.position.slice(),
          blast: event.blast.map(position => position.slice())
        });
      } else if (event.type === "tank" && event.action === "crashed") {
        death = {
          frame,
          victim: event.index,
          killer: event.by,
          victimPosition: positions[event.index] && positions[event.index].slice()
        };
      }
    }
    stateAfterFrame.push({
      positions: positions.map(position => position.slice()),
      directions: directions.slice(),
      stars: starCounts.slice()
    });
  }

  const eventHits = eventsView.events.filter(event => event.event === "shot_hit");
  const eventWalls = eventsView.events.filter(event => event.event === "shot_wall");
  hits = [
    eventHits.filter(event => event.tank === names[0]).length,
    eventHits.filter(event => event.tank === names[1]).length
  ];
  walls = [
    eventWalls.filter(event => event.tank === names[0]).length,
    eventWalls.filter(event => event.tank === names[1]).length
  ];

  let oppositeTurnPairs = 0;
  let longestTurnRun = 0;
  let currentTurnRun = 0;
  let previousTurn = null;
  let previousTurnFrame = -99;
  for (const action of actions[mine]) {
    if (action.action === "LEFT" || action.action === "RIGHT") {
      currentTurnRun++;
      longestTurnRun = Math.max(longestTurnRun, currentTurnRun);
      if (previousTurn && previousTurn !== action.action &&
          action.frame - previousTurnFrame <= 2) oppositeTurnPairs++;
      previousTurn = action.action;
      previousTurnFrame = action.frame;
    } else {
      currentTurnRun = 0;
      previousTurn = null;
      previousTurnFrame = -99;
    }
  }

  const finalFrame = Math.max(0, frameCount - 1);
  const finalState = stateAfterFrame[finalFrame] || {
    positions, directions, stars: starCounts
  };
  const recentMyActions = [];
  for (let frame = Math.max(0, finalFrame - 3); frame <= finalFrame; frame++) {
    if (frameActions[frame][mine].length) {
      recentMyActions.push(`${frame}:${frameActions[frame][mine].join("+")}`);
    }
  }

  let deathDetail = null;
  if (!winner && resultReason === "crashed" && death && death.victim === mine) {
    const deathFrame = death.frame;
    const enemyBomb = bombEvents.find(bomb => bomb.player === foe &&
      bomb.frame === deathFrame && bomb.blast.some(position => samePos(position, death.victimPosition)));
    const shotHit = eventsView.events.find(event => event.event === "shot_hit" &&
      event.frame === deathFrame && event.tank === enemyName);
    let killType = enemyBomb ? "bomb" : shotHit ? "bullet" : "unknown";
    let fireFrame = null;
    let firePosition = null;
    if (shotHit) {
      fireFrame = bulletFireFrame.get(shotHit.bullet);
      firePosition = bulletFirePosition.get(shotHit.bullet) || null;
    }
    let grassEntryFrame = null;
    let grassAgeAtFire = null;
    if (firePosition && tileAt(map, firePosition) === "o" &&
        fireFrame !== null && fireFrame !== undefined) {
      grassEntryFrame = fireFrame;
      while (grassEntryFrame > 0 && stateAfterFrame[grassEntryFrame - 1] &&
          tileAt(map,
            stateAfterFrame[grassEntryFrame - 1].positions[foe]) === "o") {
        grassEntryFrame--;
      }
      grassAgeAtFire = fireFrame - grassEntryFrame;
    }
    const activeEnemySkills = skillIntervals.filter(interval =>
      interval.source === foe && interval.start <= deathFrame && interval.end > deathFrame)
      .map(interval => interval.skill);
    const activeDebuffs = skillIntervals.filter(interval =>
      interval.source === foe && interval.target === mine &&
      interval.start <= deathFrame && interval.end > deathFrame)
      .map(interval => interval.skill);
    const ownExecuted = frameActions[deathFrame][mine].slice();
    const previousExecuted = deathFrame > 0 ? frameActions[deathFrame - 1][mine].slice() : [];
    let subtype = killType;
    if (killType === "bomb") subtype = "enemy_bomb_blast";
    else if (killType === "bullet") {
      const travelFrames = deathFrame - fireFrame;
      if (activeEnemySkills.includes("cloak")) subtype = "cloak_shot";
      else if (firePosition && tileAt(map, firePosition) === "o") subtype = "grass_shot";
      else if (travelFrames === 0 && ownExecuted.includes("GO")) subtype = "moved_into_immediate_muzzle";
      else if (travelFrames === 0 && ownExecuted.some(action => action === "LEFT" || action === "RIGHT")) {
        subtype = "turned_under_immediate_muzzle";
      } else if (travelFrames === 0 && ownExecuted.includes("FIRE")) subtype = "lost_immediate_trade";
      else if (travelFrames === 0) subtype = "held_in_immediate_muzzle";
      else if (ownExecuted.includes("GO")) subtype = "moved_into_inflight_bullet";
      else if (ownExecuted.some(action => action === "LEFT" || action === "RIGHT")) {
        subtype = "turned_under_inflight_bullet";
      } else subtype = "failed_inflight_dodge";
    }
    deathDetail = {
      killType,
      subtype,
      deathFrame,
      victimPosition: death.victimPosition,
      fireFrame,
      travelFrames: fireFrame === null || fireFrame === undefined ? null : deathFrame - fireFrame,
      firePosition,
      shooterTile: firePosition ? tileAt(map, firePosition) : null,
      grassEntryFrame,
      grassAgeAtFire,
      ownExecuted,
      previousExecuted,
      activeEnemySkills,
      activeDebuffs,
      myStars: finalState.stars[mine],
      enemyStars: finalState.stars[foe]
    };
  }

  const myShots = shots[mine];
  const myHits = hits[mine];
  const myWalls = walls[mine];
  const myTurns = turns[mine];
  const myMoves = moves[mine];
  const myActionCount = myTurns + myMoves + myShots + skillCasts[mine].length + bombsPlaced[mine];
  const flags = [];
  if (runtimeMs >= 2500) flags.push("timeout_budget_risk");
  if (runtimeMs / Math.max(1, frameCount) >= 30) flags.push("slow_per_frame");
  if (myShots >= 3 && myWalls / myShots >= 0.8) flags.push("wasteful_fire");
  if (oppositeTurnPairs >= 3 || longestTurnRun >= 5) flags.push("turn_oscillation");
  if (myActionCount >= 12 && myTurns / myActionCount >= 0.5) flags.push("turn_heavy");
  if (!winner && resultReason === "star") flags.push("lost_star_race");
  if (!winner && resultReason === "runTime") flags.push("lost_runtime_tiebreak");
  if (deathDetail) flags.push(deathDetail.subtype);

  return {
    urlId: entry.urlId,
    createdAt: entry.createdAt,
    createdAtLocal: new Date(Date.parse(entry.createdAt) + 8 * 3600e3).toISOString().replace("Z", "+08:00"),
    source: entry.source,
    role: mine === 0 ? "challenger" : "defender",
    opponent: enemyName,
    opponentTankId: mine === 0 ? entry.defenderTankId : entry.challengerTankId,
    opponentSkill: skillCasts[foe][0] ? skillCasts[foe][0].skill :
      (tankSkillIndex.tanks[String(mine === 0 ? entry.defenderTankId : entry.challengerTankId)] || {}).skill || null,
    opponentSkillSource: skillCasts[foe][0] ? "this-match-cast" :
      ((tankSkillIndex.tanks[String(mine === 0 ? entry.defenderTankId : entry.challengerTankId)] || {}).skill ?
        "historical-inference" : "unknown"),
    codeHash: mine === 0 ? entry.challengerCodeHash : entry.defenderCodeHash,
    outcome: winner ? "win" : "loss",
    resultReason,
    frames: frameCount,
    runtimeMs,
    enemyRuntimeMs,
    runtimePerFrame: runtimeMs / Math.max(1, frameCount),
    moves: myMoves,
    turns: myTurns,
    turnShare: myActionCount ? myTurns / myActionCount : 0,
    oppositeTurnPairs,
    longestTurnRun,
    shots: myShots,
    hits: myHits,
    walls: myWalls,
    hitRate: myShots ? myHits / myShots : 0,
    wallRate: myShots ? myWalls / myShots : 0,
    stars: starCounts[mine],
    enemyStars: starCounts[foe],
    skillUses: skillCasts[mine].length,
    skillTypes: [...new Set(skillCasts[mine].map(cast => cast.skill))],
    enemySkillUses: skillCasts[foe].length,
    bombsPlaced: bombsPlaced[mine],
    bombsExploded: bombsExploded[mine],
    enemyBombsPlaced: bombsPlaced[foe],
    deathDetail,
    recentMyActions,
    flags,
    replayUrl: `https://agentank.ai/history/${entry.urlId}`
  };
}

function groupStats(matches) {
  const frames = matches.reduce((sum, match) => sum + match.frames, 0);
  const runtimeMs = matches.reduce((sum, match) => sum + match.runtimeMs, 0);
  const shots = matches.reduce((sum, match) => sum + match.shots, 0);
  const hits = matches.reduce((sum, match) => sum + match.hits, 0);
  const walls = matches.reduce((sum, match) => sum + match.walls, 0);
  const turns = matches.reduce((sum, match) => sum + match.turns, 0);
  const moves = matches.reduce((sum, match) => sum + match.moves, 0);
  return {
    matches: matches.length,
    frames,
    runtimeMs,
    runtimePerFrame: runtimeMs / Math.max(1, frames),
    medianRuntimePerFrame: percentile(matches.map(match => match.runtimePerFrame), 0.5),
    p90RuntimePerFrame: percentile(matches.map(match => match.runtimePerFrame), 0.9),
    shots,
    hits,
    walls,
    hitRate: hits / Math.max(1, shots),
    wallRate: walls / Math.max(1, shots),
    turns,
    moves,
    oppositeTurnPairs: matches.reduce((sum, match) => sum + match.oppositeTurnPairs, 0),
    stars: matches.reduce((sum, match) => sum + match.stars, 0)
  };
}

const matches = manifest.matches.map(summarizeMatch);
const groups = {};
for (const match of matches) {
  const key = `${match.outcome}/${match.resultReason}`;
  (groups[key] ||= []).push(match);
}
const groupSummary = Object.fromEntries(Object.entries(groups)
  .map(([key, values]) => [key, groupStats(values)]));
const flagCounts = {};
for (const match of matches) for (const flag of match.flags) flagCounts[flag] = (flagCounts[flag] || 0) + 1;
const skillGroups = {};
for (const match of matches) {
  const key = match.opponentSkill || "unknown";
  (skillGroups[key] ||= []).push(match);
}
const opponentSkillSummary = Object.fromEntries(Object.entries(skillGroups).map(([skill, values]) => [skill, {
  matches: values.length,
  wins: values.filter(match => match.outcome === "win").length,
  losses: values.filter(match => match.outcome === "loss").length,
  winRate: values.filter(match => match.outcome === "win").length / values.length,
  crashedLosses: values.filter(match => match.outcome === "loss" && match.resultReason === "crashed").length
}]));
const opponentCounts = {};
for (const match of matches) {
  const key = `${match.opponentTankId}:${match.opponent}`;
  const item = opponentCounts[key] ||= { opponent: match.opponent, opponentTankId: match.opponentTankId, matches: 0, wins: 0, losses: 0 };
  item.matches++;
  item[match.outcome === "win" ? "wins" : "losses"]++;
}

const analysis = {
  generatedAt: new Date().toISOString(),
  cutoffLocal: manifest.cutoffLocal,
  cutoffUtc: manifest.cutoffUtc,
  codeHashes: [...new Set(matches.map(match => match.codeHash))],
  overall: groupStats(matches),
  results: {
    wins: matches.filter(match => match.outcome === "win").length,
    losses: matches.filter(match => match.outcome === "loss").length,
    winRate: matches.filter(match => match.outcome === "win").length / matches.length
  },
  groups: groupSummary,
  flagCounts,
  opponentSkillSummary,
  opponents: Object.values(opponentCounts).sort((a, b) => b.matches - a.matches),
  slowest: matches.slice().sort((a, b) => b.runtimePerFrame - a.runtimePerFrame).slice(0, 15),
  longestRuntime: matches.slice().sort((a, b) => b.runtimeMs - a.runtimeMs).slice(0, 15),
  crashedLosses: matches.filter(match => match.outcome === "loss" && match.resultReason === "crashed"),
  starLosses: matches.filter(match => match.outcome === "loss" && match.resultReason === "star"),
  runtimeLosses: matches.filter(match => match.outcome === "loss" && match.resultReason === "runTime"),
  flaggedWins: matches.filter(match => match.outcome === "win" && match.flags.length),
  matches
};
fs.writeFileSync(path.join(root, "analysis.json"), `${JSON.stringify(analysis, null, 2)}\n`);

const matchColumns = ["createdAtLocal", "urlId", "outcome", "resultReason", "role", "source", "opponent",
  "opponentSkill", "frames", "runtimeMs", "runtimePerFrame", "moves", "turns", "turnShare",
  "oppositeTurnPairs", "longestTurnRun", "shots", "hits", "walls", "stars", "enemyStars",
  "skillUses", "bombsPlaced", "flags", "replayUrl"];
const matchCsv = [matchColumns.join(",")].concat(matches.map(match => matchColumns.map(column => {
  let value = match[column];
  if (Array.isArray(value)) value = value.join("|");
  if (typeof value === "number" && !Number.isInteger(value)) value = value.toFixed(4);
  return csvCell(value);
}).join(","))).join("\n");
fs.writeFileSync(path.join(root, "matches.csv"), `${matchCsv}\n`);

const failureColumns = ["createdAtLocal", "urlId", "opponent", "opponentSkill", "resultReason", "frames",
  "runtimeMs", "stars", "enemyStars", "shots", "hits", "walls", "deathSubtype", "deathFrame",
  "travelFrames", "ownExecuted", "previousExecuted", "activeEnemySkills", "activeDebuffs", "replayUrl"];
const failures = matches.filter(match => match.outcome === "loss");
const failureCsv = [failureColumns.join(",")].concat(failures.map(match => failureColumns.map(column => {
  const detail = match.deathDetail || {};
  const source = {
    ...match,
    deathSubtype: detail.subtype,
    deathFrame: detail.deathFrame,
    travelFrames: detail.travelFrames,
    ownExecuted: detail.ownExecuted,
    previousExecuted: detail.previousExecuted,
    activeEnemySkills: detail.activeEnemySkills,
    activeDebuffs: detail.activeDebuffs
  };
  let value = source[column];
  if (Array.isArray(value)) value = value.join("|");
  return csvCell(value);
}).join(","))).join("\n");
fs.writeFileSync(path.join(root, "failures.csv"), `${failureCsv}\n`);

console.log(JSON.stringify({
  matches: matches.length,
  results: analysis.results,
  groups: groupSummary,
  flagCounts,
  crashedSubtypes: matches.filter(match => match.deathDetail).reduce((result, match) => {
    result[match.deathDetail.subtype] = (result[match.deathDetail.subtype] || 0) + 1;
    return result;
  }, {})
}, null, 2));
