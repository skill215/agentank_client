"use strict";

// Generates the first production-shaped search closure from the diagnostic
// oracle. The retained method set is runtime evidence, not a hand-maintained
// guess. BP166 additionally removes a reached-but-proven-empty leaf reporting
// hook: under the frozen BP68 continuation policy every call returns before
// reading state.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const acorn = require("acorn");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function findClass(program, name) {
  return program.body.find(node => node.type === "ClassDeclaration" &&
    node.id?.name === name);
}

function thisProperties(node, output = new Set()) {
  if (!node || typeof node !== "object") return output;
  if (node.type === "MemberExpression" && !node.computed &&
      node.object?.type === "ThisExpression" &&
      node.property?.type === "Identifier") output.add(node.property.name);
  for (const [key, value] of Object.entries(node)) {
    if (key === "start" || key === "end" || key === "loc") continue;
    if (Array.isArray(value)) for (const child of value)
      thisProperties(child, output);
    else if (value && typeof value === "object") thisProperties(value, output);
  }
  return output;
}

function specializedConstructor(source, constructor, usedProperties) {
  const kept = [];
  for (const statement of constructor.value.body.body) {
    const properties = thisProperties(statement);
    if (!properties.size || Array.from(properties).some(name =>
      usedProperties.has(name))) kept.push(source.slice(statement.start,
      statement.end));
  }
  return `${source.slice(constructor.start, constructor.value.body.start + 1)}\n` +
    `${kept.join("\n")}\n  }`;
}

function specializeFrozenProfile(text, hotNoOpName) {
  if (hotNoOpName !== "recordPolicyEnvelopeLeaf") return {
    text, removedNoOpCalls: 0 };
  let removedNoOpCalls = 0;
  const replace = pattern => {
    text = text.replace(pattern, () => {
      removedNoOpCalls += 1; return "";
    });
  };
  replace(/\s*if \(leaf\) this\.recordPolicyEnvelopeLeaf\(top\);/g);
  replace(/\s*this\.recordPolicyEnvelopeLeaf\(top\);/g);
  return { text, removedNoOpCalls };
}

function generate(root) {
  const sourceFile = path.join(root,
    "tools/agentank/diagnostics/native-bounded-policy-search-poc.js");
  const evidenceFile = path.join(root,
    "config/engine-v3/base-policy-kernel-bp160-search-reachability-evidence.json");
  const outputFile = path.join(root,
    "engine-v2/src/base-policy/policy-search.js");
  const source = fs.readFileSync(sourceFile, "utf8");
  const evidence = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
  const retained = new Set(evidence.reachability.nativeCalledMethods.map(
    entry => entry.name));
  const hotNoOpName = evidence.reachability.hotNoOpCandidate?.name;
  if (hotNoOpName) retained.delete(hotNoOpName);
  retained.add("constructor");
  const program = acorn.parse(source, { ecmaVersion: "latest",
    sourceType: "script" });
  const collision = findClass(program, "V1EntryCollisionKernel");
  const search = findClass(program, "NativeBoundedPolicySearchPoc");
  if (!collision || !search) throw new Error("BASE_POLICY_SEARCH_CLASS_MISSING");
  const methods = search.body.body.filter(method => {
    const name = method.kind === "constructor" ? "constructor" : method.key?.name;
    return retained.has(name);
  });
  const emittedNames = methods.map(method => method.kind === "constructor" ?
    "constructor" : method.key.name);
  const missing = Array.from(retained).filter(name => !emittedNames.includes(name));
  if (missing.length) throw new Error(`BASE_POLICY_SEARCH_METHOD_MISSING:${
    missing.join(",")}`);
  let prefix = source.slice(0, collision.start)
    .replaceAll("../../../engine-v2/src/", "../");
  prefix = prefix.replace("Diagnostic-only bounded policy search.",
    "Generated BP68 production search closure.");
  const classHeader = source.slice(search.start, search.body.start + 1)
    .replace("NativeBoundedPolicySearchPoc", "NativeBasePolicySearch");
  const usedProperties = new Set();
  for (const method of methods) if (method.kind !== "constructor")
    thisProperties(method.value.body, usedProperties);
  const constructor = methods.find(method => method.kind === "constructor");
  let removedNoOpCalls = 0;
  const emittedMethods = methods.map(method => method.kind === "constructor" ?
    specializedConstructor(source, constructor, usedProperties) :
    (() => {
      const result = specializeFrozenProfile(source.slice(method.start,
        method.end), hotNoOpName);
      removedNoOpCalls += result.removedNoOpCalls;
      return result.text;
    })());
  if (hotNoOpName && removedNoOpCalls !== 4)
    throw new Error(`BASE_POLICY_SEARCH_NOOP_CALL_COUNT:${removedNoOpCalls}`);
  const generated = `${prefix}${source.slice(collision.start, collision.end)}\n\n` +
    `${classHeader}\n${emittedMethods.join("\n\n")}\n}\n\n` +
    `module.exports = { NativeBasePolicySearch, EXACT_BLOCK, ` +
    `CONTINUATION_POLICY, EVENT_QUIESCENCE };\n`;
  fs.writeFileSync(outputFile, generated);
  return { outputFile, sourceFile, evidenceFile,
    sourceSha256: sha256(source), evidenceFingerprint: evidence.fingerprint,
    outputSha256: sha256(generated), outputBytes: Buffer.byteLength(generated),
    retainedMethods: emittedNames.length, retainedProperties: usedProperties.size,
    retainedConstructorStatements: constructor.value.body.body.filter(statement => {
      const properties = thisProperties(statement);
      return !properties.size || Array.from(properties).some(name =>
        usedProperties.has(name));
    }).length,
    removedConstructorStatements: constructor.value.body.body.length -
      constructor.value.body.body.filter(statement => {
        const properties = thisProperties(statement);
        return !properties.size || Array.from(properties).some(name =>
          usedProperties.has(name));
      }).length,
    removedMethods: search.body.body.length - methods.length,
    removedHotNoOpMethod: hotNoOpName || null,
    removedHotNoOpCalls: removedNoOpCalls };
}

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  process.stdout.write(`${JSON.stringify(generate(root), null, 2)}\n`);
}

module.exports = { generate };
