#!/usr/bin/env node
"use strict";

// BP144 replaces scalar-derived attack candidates with roots obtained from
// real simulator events.  It deliberately keeps three different facts apart:
// (1) a historical V1 FIRE and the exact projectile outcome, (2) a current
// physical root where the deterministic V1 oracle would FIRE but V2 did not,
// and (3) the first same-root V1/V2 action divergence in each source match.
// None of these labels is, by itself, a robust action certificate.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { defaultWorkspaceRoot } = require("../core/paths");
const { fingerprintObject, sha256Bytes, sha256Text } = require("../core/hash");
const { loadSimulator } = require("../simulation/paired-arena");
const { ProductionDiagnosticBot } = require(
  "../simulation/production-diagnostic-bot");
const { V3DiagnosticBot } = require("../../../engine-v3/src");
const { instrumentV1DeterministicPolicyOracle } = require(
  "./v1-policy-value-instrumentation");
const { field, loadCohort } = require("./v2-native-initiative-arena");
const { scenarioIndex } = require("./semantic-attack-certificate-root-corpus");
const { observedAction } = require("./root-counterfactual-labels");
const { ACTION, NONE_CELL } = require(
  "../../../engine-v2/src/abi/fast-codes");
const { ARRAY, SCALAR } = require(
  "../../../engine-v2/src/state/fast-state");

const FROZEN_V1_FILE = path.resolve(__dirname, "../../../tiny-tank-minimax.js");
const MATCHED_CONTROL_SALT = "agentank-bp144-matched-control-v1";

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function readSource(directory) {
  const resolved = path.resolve(directory);
  const file = path.join(resolved, "matches.ndjson.gz");
  const bytes = fs.readFileSync(file);
  const text = zlib.gunzipSync(bytes).toString("utf8").trim();
  return { directory: resolved, file, bytes,
    matches: text ? text.split("\n").map(JSON.parse) : [] };
}

function fireDecisionIndices(stream) {
  const bytes = Buffer.from(stream || "", "base64");
  const output = [];
  for (let index = 0; index < bytes.length; index += 1)
    if (bytes[index] === ACTION.FIRE) output.push(index);
  return output;
}

function shotLabel(shot) {
  if ((shot?.tankKills || 0) > 0)
    return shot.ownerCrashWithin4 ? "KILL_COUNTER_CRASH" : "KILL_SAFE";
  if ((shot?.shieldBreaks || 0) > 0) return "SHIELD_BREAK";
  if ((shot?.terrainHits || 0) > 0) return "TERRAIN_HIT";
  if ((shot?.survivedAtTerminal || 0) > 0) return "TERMINAL_SURVIVOR";
  if ((shot?.projectiles || 0) < 1) return "NO_PROJECTILE";
  return "NO_TANK_IMPACT";
}

function distanceBucket(distance) {
  return distance < 0 ? "UNKNOWN" : distance <= 2 ? "D0_2" :
    distance <= 4 ? "D3_4" : distance <= 7 ? "D5_7" : "D8_PLUS";
}

function shotStratum(shot) {
  return [shot.geometry, distanceBucket(shot.distance), shot.counterLine ? 1 : 0]
    .join(":");
}

function compactShot(shot) {
  const fields = ["frame", "geometry", "distance", "rayLength",
    "ownMobility", "enemyMobility", "counterLine", "ownPose", "enemyPose",
    "ownStars", "enemyStars", "projectiles", "tankKills", "terrainHits",
    "shieldBreaks", "noTankImpact", "survivedAtTerminal", "lifetimeFrames",
    "ownerCrashWithin4", "ownerProjectileKilledWithin4", "emissionFrame",
    "emissionDelay", "continuation"];
  const output = {};
  for (const field of fields) output[field] = shot[field] ?? null;
  return output;
}

function historicalRootKey(match, attackSeat, shot, decisionIndex) {
  return ["V1_FIRE", match.scenarioFingerprint, attackSeat,
    ...(match.seatSkills || []), shot.frame, decisionIndex].join(":");
}

