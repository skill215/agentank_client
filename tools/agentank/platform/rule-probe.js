"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot, workspacePaths } = require("../core/paths");
const { invariant } = require("../core/errors");
const { sanitizeForStorage } = require("../core/sanitize");
const { sha256Text } = require("../core/hash");
const { writeJsonAtomic, writeJsonImmutable, ensureDirectory } = require("../core/atomic-file");
const { validateSchemaObject } = require("../core/schema-validator");
const { loadRegistry, getProfile } = require("../profiles/registry");
const { resolveSecret } = require("../profiles/secret-ref");
const { extractContextIdentity, verifyProfileIdentity } = require("../profiles/context-identity");
const { reserveOwnerScope } = require("./rate-limit");
const { createOfficialProbeClient } = require("./probe-client");

const FAILED_CAST_CODE = `var p2ProbePhase=0;
function onIdle(me,enemy,game){
  if(p2ProbePhase===0){p2ProbePhase=1;me.poison();me.turn("right");me.turn("left");return;}
  if(p2ProbePhase===1){p2ProbePhase=2;me.speak("P2BASE:"+me.skill.remainingCooldownFrames);me.go();return;}
  if(p2ProbePhase===2&&me.skill.remainingCooldownFrames===0){p2ProbePhase=3;me.poison();me.turn("right");me.poison();return;}
  if(p2ProbePhase===3){p2ProbePhase=4;me.speak("P2EXP:"+me.skill.remainingCooldownFrames);me.go();return;}
  me.turn("right");me.go();
}`;

const STEER_HELPERS = `function p2dir(me,x,y){
  var p=me.tank.position,dx=x-p[0],dy=y-p[1],d=me.tank.direction,w;
  if(Math.abs(dx)>=Math.abs(dy)&&dx!==0)w=dx>0?"right":"left";
  else if(dy!==0)w=dy>0?"down":"up";else w=d;
  if(d===w)return 0;
  if((d==="up"&&w==="left")||(d==="left"&&w==="down")||
     (d==="down"&&w==="right")||(d==="right"&&w==="up"))me.turn("left");
  else me.turn("right");return 1;
}
function p2next(me){var p=me.tank.position,d=me.tank.direction;
  return d==="left"?[p[0]-1,p[1]]:d==="right"?[p[0]+1,p[1]]:
    d==="up"?[p[0],p[1]-1]:[p[0],p[1]+1];}
`;

const MOVE_CONTEST_CODE = `${STEER_HELPERS}
function onIdle(me,enemy,game){
  if(!enemy.tank){me.turn("right");return;}
  if(p2dir(me,enemy.tank.position[0],enemy.tank.position[1]))return;
  var n=p2next(me);me.speak("P2MC:"+n[0]+","+n[1]);me.go();
}`;

const STAR_CONTEST_CODE = `${STEER_HELPERS}
function onIdle(me,enemy,game){
  var s=game.star;if(!s){me.turn("right");return;}
  if(p2dir(me,s[0],s[1]))return;
  var n=p2next(me);me.speak("P2SC:"+n[0]+","+n[1]);me.go();
}`;

const PROJECTILE_SHARED_CODE = `${STEER_HELPERS}
function onIdle(me,enemy,game){
  if(!enemy.tank){me.turn("right");return;}
  var p=me.tank.position,e=enemy.tank.position;
  if((p[0]===e[0]||p[1]===e[1])&&!p2dir(me,e[0],e[1])){
    me.speak("P2PS:FIRE");me.fire();return;
  }
  if(p2dir(me,e[0],e[1]))return;me.go();
}`;

const MULTI_BOMB_CODE = `${STEER_HELPERS}
function onIdle(me,enemy,game){
  if(!me.status.bombActive&&me.status.bombCooldownFrames===0){
    me.speak("P2MB:BOMB");me.throwBomb();return;
  }
  if(enemy.tank&&!p2dir(me,enemy.tank.position[0],enemy.tank.position[1]))me.go();
}`;

const FREEZE_EMPTY_CODE = `function onIdle(me,enemy,game){
  me.speak("P2FE:"+game.frames+":"+(enemy.skill?enemy.skill.type:"none"));
  me.turn("right");
}`;

