"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { AgentankToolError, invariant } = require("../core/errors");
const { ensureDirectory, writeFileAtomic, writeJsonAtomic } = require("../core/atomic-file");
const { sha256Bytes, fingerprintObject } = require("../core/hash");
const { contained, defaultWorkspaceRoot } = require("../core/paths");

const PUBLIC_ORIGIN = "https://agentank.ai";
const SUPPORTED_SKILLS = new Set(["shield", "freeze", "stun", "overload", "cloak", "poison",
  "teleport", "boost"]);

function timestampId(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function requestPublicJson(relativePath, options = {}) {
  invariant(relativePath.startsWith("/api/"), "INVALID_PUBLIC_API_PATH",
    "public evidence requests must use an /api/ path");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  invariant(typeof fetchImpl === "function", "FETCH_UNAVAILABLE", "Node fetch is unavailable");
  const attempts = options.attempts || 3; const timeoutMs = options.timeoutMs || 20000;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const url = `${options.origin || PUBLIC_ORIGIN}${relativePath}`;
      const response = await fetchImpl(url, { method: "GET", signal: controller.signal,
        headers: { Accept: "application/json",
          "User-Agent": "Codex-AgenTank-skill-evidence/0.1" } });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        const error = new AgentankToolError("PUBLIC_API_HTTP_ERROR",
          `public GET ${relativePath} failed with HTTP ${response.status}`, { exitCode: 6,
            retryClass: retryable ? "SAFE_GET_RETRY" : "NO_RETRY" });
        if (!retryable) throw error;
        lastError = error;
      } else {
        let value;
        try { value = JSON.parse(bytes.toString("utf8")); }
        catch { throw new AgentankToolError("PUBLIC_API_INVALID_JSON",
          `public GET ${relativePath} returned invalid JSON`, { exitCode: 6 }); }
        return { value, bytes, metadata: { url, status: response.status,
          downloadedAt: new Date().toISOString(), byteLength: bytes.length,
          sha256: sha256Bytes(bytes), contentType: response.headers?.get?.("content-type") || null } };
      }
    } catch (error) {
      if (error instanceof AgentankToolError && error.retryClass === "NO_RETRY") throw error;
      lastError = error;
    } finally { clearTimeout(timer); }
    if (attempt < attempts) await delay(250 * (2 ** (attempt - 1)));
  }
  throw new AgentankToolError("PUBLIC_API_RETRIES_EXHAUSTED",
    `public GET ${relativePath} failed after ${attempts} attempts: ${lastError?.message || "network error"}`,
    { exitCode: 6, retryClass: "SAFE_GET_RETRY" });
}

async function resolvePublicTank(tankName, expectedSkill, options = {}) {
  const response = await requestPublicJson(`/api/tanks?q=${encodeURIComponent(tankName)}&limit=50`,
    options);
  invariant(Array.isArray(response.value), "PUBLIC_TANK_SEARCH_SHAPE_CHANGED",
    "public tank search did not return an array");
  const exact = response.value.filter(tank => tank?.name === tankName);
  invariant(exact.length > 0, "PUBLIC_TANK_NOT_FOUND", `no exact public tank named ${tankName}`);
  invariant(exact.length === 1, "PUBLIC_TANK_NAME_AMBIGUOUS",
    `multiple public tanks are named ${tankName}; provide a public tank URL id`);
  const tank = exact[0];
  invariant(typeof tank.urlId === "string" && tank.urlId.startsWith("tnk_"),
    "PUBLIC_TANK_ID_MISSING", "resolved tank has no public URL id");
  invariant(tank.skillType === expectedSkill, "PUBLIC_TANK_SKILL_MISMATCH",
    `${tankName} reports skill ${tank.skillType || "UNKNOWN"}, expected ${expectedSkill}`);
  return { tank, response };
}

function subjectSeat(summary, tankId) {
  if (summary.participants?.challenger?.tankId === tankId) return 0;
  if (summary.participants?.defender?.tankId === tankId) return 1;
  return -1;
}

function flattenReplay(raw) {
  const records = raw?.replayData?.replay?.records;
  invariant(Array.isArray(records), "PUBLIC_RAW_REPLAY_SHAPE_CHANGED",
    "raw replay is missing replayData.replay.records");
  const output = [];
  for (let frame = 0; frame < records.length; frame += 1) {
    invariant(Array.isArray(records[frame]), "PUBLIC_RAW_FRAME_SHAPE_CHANGED",
      `raw replay frame ${frame} is not an event array`);
    for (let order = 0; order < records[frame].length; order += 1)
      output.push({ frame, order, value: records[frame][order] });
  }
  return output;
}

function claim(observed, contradicted, evidenceCount, note) {
  return { status: contradicted ? "CONTRADICTED" : observed ? "CONFIRMED" : "INCONCLUSIVE",
    evidenceCount, note };
}

