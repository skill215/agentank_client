"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const EXPECTED_HANDLERS = Object.freeze({
  "R0-SCHEDULER-SEAT-ORDER": "ReferenceScheduler.applyOrderedSeatSlots",
  "R0-FRAME-PHASE-ORDER": "ReferenceFrameTimeline.advanceFrame",
  "R0-PROJECTILE-LIFECYCLE": "ReferenceEntityKernel.advanceProjectiles",
  "R0-BOMB-LIFECYCLE": "ReferenceEntityKernel.resolveDueBombs",
  "R0-STAR-LIFECYCLE": "ReferenceObjectiveKernel.resolveStar",
  "R0-TERMINAL-PRIORITY": "ReferenceTerminalResolver.resolve",
  "R0-MOVE-AND-CONTEST": "ReferenceTerrainKernel.resolveMoves",
  "R0-OBSERVATION-VISIBILITY": "ReferenceObservationKernel.observeForSide",
  "R1-SHIELD": "ReferenceSkillKernel.applyShield",
  "R1-FREEZE": "ReferenceSkillKernel.applyFreeze",
  "R1-STUN": "ReferenceSkillKernel.applyStunOutcome",
  "R1-OVERLOAD": "ReferenceSkillKernel.applyOverloadFire",
  "R1-CLOAK": "ReferenceSkillKernel.applyCloak",
  "R1-POISON": "ReferenceSkillKernel.applyPoisonCadence",
  "R1-TELEPORT": "ReferenceSkillKernel.applyTeleport",
  "R1-BOOST": "ReferenceSkillKernel.applyBoostSlot",
  "R1-FAILED-CAST": "ReferenceSkillKernel.applyFailedCast",
  "R2-STUN-PROBABILITY": "ReferenceChanceKernel.enumerateStun",
  "R2-TELEPORT-PROBABILITY": "ReferenceChanceKernel.enumerateTeleportLanding",
  "R2-FUTURE-STAR": "ReferenceChanceKernel.rejectUnconfirmedFutureStarModel"
});

function invariant(condition, code, message) {
  if (condition) return;
  const error = new Error(message); error.code = code; throw error;
}

function defaultCorpusFile(workspaceRoot) {
  return path.join(workspaceRoot, "docs", "design", "dd4-rule-corpus.json");
}

function sourceClass(ref) {
  const text = typeof ref === "string" ? ref : ref?.sourceType;
  if (!text) return "MISSING";
  if (/^(GUIDE|UPDATE|PLATFORM)/.test(text)) return "PLATFORM_AUTHORITY";
  if (/^(CORPUS|USER)/.test(text)) return "CONFIRMED_LOWER_AUTHORITY";
  if (/EXTERNAL|FRAMEWORK/.test(text)) return "CANDIDATE_ONLY";
  return "DECLARED_OTHER";
}

function strictEligible(rule) {
  return typeof rule.proofEligibility === "string" &&
    !/^(NOT_STRICT|NEVER)/.test(rule.proofEligibility);
}

