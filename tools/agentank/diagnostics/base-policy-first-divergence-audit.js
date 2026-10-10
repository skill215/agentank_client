"use strict";

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const IMPLEMENTATION = "V2_NATIVE_BOUNDED_POLICY_DIFFERENTIAL_ORACLE_ACTIVE";
const ACTION_NAME = Object.freeze([
  "NONE", "GO", "TURN_LEFT", "TURN_RIGHT", "FIRE", "THROW_BOMB",
  "CAST_SHIELD", "CAST_FREEZE", "CAST_STUN", "CAST_OVERLOAD",
  "CAST_CLOAK", "CAST_POISON", "CAST_TELEPORT", "CAST_BOOST",
  "BOOST_LEFT_GO", "BOOST_LEFT_TURN_LEFT", "BOOST_LEFT_TURN_RIGHT",
  "BOOST_LEFT_FIRE", "BOOST_LEFT_BOMB", "BOOST_RIGHT_GO",
  "BOOST_RIGHT_TURN_LEFT", "BOOST_RIGHT_TURN_RIGHT", "BOOST_RIGHT_FIRE",
  "BOOST_RIGHT_BOMB"
]);

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function readMatches(directory) {
  const file = path.join(directory, "matches.ndjson.gz");
  const text = zlib.gunzipSync(fs.readFileSync(file)).toString("utf8").trim();
  const rows = text ? text.split("\n").map(line => JSON.parse(line)) : [];
  return { file, sha256: sha256(fs.readFileSync(file)), rows: rows.filter(row =>
    row.implementation === IMPLEMENTATION) };
}

function matchKey(row) {
  return `${row.scenarioFingerprint}:${row.candidateSeat}`;
}

function firstDifference(left, right) {
  const count = Math.min(left.length, right.length);
  for (let index = 0; index < count; index += 1)
    if (left[index] !== right[index]) return index;
  return left.length === right.length ? -1 : count;
}

function bestRow(root, action) {
  let best = null;
  for (const row of root?.rows || [])
    if (row.action === action && row.allowed && row.sourceSupported &&
        (!best || row.backedValue > best.backedValue ||
          row.backedValue === best.backedValue && row.row < best.row)) best = row;
  return best;
}

function bestAlternative(root, action) {
  let best = null;
  for (const row of root?.rows || [])
    if (row.action !== action && row.allowed && row.sourceSupported &&
        (!best || row.backedValue > best.backedValue ||
          row.backedValue === best.backedValue && row.row < best.row)) best = row;
  return best;
}

function actionDeltas(offRoot, onRoot) {
  const actions = new Set();
  for (const row of offRoot?.rows || []) actions.add(row.action);
  for (const row of onRoot?.rows || []) actions.add(row.action);
  const deltas = [];
  for (const action of [...actions].sort((left, right) => left - right)) {
    const off = bestRow(offRoot, action); const on = bestRow(onRoot, action);
    if (!off && !on) continue;
    deltas.push({ action, actionName: ACTION_NAME[action] || `ACTION_${action}`,
      offRootScore: off?.rootScore ?? null, onRootScore: on?.rootScore ?? null,
      rootScoreDelta: off && on ? on.rootScore - off.rootScore : null,
      offBackedValue: off?.backedValue ?? null,
      onBackedValue: on?.backedValue ?? null,
      backedValueDelta: off && on ? on.backedValue - off.backedValue : null,
      offEnemyCells: off?.enemyCells ?? null, onEnemyCells: on?.enemyCells ?? null });
  }
  return deltas;
}

function analyzePair(off, on) {
  const offActions = Buffer.from(off.candidate.compactActionStream, "base64");
  const onActions = Buffer.from(on.candidate.compactActionStream, "base64");
  const first = firstDifference(offActions, onActions);
  if (first < 0) return null;
  const offRoot = off.candidate.nativeTacticalActionOwner?.rootSamples?.find(
    root => root.engineDecisionIndex === first);
  const onRoot = on.candidate.nativeTacticalActionOwner?.rootSamples?.find(
    root => root.engineDecisionIndex === first);
  const stateEqual = Boolean(offRoot && onRoot &&
    offRoot.stateHashLo === onRoot.stateHashLo &&
    offRoot.stateHashHi === onRoot.stateHashHi);
  const proposed = onRoot?.proposedAction ?? onActions[first];
  const selected = bestRow(onRoot, proposed);
  const alternative = bestAlternative(onRoot, proposed);
  return {
    matchUrlId: off.matchUrlId,
    scenarioFingerprint: off.scenarioFingerprint,
    candidateSeat: off.candidateSeat,
    outcomeTransition: `${off.analysisOutcome}->${on.analysisOutcome}`,
    firstDifference: first,
    stateFrame: offRoot?.stateFrame ?? onRoot?.stateFrame ?? null,
    stateSignatureEqual: stateEqual,
    offActualAction: offActions[first],
    offActualActionName: ACTION_NAME[offActions[first]],
    onActualAction: onActions[first],
    onActualActionName: ACTION_NAME[onActions[first]],
    offProposedAction: offRoot?.proposedAction ?? null,
    offProposedActionName: ACTION_NAME[offRoot?.proposedAction],
    onProposedAction: onRoot?.proposedAction ?? null,
    onProposedActionName: ACTION_NAME[onRoot?.proposedAction],
    offEmitterCoerced: offRoot ? offRoot.proposedAction !== offActions[first] : null,
    onEmitterCoerced: onRoot ? onRoot.proposedAction !== onActions[first] : null,
    oracleStageAction: offRoot?.oracleStageAction ?? onRoot?.oracleStageAction ?? null,
    oracleStageActionName: ACTION_NAME[
      offRoot?.oracleStageAction ?? onRoot?.oracleStageAction],
    onMatchesOracle: (offRoot?.oracleStageAction ?? onRoot?.oracleStageAction) ===
      onActions[first],
    offMatchesOracle: (offRoot?.oracleStageAction ?? onRoot?.oracleStageAction) ===
      offActions[first],
    onSelectionMargin: selected && alternative ?
      selected.backedValue - alternative.backedValue : null,
    onBestAlternativeAction: alternative?.action ?? null,
    onBestAlternativeActionName: ACTION_NAME[alternative?.action],
    actionDeltas: stateEqual ? actionDeltas(offRoot, onRoot) : [],
    offRoot: offRoot || null,
    onRoot: onRoot || null
  };
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[(sorted.length - 1) >> 1];
}