const BOOST_EMPTY_CODE = `function onIdle(me,enemy,game){
  me.speak("P2BE:"+game.frames+":"+(enemy.skill?enemy.skill.type:"none"));
  me.turn("right");
}`;

const POISON_EMPTY_CODE = `var p2PoisonCast=0;
function onIdle(me,enemy,game){
  if(!p2PoisonCast){p2PoisonCast=1;me.speak("P2PE:CAST");me.poison();return;}
  me.speak("P2PE:"+game.frames);me.turn("right");
}`;

const TELEPORT_REVEAL_CODE = `function onIdle(me,enemy,game){
  var v=enemy.tank?enemy.tank.position.join(","):"hidden";
  me.speak("P2TR:"+game.frames+":"+(enemy.skill?enemy.skill.type:"none")+":"+v);
  me.turn("right");
}`;

const TIMEOUT_BOUNDARY_CODE = `var p2BurnState=0;
function onIdle(me,enemy,game){
  var x=p2BurnState;for(var i=0;i<50000000;i++)x=(x+i)|0;p2BurnState=x;
  me.speak("P2TB:"+game.frames+":"+p2BurnState);
  me.turn("right");
}`;

const RUNTIME_CLOCK_CODE = `var p2RuntimeInspected=0;
function onIdle(me,enemy,game){
  if(!p2RuntimeInspected){p2RuntimeInspected=1;
    var dt=typeof Date,dn=dt!=="undefined"&&Date===null;
    print("P2ENV|Date="+dt+"|performance="+typeof performance+
      "|DateNull="+dn+"|DateNow="+(dt==="undefined"||dn?"none":typeof Date.now)+
      "|performanceNow="+(typeof performance==="object"&&performance?typeof performance.now:"none")+
      "|globalThis="+typeof globalThis+"|setTimeout="+typeof setTimeout);
    print("P2GAME|"+Object.keys(game).sort().join(","));
    print("P2STATUS|"+Object.keys(me.status).sort().join(","));
    print("P2ME|"+Object.keys(me).sort().join(","));
  }
  me.turn("right");
}`;

const EXACT_RUNTIME_TIE_CODE = `function onIdle(me,enemy,game){me.turn("right");}`;

const PROBE_CANDIDATES = Object.freeze({
  "P2-MOVE-CONTEST": { profileId: "v2", code: MOVE_CONTEST_CODE,
    opponentId: "nova-scout", mapId: "arena" },
  "P2-STAR-CONTEST": { profileId: "v2", code: STAR_CONTEST_CODE,
    opponentId: "crimson-bastion", mapId: "arena" },
  "P2-PROJECTILE-SHARED": { profileId: "v1", code: PROJECTILE_SHARED_CODE,
    opponentId: "azure-hunter", mapId: "classic" },
  "P2-MULTI-BOMB": { profileId: "v2", code: MULTI_BOMB_CODE,
    opponentId: "crimson-bastion", mapId: "arena" },
  "P2-FREEZE-EMPTY": { profileId: "v1", code: FREEZE_EMPTY_CODE,
    opponentId: "azure-hunter", mapId: "arena" },
  "P2-BOOST-EMPTY": { profileId: "v1", code: BOOST_EMPTY_CODE,
    opponentId: "nova-scout", mapId: "arena" },
  "P2-POISON-EMPTY": { profileId: "v2", code: POISON_EMPTY_CODE,
    opponentId: "nova-scout", mapId: "arena" },
  "P2-TELEPORT-REVEAL": { profileId: "v2", code: TELEPORT_REVEAL_CODE,
    opponentId: "crimson-bastion", mapId: "public-map-55" },
  "P2-TIMEOUT-BOUNDARY": { profileId: "v2", code: TIMEOUT_BOUNDARY_CODE,
    opponentId: "nova-scout", mapId: "arena" },
  "P2-RUNTIME-CLOCK": { profileId: "v2", code: RUNTIME_CLOCK_CODE,
    opponentId: "nova-scout", mapId: "arena" },
  "P2-EXACT-RUNTIME-TIE": { profileId: "v2", code: EXACT_RUNTIME_TIE_CODE,
    opponentId: "crimson-bastion", mapId: "arena" },
  "P2-FAILED-CAST": { profileId: "v2", code: FAILED_CAST_CODE,
    opponentId: "nova-scout", mapId: "arena" }
});