function extractHistoricalFireRoots(matches) {
  const roots = []; const seen = new Set();
  let actionCountMismatch = 0; let duplicateCount = 0;
  for (let sourceMatchIndex = 0; sourceMatchIndex < matches.length;
      sourceMatchIndex += 1) {
    const match = matches[sourceMatchIndex];
    const shots = match.shotQualityRecords?.control || [];
    const decisions = fireDecisionIndices(match.control?.compactActionStream);
    if (shots.length !== decisions.length) {
      actionCountMismatch += 1; continue;
    }
    const attackSeat = match.candidateSeat ^ 1;
    for (let index = 0; index < shots.length; index += 1) {
      const shot = compactShot(shots[index]); const decisionIndex = decisions[index];
      const key = historicalRootKey(match, attackSeat, shot, decisionIndex);
      if (seen.has(key)) { duplicateCount += 1; continue; }
      seen.add(key);
      roots.push({ schemaVersion: 1,
        objectKind: "SEMANTIC_ATTACK_REAL_OPPORTUNITY_ROOT_V1",
        sourceFamily: "V1_HISTORICAL_FIRE", key, sourceMatchIndex,
        matchUrlId: match.matchUrlId,
        scenarioFingerprint: match.scenarioFingerprint,
        sourceImplementation: match.implementation,
        attackSeat, opponentSeat: match.candidateSeat,
        seatSkills: match.seatSkills, frame: shot.frame, decisionIndex,
        action: ACTION.FIRE, historicalLabel: shotLabel(shot),
        positiveKill: shot.tankKills > 0, stratum: shotStratum(shot), shot,
        sourceOutcome: match.analysisOutcome,
        sourceTerminalCategory: match.terminalCategory,
        proofSelectionRole: "NONE" });
    }
  }
  return { roots, actionCountMismatch, duplicateCount };
}

function deterministicOrder(left, right, salt = "") {
  const a = sha256Text(salt + "\0" + left.key);
  const b = sha256Text(salt + "\0" + right.key);
  return a.localeCompare(b) || left.key.localeCompare(right.key);
}

function matchedControlLevel(positive, candidate) {
  if (candidate.stratum === positive.stratum) return 0;
  const left = positive.stratum.split(":"); const right = candidate.stratum.split(":");
  if (left[0] === right[0] && left[1] === right[1]) return 1;
  if (left[0] === right[0]) return 2;
  return 3;
}

function selectHistoricalProofCohort(roots) {
  const positives = roots.filter(root => root.positiveKill)
    .sort((a, b) => deterministicOrder(a, b, MATCHED_CONTROL_SALT + ":P"));
  const controls = roots.filter(root => !root.positiveKill &&
      root.shot.projectiles > 0 && !root.shot.ownerCrashWithin4)
    .sort((a, b) => deterministicOrder(a, b, MATCHED_CONTROL_SALT + ":N"));
  const used = new Set(); const selected = [];
  for (const positive of positives) {
    positive.proofSelectionRole = "POSITIVE_KILL"; selected.push(positive);
    let best = null; let bestLevel = 99; let bestHash = "";
    for (const candidate of controls) {
      if (used.has(candidate.key)) continue;
      const level = matchedControlLevel(positive, candidate);
      const hash = sha256Text(MATCHED_CONTROL_SALT + "\0" + positive.key +
        "\0" + candidate.key);
      if (level < bestLevel || level === bestLevel && hash < bestHash) {
        best = candidate; bestLevel = level; bestHash = hash;
      }
    }
    if (!best) throw new Error("BP144_MATCHED_CONTROL_EXHAUSTED");
    used.add(best.key); best.proofSelectionRole = "MATCHED_NO_KILL";
    best.matchedPositiveKey = positive.key; best.matchLevel = bestLevel;
    selected.push(best);
  }
  return selected;
}

function actionObject(code, arguments_, decisionIndex) {
  if (code === ACTION.GO) return { type: "go" };
  if (code === ACTION.TURN_LEFT) return { type: "turn", side: "left" };
  if (code === ACTION.TURN_RIGHT) return { type: "turn", side: "right" };
  if (code === ACTION.FIRE) return { type: "fire" };
  if (code === ACTION.THROW_BOMB) return { type: "throwBomb" };
  const skill = { [ACTION.CAST_SHIELD]: "shield",
    [ACTION.CAST_FREEZE]: "freeze", [ACTION.CAST_STUN]: "stun",
    [ACTION.CAST_OVERLOAD]: "overload", [ACTION.CAST_CLOAK]: "cloak",
    [ACTION.CAST_POISON]: "poison", [ACTION.CAST_TELEPORT]: "teleport",
    [ACTION.CAST_BOOST]: "boost" }[code];
  if (!skill) return null;
  if (code !== ACTION.CAST_TELEPORT) return { type: skill };
  for (const entry of arguments_ || [])
    if (entry[0] === decisionIndex)
      return { type: skill, x: entry[1], y: entry[2] };
  return null;
}

