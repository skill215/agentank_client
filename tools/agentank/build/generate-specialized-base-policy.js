#!/usr/bin/env node
"use strict";

// Closed-profile partial evaluator for the accepted BP68 policy.  The readable
// base-policy modules remain the source of truth; this generated directory
// specializes only configuration fields that NativeBasePolicyRoot fixes for
// every construction.  Search depth, node budget and evaluation semantics are
// unchanged.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const acorn = require("acorn");
const { generate: generateCompact } = require("./generate-compact-base-policy");

const FIXED = Object.freeze({
  "action-owner": Object.freeze({
    riskFrontierMode: "joint",
    riskSoftBandMode: "intent-known",
    intentValueMode: "bonus"
  }),
  "policy-search": Object.freeze({
    targetDepth: 3,
    depthSchedule: "v1-state",
    nodeBudget: 128,
    hardBudgetInterrupt: 0,
    blendBasisPoints: 2000,
    blendSchedule: "fixed",
    leadingBlendBasisPoints: 0,
    trailingBlendBasisPoints: 4000,
    fullPrimitiveDomain: true,
    deepFireMode: "v1-own",
    deepSkillMode: 3,
    deepDomainMode: "v1-shaped",
    deepBombMode: "off",
    eventQuiescenceMode: "off",
    eventQuiescenceContinuationMode: "full",
    ownContinuationMode: "full",
    eventQuiescenceMaximumPly: 3,
    pathEvidenceMode: "single",
    superkoMode: "v1",
    collectTerminalTrade: false,
    opponentMode: "v1-exact",
    opponentWeighted: true,
    v1StunCountdown: true,
    v1EntryProjectileCollision: true,
    deepHardMode: "full",
    rootDomainMode: "v1-shaped",
    rootExtraPoison: false,
    terminalMode: "v1",
    ownChanceMode: "v1-deterministic",
    rootEnemyDomainMode: "v1-shaped",
    rootEnemyDomainFlags: 7,
    rootColumnOrder: "v1",
    rootBudgetMode: "row-shared"
  }),
  "policy-leaf": Object.freeze({
    discountSimulatedProjectiles: false,
    clampLimit: 25000,
    clampMode: "total",
    componentMask: 63,
    starFieldCacheEntries: 2,
    precomputeGeometry: true
  }),
  "path-utility": Object.freeze({
    enableFire: true,
    enableBomb: true,
    enableTurn: true,
    enableStun: true,
    rootTurnOnly: false,
    reversalOnly: false,
    exactFireTransition: true,
    responseConditionedFire: false,
    goEdgeTransition: true
  }),
  "strategic-intent": Object.freeze({ margin: 150 })
});

const MODULES = Object.freeze([
  "action-owner", "action-domain", "strategic-intent", "opponent-history",
  "policy-search", "policy-leaf", "path-utility"
]);

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

function ownProperty(node) {
  return node?.type === "MemberExpression" && !node.computed &&
    node.object?.type === "ThisExpression" &&
    node.property?.type === "Identifier" ? node.property.name : null;
}

function literal(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === true) return "true";
  if (value === false) return "false";
  return String(value);
}

function inside(ranges, node) {
  for (const range of ranges)
    if (node.start >= range.start && node.end <= range.end) return true;
  return false;
}

function specializeSource(source, moduleName) {
  const fixed = FIXED[moduleName] || {};
  if (!Object.keys(fixed).length) return { output: source, replacements: 0,
    removedAssignments: 0 };
  const program = acorn.parse(source, { ecmaVersion: "latest",
    sourceType: "script" });
  const removals = [];
  walk(program, node => {
    if (node.type !== "ExpressionStatement" ||
        node.expression?.type !== "AssignmentExpression") return;
    const property = ownProperty(node.expression.left);
    if (Object.prototype.hasOwnProperty.call(fixed, property))
      removals.push({ start: node.start, end: node.end, text: ";" });
  });
  const replacements = [];
  walk(program, (node, parent) => {
    const property = ownProperty(node);
    if (!Object.prototype.hasOwnProperty.call(fixed, property) ||
        inside(removals, node)) return;
    if (parent?.type === "AssignmentExpression" && parent.left === node ||
        parent?.type === "UpdateExpression" && parent.argument === node)
      return;
    replacements.push({ start: node.start, end: node.end,
      text: literal(fixed[property]) });
  });
  const edits = removals.concat(replacements).sort((left, right) =>
    right.start - left.start || right.end - left.end);
  let output = source;
  for (const edit of edits)
    output = `${output.slice(0, edit.start)}${edit.text}${output.slice(edit.end)}`;
  if (moduleName === "policy-search") {
    // BP68 already owns byte-identical helpers. Keeping these calls routed
    // through the legacy ProductionDepthSearch forces a thin native host to
    // carry an otherwise unused facade.
    const localMethod = { target: "targetCell", walkable: "positionWalkable",
      heuristic: "heuristic", terminalValue: "terminalValue",
      chanceAlternatives: "chanceAlternatives" };
    for (const [external, local] of Object.entries(localMethod))
      output = output.replaceAll(`engine.depthSearch.${external}`,
        `this.${local}`);
    output = output.replaceAll("const search = engine.depthSearch;",
      "const search = this;");
    const helperMarker = "\nrootV1ShapedAllowed(engine, action) {";
    if (!output.includes(helperMarker))
      throw new Error("BP_SPECIALIZE_HELPER_MARKER_MISSING");
    output = output.replace(helperMarker, `
chanceAlternatives(state, seat, action) {
    const a = state.arrays; const frame = a[ARRAY.SCALAR][SCALAR.FRAME];
    if (a[ARRAY.TANK_STUN_UNTIL][seat] === NONE_FRAME ||
        a[ARRAY.TANK_STUN_UNTIL][seat] <= frame) return 1;
    if (action >= ACTION.BOOST_LEFT_GO && action <= ACTION.BOOST_RIGHT_BOMB)
      return (action - ACTION.BOOST_LEFT_GO) % 5 <= 2 ? 4 : 2;
    return action === ACTION.GO || action === ACTION.TURN_LEFT ||
      action === ACTION.TURN_RIGHT ? 2 : 1;
  }

heuristic(state) { return this.leafEvaluator.evaluate(state); }

terminalValue(terminal, depth) {
    return terminal === TERMINAL.DRAW ? 0 :
      terminal === TERMINAL.WIN0 ? 30000 + depth * 100 :
        -30000 - depth * 100;
  }
${helperMarker}`);
    // NativeBasePolicyRoot installs a non-null opponent census before every
    // prepare(). The generic V2 OpponentModel fallback is therefore outside
    // this closed profile and would create a false host dependency.
    const parsed = acorn.parse(output, { ecmaVersion: "latest",
      sourceType: "script" });
    let opponentWeight = null;
    walk(parsed, node => {
      if (node.type === "MethodDefinition" && !node.computed &&
          node.key?.name === "opponentWeight") opponentWeight = node;
    });
    if (!opponentWeight) throw new Error("BP_SPECIALIZE_OPPONENT_WEIGHT_MISSING");
    const replacement = `opponentWeight(engine, state, action) {
    void engine;
    return this.oracleOpponentReady ? this.v1OpponentWeight(state, action) : 1000;
  }`;
    output = `${output.slice(0, opponentWeight.start)}${replacement}` +
      `${output.slice(opponentWeight.end)}`;
  }
  output = output.replace("// Generated compact BP68 candidate. Do not edit by hand.",
    "// Generated specialized BP68 candidate. Do not edit by hand.");
  return { output, replacements: replacements.length,
    removedAssignments: removals.length };
}

