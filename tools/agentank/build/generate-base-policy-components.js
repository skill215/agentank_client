"use strict";

// Generate production-shaped leaf/path closures from the exact BP164 runtime
// reachability census.  The diagnostic implementations stay authoritative;
// these files contain only methods and constructor state reached by the
// selected BP68 policy.

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
    if (Array.isArray(value)) {
      for (const child of value) thisProperties(child, output);
    } else if (value && typeof value === "object") {
      thisProperties(value, output);
    }
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

function generateComponent(root, evidence, specification) {
  const sourceFile = path.join(root, specification.source);
  const outputFile = path.join(root, specification.output);
  const source = fs.readFileSync(sourceFile, "utf8");
  const retained = new Set(evidence.leafPathReachability[
    specification.evidenceKey].calledMethods.map(entry => entry.name));
  retained.add("constructor");
  const program = acorn.parse(source, { ecmaVersion: "latest",
    sourceType: "script" });
  const sourceClass = findClass(program, specification.className);
  if (!sourceClass) throw new Error(`${specification.errorPrefix}_CLASS_MISSING`);
  const methods = sourceClass.body.body.filter(method => {
    const name = method.kind === "constructor" ? "constructor" : method.key?.name;
    return retained.has(name);
  });
  const emittedNames = methods.map(method => method.kind === "constructor" ?
    "constructor" : method.key.name);
  const missing = Array.from(retained).filter(name => !emittedNames.includes(name));
  if (missing.length) throw new Error(`${specification.errorPrefix}_METHOD_MISSING:${
    missing.join(",")}`);
  let prefix = source.slice(0, sourceClass.start)
    .replaceAll("../../../engine-v2/src/", "../");
  prefix = prefix.replace("Diagnostic-only", "Generated BP68 production");
  const classHeader = source.slice(sourceClass.start,
    sourceClass.body.start + 1).replace(specification.className,
    specification.outputClassName);
  const usedProperties = new Set();
  for (const method of methods) if (method.kind !== "constructor")
    thisProperties(method.value.body, usedProperties);
  const constructor = methods.find(method => method.kind === "constructor");
  const emittedMethods = methods.map(method => method.kind === "constructor" ?
    specializedConstructor(source, constructor, usedProperties) :
    source.slice(method.start, method.end));
  const generated = `${prefix}${classHeader}\n${emittedMethods.join("\n\n")}\n}\n\n` +
    `module.exports = { ${specification.exports.join(", ")} };\n`;
  fs.writeFileSync(outputFile, generated);
  const retainedConstructorStatements = constructor.value.body.body.filter(
    statement => {
      const properties = thisProperties(statement);
      return !properties.size || Array.from(properties).some(name =>
        usedProperties.has(name));
    }).length;
  return { outputFile, sourceFile, sourceSha256: sha256(source),
    outputSha256: sha256(generated), outputBytes: Buffer.byteLength(generated),
    retainedMethods: emittedNames.length,
    retainedProperties: usedProperties.size,
    retainedConstructorStatements,
    removedConstructorStatements: constructor.value.body.body.length -
      retainedConstructorStatements,
    removedMethods: sourceClass.body.body.length - methods.length };
}

function generate(root) {
  const evidenceFile = path.join(root,
    "config/engine-v3/base-policy-kernel-bp160-search-reachability-evidence.json");
  const evidence = JSON.parse(fs.readFileSync(evidenceFile, "utf8"));
  const leaf = generateComponent(root, evidence, {
    evidenceKey: "leaf",
    source: "tools/agentank/diagnostics/native-v1-policy-leaf-evaluator-poc.js",
    output: "engine-v2/src/base-policy/policy-leaf.js",
    className: "NativeV1PolicyLeafEvaluatorPoc",
    outputClassName: "NativeBasePolicyLeafEvaluator",
    exports: ["COMPONENT_NAME", "LEAF_COMPONENT", "NativeBasePolicyLeafEvaluator"],
    errorPrefix: "BASE_POLICY_LEAF"
  });
  const pathUtility = generateComponent(root, evidence, {
    evidenceKey: "path",
    source: "tools/agentank/diagnostics/native-v1-path-utility-poc.js",
    output: "engine-v2/src/base-policy/path-utility.js",
    className: "NativeV1PathUtilityPoc",
    outputClassName: "NativeBasePolicyPathUtility",
    exports: ["NativeBasePolicyPathUtility"],
    errorPrefix: "BASE_POLICY_PATH"
  });
  return { evidenceFile, evidenceFingerprint: evidence.fingerprint,
    leaf, path: pathUtility };
}

if (require.main === module) {
  const root = path.resolve(process.argv[2] || path.join(__dirname, "../../.."));
  process.stdout.write(`${JSON.stringify(generate(root), null, 2)}\n`);
}

module.exports = { generate };