function probeCandidate(probeId, profileId) {
  const candidate = PROBE_CANDIDATES[probeId];
  invariant(candidate && candidate.profileId === profileId, "PROBE_CANDIDATE_NOT_IMPLEMENTED",
    `official candidate ${probeId}/${profileId} is not implemented`);
  return { code: candidate.code, opponentId: candidate.opponentId, mapId: candidate.mapId };
}

function replayFromResponse(response) {
  return response?.replay || response?.replayData?.replay || response?.match?.replay ||
    response?.data?.replay || null;
}

function frameEvents(record) { return Array.isArray(record) ? record : record?.events || []; }

function pointKey(point) { return Array.isArray(point) ? `${point[0]},${point[1]}` : null; }

function genericReplayAnalysis(response) {
  const replay = replayFromResponse(response); const records = Array.isArray(replay?.records) ?
    replay.records : []; const eventsByFrame = records.map(frameEvents); const all = eventsByFrame.flat();
  const meta = replay?.meta || {}; const players = Array.isArray(meta.players) ? meta.players : [];
  const runtimes = players.map(player => Number.isSafeInteger(player?.runTime) ? player.runTime : null);
  const stars = [0, 0];
  for (const event of all) if (event.type === "star" && event.action === "collected" &&
      (event.by === 0 || event.by === 1)) stars[event.by] += 1;
  const speechSkillTypes = all.filter(event => event.type === "speech" &&
    /^P2(?:FE|BE|TR):[^:]+:[^:]+/.test(event.text || "")).map(event =>
    event.text.split(":")[2]);
  return { replay, records, eventsByFrame, all, meta, players, runtimes, stars,
    resultReason: response?.resultReason || meta?.result?.reason || null,
    winner: response?.winner ?? meta?.result?.winner ?? null,
    skillTypes: [...new Set(all.filter(event => event.type === "skill" &&
      typeof event.skillType === "string").map(event => event.skillType).concat(speechSkillTypes))].sort(),
    playerLogs: players.map(player => Array.isArray(player?.logs) ? player.logs : []) };
}

function analyzeMoveContest(base) {
  const positions = new Map(base.players.map(player => [player?.tank?.id, player?.tank?.position?.slice()]));
  const candidateId = base.players[0]?.tank?.id; let contestFrame = null; let contestKind = null;
  const pending = new Map(); const staticOccupiedBlockFrames = [];
  for (let frame = 0; frame < base.eventsByFrame.length; frame += 1) {
    const before = new Map([...positions].map(([id, value]) => [id, value?.slice()]));
    const events = base.eventsByFrame[frame];
    const moves = events.filter(event => event.type === "tank" &&
      event.action === "go" && Array.isArray(event.position));
    let sameFrameIntended = null;
    for (const event of events) {
      if (event.type === "speech" && /^P2MC:-?[0-9]+,-?[0-9]+$/.test(event.text || ""))
        sameFrameIntended = event.text.slice(5);
    }
    // Auxiliary speech and the submitted GO are recorded in the same platform
    // record.  If the marked target was occupied at the beginning and remains
    // occupied, absence of the candidate GO/crash event proves a blocked move.
    // The old frame+1 relation is retained only for legacy replay adapters.
    if (sameFrameIntended) pending.set(frame + 1, sameFrameIntended);
    if (moves.length > 1) {
      const keys = moves.map(event => pointKey(event.position));
      if (new Set(keys).size !== keys.length) { contestFrame = frame; contestKind = "SAME_TARGET"; }
      const a = moves[0], b = moves[1];
      if (pointKey(a.position) === pointKey(before.get(b.objectId)) &&
          pointKey(b.position) === pointKey(before.get(a.objectId))) {
        contestFrame = frame; contestKind = "SWAP";
      }
    }
    const intended = sameFrameIntended || pending.get(frame);
    if (intended) {
      const occupant = [...before].find(([id, position]) => id !== candidateId &&
        pointKey(position) === intended);
      const candidateMoved = moves.some(event => event.objectId === candidateId);
      const candidateCrashed = events.some(event => event.type === "tank" &&
        event.action === "crashed" && event.objectId === candidateId);
      const occupantMovedAway = occupant && moves.some(event => event.objectId === occupant[0] &&
        pointKey(event.position) !== intended);
      if (occupant && !candidateMoved && !candidateCrashed && !occupantMovedAway) {
        staticOccupiedBlockFrames.push(frame);
        if (contestFrame === null) {
          contestFrame = frame; contestKind = "STATIC_OCCUPIED_BLOCK";
        }
      }
    }
    if (intended && moves.some(event => event.objectId !== candidateId &&
        pointKey(event.position) === intended) && !moves.some(event => event.objectId === candidateId)) {
      contestFrame = frame; contestKind = "MARKED_TARGET_TAKEN";
    }
    for (const event of moves) positions.set(event.objectId, event.position.slice());
  }
  return { targetEventReached: contestFrame !== null, contestFrame, contestKind,
    staticOccupiedBlockFrames, staticOccupiedBlockCount: staticOccupiedBlockFrames.length,
    inferredVariant: contestKind, outcome: contestFrame === null ? "INCONCLUSIVE" : "CONCLUSIVE" };
}