function actionArgument(engine, code, arguments_, decisionIndex) {
  if (code !== ACTION.CAST_TELEPORT) return NONE_CELL;
  for (const entry of arguments_ || []) if (entry[0] === decisionIndex)
    return engine.adapter.state.cell(entry[1], entry[2]);
  return NONE_CELL;
}

class RecordedActionBot {
  constructor(stream, arguments_) {
    this.actions = Buffer.from(stream || "", "base64");
    this.arguments = arguments_ || []; this.index = 0;
  }
  decide() {
    const index = this.index++; const action = actionObject(
      this.actions[index] ?? ACTION.NONE, this.arguments, index);
    return { action, logs: [], runtimeMs: 0 };
  }
}

// A replay has two independent authorities: recorded commands own simulator
// physics, while ProductionRoot is only a shadow observer/candidate evaluator.
// Returning the shadow bot's proxy emission would let a diagnostic emitter
// limitation alter the supposedly immutable source match.  Always return the
// recorded command and audit whether the shadow emitted the same primitive.
class RecordedProductionShadowBot {
  constructor(shadow, stream, arguments_) {
    this.shadow = shadow; this.actions = Buffer.from(stream || "", "base64");
    this.arguments = arguments_ || []; this.index = 0;
    this.shadowOutputMismatchCount = 0;
  }
  decide(context) {
    const index = this.index++; const code = this.actions[index] ?? ACTION.NONE;
    const decision = this.shadow.decide(context) || {};
    if (observedAction(decision.action) !== code)
      this.shadowOutputMismatchCount += 1;
    return { ...decision,
      action: actionObject(code, this.arguments, index) };
  }
}

const RECORDED_SKILL_METHOD = Object.freeze({
  [ACTION.CAST_SHIELD]: "shield", [ACTION.CAST_FREEZE]: "freeze",
  [ACTION.CAST_STUN]: "stun", [ACTION.CAST_OVERLOAD]: "overload",
  [ACTION.CAST_CLOAK]: "cloak", [ACTION.CAST_POISON]: "poison",
  [ACTION.CAST_TELEPORT]: "teleport", [ACTION.CAST_BOOST]: "boost"
});

function installRecordedSkillEmitter(engine) {
  engine.diagnosticReplacementEmitter = function emitRecordedSkill(
      me, action, argument, fallback) {
    const method = RECORDED_SKILL_METHOD[action];
    if (!method || !me || typeof me[method] !== "function")
      return fallback(me, action, argument);
    if (action === ACTION.CAST_TELEPORT) {
      const state = this.adapter?.state;
      me[method](state ? state.x(argument) : 0, state ? state.y(argument) : 0);
    } else me[method]();
    this.adapter.recordEmission(action, argument); return action;
  };
}

function rootSnapshot(engine) {
  const state = engine.adapter.state; const a = state.arrays;
  const own = a[ARRAY.TANK_CELL][0]; const enemy = a[ARRAY.TANK_CELL][1];
  let fireRow = -1;
  for (let row = 0; row < engine.ourCount; row += 1)
    if (engine.ourActions[row] === ACTION.FIRE) { fireRow = row; break; }
  return { frame: a[ARRAY.SCALAR][SCALAR.FRAME],
    hashLo: state.hashLo, hashHi: state.hashHi,
    ownPose: [state.x(own), state.y(own), a[ARRAY.TANK_DIR][0]],
    enemyPose: [state.x(enemy), state.y(enemy), a[ARRAY.TANK_DIR][1]],
    ownStars: a[ARRAY.TANK_STARS][0], enemyStars: a[ARRAY.TANK_STARS][1],
    enemyVisible: Boolean(engine.adapter.enemyVisible),
    ownCanFire: Boolean(engine.adapter.ownCanFire),
    informationComplete: Boolean(engine.adapter.informationComplete),
    activeProjectileCount: state.activeProjectileCount(),
    activeBombCount: state.activeBombCount(),
    possibleProjectileCount: engine.possibleProjectiles.count(),
    ourActionCount: engine.ourCount, enemyActionCount: engine.enemyCount,
    fireGenerated: fireRow >= 0, fireHardStatus: fireRow >= 0 ?
      engine.hardStatus[fireRow] : null };
}

