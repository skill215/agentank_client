#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const { OPTION_KIND } = require("../../../engine-v2/src/policy/option-portfolio");
const { AttackSetupClosure, ATTACK_SETUP_REASON } =
  require("../../../engine-v2/src/search/attack-setup-closure");

const MAX_ACTIONS = 16;
const MAX_ENEMY = 16;

function option(name, fallback = "") {
  const at = process.argv.indexOf(name);
  return at < 0 ? fallback : String(process.argv[at + 1]);
}

function reasonNames(mask) {
  const names = [];
  for (const [name, value] of Object.entries(ATTACK_SETUP_REASON))
    if (value && (mask & value)) names.push(name);
  return names;
}

function copyRisk(target, row, source) {
  target.immediateFatalMass[row] = source.immediateFatalMass;
  target.horizonFatalMass[row] = source.horizonFatalMass;
  target.unknownMass[row] = source.unknownMass;
  target.escapeSlack[row] = source.escapeSlack;
  target.robustLower[row] = source.robustLower;
}

function copyCombat(target, row, source) {
  target.attackClosureStatus[row] = source.attackClosureStatus;
  target.enemyUnknownFirstActions[row] = source.enemyUnknownFirstActions;
  target.hitDeadline[row] = source.hitDeadline;
  target.postFireEscape[row] = source.postFireEscape;
  target.ownCounterExposure[row] = source.ownCounterExposure;
}

function createSlabs() {
  return {
    closure: new AttackSetupClosure(MAX_ACTIONS),
    outcome: {
      immediateFatalMass: new Uint16Array(MAX_ACTIONS),
      horizonFatalMass: new Uint16Array(MAX_ACTIONS),
      unknownMass: new Uint16Array(MAX_ACTIONS),
      escapeSlack: new Int8Array(MAX_ACTIONS),
      robustLower: new Int16Array(MAX_ACTIONS)
    },
    combat: {
      attackClosureStatus: new Uint8Array(MAX_ACTIONS),
      enemyUnknownFirstActions: new Uint8Array(MAX_ACTIONS),
      hitDeadline: new Uint8Array(MAX_ACTIONS),
      postFireEscape: new Uint8Array(MAX_ACTIONS),
      ownCounterExposure: new Uint16Array(MAX_ACTIONS)
    },
    pac: {
      maxEnemy: MAX_ENEMY,
      status: new Uint8Array(MAX_ACTIONS),
      cellStatus: new Uint8Array(MAX_ACTIONS * MAX_ENEMY),
      cellSetupDelay: new Uint8Array(MAX_ACTIONS * MAX_ENEMY),
      cellMobilityLoss: new Uint8Array(MAX_ACTIONS * MAX_ENEMY),
      cellEndpointReduction: new Uint16Array(MAX_ACTIONS * MAX_ENEMY)
    },
    escape: {
      committedEntityCount: 0,
      supportStatus: 0,
      member: new Uint8Array(MAX_ACTIONS),
      successorProof: new Uint8Array(MAX_ACTIONS)
    }
  };
}

function resetSlabs(slabs) {
  for (const array of Object.values(slabs.outcome)) array.fill(0);
  for (const array of Object.values(slabs.combat)) array.fill(0);
  for (const [key, array] of Object.entries(slabs.pac))
    if (key !== "maxEnemy") array.fill(0);
  slabs.escape.member.fill(0); slabs.escape.successorProof.fill(0);
}