function analyzeStarContest(base) {
  let star = null; let contestFrame = null; let collectionFrame = null; let collectedBy = null;
  for (let frame = 0; frame < base.eventsByFrame.length; frame += 1) {
    const events = base.eventsByFrame[frame];
    for (const event of events) {
      if (event.type === "star" && event.action === "created") star = event.position?.slice() || null;
      if (event.type === "star" && event.action === "collected") {
        collectionFrame = frame; collectedBy = event.by;
        const moves = events.filter(value => value.type === "tank" && value.action === "go" &&
          pointKey(value.position) === pointKey(star));
        const marked = events.some(value => value.type === "speech" &&
          value.text === `P2SC:${pointKey(star)}`);
        if (moves.length > 1 || (marked && event.by !== 0)) contestFrame = frame;
      }
    }
  }
  return { targetEventReached: contestFrame !== null, contestFrame, collectionFrame, collectedBy,
    inferredVariant: contestFrame === null ? null : "OBSERVED_COLLECTION_ORDER",
    outcome: contestFrame === null ? "INCONCLUSIVE" : "CONCLUSIVE" };
}

function analyzeProjectileShared(base) {
  let sharedFrame = null; let sharedPosition = null; let projectileIds = [];
  for (let frame = 0; frame < base.eventsByFrame.length; frame += 1) {
    const events = base.eventsByFrame[frame]; const byPosition = new Map();
    for (const event of events) if (event.type === "bullet" && event.action === "go" &&
        Array.isArray(event.position)) {
      const key = pointKey(event.position); const ids = byPosition.get(key) || new Set();
      ids.add(event.objectId); byPosition.set(key, ids);
    }
    for (const [key, ids] of byPosition) if (ids.size > 1 && events.some(event =>
        (event.type === "map" && event.action === "destroyed" && pointKey(event.position) === key) ||
        (event.type === "tank" && event.action === "crashed") ||
        (event.type === "skill" && /block|absorb/.test(event.action || "")))) {
      sharedFrame = frame; sharedPosition = key; projectileIds = [...ids].sort();
    }
  }
  return { targetEventReached: sharedFrame !== null, sharedFrame, sharedPosition, projectileIds,
    inferredVariant: sharedFrame === null ? null : "ORDERED_SHARED_RESOURCE_OBSERVED",
    outcome: sharedFrame === null ? "INCONCLUSIVE" : "CONCLUSIVE" };
}

