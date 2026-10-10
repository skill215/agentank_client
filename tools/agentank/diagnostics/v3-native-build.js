#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { defaultWorkspaceRoot } = require("../core/paths");
const { sha256Text, sha256Bytes, fingerprintObject } = require("../core/hash");
const { resolveFrozenV1 } = require("../../../engine-v3/src/legacy/default-source");
const { instrumentV1Source } = require("../../../engine-v3/src/legacy/v1-runtime");
const { V3_PORTS } = require("../../../engine-v3/src/contracts");

function wrapper(port) {
  const name = port.legacyName; const original = `nativeOriginal_${name}`;
  const parameters = port.arity === 2 ? "a,b" : port.arity === 3 ? "a,b,c" : "a,b,c,d";
  const forwarded = port.arity === 2 ? "a,b" : port.arity === 3 ? "a,b,c" : "a,b,c,d";
  return `  var ${original}=${name};\n` +
    `  nativeOriginals.${name}=${original};\n` +
    `  ${name}=function(${parameters}){return hooks.dispatch(${port.slot},${original},` +
    `${port.arity},${forwarded});};\n`;
}

function buildNativeV1Module(root = defaultWorkspaceRoot()) {
  const frozen = resolveFrozenV1(root); const instrumented = instrumentV1Source(frozen.source);
  const body = `"use strict";\n` +
    `function createNativeV1Runtime(hooks){\n` + instrumented + `\n` +
    `  var nativeOriginals=Object.create(null);\n` + V3_PORTS.map(wrapper).join("") +
    `  return {decide:onIdle,originals:nativeOriginals,functions:{clearLine:clearLine}};\n` +
    `}\nmodule.exports={createNativeV1Runtime:createNativeV1Runtime};\n`;
  const sourceSha256 = sha256Text(body); const directory = path.join(root, "artifacts",
    "v3-repair", "native");
  const moduleFile = path.join(directory, `native-v1-${sourceSha256.slice(0, 24)}.js`);
  fs.mkdirSync(directory, { recursive: true });
  if (!fs.existsSync(moduleFile)) fs.writeFileSync(moduleFile, body);
  else if (sha256Bytes(fs.readFileSync(moduleFile)) !== sourceSha256)
    throw new Error("V3_NATIVE_MODULE_DRIFT");
  const manifest = { schemaVersion: 1, objectKind: "V3_NATIVE_V1_MODULE_V1",
    frozenV1Sha256: frozen.sha256, moduleFile, sourceSha256, sourceBytes: Buffer.byteLength(body),
    vmDependency: false, factoryIsolatedState: true, fingerprint: "" };
  manifest.fingerprint = fingerprintObject(manifest);
  fs.writeFileSync(path.join(directory, "current.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (require.main === module) {
  const result = buildNativeV1Module();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

module.exports = { buildNativeV1Module };