function classifyRecord(record, slabs) {
  if (record.schemaVersion !== 2)
    throw new Error(`ATTACK_SETUP_CORPUS_SCHEMA:${record.schemaVersion}`);
  if (record.proposal.row >= MAX_ACTIONS || record.incumbent.row >= MAX_ACTIONS ||
      record.enemyActions.length > MAX_ENEMY)
    throw new Error("ATTACK_SETUP_CORPUS_CAPACITY");
  if (record.proposalOptionKind !== OPTION_KIND.ATTACK_SETUP)
    return { evaluated: false, kind: record.proposalOptionKind };
  resetSlabs(slabs);
  const incumbent = record.incumbent.row; const row = record.proposal.row;
  copyRisk(slabs.outcome, incumbent, record.incumbent);
  copyRisk(slabs.outcome, row, record.proposal);
  copyCombat(slabs.combat, incumbent, record.incumbent);
  copyCombat(slabs.combat, row, record.proposal);
  slabs.pac.status[row] = record.proposal.attackClosureStatus;
  for (let column = 0; column < record.proposalAttackColumns.length; column += 1) {
    const source = record.proposalAttackColumns[column];
    const at = row * MAX_ENEMY + column;
    slabs.pac.cellStatus[at] = source.status;
    slabs.pac.cellSetupDelay[at] = source.setupDelay;
    slabs.pac.cellMobilityLoss[at] = source.mobilityLoss;
    slabs.pac.cellEndpointReduction[at] = source.endpointReduction;
  }
  slabs.escape.committedEntityCount = record.committedEntityCount;
  slabs.escape.supportStatus = record.committedSupportStatus;
  slabs.escape.member[row] = record.proposal.committedEscapeMember;
  slabs.escape.successorProof[row] = record.proposal.committedSuccessorProof;
  slabs.closure.reset(Math.max(incumbent, row) + 1, incumbent);
  const exact = record.incumbentLower === record.incumbentUpper &&
    record.proposalLower === record.proposalUpper;
  const certified = slabs.closure.evaluateRow(row, record.proposalOptionKind, exact,
    slabs.outcome, slabs.combat, slabs.pac, record.enemyActions.length, slabs.escape);
  return {
    evaluated: true,
    certified: Boolean(certified),
    reason: slabs.closure.reason[row],
    reasonNames: reasonNames(slabs.closure.reason[row]),
    doomedColumns: slabs.closure.doomedColumns[row],
    constrainedColumns: slabs.closure.constrainedColumns[row],
    uncoveredColumns: slabs.closure.uncoveredColumns[row]
  };
}

function run() {
  const input = path.resolve(option("--input"));
  if (!input || !fs.existsSync(input)) throw new Error("ATTACK_SETUP_CORPUS_INPUT_REQUIRED");
  const compressed = fs.readFileSync(input);
  const text = zlib.gunzipSync(compressed).toString("utf8").trim();
  const records = text ? text.split("\n").map(line => JSON.parse(line)) : [];
  const slabs = createSlabs();
  const output = {
    objectKind: "ATTACK_SETUP_CORPUS_VERIFICATION_V1",
    input,
    inputSha256: crypto.createHash("sha256").update(compressed).digest("hex"),
    records: records.length,
    setupRecords: 0,
    otherRecords: 0,
    certified: 0,
    rejected: 0,
    incomplete: 0,
    reasonCounts: {},
    samples: []
  };
  for (const record of records) {
    const result = classifyRecord(record, slabs);
    if (!result.evaluated) { output.otherRecords += 1; continue; }
    output.setupRecords += 1;
    if (result.certified) output.certified += 1;
    else if (result.reasonNames.some(name => name.endsWith("INCOMPLETE") ||
        name === "UNKNOWN_COLUMN" || name === "COMMITTED_SUPPORT")) output.incomplete += 1;
    else output.rejected += 1;
    for (const name of result.reasonNames)
      output.reasonCounts[name] = (output.reasonCounts[name] || 0) + 1;
    if (output.samples.length < 16) output.samples.push({
      matchUrlId: record.matchUrlId,
      frame: record.frame,
      outcome: record.analysisOutcome,
      fromAction: record.incumbent.action,
      toAction: record.proposal.action,
      ...result
    });
  }
  output.hotAllocationCount = slabs.closure.hotAllocationCount;
  const expected = Number(option("--expect-certified", "0"));
  output.expectCertified = expected;
  output.passed = output.certified === expected && output.records > 0 &&
    output.setupRecords + output.otherRecords === output.records &&
    output.hotAllocationCount === 0;
  const target = option("--output");
  if (target) fs.writeFileSync(path.resolve(target), `${JSON.stringify(output, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!output.passed) process.exitCode = 1;
}

if (require.main === module) run();

module.exports = { classifyRecord, createSlabs };