function analyzeMultiBomb(base) {
  let explosionFrame = null; let bombIds = [];
  for (let frame = 0; frame < base.eventsByFrame.length; frame += 1) {
    const ids = new Set(base.eventsByFrame[frame].filter(event => event.type === "bomb" &&
      /explode|exploded/.test(event.action || "")).map(event => event.objectId));
    if (ids.size > 1) { explosionFrame = frame; bombIds = [...ids].sort(); break; }
  }
  return { targetEventReached: explosionFrame !== null, explosionFrame, bombIds,
    inferredVariant: explosionFrame === null ? null : "ORDERED_BOMB_BATCH_OBSERVED",
    outcome: explosionFrame === null ? "INCONCLUSIVE" : "CONCLUSIVE" };
}

function analyzeSkillBoundary(probeId, base) {
  const skill = probeId === "P2-FREEZE-EMPTY" ? "freeze" : probeId === "P2-BOOST-EMPTY" ?
    "boost" : probeId === "P2-POISON-EMPTY" ? "poison" : "teleport";
  const applied = [];
  for (let frame = 0; frame < base.eventsByFrame.length; frame += 1)
    for (const event of base.eventsByFrame[frame]) if (event.type === "skill" &&
        event.skillType === skill && event.action === "applied") applied.push({ frame, event });
  const evidence = { appliedFrames: applied.map(item => item.frame), observedSkillTypes: base.skillTypes };
  if (probeId === "P2-POISON-EMPTY" && applied.length > 0) {
    const first = applied[0]; const target = first.event.targetObjectId;
    evidence.targetActionFrames = [];
    for (let frame = first.frame; frame <= first.frame + 4 && frame < base.eventsByFrame.length; frame += 1)
      if (base.eventsByFrame[frame].some(event => event.type === "tank" && event.objectId === target &&
          ["go", "turn"].includes(event.action))) evidence.targetActionFrames.push(frame);
  }
  return { targetEventReached: applied.length > 0, ...evidence, inferredVariant: null,
    outcome: "INCONCLUSIVE" };
}

function analyzeTimeout(base) {
  const runtime = base.runtimes[0]; const bracketReached = Number.isSafeInteger(runtime) &&
    runtime >= 2950 && runtime <= 3050;
  const runtimeLimitReached = base.resultReason === "runTime" || base.resultReason === "runtime";
  return { targetEventReached: bracketReached || runtimeLimitReached, observedRuntimeMs: runtime,
    runtimeLimitReached, resultReason: base.resultReason, playerLogs: base.playerLogs,
    inferredVariant: null, outcome: "INCONCLUSIVE" };
}

function analyzeRuntimeClock(base) {
  const logs = (base.playerLogs[0] || []).map(log => {
    if (typeof log?.data !== "string") return JSON.stringify(log?.data ?? null);
    try { const parsed = JSON.parse(log.data); return typeof parsed === "string" ? parsed : log.data; }
    catch { return log.data; }
  });
  const envLine = logs.find(line => line.includes("P2ENV|")) || null;
  const fields = {};
  if (envLine) for (const part of envLine.slice(envLine.indexOf("P2ENV|") + 6).split("|")) {
    const separator = part.indexOf("="); if (separator > 0) fields[part.slice(0, separator)] =
      part.slice(separator + 1);
  }
  const inferredVariant = !envLine ? null : fields.DateNow === "function" ? "DATE_NOW" :
    fields.performanceNow === "function" ? "PERFORMANCE_NOW" :
      fields.DateNow === "none" && fields.performanceNow === "none" ? "NO_WALL_CLOCK" : null;
  return { targetEventReached: envLine !== null, runtimeGlobals: fields,
    publicRootKeys: Object.fromEntries(["P2GAME", "P2STATUS", "P2ME"].map(prefix => {
      const line = logs.find(value => value.includes(`${prefix}|`)); return [prefix,
        line ? line.slice(line.indexOf(`${prefix}|`) + prefix.length + 1).split(",").filter(Boolean) : []];
    })), inferredVariant, outcome: envLine === null ? "INCONCLUSIVE" : "CONCLUSIVE" };
}