function specializedRootSource() {
  return `"use strict";

// Generated closed BP68 assembly. Do not edit by hand.
const { NativeBasePolicyActionOwner } = require("./action-owner");
const { NativeBasePolicyActionDomain } = require("./action-domain");
const { NativeBasePolicyStrategicIntent } = require("./strategic-intent");
const { NativeBasePolicyOpponentHistory } = require("./opponent-history");
const { NativeBasePolicySearch } = require("./policy-search");
const { NativeBasePolicyLeafEvaluator } = require("./policy-leaf");
const { NativeBasePolicyPathUtility } = require("./path-utility");

class NativeBasePolicyRoot {
  constructor() {
    this.domain = new NativeBasePolicyActionDomain();
    this.intent = new NativeBasePolicyStrategicIntent();
    this.opponentHistory = new NativeBasePolicyOpponentHistory();
    this.leafEvaluator = new NativeBasePolicyLeafEvaluator();
    this.pathUtility = new NativeBasePolicyPathUtility(this.leafEvaluator);
    this.policySearch = new NativeBasePolicySearch({
      deepFireDomain: this.domain,
      leafEvaluator: this.leafEvaluator,
      pathUtility: this.pathUtility
    });
    this.owner = new NativeBasePolicyActionOwner({
      domain: this.domain,
      intent: this.intent,
      policySearch: this.policySearch,
      opponentHistory: this.opponentHistory
    });
  }
  selectOverride(engine, selected, incumbentAction) {
    this.opponentHistory.observe(engine);
    this.policySearch.setOracleOpponentContext(
      this.opponentHistory.contextView());
    return this.owner.selectOverride(engine, selected, incumbentAction);
  }
}

module.exports = { NativeBasePolicyRoot };
`;
}

function generate(root) {
  generateCompact(root);
  const inputDirectory = path.join(root, "engine-v2/src/base-policy-compact");
  const outputDirectory = path.join(root,
    "engine-v2/src/base-policy-specialized");
  fs.mkdirSync(outputDirectory, { recursive: true });
  const modules = {};
  for (const moduleName of MODULES) {
    const sourceFile = path.join(inputDirectory, `${moduleName}.js`);
    const outputFile = path.join(outputDirectory, `${moduleName}.js`);
    const source = fs.readFileSync(sourceFile, "utf8");
    const result = specializeSource(source, moduleName);
    fs.writeFileSync(outputFile, result.output);
    modules[moduleName] = { sourceSha256: sha256(source),
      outputSha256: sha256(result.output), sourceBytes: Buffer.byteLength(source),
      outputBytes: Buffer.byteLength(result.output),
      replacements: result.replacements,
      removedAssignments: result.removedAssignments };
  }
  const sourceRoot = fs.readFileSync(path.join(inputDirectory, "native-root.js"),
    "utf8");
  const nativeRoot = specializedRootSource();
  fs.writeFileSync(path.join(outputDirectory, "native-root.js"), nativeRoot);
  modules["native-root"] = { sourceSha256: sha256(sourceRoot),
    outputSha256: sha256(nativeRoot), sourceBytes: Buffer.byteLength(sourceRoot),
    outputBytes: Buffer.byteLength(nativeRoot), replacements: 0,
    removedAssignments: 0 };
  const index = `"use strict";\n\n` +
    `const { NativeBasePolicyRoot } = require("./native-root");\n` +
    `module.exports = { NativeBasePolicyRoot };\n`;
  fs.writeFileSync(path.join(outputDirectory, "index.js"), index);
  return { inputDirectory, outputDirectory, fixed: FIXED, modules };
}

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  process.stdout.write(`${JSON.stringify(generate(root), null, 2)}\n`);
}

module.exports = { FIXED, specializeSource, generate };