function snapshotMatchesShot(snapshot, shot) {
  return snapshot.frame === shot.frame &&
    JSON.stringify(snapshot.ownPose) === JSON.stringify(shot.ownPose) &&
    JSON.stringify(snapshot.enemyPose) === JSON.stringify(shot.enemyPose) &&
    snapshot.ownStars === shot.ownStars && snapshot.enemyStars === shot.enemyStars;
}

function replayPrefix(match, candidateIsHistoricalControl) {
  const candidate = candidateIsHistoricalControl ? match.control : match.candidate;
  const control = candidateIsHistoricalControl ? match.candidate : match.control;
  return { seatSkills: match.seatSkills,
    candidateActionStream: candidate?.compactActionStream || "",
    candidateArguments: candidate?.compactArguments || [],
    controlActionStream: control?.compactActionStream || "",
    controlArguments: control?.compactArguments || [] };
}

function terminalReproduced(replay, simulator, match) {
  if (replay.replayData.replay.records.length !== match.frames) return false;
  for (let seat = 0; seat < 2; seat += 1) {
    if (simulator.players[seat].stars !== match.counts.stars[seat]) return false;
    if (Number(Boolean(simulator.players[seat].crashed)) !==
        Number(Boolean(match.counts.crashes[seat]))) return false;
  }
  return (simulator.result?.reason || "UNKNOWN") ===
    (match.result?.reason || "UNKNOWN");
}

function captureHistoricalFireMatch(module, scenario, match, targets) {
  const attackSeat = match.candidateSeat ^ 1;
  const prefix = replayPrefix(match, true);
  const actions = Buffer.from(prefix.candidateActionStream, "base64");
  const targetByIndex = new Map(targets.map(root => [root.decisionIndex, root]));
  let decisionIndex = 0; let captured = 0;
  const bot = new ProductionDiagnosticBot({ captureExceptionalFrames: false,
    diagnosticFinalActionOverride(engine) {
      const index = decisionIndex++; const code = actions[index] ?? ACTION.NONE;
      const root = targetByIndex.get(index);
      if (root) {
        root.root = rootSnapshot(engine);
        root.exact = snapshotMatchesShot(root.root, root.shot) &&
          code === ACTION.FIRE;
        root.replayPrefix = prefix; captured += 1;
      }
      return { action: code,
        argument: actionArgument(engine, code, prefix.candidateArguments, index) };
    } });
  // The frozen V1 seat may own a different skill than production V2.  Install
  // only the final replacement emitter: wrapping generateActions/engine.emit
  // would let an internally selected skill bypass the override and desynchronise
  // its callback index from the immutable recorded stream.
  installRecordedSkillEmitter(bot.engine);
  const candidate = new RecordedProductionShadowBot(bot,
    prefix.candidateActionStream, prefix.candidateArguments);
  const opponent = new RecordedActionBot(prefix.controlActionStream,
    prefix.controlArguments);
  const built = field(module, scenario, attackSeat, match.seatSkills);
  const bots = attackSeat === 0 ? [candidate, opponent] : [opponent, candidate];
  const replay = built.simulator.run(bots[0], bots[1]);
  return { captured,
    exactTerminal: terminalReproduced(replay, built.simulator, match),
    candidateActionsConsumed: candidate.index,
    candidateActionCount: candidate.actions.length,
    shadowActionsConsumed: decisionIndex,
    shadowOutputMismatchCount: candidate.shadowOutputMismatchCount,
    controlActionsConsumed: opponent.index,
    controlActionCount: opponent.actions.length };
}

function pairedRoot(match, family, decisionIndex, frame, v2Action,
    oracleAction, oracleStage, engine) {
  const root = rootSnapshot(engine);
  return { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_REAL_OPPORTUNITY_ROOT_V1",
    sourceFamily: family,
    key: [family, match.scenarioFingerprint, match.candidateSeat,
      ...(match.seatSkills || []), frame, decisionIndex, v2Action,
      oracleAction].join(":"),
    matchUrlId: match.matchUrlId,
    scenarioFingerprint: match.scenarioFingerprint,
    sourceImplementation: match.implementation,
    attackSeat: match.candidateSeat, opponentSeat: match.candidateSeat ^ 1,
    seatSkills: match.seatSkills, frame, decisionIndex,
    v2Action, oracleAction, oracleOwnershipStage: oracleStage,
    sourceOutcome: match.analysisOutcome,
    sourceTerminalCategory: match.terminalCategory,
    root, exact: root.frame === frame,
    proofSelectionRole: family === "V2_MISSED_V1_FIRE" ?
      "MISSED_FIRE" : "PAIRED_CONTEXT" };
}