function analyzeRuntimeTie(base) {
  const reached = base.runtimes.length >= 2 && base.runtimes[0] !== null &&
    base.runtimes[0] === base.runtimes[1] && base.stars[0] === base.stars[1];
  return { targetEventReached: reached, observedRuntimes: base.runtimes,
    observedStars: base.stars, resultReason: base.resultReason,
    inferredVariant: reached ? `TERMINAL:${JSON.stringify(base.meta?.result || null)}` : null,
    outcome: reached ? "CONCLUSIVE" : "INCONCLUSIVE" };
}

function analyzeProbeResponse(probeId, response) {
  const base = genericReplayAnalysis(response); const replay = base.replay; const records = base.records;
  if (probeId === "P2-MOVE-CONTEST") return { recordCount: records.length,
    ...analyzeMoveContest(base) };
  if (probeId === "P2-STAR-CONTEST") return { recordCount: records.length,
    ...analyzeStarContest(base) };
  if (probeId === "P2-PROJECTILE-SHARED") return { recordCount: records.length,
    ...analyzeProjectileShared(base) };
  if (probeId === "P2-MULTI-BOMB") return { recordCount: records.length,
    ...analyzeMultiBomb(base) };
  if (["P2-FREEZE-EMPTY", "P2-BOOST-EMPTY", "P2-POISON-EMPTY",
    "P2-TELEPORT-REVEAL"].includes(probeId)) return { recordCount: records.length,
    ...analyzeSkillBoundary(probeId, base) };
  if (probeId === "P2-TIMEOUT-BOUNDARY") return { recordCount: records.length,
    ...analyzeTimeout(base) };
  if (probeId === "P2-RUNTIME-CLOCK") return { recordCount: records.length,
    ...analyzeRuntimeClock(base) };
  if (probeId === "P2-EXACT-RUNTIME-TIE") return { recordCount: records.length,
    ...analyzeRuntimeTie(base) };
  invariant(probeId === "P2-FAILED-CAST", "UNKNOWN_RULE_PROBE_ANALYZER",
    `no official response analyzer for ${probeId}`);
  const text = JSON.stringify(records);
  const failedEventCount = (text.match(/failed|no[_ -]?effect|cooldown/gi) || []).length;
  const poisonEventCount = (text.match(/poison/gi) || []).length;
  const targetEventReached = probeId === "P2-FAILED-CAST" && failedEventCount > 0;
  const castFrames = []; let failedFrame = null; let speechFrame = null; let observedCooldown = null;
  let baselineCooldown = null; let experimentalCooldown = null;
  for (let frame = 0; frame < records.length; frame += 1) {
    const events = Array.isArray(records[frame]) ? records[frame] : records[frame]?.events || [];
    for (const event of events) {
      if (event.type === "skill" && event.skillType === "poison" && event.action === "cast" &&
          true) castFrames.push(frame);
      if (event.type === "skill" && event.skillType === "poison" && event.action === "failed" &&
          failedFrame === null) failedFrame = frame;
      if (event.type === "speech" && typeof event.text === "string" && /^P2(?:BASE|EXP):[0-9]+$/.test(event.text)) {
        speechFrame = frame; observedCooldown = Number(event.text.slice(event.text.indexOf(":") + 1));
        if (event.text.startsWith("P2BASE:")) baselineCooldown = observedCooldown;
        else experimentalCooldown = observedCooldown;
      }
    }
  }
  const castFrame = castFrames.length > 0 ? castFrames[0] : null;
  const preservedExpected = baselineCooldown;
  const secondCastFrame = castFrames.length > 1 ? castFrames[1] : null;
  const consumedExpected = baselineCooldown === null || failedFrame === null || secondCastFrame === null ?
    null : baselineCooldown + failedFrame - secondCastFrame;
  const inferredVariant = baselineCooldown === null || experimentalCooldown === null ? null :
    experimentalCooldown === baselineCooldown ? "FAILED_PRESERVES_READY_FRAME" :
    experimentalCooldown > baselineCooldown ? "FAILED_RESETS_READY_FRAME" : null;
  return { recordCount: records.length, failedEventCount, poisonEventCount, targetEventReached,
    castFrame, castFrames, failedFrame, speechFrame, observedCooldown, baselineCooldown,
    experimentalCooldown, preservedExpected, consumedExpected,
    inferredVariant, outcome: inferredVariant === null ? "INCONCLUSIVE" : "CONCLUSIVE" };
}

