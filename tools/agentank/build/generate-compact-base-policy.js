#!/usr/bin/env node
"use strict";

// Closed-profile candidate generator. It removes only properties that are
// written for diagnostics/reporting and never consumed by BP68 decisions.
// The ordinary base-policy modules remain the readable/auditable source.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const acorn = require("acorn");

const STRIP = Object.freeze({
  "action-owner": [
    "attackPoseOptionFirst", "attackPoseRequiredAimTurns",
    "resourceRequiresCellwiseDominance", "intentMembership",
    "nonContactBasePolicy", "directAttackBasePolicy",
    "preemptiveSafetyBasePolicy", "committedSearchMode",
    "basePolicyVerifierMode", "basePolicyVerifierMargin",
    "policySearchSupportMode", "verifiedInterceptMode",
    "verifiedInterceptBand", "poisonProposalMode", "poisonProposalPolicy",
    "qualifiedFireOwnerMode", "checkCount", "proposalCount",
    "overrideCount", "sameCount", "noSupportCount", "strictSkipCount",
    "committedSkipCount", "riskSupportMissingCount",
    "softRiskCandidateCount", "softRiskIntentAllowedCount",
    "selectedJointDominatedCount", "nonContactSkipCount",
    "strictOwnerSkipCount", "noCompleteValueCount", "lastSource",
    "membershipStage"
  ],
  "action-domain": [
    "mode", "checkCount", "fireCheckCount", "directFireCount",
    "interceptFireCount", "blockedFireCount", "resourceCheckCount",
    "bombAllowedCount", "bombBlockedCount", "skillAllowedCount",
    "skillBlockedCount", "hotAllocationCount"
  ],
  "strategic-intent": [
    "mappingMode", "continuityMode", "classificationMode", "prepareCount",
    "attackCount", "starCount", "edgeCount", "faceCount", "evadeCount",
    "continuityCount", "switchCount", "contextChangeCount",
    "bonusRowCount", "mappingActionCount", "mappingMissingRowCount",
    "hotAllocationCount"
  ],
  "opponent-history": [
    "observeCount", "hiddenCount", "classifiedCount", "hotAllocationCount"
  ],
  "policy-search": [
    "scheduledDepthCount", "hardBudgetInterruptCount", "blendScheduleCount",
    "ownContinuationRouteCount", "ownContinuationRouteIncompleteCount",
    "ownContinuationDomainFallbackCount",
    "ownContinuationSecondaryRouteCount",
    "ownContinuationSecondaryIncompleteCount",
    "ownContinuationPortfolioDedupCount", "rootPolicyPrepareCount",
    "rootPolicyPrimaryIncompleteCount", "rootPolicySecondaryIncompleteCount",
    "rootPolicyDistinctCount", "rootPolicyPrimaryRowCount",
    "rootPolicySecondaryRowCount", "eventQuiescenceCheckCount",
    "eventQuiescenceExpansionCount", "eventQuiescenceQuietLeafCount",
    "eventQuiescenceCappedLeafCount", "eventQuiescenceProjectileLeafCount",
    "eventQuiescenceBombLeafCount", "eventQuiescencePolicyRouteCount",
    "eventQuiescencePolicyRouteIncompleteCount",
    "eventQuiescencePolicyDomainMissCount", "oracleOpponentObservations",
    "policyEnvelopeRescueFallbackCount", "policyEnvelopeAbortFallbackCount",
    "policyEnvelopeCompletionFallbackCount",
    "policyEnvelopeInjectedActionCount", "rootDomainOracleCompareCount",
    "rootDomainOracleBothCount", "rootDomainNativeOnlyCount",
    "rootDomainOracleOnlyCount", "superkoCheckCount", "superkoPenaltyCount",
    "superkoPenaltyTotal", "superkoPathMatchCount", "superkoRootMatchCount",
    "superkoReliefCount", "externalRootRestrictionCount",
    "externalRootRestrictedRowCount", "preparedRootCount", "completedDepth",
    "representativeSupportDepth", "representativeSupportComplete",
    "lastExactBlockMask", "lastExactRowCount", "exactRowCount",
    "blockedRowCount", "exactBlockedRootCount",
    "budgetCompleteHeuristicRootCount", "depthOnlyHeuristicRootCount",
    "exactOwnershipRootCount", "strictOwnershipRootCount",
    "heuristicOwnershipRootCount", "prepareCount", "completeCount",
    "rootCount", "totalNodes", "hardAllowCount", "hardRejectProvenCount",
    "terminalCount", "rootRestoreFailureCount", "recordTerminalCount",
    "combatTerminalCount", "mutualCombatTerminalCount", "ownExpansionCount",
    "enemyExpansionCount", "jointTransitionCount", "chanceOutcomeCount",
    "v1OwnChanceCheckCount", "v1OwnReversedCount", "weightedReplyCount",
    "deepOwnSkillCount", "deepEnemySkillCount", "deepV1FireCheckCount",
    "isolationAllocationCount", "nativeRootActionCount"
  ],
  "policy-leaf": [
    "componentSignedTotal", "componentAbsTotal", "callCount",
    "starFieldCount", "projectileThreatCount", "bombPressureCount",
    "attackRaceWinCount", "attackRaceLossCount", "attackRaceTieCount",
    "lineFireCount", "statusCount", "clampCount", "componentClampCount",
    "rootEventBase", "simulatedProjectileCount", "starFieldCacheHitCount",
    "starFieldCacheMissCount", "starFieldCacheTerrainCompareCount",
    "starFieldCacheTerrainCellCompareCount", "starFieldCacheRootCompareCount",
    "starFieldCacheRootRebindCount"
  ],
  "path-utility": [
    "enemyActionCounts", "enemyStationaryStreak", "callCount", "fireCount",
    "directFireCount", "dirtFireCount", "emptyFireCount", "bombCount",
    "turnCount", "reversalCount", "stunCount", "goCount",
    "goEdgePenaltyCount", "goEdgeReliefCount", "exactFireTransitionCount",
    "responseFirePrepareCount", "responseFireAppliedCount",
    "responseFirePositiveCount", "responseFireDeltaTotal"
  ],
  "native-root": ["selectCount"]
});