function replayV2OracleMatch(module, scenario, match, deterministicV1Source,
    maximumMissedPerMatch = 4) {
  const prefix = replayPrefix(match, false);
  const actions = Buffer.from(prefix.candidateActionStream, "base64");
  const oracle = new V3DiagnosticBot({ enableOwnershipTrace: true,
    source: deterministicV1Source, sourceFile: FROZEN_V1_FILE,
    sourceSha256: sha256Text(fs.readFileSync(FROZEN_V1_FILE, "utf8")) });
  let decisionIndex = 0; let first = null; const missed = [];
  const bot = new ProductionDiagnosticBot({ captureExceptionalFrames: false,
    diagnosticFinalActionOverride(engine, _action, _argument, context) {
      const index = decisionIndex++; const code = actions[index] ?? ACTION.NONE;
      const oracleDecision = oracle.decide(context);
      const oracleAction = observedAction(oracleDecision?.action);
      const trace = oracle.controller.ownershipTrace;
      const frame = Number.isSafeInteger(context?.game?.frames) ?
        context.game.frames : engine.adapter.state.arrays[ARRAY.SCALAR][SCALAR.FRAME];
      if (!first && oracleAction !== ACTION.NONE && oracleAction !== code)
        first = pairedRoot(match, "PAIRED_FIRST_DIVERGENCE", index, frame,
          code, oracleAction, trace.selectedStage, engine);
      const snapshot = engine.adapter.state;
      const a = snapshot?.arrays; const own = a?.[ARRAY.TANK_CELL]?.[0];
      const enemy = a?.[ARRAY.TANK_CELL]?.[1];
      const distance = snapshot && own !== undefined && enemy !== undefined ?
        Math.abs(snapshot.x(own) - snapshot.x(enemy)) +
          Math.abs(snapshot.y(own) - snapshot.y(enemy)) : 255;
      const contact = Boolean(engine.adapter.enemyVisible) &&
        (distance <= 9 || engine.clearLine(own, enemy));
      if (missed.length < maximumMissedPerMatch && contact &&
          oracleAction === ACTION.FIRE && code !== ACTION.FIRE)
        missed.push(pairedRoot(match, "V2_MISSED_V1_FIRE", index, frame,
          code, oracleAction, trace.selectedStage, engine));
      return { action: code,
        argument: actionArgument(engine, code, prefix.candidateArguments, index) };
    } });
  const candidate = new RecordedProductionShadowBot(bot,
    prefix.candidateActionStream, prefix.candidateArguments);
  const opponent = new RecordedActionBot(prefix.controlActionStream,
    prefix.controlArguments);
  const built = field(module, scenario, match.candidateSeat, match.seatSkills);
  const bots = match.candidateSeat === 0 ? [candidate, opponent] :
    [opponent, candidate];
  const replay = built.simulator.run(bots[0], bots[1]);
  for (const root of [first, ...missed]) if (root) root.replayPrefix = prefix;
  return { first, missed,
    exactTerminal: terminalReproduced(replay, built.simulator, match),
    candidateActionsConsumed: candidate.index,
    candidateActionCount: candidate.actions.length,
    shadowActionsConsumed: decisionIndex,
    shadowOutputMismatchCount: candidate.shadowOutputMismatchCount,
    controlActionsConsumed: opponent.index,
    controlActionCount: opponent.actions.length };
}

function increment(target, key) { target[key] = (target[key] || 0) + 1; }