async function runOfficialRuleProbe(options) {
  invariant(options.authorized === true, "OFFICIAL_SIMULATE_AUTHORIZATION_REQUIRED",
    "official simulate requires --authorize-official-simulate");
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const plan = JSON.parse(fs.readFileSync(path.join(root, "config", "agentank",
    "imp2-rule-probes.json"), "utf8"));
  validateSchemaObject("imp2-rule-probe-plan", plan, root);
  const probe = plan.probes.find(item => item.probeId === options.probeId);
  invariant(probe, "UNKNOWN_RULE_PROBE", `unknown probe ${options.probeId}`);
  invariant(probe.tankProfileIds.includes(options.profileId), "PROBE_PROFILE_NOT_ALLOWED",
    "probe plan does not allow this TankProfile");
  const candidate = probeCandidate(probe.probeId, options.profileId);
  invariant(candidate.mapId === probe.mapId, "PROBE_MAP_MISMATCH", "candidate map differs from plan");
  const registry = loadRegistry(workspacePaths(root).registry); const profile = getProfile(registry, options.profileId);
  invariant(profile.status === "ACTIVE" || profile.status === "READ_ONLY", "PROFILE_NOT_ACTIVE",
    "official probe requires an active profile");
  const secret = resolveSecret(profile.secretRef, options.environment || process.env);
  const client = (options.clientFactory || createOfficialProbeClient)({ secret,
    fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs });
  const context = await client.getContext(); const identity = extractContextIdentity(context, "main");
  verifyProfileIdentity(profile, identity);
  reserveOwnerScope(root, profile.ownerScopeId, `IMP2_RULE_PROBE:${probe.probeId}`,
    { nowMs: options.nowMs });
  const response = await client.simulate({ opponentId: candidate.opponentId,
    mapId: candidate.mapId, code: candidate.code });
  const sanitized = sanitizeForStorage(response);
  invariant(!JSON.stringify(sanitized).includes(secret), "SECRET_ECHO_IN_PROBE",
    "platform response secret material survived sanitization");
  const responseText = JSON.stringify(sanitized); const responseSha256 = sha256Text(responseText);
  const analysis = analyzeProbeResponse(probe.probeId, sanitized);
  const directory = path.join(root, "artifacts", "platform", "probes", "imp2");
  const rawDirectory = path.join(directory, "raw"); ensureDirectory(rawDirectory);
  const rawFile = path.join(rawDirectory, `${probe.probeId}-${responseSha256}.json`);
  writeJsonImmutable(rawFile, sanitized, { mode: 0o600 });
  const evidence = { schemaVersion: 1, probeId: probe.probeId,
    ruleOrVariantId: probe.ruleOrVariantId, sourceType: "PLATFORM_SIM", outcome: analysis.outcome,
    tankProfileId: profile.tankProfileId, tankId: identity.tankId, skillId: identity.skillId,
    opponentId: candidate.opponentId, mapId: candidate.mapId,
    candidateCodeSha256: sha256Text(candidate.code), responseSha256,
    rawRelativePath: path.relative(root, rawFile), recordCount: analysis.recordCount,
    failedEventCount: analysis.failedEventCount, poisonEventCount: analysis.poisonEventCount,
    targetEventReached: analysis.targetEventReached,
    analysis,
    castFrame: analysis.castFrame, failedFrame: analysis.failedFrame,
    speechFrame: analysis.speechFrame, observedCooldown: analysis.observedCooldown,
    preservedExpected: analysis.preservedExpected, consumedExpected: analysis.consumedExpected,
    inferredVariant: analysis.inferredVariant,
    baselineCooldown: analysis.baselineCooldown, experimentalCooldown: analysis.experimentalCooldown,
    platformMutationType: "SIMULATE_ONLY", platformPublishCount: 0, platformChallengeCount: 0 };
  const evidenceFile = path.join(directory, `${probe.probeId}.json`);
  writeJsonAtomic(evidenceFile, evidence, { mode: 0o600 });
  return { evidence, evidenceFile };
}