function validateRuleCorpus(corpus) {
  invariant(corpus?.schemaVersion === 2, "RULE_CORPUS_SCHEMA", "RuleCorpus schemaVersion must be 2");
  invariant(Array.isArray(corpus.rules) && corpus.rules.length > 0,
    "RULE_CORPUS_RULES_EMPTY", "RuleCorpus must contain rules");
  invariant(Array.isArray(corpus.variantGroups), "RULE_CORPUS_VARIANTS_INVALID",
    "RuleCorpus variantGroups must be an array");
  invariant(Array.isArray(corpus.fixtures), "RULE_CORPUS_FIXTURES_INVALID",
    "RuleCorpus fixtures must be an array");
  const rules = new Map(corpus.rules.map(rule => [rule.ruleId, rule]));
  const variants = new Map(corpus.variantGroups.map(group => [group.id, group]));
  const fixtures = new Map(corpus.fixtures.map(fixture => [fixture.fixtureId, fixture]));
  invariant(rules.size === corpus.rules.length, "RULE_CORPUS_DUPLICATE_RULE", "duplicate ruleId");
  invariant(variants.size === corpus.variantGroups.length, "RULE_CORPUS_DUPLICATE_VARIANT",
    "duplicate variant id");
  invariant(fixtures.size === corpus.fixtures.length, "RULE_CORPUS_DUPLICATE_FIXTURE",
    "duplicate fixture id");

  for (const rule of corpus.rules) {
    invariant(corpus.handlerBindings[rule.ruleId] === EXPECTED_HANDLERS[rule.ruleId],
      "RULE_HANDLER_MISMATCH", `missing or unexpected handler for ${rule.ruleId}`);
    invariant(Array.isArray(rule.sourceRefs) && rule.sourceRefs.length > 0,
      "RULE_PROVENANCE_MISSING", `${rule.ruleId} has no provenance`);
    invariant(typeof rule.unknownRuleBehavior === "string" && rule.unknownRuleBehavior.length > 0,
      "UNKNOWN_BEHAVIOR_MISSING", `${rule.ruleId} has no unknown behavior`);
    for (const id of rule.variantIds || []) invariant(variants.has(id), "RULE_VARIANT_MISSING",
      `${rule.ruleId} references missing variant ${id}`);
    for (const id of rule.fixtureIds || []) invariant(fixtures.has(id), "RULE_FIXTURE_MISSING",
      `${rule.ruleId} references missing fixture ${id}`);
    if (/^UNKNOWN(?:_|$)/.test(rule.status)) {
      invariant(!strictEligible(rule), "UNKNOWN_UPGRADED_STRICT",
        `${rule.ruleId} UNKNOWN status cannot be strict`);
    }
  }
  for (const group of corpus.variantGroups) {
    invariant(Array.isArray(group.candidates) && group.candidates.length > 0,
      "VARIANT_DOMAIN_EMPTY", `${group.id} has no candidates`);
    invariant(group.active === null || group.candidates.includes(group.active),
      "VARIANT_ACTIVE_OUTSIDE_DOMAIN", `${group.id} active candidate is invalid`);
    invariant(typeof group.productionBehavior === "string" && group.productionBehavior.length > 0,
      "VARIANT_BEHAVIOR_MISSING", `${group.id} has no production behavior`);
  }
  for (const fixture of corpus.fixtures) {
    invariant(Array.isArray(fixture.ruleIds) && fixture.ruleIds.length > 0,
      "FIXTURE_RULES_EMPTY", `${fixture.fixtureId} has no rules`);
    for (const id of fixture.ruleIds) invariant(rules.has(id), "FIXTURE_RULE_MISSING",
      `${fixture.fixtureId} references missing rule ${id}`);
    if (fixture.variantGroup) invariant(variants.has(fixture.variantGroup),
      "FIXTURE_VARIANT_MISSING", `${fixture.fixtureId} references missing variant group`);
    const refs = fixture.sourceRefs || (fixture.sourceRef ? [fixture.sourceRef] : []);
    if (fixture.proofExpectation?.strictEligible) {
      invariant(!refs.some(ref => sourceClass(ref) === "CANDIDATE_ONLY"),
        "EXTERNAL_SOURCE_STRICT", `${fixture.fixtureId} promotes external evidence to strict`);
    }
  }
  return { rules, variants, fixtures };
}

function loadRuleCorpus(workspaceRoot, file = defaultCorpusFile(workspaceRoot)) {
  const bytes = fs.readFileSync(file);
  const corpus = JSON.parse(bytes.toString("utf8"));
  const index = validateRuleCorpus(corpus);
  return Object.freeze({ corpus, index, file, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
}

function createRuleContext(loaded, activeVariantByGroup = {}) {
  const selected = {};
  for (const group of loaded.corpus.variantGroups) {
    const value = Object.hasOwn(activeVariantByGroup, group.id) ? activeVariantByGroup[group.id] :
      group.active;
    invariant(value === null || group.candidates.includes(value), "INVALID_RULE_VARIANT_SELECTION",
      `invalid selection for ${group.id}`);
    selected[group.id] = value;
  }
  const phaseOrdinalById = Object.freeze(Object.fromEntries(loaded.corpus.phaseOrder.map(phase =>
    [phase.id, phase.ordinal])));
  return Object.freeze({ ruleCorpusSha256: loaded.sha256,
    rulesetVersion: loaded.corpus.rulesetVersion, phaseOrderId: loaded.corpus.phaseOrderId,
    terminalPolicyId: loaded.corpus.terminalPolicyId,
    activeVariantByGroup: Object.freeze(selected), phaseOrdinalById,
    constants: loaded.corpus.constants });
}

function ruleEvidenceReport(loaded) {
  const rules = loaded.corpus.rules.map(rule => ({ ruleId: rule.ruleId, status: rule.status,
    sourceClasses: [...new Set(rule.sourceRefs.map(sourceClass))].sort(),
    unknownRuleBehavior: rule.unknownRuleBehavior, proofEligibility: rule.proofEligibility,
    handler: loaded.corpus.handlerBindings[rule.ruleId] }));
  const candidateOnlyCannotOverride = loaded.corpus.rejectedExternalDefaults.every(item =>
    typeof item.id === "string" && typeof item.reason === "string");
  return { schemaVersion: 1, corpusId: loaded.corpus.corpusId, corpusSha256: loaded.sha256,
    ruleCount: rules.length, variantCount: loaded.corpus.variantGroups.length,
    fixtureCount: loaded.corpus.fixtures.length, rules, candidateOnlyCannotOverride,
    externalSimulatorCommit: loaded.corpus.evidence.externalSimulatorCommit };
}

module.exports = { EXPECTED_HANDLERS, defaultCorpusFile, sourceClass, strictEligible,
  validateRuleCorpus, loadRuleCorpus, createRuleContext, ruleEvidenceReport };