function summarize(roots, selectedHistorical, paired, missed, replay) {
  const labels = {}; const strata = {}; const selectionRoles = {};
  for (const root of roots) {
    increment(labels, root.historicalLabel);
    increment(strata, root.stratum); increment(selectionRoles, root.proofSelectionRole);
  }
  const matchLevels = {};
  for (const root of selectedHistorical)
    if (root.proofSelectionRole === "MATCHED_NO_KILL")
      increment(matchLevels, String(root.matchLevel));
  return { historicalFireRootCount: roots.length,
    historicalLabels: labels, historicalStrata: strata,
    historicalSelectionRoles: selectionRoles,
    historicalProofRootCount: selectedHistorical.length,
    historicalExactRootCount: selectedHistorical.filter(root => root.exact).length,
    matchedControlLevels: matchLevels,
    pairedFirstDivergenceCount: paired.length,
    pairedExactRootCount: paired.filter(root => root.exact).length,
    missedFireCount: missed.length,
    missedFireExactRootCount: missed.filter(root => root.exact).length,
    replayedHistoricalMatchCount: replay.historicalMatches,
    replayedOracleMatchCount: replay.oracleMatches,
    sourceTerminalReproductionCount: replay.terminalReproduced,
    actionStreamMismatchCount: replay.actionStreamMismatches };
}

