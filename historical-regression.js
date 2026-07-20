#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { performance } = require("perf_hooks");

const TANK_ID = 6821;
const SCHEMA_VERSION = 1;
const DIRS = ["up", "right", "down", "left"];
const DELTAS = {
  up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0]
};
const SKILL_COOLDOWNS = {
  shield: 25, freeze: 29, stun: 20, overload: 32,
  cloak: 35, poison: 20, teleport: 40, boost: 26
};
const SELF_SKILLS = new Set(["shield", "overload", "cloak", "boost"]);
const DEBUFF_SKILLS = new Set(["freeze", "stun", "poison"]);

function parseArgs(argv) {
  const result = {
    records: "battle-records",
    current: "tiny-tank-minimax.js",
    snapshot: null,
    baselineCode: null,
    storeBaselineCode: null,
    writeBaseline: null,
    output: "battle-records/historical-regression-v21"
  };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[i + 1];
    if (argv[i] === "--records") result.records = value, i++;
    else if (argv[i] === "--current") result.current = value, i++;
    else if (argv[i] === "--snapshot") result.snapshot = value, i++;
    else if (argv[i] === "--baseline-code") result.baselineCode = value, i++;
    else if (argv[i] === "--store-baseline-code") result.storeBaselineCode = value, i++;
    else if (argv[i] === "--write-baseline") result.writeBaseline = value, i++;
    else if (argv[i] === "--output") result.output = value, i++;
    else if (argv[i] === "--help") {
      process.stdout.write([
        "usage:",
        "  node historical-regression.js --baseline-code v20.js --store-baseline-code saved-v20.js --write-baseline baseline.json",
        "  node historical-regression.js --snapshot baseline.json --current tiny-tank-minimax.js",
        "",
        "Action drift is reported, never treated as a test failure. The command fails only",
        "for corrupt/missing corpus data, agent exceptions, or an incompatible snapshot.\n"
      ].join("\n"));
      process.exit(0);
    } else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return result;
}

function walkRawFiles(root) {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name === "raw.json") files.push(file);
    }
  }
  walk(root);
  return files;
}