function analyzeBoost(tank, matches) {
  const samples = []; let applications = 0; let casts = 0; let expirations = 0;
  let doubleStepPairs = 0; let invalidDoubleStepPairs = 0; let freeTurnMainPairs = 0;
  let durationMismatch = 0; let expiryMismatch = 0; let activeSingleGoFrames = 0;
  const codeHashes = new Set();
  for (const item of matches) {
    const seat = subjectSeat(item.summary, tank.id);
    invariant(seat >= 0, "PUBLIC_MATCH_SUBJECT_MISSING", `${item.urlId} does not contain ${tank.name}`);
    const participant = seat === 0 ? item.summary.participants.challenger :
      item.summary.participants.defender;
    codeHashes.add(participant.codeHash);
    const flattened = flattenReplay(item.raw); const subjectSkill = flattened.filter(entry => {
      const event = entry.value;
      return event.type === "skill" && event.skillType === "boost" && event.by === seat;
    });
    const matchCasts = subjectSkill.filter(entry => entry.value.action === "cast");
    const matchApplied = subjectSkill.filter(entry => entry.value.action === "applied");
    const matchExpired = subjectSkill.filter(entry => entry.value.action === "expired");
    casts += matchCasts.length; applications += matchApplied.length; expirations += matchExpired.length;
    let matchPairs = 0; let matchFree = 0;
    for (const applied of matchApplied) {
      const objectId = applied.value.sourceObjectId; const expectedDuration = applied.value.durationFrames;
      if (expectedDuration !== 6) durationMismatch += 1;
      const expired = matchExpired.find(candidate => candidate.frame >= applied.frame &&
        candidate.value.sourceObjectId === objectId);
      if (!expired || expired.frame - applied.frame !== 6) expiryMismatch += 1;
      const lastFrame = expired ? expired.frame : applied.frame + Number(expectedDuration || 0);
      for (let frame = applied.frame; frame < lastFrame; frame += 1) {
        const actions = flattened.filter(entry => entry.frame === frame &&
          entry.value.objectId === objectId && entry.value.type === "tank");
        const go = actions.filter(entry => entry.value.action === "go");
        if (go.length === 1) activeSingleGoFrames += 1;
        for (let index = 1; index < go.length; index += 1) {
          if (go[index].value.boosted !== true) continue;
          const before = go[index - 1].value.position; const after = go[index].value.position;
          const adjacent = Array.isArray(before) && Array.isArray(after) &&
            Math.abs(before[0] - after[0]) + Math.abs(before[1] - after[1]) === 1;
          doubleStepPairs += 1; matchPairs += 1;
          if (!adjacent || go[index - 1].value.boosted === true) invalidDoubleStepPairs += 1;
        }
        const firstTurnIndex = actions.findIndex(entry => entry.value.action === "turn");
        if (firstTurnIndex >= 0 && actions.slice(firstTurnIndex + 1)
          .some(entry => entry.value.action !== "turn")) {
          freeTurnMainPairs += 1; matchFree += 1;
        }
      }
    }
    samples.push({ matchUrlId: item.urlId, codeHash: participant.codeHash,
      castCount: matchCasts.length, applicationCount: matchApplied.length,
      expirationCount: matchExpired.length, doubleStepPairCount: matchPairs,
      freeTurnMainPairCount: matchFree });
  }
  const durationEvidence = applications;
  return { analyzerVersion: 1, skill: "boost", subject: { tankId: tank.id,
    tankUrlId: tank.urlId, tankName: tank.name }, codeHashes: Array.from(codeHashes).sort(),
    coverage: { matches: matches.length, matchesWithCast: samples.filter(item => item.castCount > 0).length,
      casts, applications, expirations, activeSingleGoFrames },
    claims: {
      durationSixFrames: claim(durationEvidence > 0, durationMismatch > 0 || expiryMismatch > 0,
        durationEvidence, "raw applied.durationFrames and applied-to-expired frame delta"),
      goMovesUpToTwoTiles: claim(doubleStepPairs > 0, invalidDoubleStepPairs > 0,
        doubleStepPairs, "second raw go event is boosted and adjacent to the first step"),
      firstTurnCanBeFree: claim(freeTurnMainPairs > 0, false, freeTurnMainPairs,
        "subject turn is followed by another tank action in the same raw frame"),
      cooldownTwentySixFrames: claim(false, false, 0,
        "public replay events do not expose cooldown state continuously"),
      emptyQueueRepoll: claim(false, false, 0,
        "replay events do not expose onIdle repoll boundaries")
    }, samples };
}