async function build(root = defaultWorkspaceRoot()) {
  const sourceDirectory = path.resolve(option("--source", path.join(root,
    "artifacts", "v2-native-initiative",
    "shot-quality-counterexposure-blind96-v2")));
  const cohortFile = path.resolve(option("--cohort", path.join(root,
    "config", "engine-v2", "strategic-attack-cohort.json")));
  const role = option("--role", "DISCOVERY").toUpperCase();
  const outputDirectory = path.resolve(option("--output", path.join(root,
    "artifacts", "v2-native-initiative",
    "bp144-semantic-attack-real-opportunity-corpus")));
  const expectedHistorical = Number(option("--expected-historical", 932));
  const expectedKills = Number(option("--expected-kills", 65));
  const maximumMissed = Number(option("--maximum-missed-per-match", 4));
  const source = readSource(sourceDirectory);
  const extracted = extractHistoricalFireRoots(source.matches);
  if (extracted.actionCountMismatch)
    throw new Error("BP144_FIRE_ACTION_DENOMINATOR:" +
      extracted.actionCountMismatch);
  if (extracted.duplicateCount)
    throw new Error("BP144_DUPLICATE_HISTORICAL_ROOT:" + extracted.duplicateCount);
  if (expectedHistorical > 0 && extracted.roots.length !== expectedHistorical)
    throw new Error("BP144_HISTORICAL_DENOMINATOR:" + extracted.roots.length +
      "/" + expectedHistorical);
  const killCount = extracted.roots.filter(root_ => root_.positiveKill).length;
  if (expectedKills > 0 && killCount !== expectedKills)
    throw new Error("BP144_KILL_DENOMINATOR:" + killCount + "/" + expectedKills);
  const selectedHistorical = selectHistoricalProofCohort(extracted.roots);
  const loaded = loadCohort(root, cohortFile, role);
  const scenarios = scenarioIndex(loaded.scenarios);
  const simulator = await loadSimulator(root);
  const selectedByMatch = new Map();
  for (const record of selectedHistorical) {
    const bucket = selectedByMatch.get(record.sourceMatchIndex) || [];
    bucket.push(record); selectedByMatch.set(record.sourceMatchIndex, bucket);
  }
  const replay = { historicalMatches: 0, oracleMatches: 0,
    terminalReproduced: 0, actionStreamMismatches: 0 };
  for (const [sourceMatchIndex, targets] of selectedByMatch) {
    const match = source.matches[sourceMatchIndex];
    const scenario = scenarios.get(match.scenarioFingerprint) ||
      scenarios.get(match.matchUrlId);
    if (!scenario) throw new Error("BP144_SCENARIO_MISSING:" + match.matchUrlId);
    const result = captureHistoricalFireMatch(simulator.module, scenario, match,
      targets);
    replay.historicalMatches += 1;
    replay.terminalReproduced += result.exactTerminal ? 1 : 0;
    if (result.captured !== targets.length ||
        result.candidateActionsConsumed !== result.candidateActionCount ||
        result.shadowActionsConsumed !== result.candidateActionCount ||
        result.shadowOutputMismatchCount !== 0 ||
        result.controlActionsConsumed !== result.controlActionCount)
      replay.actionStreamMismatches += 1;
  }
  const deterministicV1Source = instrumentV1DeterministicPolicyOracle(
    fs.readFileSync(FROZEN_V1_FILE, "utf8"));
  const paired = []; const missed = [];
  for (let index = 0; index < source.matches.length; index += 1) {
    const match = source.matches[index];
    const scenario = scenarios.get(match.scenarioFingerprint) ||
      scenarios.get(match.matchUrlId);
    if (!scenario) throw new Error("BP144_SCENARIO_MISSING:" + match.matchUrlId);
    const result = replayV2OracleMatch(simulator.module, scenario, match,
      deterministicV1Source, maximumMissed);
    replay.oracleMatches += 1;
    replay.terminalReproduced += result.exactTerminal ? 1 : 0;
    if (result.candidateActionsConsumed !== result.candidateActionCount ||
        result.shadowActionsConsumed !== result.candidateActionCount ||
        result.shadowOutputMismatchCount !== 0 ||
        result.controlActionsConsumed !== result.controlActionCount)
      replay.actionStreamMismatches += 1;
    if (result.first) paired.push(result.first);
    missed.push(...result.missed);
    if ((index + 1) % 16 === 0 || index + 1 === source.matches.length)
      process.stderr.write("[bp144-real-opportunity] " + (index + 1) + "/" +
        source.matches.length + "\n");
  }
  const summary = summarize(extracted.roots, selectedHistorical, paired, missed,
    replay);
  const totalReplays = replay.historicalMatches + replay.oracleMatches;
  const accepted = summary.historicalProofRootCount === expectedKills * 2 &&
    summary.historicalExactRootCount === summary.historicalProofRootCount &&
    summary.pairedExactRootCount === summary.pairedFirstDivergenceCount &&
    summary.missedFireExactRootCount === summary.missedFireCount &&
    replay.terminalReproduced === totalReplays &&
    replay.actionStreamMismatches === 0;
  const overview = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_REAL_OPPORTUNITY_OVERVIEW_V1",
    status: accepted ? "ACCEPT_REAL_ATTACK_ROOTS" : "REJECTED",
    role, cohortFingerprint: loaded.manifest.fingerprint,
    sourceMatchCount: source.matches.length, ...summary,
    decisionBoundary:
      "Historical projectile outcomes and same-root V1/V2 disagreements are candidate-source labels only. They do not prove robust action ownership." };
  const records = extracted.roots.concat(paired, missed);
  const lines = records.map(record => JSON.stringify(record)).join("\n");
  const bytes = zlib.gzipSync(Buffer.from(lines ? lines + "\n" : ""),
    { level: 9 });
  const productionFile = path.join(root, "engine-v2", "src", "runtime",
    "production-root.js");
  const manifest = { schemaVersion: 1,
    objectKind: "SEMANTIC_ATTACK_REAL_OPPORTUNITY_MANIFEST_V1",
    status: overview.status, sourceDirectory, sourceMatchesSha256:
      sha256Bytes(source.bytes), cohortFile,
    cohortSha256: sha256Bytes(fs.readFileSync(cohortFile)),
    frozenV1Sha256: sha256Bytes(fs.readFileSync(FROZEN_V1_FILE)),
    productionRootSha256: sha256Bytes(fs.readFileSync(productionFile)),
    rootsSha256: sha256Bytes(bytes), rootCount: records.length,
    proofRootCount: selectedHistorical.length + missed.length,
    arguments: process.argv.slice(2), fingerprint: "" };
  manifest.fingerprint = fingerprintObject({ ...manifest, overview });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "overview.json"),
    JSON.stringify(overview, null, 2) + "\n");
  fs.writeFileSync(path.join(outputDirectory, "roots.ndjson.gz"), bytes);
  process.stdout.write(JSON.stringify({ output: outputDirectory, overview,
    fingerprint: manifest.fingerprint }, null, 2) + "\n");
  if (!accepted) throw new Error("BP144_REAL_OPPORTUNITY_REJECTED");
  return { output: outputDirectory, manifest, overview, records };
}

if (require.main === module) build().catch(error => {
  process.stderr.write((error.stack || error.message) + "\n");
  process.exitCode = 1;
});

module.exports = { readSource, fireDecisionIndices, shotLabel, distanceBucket,
  shotStratum, compactShot, extractHistoricalFireRoots,
  matchedControlLevel, selectHistoricalProofCohort, actionObject,
  RecordedActionBot, RecordedProductionShadowBot, installRecordedSkillEmitter,
  actionArgument, rootSnapshot, snapshotMatchesShot, replayPrefix,
  terminalReproduced,
  captureHistoricalFireMatch, replayV2OracleMatch, summarize, build };