const REMOVE_METHOD = Object.freeze({
  "action-owner": ["summary"], "action-domain": ["summary"],
  "strategic-intent": ["summary"], "opponent-history": ["summary"]
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function walk(node, callback, parent = null) {
  if (!node || typeof node !== "object") return;
  callback(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end" || key === "loc") continue;
    if (Array.isArray(value)) for (const child of value)
      walk(child, callback, node);
    else if (value && typeof value === "object") walk(value, callback, node);
  }
}

function thisProperty(node) {
  let value = node;
  while (value?.type === "MemberExpression" && value.computed)
    value = value.object;
  return value?.type === "MemberExpression" && !value.computed &&
    value.object?.type === "ThisExpression" &&
    value.property?.type === "Identifier" ? value.property.name : null;
}

function mutatedProperty(expression) {
  if (expression.type === "UpdateExpression")
    return thisProperty(expression.argument);
  if (expression.type === "AssignmentExpression")
    return thisProperty(expression.left);
  if (expression.type === "CallExpression" &&
      expression.callee?.type === "MemberExpression" &&
      expression.callee.property?.name === "fill")
    return thisProperty(expression.callee.object);
  return null;
}

function compactSource(source, moduleName) {
  const strip = new Set(STRIP[moduleName]);
  const removeMethods = new Set(REMOVE_METHOD[moduleName] || []);
  const program = acorn.parse(source, { ecmaVersion: "latest",
    sourceType: "script" });
  const edits = [];
  walk(program, (node) => {
    if (node.type === "ExpressionStatement" &&
        strip.has(mutatedProperty(node.expression)))
      edits.push({ start: node.start, end: node.end, text: ";" });
    if (node.type === "MethodDefinition" && !node.computed &&
        removeMethods.has(node.key?.name))
      edits.push({ start: node.start, end: node.end, text: "" });
  });
  edits.sort((left, right) => right.start - left.start);
  let output = source;
  for (const edit of edits)
    output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
  output = output.replace("\"use strict\";", "\"use strict\";\n\n" +
    "// Generated compact BP68 candidate. Do not edit by hand.");
  return { output, editCount: edits.length };
}

function generate(root) {
  const inputDirectory = path.join(root, "engine-v2/src/base-policy");
  const outputDirectory = path.join(root, "engine-v2/src/base-policy-compact");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const modules = {};
  for (const moduleName of Object.keys(STRIP)) {
    const sourceFile = path.join(inputDirectory, `${moduleName}.js`);
    const outputFile = path.join(outputDirectory, `${moduleName}.js`);
    const source = fs.readFileSync(sourceFile, "utf8");
    const compact = compactSource(source, moduleName);
    fs.writeFileSync(outputFile, compact.output);
    modules[moduleName] = { sourceSha256: sha256(source),
      outputSha256: sha256(compact.output), sourceBytes: Buffer.byteLength(source),
      outputBytes: Buffer.byteLength(compact.output), edits: compact.editCount };
  }
  const index = `"use strict";\n\n` +
    `const { NativeBasePolicyRoot, NATIVE_BASE_POLICY_PROFILE } = require("./native-root");\n` +
    `const { NativeBasePolicyActionOwner } = require("./action-owner");\n` +
    `const { NativeBasePolicyActionDomain } = require("./action-domain");\n` +
    `const { NativeBasePolicyStrategicIntent } = require("./strategic-intent");\n` +
    `const { NativeBasePolicyOpponentHistory } = require("./opponent-history");\n` +
    `const { NativeBasePolicySearch } = require("./policy-search");\n` +
    `const { NativeBasePolicyLeafEvaluator } = require("./policy-leaf");\n` +
    `const { NativeBasePolicyPathUtility } = require("./path-utility");\n` +
    `module.exports = { NativeBasePolicyRoot, NATIVE_BASE_POLICY_PROFILE,\n` +
    `  NativeBasePolicyActionOwner, NativeBasePolicyActionDomain,\n` +
    `  NativeBasePolicyStrategicIntent, NativeBasePolicyOpponentHistory,\n` +
    `  NativeBasePolicySearch, NativeBasePolicyLeafEvaluator,\n` +
    `  NativeBasePolicyPathUtility };\n`;
  fs.writeFileSync(path.join(outputDirectory, "index.js"), index);
  return { inputDirectory, outputDirectory, modules,
    indexSha256: sha256(index), strippedProperties: Object.fromEntries(
      Object.entries(STRIP).map(([name, values]) => [name, values.length])) };
}

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  process.stdout.write(`${JSON.stringify(generate(root), null, 2)}\n`);
}

module.exports = { STRIP, REMOVE_METHOD, compactSource, generate };