function analyzeShield(tank, matches) {
  const samples = []; const codeHashes = new Set(); let casts = 0; let applications = 0;
  let expirations = 0; let durationMismatch = 0; let absorbedBullets = 0;
  let firstHitRetainedWindows = 0; let twoHitConsumedWindows = 0; let prematureSingleHitExpiry = 0;
  let bombInteractions = 0;
  for (const item of matches) {
    const seat = subjectSeat(item.summary, tank.id);
    invariant(seat >= 0, "PUBLIC_MATCH_SUBJECT_MISSING", `${item.urlId} does not contain ${tank.name}`);
    const participant = seat === 0 ? item.summary.participants.challenger :
      item.summary.participants.defender;
    codeHashes.add(participant.codeHash);
    const records = item.raw?.replayData?.replay?.records;
    const players = item.raw?.replayData?.replay?.meta?.players;
    invariant(Array.isArray(records) && Array.isArray(players), "PUBLIC_RAW_REPLAY_SHAPE_CHANGED",
      `${item.urlId} has no replay records or players`);
    const subjectObjectId = players[seat]?.tank?.id;
    invariant(typeof subjectObjectId === "string", "PUBLIC_RAW_SUBJECT_OBJECT_MISSING",
      `${item.urlId} has no subject object id`);
    let subjectPosition = players[seat].tank.position?.slice(); let active = null;
    let matchCasts = 0; let matchApplications = 0; let matchAbsorbed = 0;
    const windows = [];
    for (let frame = 0; frame < records.length; frame += 1) {
      const frameEvents = records[frame];
      for (let order = 0; order < frameEvents.length; order += 1) {
        const event = frameEvents[order];
        if (event.type === "tank" && event.objectId === subjectObjectId && event.action === "go" &&
          Array.isArray(event.position)) subjectPosition = event.position.slice();
        if (event.type === "skill" && event.skillType === "shield" && event.by === seat) {
          if (event.action === "cast") { casts += 1; matchCasts += 1; }
          else if (event.action === "applied") {
            applications += 1; matchApplications += 1;
            if (event.durationFrames !== 4) durationMismatch += 1;
            active = { appliedFrame: frame, durationFrames: event.durationFrames,
              sourceObjectId: event.sourceObjectId, hits: [], expiredFrame: null,
              expiredOrder: null, subjectCrashed: false };
            windows.push(active);
          } else if (event.action === "expired" && active) {
            expirations += 1; active.expiredFrame = frame; active.expiredOrder = order; active = null;
          }
        }
        if (active && event.type === "bullet" && event.action === "go" &&
          event.tank?.id !== subjectObjectId && Array.isArray(event.position) &&
          Array.isArray(subjectPosition) && event.position[0] === subjectPosition[0] &&
          event.position[1] === subjectPosition[1]) {
          const crashed = frameEvents.slice(order + 1).some(candidate => candidate.type === "bullet" &&
            candidate.action === "crashed" && candidate.objectId === event.objectId);
          if (crashed) {
            active.hits.push({ frame, order, bulletObjectId: event.objectId,
              position: event.position.slice() });
            absorbedBullets += 1; matchAbsorbed += 1;
          }
        }
        if (active && event.type === "tank" && event.action === "crashed" &&
          event.objectId === subjectObjectId) active.subjectCrashed = true;
        if (active && String(event.type || "").toLowerCase().includes("bomb")) bombInteractions += 1;
      }
    }
    for (const window of windows) {
      if (window.hits.length >= 1) {
        const first = window.hits[0]; const expiredAfterFirst = window.expiredFrame === first.frame &&
          window.expiredOrder > first.order;
        if (!expiredAfterFirst && !window.subjectCrashed) firstHitRetainedWindows += 1;
        else if (window.hits.length === 1 && expiredAfterFirst &&
          window.expiredFrame < window.appliedFrame + window.durationFrames)
          prematureSingleHitExpiry += 1;
      }
      if (window.hits.length >= 2) {
        const second = window.hits[1];
        if (!window.subjectCrashed && window.expiredFrame === second.frame &&
          window.expiredOrder > second.order) twoHitConsumedWindows += 1;
      }
    }
    samples.push({ matchUrlId: item.urlId, codeHash: participant.codeHash,
      castCount: matchCasts, applicationCount: matchApplications,
      absorbedBulletCount: matchAbsorbed,
      twoHitWindowCount: windows.filter(window => window.hits.length >= 2).length });
  }
  return { analyzerVersion: 1, skill: "shield", subject: { tankId: tank.id,
    tankUrlId: tank.urlId, tankName: tank.name }, codeHashes: Array.from(codeHashes).sort(),
    coverage: { matches: matches.length, matchesWithCast: samples.filter(item => item.castCount > 0).length,
      casts, applications, expirations, absorbedBullets, bombInteractions },
    claims: {
      durationFourFrames: claim(applications > 0, durationMismatch > 0, applications,
        "raw shield applied.durationFrames"),
      absorbsBulletWithoutDestroyingTank: claim(absorbedBullets > 0, false, absorbedBullets,
        "enemy bullet entered the shielded subject cell, crashed, and subject survived"),
      firstBulletLeavesOneCharge: claim(firstHitRetainedWindows > 0,
        prematureSingleHitExpiry > 0, firstHitRetainedWindows,
        "shield remained active after the first absorbed bullet"),
      secondBulletConsumesShield: claim(twoHitConsumedWindows > 0, false, twoHitConsumedWindows,
        "second absorbed bullet was followed by shield expiration while subject survived"),
      bombConsumesShield: claim(bombInteractions > 0, false, bombInteractions,
        "selected raw replays contain no shield-window bomb interaction"),
      cooldownTwentyFiveFrames: claim(false, false, 0,
        "public replay events do not expose cooldown state continuously")
    }, samples };
}