function buildAudit(offRows, onRows) {
  const onByKey = new Map(onRows.map(row => [matchKey(row), row]));
  const roots = []; const transitions = {};
  let actionDifferentMatches = 0; let outcomeChanged = 0;
  for (const off of offRows) {
    const on = onByKey.get(matchKey(off));
    if (!on) continue;
    const analyzed = analyzePair(off, on);
    if (!analyzed) continue;
    actionDifferentMatches += 1;
    if (off.analysisOutcome === on.analysisOutcome) continue;
    outcomeChanged += 1; roots.push(analyzed);
    transitions[analyzed.outcomeTransition] =
      (transitions[analyzed.outcomeTransition] || 0) + 1;
  }
  const margins = roots.map(root => root.onSelectionMargin).filter(Number.isFinite);
  const selectedDeltas = roots.map(root => root.actionDeltas.find(delta =>
    delta.action === root.onProposedAction)?.rootScoreDelta).filter(Number.isFinite);
  const negative = roots.filter(root => root.outcomeTransition !== "V1_WIN->V2_WIN");
  const positive = roots.filter(root => root.outcomeTransition === "V1_WIN->V2_WIN");
  const scenarioIds = [...new Set(roots.map(root => root.matchUrlId))].sort();
  const actionCounts = {};
  for (const root of roots) actionCounts[root.onProposedActionName] =
    (actionCounts[root.onProposedActionName] || 0) + 1;
  let deltaOwnsFlipCount = 0;
  for (const root of roots) {
    const delta = root.actionDeltas.find(item =>
      item.action === root.onProposedAction)?.rootScoreDelta;
    if (Number.isFinite(delta) && Number.isFinite(root.onSelectionMargin) &&
        delta >= root.onSelectionMargin) deltaOwnsFlipCount += 1;
  }
  return { roots, overview: {
    objectKind: "BASE_POLICY_FIRST_DIVERGENCE_AUDIT_V1",
    commonMatches: Math.min(offRows.length, onRows.length),
    actionDifferentMatches, outcomeChanged,
    negativeTransitions: negative.length, positiveTransitions: positive.length,
    transitions,
    outcomeChangedScenarioIds: scenarioIds,
    comparableRootCount: roots.filter(root => root.offRoot && root.onRoot).length,
    stateExactRootCount: roots.filter(root => root.stateSignatureEqual).length,
    onOracleAgreementCount: roots.filter(root => root.onMatchesOracle).length,
    offOracleAgreementCount: roots.filter(root => root.offMatchesOracle).length,
    negativeOnOracleAgreementCount:
      negative.filter(root => root.onMatchesOracle).length,
    positiveOnOracleAgreementCount:
      positive.filter(root => root.onMatchesOracle).length,
    onProposedActionCount: actionCounts,
    recursiveNonFireFlipCount:
      roots.filter(root => root.onProposedAction !== 4).length,
    responseDeltaOwnsFlipCount: deltaOwnsFlipCount,
    offEmitterCoercionCount: roots.filter(root => root.offEmitterCoerced).length,
    onEmitterCoercionCount: roots.filter(root => root.onEmitterCoerced).length,
    selectionMargin: { minimum: margins.length ? Math.min(...margins) : null,
      median: median(margins), maximum: margins.length ? Math.max(...margins) : null,
      values: margins },
    selectedRootScoreDelta: {
      minimum: selectedDeltas.length ? Math.min(...selectedDeltas) : null,
      median: median(selectedDeltas),
      maximum: selectedDeltas.length ? Math.max(...selectedDeltas) : null,
      values: selectedDeltas
    }
  } };
}

function run() {
  const offDirectory = path.resolve(option("--off"));
  const onDirectory = path.resolve(option("--on"));
  const output = path.resolve(option("--output", "/tmp/agentank-bp11-audit"));
  const off = readMatches(offDirectory); const on = readMatches(onDirectory);
  const audit = buildAudit(off.rows, on.rows);
  fs.mkdirSync(output, { recursive: true });
  const roots = audit.roots.map(root => JSON.stringify(root)).join("\n");
  fs.writeFileSync(path.join(output, "roots.ndjson.gz"),
    zlib.gzipSync(Buffer.from(roots ? `${roots}\n` : ""), { level: 9 }));
  fs.writeFileSync(path.join(output, "overview.json"),
    `${JSON.stringify(audit.overview, null, 2)}\n`);
  const manifest = { objectKind: "BASE_POLICY_FIRST_DIVERGENCE_MANIFEST_V1",
    off: { directory: offDirectory, matchesSha256: off.sha256 },
    on: { directory: onDirectory, matchesSha256: on.sha256 },
    sourceSha256: sha256(fs.readFileSync(__filename)),
    rootCount: audit.roots.length };
  fs.writeFileSync(path.join(output, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, overview: audit.overview }, null, 2)}\n`);
  return audit;
}

if (require.main === module) run();

module.exports = { actionDeltas, analyzePair, bestAlternative, bestRow,
  buildAudit, firstDifference };