function loadCorpus(root) {
  const unique = new Map();
  let rawFiles = 0;
  for (const file of walkRawFiles(root)) {
    rawFiles++;
    const text = fs.readFileSync(file, "utf8");
    const raw = JSON.parse(text);
    const id = raw.match && raw.match.urlId;
    if (!id || !raw.replayData || !raw.replayData.replay) continue;
    const candidate = { id, file, raw, text };
    const previous = unique.get(id);
    // Prefer the shortest stable path when a match was downloaded in several batches.
    if (!previous || file.length < previous.file.length ||
        (file.length === previous.file.length && file < previous.file)) {
      unique.set(id, candidate);
    }
  }
  const matches = [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
  const digest = crypto.createHash("sha256");
  for (const match of matches) {
    digest.update(match.id);
    digest.update("\0");
    digest.update(match.text);
    digest.update("\0");
  }
  return { root, rawFiles, matches, fingerprint: digest.digest("hex") };
}

function roleParticipants(raw) {
  return [raw.participants.challenger, raw.participants.defender];
}

function collectTankSkills(corpus) {
  const votes = new Map();
  function vote(tankId, skill) {
    if (!tankId || !skill) return;
    if (!votes.has(tankId)) votes.set(tankId, new Map());
    const tankVotes = votes.get(tankId);
    tankVotes.set(skill, (tankVotes.get(skill) || 0) + 1);
  }
  vote(TANK_ID, "stun");
  for (const item of corpus.matches) {
    const participants = roleParticipants(item.raw);
    for (const records of item.raw.replayData.replay.records) {
      for (const event of records) {
        if (event.type === "skill" && event.action === "cast" &&
            (event.by === 0 || event.by === 1)) {
          vote(participants[event.by].tankId, event.skillType);
        }
      }
    }
  }
  const result = new Map();
  for (const [tankId, tankVotes] of votes) {
    const best = [...tankVotes].sort((a, b) => b[1] - a[1] ||
      a[0].localeCompare(b[0]))[0];
    result.set(tankId, best[0]);
  }
  return result;
}

function turn(direction, side) {
  const index = DIRS.indexOf(direction);
  if (index < 0) return direction;
  return DIRS[(index + (side === "left" ? 3 : 1)) % 4];
}

function samePos(a, b) {
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

function manhattan(a, b) {
  return a && b ? Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) : Infinity;
}

function edgeDistance(position, map) {
  return Math.min(position[0], position[1],
    map.length - 1 - position[0], map[0].length - 1 - position[1]);
}

function blocksSight(tile) {
  return tile === "x" || tile === "m";
}

function clearSight(a, b, map) {
  let x = a[0], y = a[1];
  const dx = Math.abs(b[0] - x), sx = x < b[0] ? 1 : -1;
  const dy = -Math.abs(b[1] - y), sy = y < b[1] ? 1 : -1;
  let error = dx + dy;
  while (x !== b[0] || y !== b[1]) {
    const twice = 2 * error;
    if (twice >= dy) error += dy, x += sx;
    if (twice <= dx) error += dx, y += sy;
    if (x === b[0] && y === b[1]) break;
    if (!map[x] || blocksSight(map[x][y])) return false;
  }
  return true;
}

function inForwardCone(origin, direction, target) {
  const delta = DELTAS[direction];
  if (!delta) return false;
  const rx = target[0] - origin[0], ry = target[1] - origin[1];
  const forward = rx * delta[0] + ry * delta[1];
  const lateral = Math.abs(rx * delta[1] - ry * delta[0]);
  return forward > 0 && lateral <= forward;
}

function faces(from, direction, target, map) {
  if (!from || !target) return false;
  const delta = DELTAS[direction];
  const aligned = delta && (delta[0] === 0 ? from[0] === target[0] :
    from[1] === target[1]);
  if (!aligned) return false;
  const ahead = delta[0] === 0 ?
    (target[1] - from[1]) * delta[1] > 0 :
    (target[0] - from[0]) * delta[0] > 0;
  if (!ahead) return false;
  let cursor = [from[0] + delta[0], from[1] + delta[1]];
  while (!samePos(cursor, target)) {
    if (!map[cursor[0]] || blocksSight(map[cursor[0]][cursor[1]])) return false;
    cursor = [cursor[0] + delta[0], cursor[1] + delta[1]];
  }
  return true;
}

function codeHash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function loadAgent(file) {
  function FrozenDate() {}
  FrozenDate.now = () => 0; // Keep the 1.5 s fuse deterministic in offline replay.
  const quietConsole = { log() {}, info() {}, warn() {}, error() {} };
  const context = {
    console: quietConsole,
    print() {},
    Math,
    WeakMap,
    Date: FrozenDate
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  if (typeof context.onIdle !== "function") throw new Error(`${file}: onIdle missing`);
  return context;
}

function effectRemaining(effect, frame) {
  return effect ? Math.max(0, effect.expiresFrame - frame) : 0;
}

function statusFor(player, state, frame) {
  const self = state.selfEffects[player];
  const debuff = state.debuffEffects[player];
  const skill = self && self.type;
  const harm = debuff && debuff.type;
  const activeBomb = [...state.bombs.values()].some(bomb => bomb.owner === player);
  const cooldown = state.lastBombExplosion[player] < 0 ? 0 :
    Math.max(0, state.lastBombExplosion[player] + 10 - frame);
  return {
    shielded: skill === "shield",
    cloaked: skill === "cloak",
    boosted: skill === "boost",
    overloaded: skill === "overload",
    frozen: harm === "freeze",
    stunned: harm === "stun",
    poisoned: harm === "poison",
    fireLocked: state.fireLockedUntil[player] >= frame,
    actionSpeed: harm === "poison" ? 0.5 : 1,
    bombCooldownFrames: cooldown,
    bombActive: activeBomb,
    canActThisFrame: harm !== "freeze"
  };
}

function skillInfo(player, state, frame) {
  const type = state.skillTypes[player] || null;
  const castFrame = state.lastSkillCast[player];
  const cooldown = type && SKILL_COOLDOWNS[type] || 0;
  const remaining = castFrame < 0 ? 0 : Math.max(0, castFrame + cooldown - frame);
  const self = state.selfEffects[player];
  return {
    type,
    cooldownFrames: cooldown,
    remainingCooldownFrames: remaining,
    activeRemainingFrames: effectRemaining(self, frame),
    activeType: self && self.type || null
  };
}

function effectsFor(player, state, frame) {
  const self = state.selfEffects[player];
  const debuff = state.debuffEffects[player];
  return {
    self: self ? { type: self.type, remainingFrames: effectRemaining(self, frame) } : null,
    debuff: debuff ? { type: debuff.type, remainingFrames: effectRemaining(debuff, frame) } : null
  };
}

function visibleEnemyTank(mine, foe, state, frame) {
  if (state.crashed[foe]) return null;
  const cloaked = state.selfEffects[foe] && state.selfEffects[foe].type === "cloak";
  const grass = state.map[state.positions[foe][0]][state.positions[foe][1]] === "o";
  if ((cloaked || grass) && state.revealUntil[foe] < frame) return null;
  return {
    id: state.objectIds[foe],
    position: state.positions[foe].slice(),
    direction: state.directions[foe],
    crashed: false
  };
}

function projectileObject(bullet) {
  return bullet ? {
    id: bullet.id,
    position: bullet.position.slice(),
    direction: bullet.direction
  } : null;
}

function firstBullet(state, owner, predicate = () => true) {
  for (const bullet of state.bullets.values()) {
    if (bullet.owner === owner && predicate(bullet)) return bullet;
  }
  return null;
}

function recordCommands(actor) {
  actor.commands = [];
  const add = (action, detail) => {
    actor.commands.push(detail === undefined ? { action } : { action, detail });
  };
  actor.go = () => add("GO");
  actor.turn = side => add(side === "left" ? "LEFT" : "RIGHT");
  actor.fire = () => add("FIRE");
  actor.throwBomb = () => add("BOMB");
  actor.stun = () => add("STUN");
  actor.shield = () => add("SHIELD");
  actor.freeze = () => add("FREEZE");
  actor.overload = () => add("OVERLOAD");
  actor.cloak = () => add("CLOAK");
  actor.poison = () => add("POISON");
  actor.boost = () => add("BOOST");
  actor.teleport = (x, y) => add("TELEPORT", [x, y]);
  actor.say = () => {};
  return actor;
}

function buildInput(mine, state, frame) {
  const foe = 1 - mine;
  const enemyTank = visibleEnemyTank(mine, foe, state, frame);
  const ownBullet = firstBullet(state, mine);
  const enemyBullet = firstBullet(state, foe, bullet =>
    inForwardCone(state.positions[mine], state.directions[mine], bullet.position) &&
    clearSight(state.positions[mine], bullet.position, state.map));
  const me = recordCommands({
    tank: {
      id: state.objectIds[mine],
      position: state.positions[mine].slice(),
      direction: state.directions[mine],
      crashed: state.crashed[mine]
    },
    stars: state.stars[mine],
    bullet: projectileObject(ownBullet),
    status: statusFor(mine, state, frame),
    effects: effectsFor(mine, state, frame),
    skill: skillInfo(mine, state, frame)
  });
  const enemy = {
    tank: enemyTank,
    stars: state.stars[foe],
    bullet: projectileObject(enemyBullet),
    status: statusFor(foe, state, frame),
    effects: effectsFor(foe, state, frame),
    skill: skillInfo(foe, state, frame)
  };
  const bombs = [...state.bombs.values()]
    .filter(bomb => state.map[bomb.position[0]][bomb.position[1]] !== "o")
    .map(bomb => ({
      position: bomb.position.slice(),
      placedFrame: bomb.placedFrame,
      explodeFrame: bomb.explodeFrame,
      framesRemaining: Math.max(0, bomb.explodeFrame - frame)
    }));
  return {
    me,
    enemy,
    game: {
      map: state.map,
      star: state.star && state.star.slice(),
      bombs,
      frames: frame
    },
    visibility: {
      enemyTank: !!enemyTank,
      enemyBullet: !!enemyBullet,
      ownBullet: !!ownBullet,
      bombs: bombs.length
    }
  };
}

function expireImplicitEffects(state, frame) {
  for (let player = 0; player < 2; player++) {
    if (state.selfEffects[player] && state.selfEffects[player].expiresFrame <= frame) {
      state.selfEffects[player] = null;
    }
    if (state.debuffEffects[player] && state.debuffEffects[player].expiresFrame <= frame) {
      state.debuffEffects[player] = null;
    }
  }
}

function playerFromObject(state, objectId) {
  return objectId === state.objectIds[0] ? 0 : objectId === state.objectIds[1] ? 1 : -1;
}

function applyFrameEvents(state, events, frame) {
  expireImplicitEffects(state, frame);
  for (const event of events) {
    if (event.type === "tank" && event.action === "go") {
      const player = playerFromObject(state, event.objectId);
      if (player >= 0) state.positions[player] = event.position.slice();
    } else if (event.type === "tank" && event.action === "turn") {
      const player = playerFromObject(state, event.objectId);
      if (player >= 0) state.directions[player] = turn(state.directions[player], event.direction);
    } else if (event.type === "tank" && event.action === "crashed") {
      if (event.index === 0 || event.index === 1) state.crashed[event.index] = true;
    } else if (event.type === "bullet" && event.action === "created") {
      const owner = event.tank ? playerFromObject(state, event.tank.id) : -1;
      if (owner >= 0) {
        state.bullets.set(event.objectId, {
          id: event.objectId,
          owner,
          position: (event.tank.position || state.positions[owner]).slice(),
          direction: event.direction || event.tank.direction || state.directions[owner]
        });
      }
    } else if (event.type === "bullet" && event.action === "go") {
      const bullet = state.bullets.get(event.objectId);
      if (bullet) bullet.position = event.position.slice(), bullet.direction = event.direction;
    } else if (event.type === "bullet" && event.action === "crashed") {
      state.bullets.delete(event.objectId);
    } else if (event.type === "star" && event.action === "created") {
      state.star = event.position.slice();
    } else if (event.type === "star" && event.action === "collected") {
      if (event.by === 0 || event.by === 1) state.stars[event.by]++;
      state.star = null;
    } else if (event.type === "map" && event.action === "destroyed") {
      state.map[event.position[0]][event.position[1]] = ".";
    } else if (event.type === "bomb" && event.action === "placed") {
      state.bombs.set(event.objectId, {
        id: event.objectId,
        owner: event.by,
        position: event.position.slice(),
        placedFrame: event.placedFrame === undefined ? frame : event.placedFrame,
        explodeFrame: event.explodeFrame === undefined ? frame + 10 : event.explodeFrame
      });
    } else if (event.type === "bomb" && event.action === "exploded") {
      state.bombs.delete(event.objectId);
      if (event.by === 0 || event.by === 1) state.lastBombExplosion[event.by] = frame;
    } else if (event.type === "skill" && event.action === "cast") {
      if (event.by === 0 || event.by === 1) {
        state.skillTypes[event.by] = event.skillType;
        state.lastSkillCast[event.by] = frame;
      }
    } else if (event.type === "skill" && event.action === "applied") {
      const target = playerFromObject(state, event.targetObjectId);
      if (target >= 0 && event.skillType === "teleport" && event.to) {
        state.positions[target] = event.to.slice();
        state.revealUntil[target] = frame;
        const foe = 1 - target;
        if (manhattan(state.positions[target], state.positions[foe]) <= 4) {
          state.fireLockedUntil[target] = frame + 2;
        }
      } else if (target >= 0 && SELF_SKILLS.has(event.skillType)) {
        state.selfEffects[target] = {
          type: event.skillType,
          expiresFrame: frame + (event.durationFrames || 1)
        };
      } else if (target >= 0 && DEBUFF_SKILLS.has(event.skillType)) {
        state.debuffEffects[target] = {
          type: event.skillType,
          expiresFrame: frame + (event.durationFrames || 1)
        };
      }
    } else if (event.type === "skill" && event.action === "expired") {
      const target = playerFromObject(state, event.targetObjectId);
      if (target >= 0 && state.selfEffects[target] &&
          state.selfEffects[target].type === event.skillType) state.selfEffects[target] = null;
      if (target >= 0 && state.debuffEffects[target] &&
          state.debuffEffects[target].type === event.skillType) state.debuffEffects[target] = null;
    }
  }
}

function historicalActions(events, state, mine) {
  const actions = [];
  for (const event of events || []) {
    if (event.type === "tank" && event.objectId === state.objectIds[mine]) {
      if (event.action === "go") actions.push("GO");
      else if (event.action === "turn") actions.push(event.direction === "left" ? "LEFT" : "RIGHT");
    } else if (event.type === "bullet" && event.action === "created" &&
        event.tank && event.tank.id === state.objectIds[mine]) actions.push("FIRE");
    else if (event.type === "bomb" && event.action === "placed" && event.by === mine) actions.push("BOMB");
    else if (event.type === "skill" && event.action === "cast" && event.by === mine) {
      actions.push(event.skillType.toUpperCase());
    }
  }
  return actions.join("+") || null;
}

function scenarioTags(item, state, input, frame, lastFrame) {
  const mine = item.mine, foe = 1 - mine;
  const tags = [];
  tags.push(item.won ? "history_win" : "history_loss");
  tags.push(`reason_${item.reason || "unknown"}`);
  if (input.visibility.enemyTank) tags.push("enemy_visible");
  else if (state.selfEffects[foe] && state.selfEffects[foe].type === "cloak") tags.push("enemy_hidden_cloak");
  else if (state.map[state.positions[foe][0]][state.positions[foe][1]] === "o") tags.push("enemy_hidden_grass");
  else tags.push("enemy_hidden_other");
  if (input.visibility.enemyBullet) tags.push("enemy_projectile_visible");
  if (input.visibility.ownBullet) tags.push("own_projectile_active");
  if (input.visibility.bombs) tags.push("bomb_visible");
  if (state.star) tags.push("star_active");
  if (input.me.effects.self) tags.push(`self_${input.me.effects.self.type}`);
  if (input.me.effects.debuff) tags.push(`debuff_${input.me.effects.debuff.type}`);
  if (input.enemy.effects.self) tags.push(`enemy_${input.enemy.effects.self.type}`);
  if (input.enemy.effects.debuff) tags.push(`enemy_debuff_${input.enemy.effects.debuff.type}`);
  if (edgeDistance(state.positions[mine], state.map) <= 2) tags.push("near_edge");
  if (input.visibility.enemyTank) {
    const distance = manhattan(state.positions[mine], state.positions[foe]);
    tags.push(distance <= 2 ? "contact_close" : distance <= 5 ? "contact_mid" : "contact_long");
    if (faces(state.positions[foe], state.directions[foe], state.positions[mine], state.map)) {
      tags.push("enemy_muzzle_line");
    }
    if (faces(state.positions[mine], state.directions[mine], state.positions[foe], state.map)) {
      tags.push("own_fire_line");
    }
    if (state.star && manhattan(state.positions[foe], state.star) <=
        manhattan(state.positions[mine], state.star)) tags.push("star_race_not_ahead");
  }
  if (lastFrame - frame <= 3) tags.push("terminal_window");
  return tags;
}

function initialState(raw, skills) {
  const participants = roleParticipants(raw);
  const players = raw.replayData.replay.meta.players;
  return {
    map: raw.replayData.map.map.map(column => column.slice()),
    positions: players.map(player => player.tank.position.slice()),
    directions: players.map(player => player.tank.direction),
    objectIds: players.map(player => player.tank.id),
    stars: [0, 0],
    crashed: [false, false],
    star: null,
    bullets: new Map(),
    bombs: new Map(),
    selfEffects: [null, null],
    debuffEffects: [null, null],
    lastSkillCast: [-1, -1],
    lastBombExplosion: [-100, -100],
    revealUntil: [-1, -1],
    fireLockedUntil: [-1, -1],
    skillTypes: participants.map(participant => skills.get(participant.tankId) || null)
  };
}

function invokeAgent(context, input) {
  const started = performance.now();
  let error = null;
  try {
    context.onIdle(input.me, input.enemy, input.game);
  } catch (caught) {
    error = caught && caught.stack || String(caught);
  }
  const elapsedMs = performance.now() - started;
  const command = input.me.commands[0] || null;
  return {
    action: command ? command.action : null,
    detail: command && command.detail,
    commandCount: input.me.commands.length,
    elapsedMs,
    error
  };
}

function prepareMatches(corpus, skills) {
  return corpus.matches.map(item => {
    const raw = item.raw;
    const participants = roleParticipants(raw);
    const mine = participants[0].tankId === TANK_ID ? 0 :
      participants[1].tankId === TANK_ID ? 1 : -1;
    if (mine < 0) throw new Error(`${item.id}: tank ${TANK_ID} not present`);
    return {
      ...item,
      mine,
      won: raw.match.winnerTankId === TANK_ID,
      reason: raw.match.resultReason,
      historicalHash: participants[mine].codeHash,
      opponent: participants[1 - mine].tankName,
      state: initialState(raw, skills)
    };
  });
}

function resultRow(item, state, input, frame, records, result) {
  return {
    matchId: item.id,
    frame,
    won: item.won,
    reason: item.reason,
    historicalHash: item.historicalHash,
    opponent: item.opponent,
    historicalAction: historicalActions(records[frame + 1], state, item.mine),
    action: result.action,
    detail: result.detail,
    commandCount: result.commandCount,
    elapsedMs: result.elapsedMs,
    error: result.error,
    tags: scenarioTags(item, state, input, frame, records.length - 1)
  };
}

function runAgent(file, corpus, skills) {
  const rows = [];
  const perMatch = [];
  let totalMs = 0;
  for (const item of prepareMatches(corpus, skills)) {
    const context = loadAgent(file);
    const records = item.raw.replayData.replay.records;
    let decisions = 0;
    let errors = 0;
    let matchMs = 0;
    for (let frame = 0; frame < records.length; frame++) {
      applyFrameEvents(item.state, records[frame], frame);
      if (item.state.crashed[item.mine] || frame === records.length - 1) continue;
      const input = buildInput(item.mine, item.state, frame);
      const result = invokeAgent(context, input);
      rows.push(resultRow(item, item.state, input, frame, records, result));
      decisions++;
      if (result.error) errors++;
      totalMs += result.elapsedMs;
      matchMs += result.elapsedMs;
    }
    perMatch.push({
      matchId: item.id,
      won: item.won,
      reason: item.reason,
      historicalHash: item.historicalHash,
      frames: records.length,
      decisions,
      errors,
      elapsedMs: matchMs
    });
  }
  return { file, hash: codeHash(file), rows, perMatch, totalMs };
}

function runPairedAgents(baselineFile, currentFile, corpus, skills) {
  const runs = [baselineFile, currentFile].map(file => ({
    file, hash: codeHash(file), rows: [], perMatch: [], totalMs: 0
  }));
  const matches = prepareMatches(corpus, skills);
  for (let matchIndex = 0; matchIndex < matches.length; matchIndex++) {
    const item = matches[matchIndex];
    const contexts = [loadAgent(baselineFile), loadAgent(currentFile)];
    const records = item.raw.replayData.replay.records;
    const decisions = [0, 0], errors = [0, 0], matchMs = [0, 0];
    // Alternate which version runs first per match to counterbalance warm-cache noise.
    const order = matchIndex % 2 === 0 ? [0, 1] : [1, 0];
    for (let frame = 0; frame < records.length; frame++) {
      applyFrameEvents(item.state, records[frame], frame);
      if (item.state.crashed[item.mine] || frame === records.length - 1) continue;
      const inputs = [
        buildInput(item.mine, item.state, frame),
        buildInput(item.mine, item.state, frame)
      ];
      const results = [];
      for (const version of order) {
        results[version] = invokeAgent(contexts[version], inputs[version]);
      }
      for (let version = 0; version < 2; version++) {
        const result = results[version];
        runs[version].rows.push(resultRow(item, item.state, inputs[version],
          frame, records, result));
        decisions[version]++;
        if (result.error) errors[version]++;
        matchMs[version] += result.elapsedMs;
        runs[version].totalMs += result.elapsedMs;
      }
    }
    for (let version = 0; version < 2; version++) {
      runs[version].perMatch.push({
        matchId: item.id,
        won: item.won,
        reason: item.reason,
        historicalHash: item.historicalHash,
        frames: records.length,
        decisions: decisions[version],
        errors: errors[version],
        elapsedMs: matchMs[version]
      });
    }
  }
  return runs;
}

function snapshotFromRun(run, corpus) {
  const matches = {};
  for (const row of run.rows) {
    if (!matches[row.matchId]) matches[row.matchId] = [];
    matches[row.matchId].push({ frame: row.frame, action: row.action, detail: row.detail || null });
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    baselineFile: run.file,
    baselineCodeHash: run.hash,
    corpusFingerprint: corpus.fingerprint,
    uniqueMatches: corpus.matches.length,
    decisions: run.rows.length,
    matches
  };
}

function rowsFromSnapshot(snapshot) {
  const index = new Map();
  for (const [matchId, rows] of Object.entries(snapshot.matches)) {
    for (const row of rows) index.set(`${matchId}:${row.frame}`, row);
  }
  return index;
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function increment(object, key, amount = 1) {
  object[key] = (object[key] || 0) + amount;
}

function summarize(run, baselineIndex, corpus, baselineMeta, baselineRun) {
  const tags = {}, transitions = {}, hashes = {}, outcomes = {};
  const changedRows = [];
  let comparable = 0, changed = 0, missingBaseline = 0;
  let errors = 0, multiCommands = 0, historicalMatches = 0;
  const changedMatches = new Set();
  const latencies = [];
  for (const row of run.rows) {
    const baseline = baselineIndex.get(`${row.matchId}:${row.frame}`);
    if (!baseline) {
      missingBaseline++;
      continue;
    }
    comparable++;
    latencies.push(row.elapsedMs);
    if (row.error) errors++;
    if (row.commandCount > 1) multiCommands++;
    if (row.historicalAction && row.historicalAction.split("+")[0] === row.action) historicalMatches++;
    const isChanged = baseline.action !== row.action ||
      JSON.stringify(baseline.detail || null) !== JSON.stringify(row.detail || null);
    const outcome = row.won ? "history_win" : "history_loss";
    if (!outcomes[outcome]) outcomes[outcome] = { total: 0, changed: 0 };
    outcomes[outcome].total++;
    if (!hashes[row.historicalHash]) hashes[row.historicalHash] = { total: 0, changed: 0 };
    hashes[row.historicalHash].total++;
    for (const tag of row.tags) {
      if (!tags[tag]) tags[tag] = { total: 0, changed: 0 };
      tags[tag].total++;
    }
    if (isChanged) {
      changed++;
      changedMatches.add(row.matchId);
      outcomes[outcome].changed++;
      hashes[row.historicalHash].changed++;
      for (const tag of row.tags) tags[tag].changed++;
      increment(transitions, `${baseline.action || "NONE"}->${row.action || "NONE"}`);
      changedRows.push({ ...row, baselineAction: baseline.action, baselineDetail: baseline.detail || null });
    }
  }
  const addRates = object => Object.fromEntries(Object.entries(object).map(([key, value]) =>
    [key, { ...value, changedRate: value.total ? value.changed / value.total : 0 }]));
  const matchTimes = run.perMatch.map(match => match.elapsedMs);
  const baselineTotalMs = baselineRun ? baselineRun.totalMs : null;
  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    corpus: {
      sourceRawFiles: corpus.rawFiles,
      uniqueMatches: corpus.matches.length,
      fingerprint: corpus.fingerprint,
      replayFrames: corpus.matches.reduce((sum, item) =>
        sum + item.raw.replayData.replay.records.length, 0),
      wins: corpus.matches.filter(item => item.raw.match.winnerTankId === TANK_ID).length,
      losses: corpus.matches.filter(item => item.raw.match.winnerTankId !== TANK_ID).length
    },
    baseline: baselineMeta,
    current: { file: run.file, codeHash: run.hash },
    comparison: {
      comparable,
      changed,
      unchanged: comparable - changed,
      changedRate: comparable ? changed / comparable : 0,
      matchesChanged: changedMatches.size,
      missingBaseline,
      currentErrors: errors,
      multiCommandFrames: multiCommands,
      historicalFirstActionMatches: historicalMatches,
      historicalFirstActionMatchRate: comparable ? historicalMatches / comparable : 0,
      transitions: Object.fromEntries(Object.entries(transitions)
        .sort((a, b) => b[1] - a[1]))
    },
    performance: {
      currentTotalMs: run.totalMs,
      baselineTotalMs,
      reductionRate: baselineTotalMs ? (baselineTotalMs - run.totalMs) / baselineTotalMs : null,
      decisionMedianMs: percentile(latencies, 0.5),
      decisionP95Ms: percentile(latencies, 0.95),
      decisionP99Ms: percentile(latencies, 0.99),
      decisionMaxMs: Math.max(0, ...latencies),
      matchMedianMs: percentile(matchTimes, 0.5),
      matchP95Ms: percentile(matchTimes, 0.95),
      matchMaxMs: Math.max(0, ...matchTimes)
    },
    outcomes: addRates(outcomes),
    historicalCodeHashes: addRates(hashes),
    tags: addRates(tags),
    changedRows
  };
}

function percent(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function shortHash(value) {
  return value ? value.slice(0, 12) : "unknown";
}

function markdownReport(result) {
  const c = result.comparison, p = result.performance;
  const tagRows = Object.entries(result.tags)
    .filter(([, value]) => value.changed > 0)
    .sort((a, b) => b[1].changed - a[1].changed || b[1].total - a[1].total)
    .slice(0, 25);
  const transitions = Object.entries(c.transitions).slice(0, 20);
  const hashes = Object.entries(result.historicalCodeHashes)
    .sort((a, b) => b[1].total - a[1].total);
  const changedExamples = result.changedRows.slice()
    .sort((a, b) => b.elapsedMs - a.elapsedMs)
    .slice(0, 30);
  return `# 全历史场景差分回归\n\n` +
    `本报告不是胜负预测，也不要求历史胜场继续“成功”或历史负场全部被规避。` +
    `它把真实回放状态固定为输入，只衡量当前策略相对基线的动作漂移、覆盖范围、异常与性能。` +
    `一旦动作改变，后续真实世界本应走向另一条轨迹，因此不得把离线结果解释为反事实胜率。\n\n` +
    `## 语料与基线\n\n` +
    `- 原始文件：${result.corpus.sourceRawFiles}；去重比赛：${result.corpus.uniqueMatches}` +
    `（胜 ${result.corpus.wins}、负 ${result.corpus.losses}）；回放帧：${result.corpus.replayFrames}\n` +
    `- 可比较决策帧：${c.comparable}；缺失基线：${c.missingBaseline}\n` +
    `- 基线：${shortHash(result.baseline.codeHash)}；当前：${shortHash(result.current.codeHash)}\n` +
    `- 快照语料指纹：\`${result.corpus.fingerprint}\`\n\n` +
    `## 总体差异\n\n` +
    `- 动作变化：${c.changed}/${c.comparable}（${percent(c.changedRate)}），` +
    `涉及 ${c.matchesChanged}/${result.corpus.uniqueMatches} 场；未变化 ${c.unchanged} 帧。\n` +
    `- 当前脚本异常：${c.currentErrors}；单帧排入多个命令：${c.multiCommandFrames}。` +
    `动作变化本身不触发失败。\n` +
    `- 固定历史轨迹上的“当前动作与下一帧历史首动作一致率”为 ` +
    `${percent(c.historicalFirstActionMatchRate)}；该值只用于检查重建质量，` +
    `不能用于评价新版优劣，因为大量比赛来自 v18/v19。\n\n` +
    `| 历史结果 | 决策帧 | 变化 | 变化率 |\n|---|---:|---:|---:|\n` +
    Object.entries(result.outcomes).map(([key, value]) =>
      `| ${key} | ${value.total} | ${value.changed} | ${percent(value.changedRate)} |`).join("\n") +
    `\n\n## 按历史代码版本\n\n| 历史代码哈希 | 决策帧 | 变化 | 变化率 |\n|---|---:|---:|---:|\n` +
    hashes.map(([key, value]) =>
      `| ${shortHash(key)} | ${value.total} | ${value.changed} | ${percent(value.changedRate)} |`).join("\n") +
    `\n\n## 性能\n\n` +
    `- 当前总决策耗时：${p.currentTotalMs.toFixed(2)} ms` +
    (p.baselineTotalMs === null ? "。\n" : `；同次运行基线：${p.baselineTotalMs.toFixed(2)} ms；` +
      `减少 ${percent(p.reductionRate)}。\n`) +
    `- 当前单决策：中位 ${p.decisionMedianMs.toFixed(3)} ms，` +
    `P95 ${p.decisionP95Ms.toFixed(3)} ms，P99 ${p.decisionP99Ms.toFixed(3)} ms，` +
    `最大 ${p.decisionMaxMs.toFixed(3)} ms。\n` +
    `- 当前单场：中位 ${p.matchMedianMs.toFixed(2)} ms，` +
    `P95 ${p.matchP95Ms.toFixed(2)} ms，最大 ${p.matchMaxMs.toFixed(2)} ms。` +
    `离线计时关闭了基于墙钟的 1.5 秒熔断，以保证动作快照确定性；性能数字用于相对比较。\n\n` +
    `## 变化集中的场景标签\n\n| 标签 | 覆盖帧 | 变化帧 | 变化率 |\n|---|---:|---:|---:|\n` +
    tagRows.map(([key, value]) =>
      `| ${key} | ${value.total} | ${value.changed} | ${percent(value.changedRate)} |`).join("\n") +
    `\n\n## 主要动作迁移\n\n| 基线 → 当前 | 帧数 |\n|---|---:|\n` +
    transitions.map(([key, value]) => `| ${key} | ${value} |`).join("\n") +
    `\n\n## 最慢的变化样本\n\n| 比赛 | 帧 | 历史结果 | 场景 | 基线 | 当前 | 当前耗时 ms |\n|---|---:|---|---|---|---|---:|\n` +
    changedExamples.map(row => `| ${row.matchId} | ${row.frame} | ` +
      `${row.won ? "win" : "loss"}/${row.reason} | ${row.tags.join(", ")} | ` +
      `${row.baselineAction || "NONE"} | ${row.action || "NONE"} | ${row.elapsedMs.toFixed(3)} |`).join("\n") +
    `\n\n## 回归判定\n\n` +
    `本套件只在以下情况失败：语料或快照不兼容、比赛缺帧、脚本抛异常、` +
    `或无法产生可比较结果。动作变化率和历史动作一致率均为观察指标，不设“必须成功”的门槛。\n`;
}

function csvCell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function changedCsv(rows) {
  const headers = ["matchId", "frame", "won", "reason", "historicalHash", "opponent",
    "historicalAction", "baselineAction", "action", "elapsedMs", "tags"];
  return [headers.join(","), ...rows.map(row => headers.map(key => csvCell(
    key === "tags" ? row.tags.join("|") : row[key])).join(","))].join("\n") + "\n";
}

function writeGenerated(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.baselineCode && !args.snapshot) {
    throw new Error("provide --baseline-code or --snapshot");
  }
  const corpus = loadCorpus(args.records);
  const skills = collectTankSkills(corpus);
  let baselineRun = null;
  let currentRun = null;
  let snapshot;
  if (args.baselineCode) {
    let baselineSource = args.baselineCode;
    if (args.storeBaselineCode) {
      writeGenerated(args.storeBaselineCode,
        fs.readFileSync(args.baselineCode, "utf8"));
      baselineSource = args.storeBaselineCode;
    }
    [baselineRun, currentRun] = runPairedAgents(baselineSource,
      args.current, corpus, skills);
    snapshot = snapshotFromRun(baselineRun, corpus);
    if (args.writeBaseline) {
      writeGenerated(args.writeBaseline, `${JSON.stringify(snapshot, null, 2)}\n`);
    }
  } else {
    snapshot = JSON.parse(fs.readFileSync(args.snapshot, "utf8"));
  }
  if (snapshot.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`snapshot schema ${snapshot.schemaVersion} != ${SCHEMA_VERSION}`);
  }
  if (snapshot.corpusFingerprint !== corpus.fingerprint) {
    throw new Error("corpus fingerprint differs from baseline snapshot; regenerate baseline intentionally");
  }
  if (!currentRun) currentRun = runAgent(args.current, corpus, skills);
  const baselineIndex = rowsFromSnapshot(snapshot);
  const result = summarize(currentRun, baselineIndex, corpus, {
    file: snapshot.baselineFile,
    codeHash: snapshot.baselineCodeHash,
    decisions: snapshot.decisions
  }, baselineRun);
  writeGenerated(path.join(args.output, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
  writeGenerated(path.join(args.output, "changed-frames.csv"), changedCsv(result.changedRows));
  writeGenerated(path.join(args.output, "REPORT.md"), markdownReport(result));
  const failures = [];
  if (result.comparison.missingBaseline) failures.push(`${result.comparison.missingBaseline} missing baseline frames`);
  if (result.comparison.currentErrors) failures.push(`${result.comparison.currentErrors} agent errors`);
  if (!result.comparison.comparable) failures.push("no comparable decisions");
  process.stdout.write(JSON.stringify({
    matches: result.corpus.uniqueMatches,
    frames: result.corpus.replayFrames,
    decisions: result.comparison.comparable,
    changed: result.comparison.changed,
    changedRate: result.comparison.changedRate,
    currentErrors: result.comparison.currentErrors,
    currentTotalMs: result.performance.currentTotalMs,
    baselineTotalMs: result.performance.baselineTotalMs,
    output: args.output
  }, null, 2) + "\n");
  if (failures.length) throw new Error(failures.join("; "));
}

main();