function delay(milliseconds) { return new Promise(resolve => setTimeout(resolve, milliseconds)); }

async function runOfficialRuleProbeSuite(options) {
  invariant(options.authorized === true, "OFFICIAL_SIMULATE_AUTHORIZATION_REQUIRED",
    "official simulate suite requires --authorize-official-simulate");
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const plan = JSON.parse(fs.readFileSync(path.join(root, "config", "agentank",
    "imp2-rule-probes.json"), "utf8"));
  validateSchemaObject("imp2-rule-probe-plan", plan, root);
  const directory = path.join(root, "artifacts", "platform", "probes", "imp2");
  const pending = plan.probes.filter(probe => !fs.existsSync(path.join(directory,
    `${probe.probeId}.json`)));
  const results = [];
  for (let index = 0; index < pending.length; index += 1) {
    if (index > 0) await delay(options.intervalMs || 2100);
    const probe = pending[index]; const candidate = PROBE_CANDIDATES[probe.probeId];
    invariant(candidate, "PROBE_CANDIDATE_NOT_IMPLEMENTED",
      `official candidate ${probe.probeId} is not implemented`);
    const result = await runOfficialRuleProbe({ ...options, workspaceRoot: root,
      probeId: probe.probeId, profileId: candidate.profileId });
    results.push({ probeId: result.evidence.probeId, outcome: result.evidence.outcome,
      targetEventReached: result.evidence.targetEventReached,
      responseSha256: result.evidence.responseSha256,
      evidenceFile: result.evidenceFile });
  }
  return { plannedProbeCount: plan.probes.length, previouslyCompletedProbeCount:
    plan.probes.length - pending.length, executedProbeCount: results.length, results };
}

function reconcileOfficialRuleProbe(options) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const evidenceFile = path.join(root, "artifacts", "platform", "probes", "imp2",
    `${options.probeId}.json`);
  invariant(fs.existsSync(evidenceFile), "RULE_PROBE_EVIDENCE_NOT_FOUND",
    "rule probe evidence does not exist");
  const evidence = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
  const rawFile = path.join(root, evidence.rawRelativePath);
  invariant(fs.existsSync(rawFile), "RULE_PROBE_RAW_NOT_FOUND", "raw rule probe response is missing");
  const analysis = analyzeProbeResponse(options.probeId, JSON.parse(fs.readFileSync(rawFile, "utf8")));
  const updated = { ...evidence, outcome: analysis.outcome, recordCount: analysis.recordCount,
    failedEventCount: analysis.failedEventCount, poisonEventCount: analysis.poisonEventCount,
    targetEventReached: analysis.targetEventReached, castFrame: analysis.castFrame,
    failedFrame: analysis.failedFrame, speechFrame: analysis.speechFrame,
    observedCooldown: analysis.observedCooldown, preservedExpected: analysis.preservedExpected,
    consumedExpected: analysis.consumedExpected, inferredVariant: analysis.inferredVariant,
    baselineCooldown: analysis.baselineCooldown,
    experimentalCooldown: analysis.experimentalCooldown, analysis };
  writeJsonAtomic(evidenceFile, updated, { mode: 0o600 });
  return { evidence: updated, evidenceFile };
}

function reconcileOfficialRuleProbeSuite(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const plan = JSON.parse(fs.readFileSync(path.join(root, "config", "agentank",
    "imp2-rule-probes.json"), "utf8"));
  validateSchemaObject("imp2-rule-probe-plan", plan, root);
  const results = plan.probes.map(probe => reconcileOfficialRuleProbe({ workspaceRoot: root,
    probeId: probe.probeId })).map(result => ({ probeId: result.evidence.probeId,
    outcome: result.evidence.outcome, targetEventReached: result.evidence.targetEventReached,
    evidenceFile: result.evidenceFile }));
  return { reconciledProbeCount: results.length, results };
}

module.exports = { FAILED_CAST_CODE, PROBE_CANDIDATES, probeCandidate, analyzeProbeResponse,
  runOfficialRuleProbe, runOfficialRuleProbeSuite, reconcileOfficialRuleProbe,
  reconcileOfficialRuleProbeSuite };