function analyzeCloak(tank, matches) {
  const samples = []; const codeHashes = new Set(); let casts = 0; let applications = 0;
  let expirations = 0; let durationMismatch = 0; let frameOneCasts = 0;
  let activeMoves = 0; let activeTurns = 0; let activeFires = 0;
  let longGrassCamps = 0; let longNonGrassCamps = 0;
  for (const item of matches) {
    const seat = subjectSeat(item.summary, tank.id);
    invariant(seat >= 0, "PUBLIC_MATCH_SUBJECT_MISSING", `${item.urlId} does not contain ${tank.name}`);
    const participant = seat === 0 ? item.summary.participants.challenger :
      item.summary.participants.defender;
    codeHashes.add(participant.codeHash);
    const records = item.raw?.replayData?.replay?.records;
    const players = item.raw?.replayData?.replay?.meta?.players;
    const terrainSource = item.raw?.replayData?.map?.map;
    invariant(Array.isArray(records) && Array.isArray(players) && Array.isArray(terrainSource),
      "PUBLIC_RAW_REPLAY_SHAPE_CHANGED", `${item.urlId} has no records, players, or map`);
    const terrain = terrainSource.map(column => column.slice());
    const subjectObjectId = players[seat]?.tank?.id;
    invariant(typeof subjectObjectId === "string", "PUBLIC_RAW_SUBJECT_OBJECT_MISSING",
      `${item.urlId} has no subject object id`);
    let active = false; let matchCasts = 0; let matchApplications = 0;
    let matchActiveMoves = 0; let matchActiveTurns = 0; let matchActiveFires = 0;
    const moves = [{ frame: 0, position: players[seat].tank.position.slice() }];
    const fireFrames = [];
    for (let frame = 0; frame < records.length; frame += 1) {
      for (const event of records[frame]) {
        if (event.type === "skill" && event.skillType === "cloak" && event.by === seat) {
          if (event.action === "cast") {
            casts += 1; matchCasts += 1; if (frame === 1) frameOneCasts += 1;
          } else if (event.action === "applied") {
            applications += 1; matchApplications += 1; active = true;
            if (event.durationFrames !== 6) durationMismatch += 1;
          } else if (event.action === "expired") { expirations += 1; active = false; }
        }
        if (event.type === "tank" && event.objectId === subjectObjectId) {
          if (event.action === "go") {
            moves.push({ frame, position: event.position.slice() });
            if (active) { activeMoves += 1; matchActiveMoves += 1; }
          } else if (event.action === "turn" && active) {
            activeTurns += 1; matchActiveTurns += 1;
          }
        }
        if (event.type === "bullet" && event.action === "created" &&
          event.tank?.id === subjectObjectId) {
          fireFrames.push(frame); if (active) { activeFires += 1; matchActiveFires += 1; }
        }
      }
    }
    let matchGrassCamps = 0; let longestStationaryFrames = 0;
    for (let index = 0; index < moves.length; index += 1) {
      const start = moves[index]; const endFrame = index + 1 < moves.length ?
        moves[index + 1].frame : records.length;
      const stationaryFrames = Math.max(0, endFrame - start.frame - 1);
      if (stationaryFrames > longestStationaryFrames) longestStationaryFrames = stationaryFrames;
      if (stationaryFrames < 10) continue;
      const tile = terrain[start.position[0]]?.[start.position[1]];
      if (tile === "o") { longGrassCamps += 1; matchGrassCamps += 1; }
      else longNonGrassCamps += 1;
    }
    samples.push({ matchUrlId: item.urlId, codeHash: participant.codeHash,
      castCount: matchCasts, applicationCount: matchApplications, activeMoveCount: matchActiveMoves,
      activeTurnCount: matchActiveTurns, activeFireCount: matchActiveFires,
      longGrassCampCount: matchGrassCamps, longestStationaryFrames,
      totalMoveEvents: Math.max(0, moves.length - 1), totalFireEvents: fireFrames.length });
  }
  return { analyzerVersion: 1, skill: "cloak", subject: { tankId: tank.id,
    tankUrlId: tank.urlId, tankName: tank.name }, codeHashes: Array.from(codeHashes).sort(),
    coverage: { matches: matches.length, matchesWithCast: samples.filter(item => item.castCount > 0).length,
      casts, applications, expirations, frameOneCasts, activeMoves, activeTurns, activeFires,
      longGrassCamps, longNonGrassCamps },
    claims: {
      durationSixFrames: claim(applications > 0, durationMismatch > 0, applications,
        "raw cloak applied.durationFrames"),
      doesNotPreventNormalActions: claim(activeMoves + activeTurns + activeFires > 0, false,
        activeMoves + activeTurns + activeFires,
        "subject continued moving, turning, or firing while cloak was active"),
      hidesTankFromEnemyObservation: claim(false, false, 0,
        "omniscient public replay does not expose the opponent script's enemy.tank observation"),
      firingPreservesCloak: claim(activeFires > 0, false, activeFires,
        "requires a subject fire event before cloak expiry"),
      cooldownThirtyFiveFrames: claim(false, false, 0,
        "cast spacing is compatible but public replay does not expose readiness continuously")
    },
    implementationBehavior: {
      evidenceClass: "THIRD_PARTY_DOCTRINE_PLUS_PLATFORM_REPLAY",
      manualSource: "https://mifunetron.github.io/agentank-field-manual/zh.html#night",
      manualIsExactPublishedSource: false,
      manualCampPattern: claim(longGrassCamps > 0, false, longGrassCamps,
        "stationary segment of at least 10 frames on a grass tile"),
      note: "The manual says winning configurations are omitted; its act(state) listing is pseudocode, not Nightjar's published bytes."
    }, samples };
}

function directionStep(direction) {
  if (direction === "up") return [0, -1];
  if (direction === "right") return [1, 0];
  if (direction === "down") return [0, 1];
  if (direction === "left") return [-1, 0];
  return null;
}

function analyzeTeleport(tank, matches) {
  const samples = []; const codeHashes = new Set(); let casts = 0; let applications = 0;
  let failedCasts = 0; let illegalLandings = 0; let arbitraryLandings = 0;
  let directionContinuationEvidence = 0; let starAdjacentLandings = 0;
  let starExactLandings = 0; let nearEnemyLandings = 0; let pickupBeforeReleaseFrame = 0;
  let pickupAtReleaseFrame = 0; let fireBeforeReleaseFrame = 0; let fireAtReleaseFrame = 0;
  for (const item of matches) {
    const seat = subjectSeat(item.summary, tank.id);
    invariant(seat >= 0, "PUBLIC_MATCH_SUBJECT_MISSING", `${item.urlId} does not contain ${tank.name}`);
    const participant = seat === 0 ? item.summary.participants.challenger :
      item.summary.participants.defender;
    codeHashes.add(participant.codeHash);
    const records = item.raw?.replayData?.replay?.records;
    const players = item.raw?.replayData?.replay?.meta?.players;
    const terrainSource = item.raw?.replayData?.map?.map;
    invariant(Array.isArray(records) && Array.isArray(players) && Array.isArray(terrainSource),
      "PUBLIC_RAW_REPLAY_SHAPE_CHANGED", `${item.urlId} has no records, players, or map`);
    const terrain = terrainSource.map(column => column.slice());
    const subjectObjectId = players[seat]?.tank?.id; const enemyObjectId = players[1 - seat]?.tank?.id;
    let subjectPosition = players[seat].tank.position.slice();
    let enemyPosition = players[1 - seat].tank.position.slice();
    let subjectDirection = players[seat].tank.direction; let star = null;
    let matchCasts = 0; let matchApplications = 0; let matchArbitrary = 0;
    const pendingCasts = []; const landings = [];
    for (let frame = 0; frame < records.length; frame += 1) {
      for (let order = 0; order < records[frame].length; order += 1) {
        const event = records[frame][order];
        if (event.type === "star" && event.action === "created") star = event.position.slice();
        else if (event.type === "star" && event.action === "collected") star = null;
        else if (event.type === "map" && event.action === "destroyed" &&
          Array.isArray(event.position) && terrain[event.position[0]])
          terrain[event.position[0]][event.position[1]] = ".";
        if (event.type === "tank" && event.objectId === subjectObjectId) {
          if (event.action === "turn") subjectDirection = event.direction;
          else if (event.action === "go") subjectPosition = event.position.slice();
        } else if (event.type === "tank" && event.objectId === enemyObjectId &&
          event.action === "go") enemyPosition = event.position.slice();
        if (event.type === "skill" && event.skillType === "teleport" && event.by === seat) {
          if (event.action === "cast") {
            casts += 1; matchCasts += 1; pendingCasts.push({ frame, order, applied: false });
          } else if (event.action === "applied") {
            applications += 1; matchApplications += 1;
            const pending = pendingCasts.find(candidate => candidate.frame === frame && !candidate.applied);
            if (pending) pending.applied = true;
            const fromMatches = Array.isArray(event.from) && event.from[0] === subjectPosition[0] &&
              event.from[1] === subjectPosition[1];
            const to = event.to; const tile = Array.isArray(to) ? terrain[to[0]]?.[to[1]] : undefined;
            const legal = fromMatches && (tile === "." || tile === "o") &&
              !(enemyPosition && to[0] === enemyPosition[0] && to[1] === enemyPosition[1]);
            if (!legal) illegalLandings += 1;
            const starDistance = star && Array.isArray(to) ?
              Math.abs(to[0] - star[0]) + Math.abs(to[1] - star[1]) : null;
            if (starDistance === 0) starExactLandings += 1;
            if (starDistance === 1) starAdjacentLandings += 1;
            if (starDistance === null || starDistance > 1) { arbitraryLandings += 1; matchArbitrary += 1; }
            const enemyDistance = enemyPosition && Array.isArray(to) ?
              Math.abs(to[0] - enemyPosition[0]) + Math.abs(to[1] - enemyPosition[1]) : null;
            if (enemyDistance !== null && enemyDistance <= 4) nearEnemyLandings += 1;
            landings.push({ frame, order, from: event.from.slice(), to: to.slice(), tile,
              starDistance, enemyDistance, directionBefore: subjectDirection, directionProved: false,
              pickupBeforeRelease: false, pickupAtRelease: false,
              fireBeforeRelease: false, fireAtRelease: false });
            subjectPosition = to.slice();
          }
        }
      }
    }
    failedCasts += pendingCasts.filter(candidate => !candidate.applied).length;
    for (const landing of landings) {
      let stoppedByTurn = false;
      for (let frame = landing.frame; frame < records.length; frame += 1) {
        for (let order = 0; order < records[frame].length; order += 1) {
          if (frame === landing.frame && order <= landing.order) continue;
          const event = records[frame][order];
          if (event.type === "star" && event.action === "collected" && event.by === seat) {
            if (frame < landing.frame + 2) landing.pickupBeforeRelease = true;
            else if (frame === landing.frame + 2) landing.pickupAtRelease = true;
          }
          if (event.type === "bullet" && event.action === "created" &&
            event.tank?.id === subjectObjectId) {
            if (frame < landing.frame + 2) landing.fireBeforeRelease = true;
            else if (frame === landing.frame + 2) landing.fireAtRelease = true;
          }
          if (!stoppedByTurn && event.type === "tank" && event.objectId === subjectObjectId) {
            if (event.action === "turn") stoppedByTurn = true;
            else if (event.action === "go") {
              const step = directionStep(landing.directionBefore);
              if (step && event.position[0] - landing.to[0] === step[0] &&
                event.position[1] - landing.to[1] === step[1]) {
                landing.directionProved = true; directionContinuationEvidence += 1;
              }
              stoppedByTurn = true;
            }
          }
        }
        if (frame > landing.frame + 2 && stoppedByTurn) break;
      }
      if (landing.pickupBeforeRelease) pickupBeforeReleaseFrame += 1;
      if (landing.pickupAtRelease) pickupAtReleaseFrame += 1;
      if (landing.enemyDistance !== null && landing.enemyDistance <= 4) {
        if (landing.fireBeforeRelease) fireBeforeReleaseFrame += 1;
        if (landing.fireAtRelease) fireAtReleaseFrame += 1;
      }
    }
    samples.push({ matchUrlId: item.urlId, codeHash: participant.codeHash,
      castCount: matchCasts, applicationCount: matchApplications,
      arbitraryLandingCount: matchArbitrary,
      landings: landings.map(landing => ({ frame: landing.frame, from: landing.from, to: landing.to,
        tile: landing.tile, starDistance: landing.starDistance, enemyDistance: landing.enemyDistance,
        directionProved: landing.directionProved })) });
  }
  return { analyzerVersion: 1, skill: "teleport", subject: { tankId: tank.id,
    tankUrlId: tank.urlId, tankName: tank.name }, codeHashes: Array.from(codeHashes).sort(),
    coverage: { matches: matches.length, matchesWithCast: samples.filter(item => item.castCount > 0).length,
      casts, applications, failedCasts, arbitraryLandings, starAdjacentLandings,
      starExactLandings, nearEnemyLandings, directionContinuationEvidence,
      pickupBeforeReleaseFrame, pickupAtReleaseFrame,
      fireBeforeReleaseFrame, fireAtReleaseFrame },
    claims: {
      movesInstantlyToLegalTarget: claim(applications > 0, illegalLandings > 0, applications,
        "raw from/to matched tracked pose and landed on passable non-enemy cells"),
      supportsTargetsBeyondStarAdjacency: claim(arbitraryLandings > 0, false, arbitraryLandings,
        "successful landing had no star or was farther than one tile from the current star"),
      preservesDirection: claim(directionContinuationEvidence > 0, false,
        directionContinuationEvidence, "next movement before any turn followed the pre-teleport direction"),
      starRequestReroutesAdjacent: claim(false, false, starAdjacentLandings,
        "raw cast events omit requested coordinates; an adjacent landing cannot prove a star request"),
      invalidTargetConsumesCooldown: claim(false, false, failedCasts,
        "selected matches contain no identifiable failed subject cast and raw omits request coordinates"),
      pickupLockTwoFrames: claim(false, pickupBeforeReleaseFrame > 0, pickupAtReleaseFrame,
        "collection at castFrame+2 is compatible with release; no earlier collection or proved blocked attempt"),
      nearEnemyFireLockTwoFrames: claim(false, fireBeforeReleaseFrame > 0,
        nearEnemyLandings,
        "absence before castFrame+2 is compatible with a lock but does not prove a fire attempt"),
      revealsLandingToEnemy: claim(false, false, 0,
        "omniscient replay does not expose the opponent script's temporary observation")
    }, samples };
}

function analyzeSkill(skill, tank, matches) {
  if (skill === "boost") return analyzeBoost(tank, matches);
  if (skill === "shield") return analyzeShield(tank, matches);
  if (skill === "cloak") return analyzeCloak(tank, matches);
  if (skill === "teleport") return analyzeTeleport(tank, matches);
  return { analyzerVersion: 1, skill, subject: { tankId: tank.id, tankUrlId: tank.urlId,
    tankName: tank.name }, coverage: { matches: matches.length }, claims: {},
    status: "ANALYZER_NOT_IMPLEMENTED" };
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function reanalyzeStoredSkillEvidence(options = {}) {
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const skill = String(options.skill || "").toLowerCase();
  invariant(SUPPORTED_SKILLS.has(skill), "INVALID_SKILL_ID", "--skill is not a supported skill id");
  const tankUrlId = String(options.tankUrlId || ""); const runId = String(options.runId || "");
  invariant(/^tnk_[A-Za-z0-9]+$/.test(tankUrlId), "INVALID_PUBLIC_TANK_URL_ID",
    "--tank-url-id must be a public tnk_ id");
  invariant(/^[A-Za-z0-9_-]+$/.test(runId), "INVALID_DISCOVERY_RUN_ID",
    "--run-id is required and must be a safe id");
  const runDirectory = contained(root, "battle-records", "discovery", "skills", skill,
    tankUrlId, "runs", runId);
  const manifestFile = contained(runDirectory, "collection-manifest.json");
  invariant(fs.existsSync(manifestFile), "DISCOVERY_RUN_NOT_FOUND", `discovery run not found: ${runId}`);
  const manifest = readJson(manifestFile); const tank = manifest.tank;
  invariant(tank?.urlId === tankUrlId && manifest.skill === skill,
    "DISCOVERY_RUN_IDENTITY_MISMATCH", "stored discovery run identity does not match arguments");
  const matches = manifest.matchUrlIds.map(urlId => {
    const directory = contained(runDirectory, "matches", urlId);
    return { urlId, summary: readJson(contained(directory, "summary.json")),
      events: readJson(contained(directory, "events.json")),
      raw: readJson(contained(directory, "raw.json")) };
  });
  const previousFile = contained(runDirectory, "skill-evidence-report.json");
  const previous = fs.existsSync(previousFile) ? readJson(previousFile) : null;
  const analysis = analyzeSkill(skill, tank, matches);
  analysis.collection = previous?.collection || { lane: "DISCOVERY", runId,
    requestedLimit: matches.length, knownMatchIds: [],
    newlyDiscoveredMatchIds: manifest.matchUrlIds.slice().sort() };
  analysis.fingerprint = fingerprintObject(analysis); writeJsonAtomic(previousFile, analysis);
  const updatedManifest = { ...manifest, reportFingerprint: analysis.fingerprint,
    reanalyzedAt: new Date().toISOString() };
  delete updatedManifest.fingerprint; updatedManifest.fingerprint = fingerprintObject(updatedManifest);
  writeJsonAtomic(manifestFile, updatedManifest);
  return { runDirectory, manifest: updatedManifest, analysis };
}

function validateReplay(view, value, urlId) {
  invariant(value?.match?.urlId === urlId, "PUBLIC_MATCH_ID_MISMATCH",
    `${urlId} ${view} response has a different match id`);
  invariant(value.view === view, "PUBLIC_MATCH_VIEW_MISMATCH",
    `${urlId} expected ${view} response, received ${value.view || "UNKNOWN"}`);
}

async function mapLimit(values, limit, worker) {
  const output = new Array(values.length); let cursor = 0;
  async function run() {
    while (cursor < values.length) {
      const index = cursor; cursor += 1; output[index] = await worker(values[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => run()));
  return output;
}

async function collectPublicSkillEvidence(options = {}) {
  const skill = String(options.skill || "").toLowerCase();
  invariant(SUPPORTED_SKILLS.has(skill), "INVALID_SKILL_ID", "--skill is not a supported skill id");
  const tankName = String(options.tankName || "");
  invariant(tankName.length > 0, "MISSING_TANK_NAME", "--tank-name is required");
  const limit = Number(options.limit || 10);
  invariant(Number.isSafeInteger(limit) && limit > 0 && limit <= 50,
    "INVALID_PUBLIC_MATCH_LIMIT", "--limit must be 1..50");
  const root = path.resolve(options.workspaceRoot || defaultWorkspaceRoot());
  const requestOptions = { fetchImpl: options.fetchImpl, origin: options.origin,
    attempts: options.attempts, timeoutMs: options.timeoutMs };
  const resolved = await resolvePublicTank(tankName, skill, requestOptions); const tank = resolved.tank;
  const indexResponse = await requestPublicJson(
    `/api/tanks/${encodeURIComponent(tank.urlId)}/matches?limit=${limit}&offset=0`, requestOptions);
  invariant(Array.isArray(indexResponse.value?.matches), "PUBLIC_MATCH_INDEX_SHAPE_CHANGED",
    "public tank match index is missing matches");
  invariant(indexResponse.value.matches.length === limit, "PUBLIC_MATCH_INDEX_SHORT",
    `requested ${limit} matches but received ${indexResponse.value.matches.length}`);
  const indexMatches = indexResponse.value.matches;
  const known = new Set(options.knownMatchIds || []); const listed = new Set(indexMatches.map(item => item.urlId));
  for (const urlId of known) invariant(listed.has(urlId), "KNOWN_MATCH_NOT_IN_RECENT_SET",
    `known match ${urlId} is not in the most recent ${limit}`);
  const runId = options.runId || timestampId(options.now || new Date());
  invariant(/^[A-Za-z0-9_-]+$/.test(runId), "INVALID_DISCOVERY_RUN_ID",
    "run id must contain only letters, digits, underscore or hyphen");
  const runDirectory = contained(root, "battle-records", "discovery", "skills", skill,
    tank.urlId, "runs", runId);
  invariant(!fs.existsSync(runDirectory), "DISCOVERY_RUN_ALREADY_EXISTS",
    `discovery run already exists: ${runId}`);
  ensureDirectory(runDirectory);
  writeFileAtomic(contained(runDirectory, "tank-search.json"), resolved.response.bytes);
  writeFileAtomic(contained(runDirectory, "matches-index.json"), indexResponse.bytes);
  const collected = await mapLimit(indexMatches, options.concurrency || 3, async indexItem => {
    const urlId = indexItem.urlId;
    invariant(/^mat_[A-Za-z0-9]+$/.test(urlId || ""), "INVALID_PUBLIC_MATCH_ID",
      "match index contains an invalid public match id");
    const views = await Promise.all(["summary", "events", "raw"].map(async view => {
      const suffix = view === "summary" ? "" : `?view=${view}`;
      const response = await requestPublicJson(`/api/matches/${urlId}/agent.json${suffix}`,
        requestOptions);
      validateReplay(view, response.value, urlId); return { view, response };
    }));
    const directory = contained(runDirectory, "matches", urlId); ensureDirectory(directory);
    const metadata = {};
    for (const artifact of views) {
      writeFileAtomic(contained(directory, `${artifact.view}.json`), artifact.response.bytes);
      metadata[artifact.view] = artifact.response.metadata;
    }
    const summary = views[0].response.value; const seat = subjectSeat(summary, tank.id);
    invariant(seat >= 0, "PUBLIC_MATCH_SUBJECT_MISSING", `${urlId} does not contain ${tankName}`);
    const indexHash = seat === 0 ? indexItem.challengerCodeHash : indexItem.defenderCodeHash;
    const summaryHash = seat === 0 ? summary.participants.challenger.codeHash :
      summary.participants.defender.codeHash;
    invariant(indexHash === summaryHash, "PUBLIC_MATCH_CODE_HASH_MISMATCH",
      `${urlId} index and summary code hashes differ`);
    const artifactManifest = { schemaVersion: 1, matchUrlId: urlId, subjectSeat: seat,
      subjectCodeHash: summaryHash, knownInput: known.has(urlId), artifacts: metadata };
    artifactManifest.fingerprint = fingerprintObject(artifactManifest);
    writeJsonAtomic(contained(directory, "artifact-manifest.json"), artifactManifest);
    return { urlId, indexItem, summary, events: views[1].response.value,
      raw: views[2].response.value, artifactManifest };
  });
  const analysis = analyzeSkill(skill, tank, collected);
  analysis.collection = { lane: "DISCOVERY", runId, requestedLimit: limit,
    knownMatchIds: Array.from(known).sort(), newlyDiscoveredMatchIds: collected
      .map(item => item.urlId).filter(urlId => !known.has(urlId)).sort() };
  analysis.fingerprint = fingerprintObject(analysis);
  writeJsonAtomic(contained(runDirectory, "skill-evidence-report.json"), analysis);
  const manifest = { schemaVersion: 1, lane: "DISCOVERY", runId, skill,
    tank: { id: tank.id, urlId: tank.urlId, name: tank.name, skillType: tank.skillType },
    matchCount: collected.length, matchUrlIds: collected.map(item => item.urlId),
    index: indexResponse.metadata, tankSearch: resolved.response.metadata,
    reportFingerprint: analysis.fingerprint, createdAt: new Date().toISOString() };
  manifest.fingerprint = fingerprintObject(manifest);
  writeJsonAtomic(contained(runDirectory, "collection-manifest.json"), manifest);
  return { runDirectory, manifest, analysis };
}

module.exports = { PUBLIC_ORIGIN, requestPublicJson, resolvePublicTank, analyzeBoost, analyzeShield,
  analyzeCloak, analyzeTeleport, analyzeSkill, collectPublicSkillEvidence, reanalyzeStoredSkillEvidence,
  timestampId };
