"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ComponentRegistry } = require("./component-registry");
const { V3_SLOT, V3_COMPONENT_MODE } = require("./contracts");
const { V2BridgeKernel } = require("./v2-bridge-kernel");
const { V2FramePrepareAdapter, V2ActionEmitAdapter } =
  require("./adapters/v2-bridge-components");
const { V3FinalProposalArbiter } = require("./adapters/v2-hard-final");
const { NativeV1Runtime } = require("./legacy/native-v1-runtime");

function currentManifest(root) {
  const file = path.join(root, "artifacts", "v3-repair", "native", "current.json");
  if (!fs.existsSync(file)) throw new Error("V3_NATIVE_MODULE_NOT_BUILT");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// The first native root deliberately contains only the accepted BEST: shared
// observation/projectile state plus the complete Physical Hard final arbiter.
// Negative/neutral behavior components remain outside the execution path.
class NativeHierarchicalRoot {
  constructor(options = {}) {
    const root = options.workspaceRoot || path.resolve(__dirname, "../..");
    const manifest = options.nativeManifest || currentManifest(root);
    this.registry = new ComponentRegistry();
    this.bridge = new V2BridgeKernel(options.bridgeOptions || {});
    this.registry.replace(V3_SLOT.FRAME_PREPARE, new V2FramePrepareAdapter(this.bridge));
    this.registry.replace(V3_SLOT.FINAL_ACTION_GATE,
      new V3FinalProposalArbiter(this.bridge, V3_COMPONENT_MODE.ACTIVE));
    this.registry.replace(V3_SLOT.ACTION_EMIT, new V2ActionEmitAdapter(this.bridge));
    this.runtime = new NativeV1Runtime({ moduleFile: manifest.moduleFile,
      sourceIdentity: manifest.sourceSha256, registry: this.registry });
    this.source = { sha256: manifest.sourceSha256, sourceFile: manifest.moduleFile,
      frozenV1Sha256: manifest.frozenV1Sha256 };
  }

  decide(me, enemy, game) { return this.runtime.decide(me, enemy, game); }

  summary() {
    return { sourceSha256: this.source.sha256, frozenV1Sha256: this.source.frozenV1Sha256,
      decisions: this.runtime.decisions, native: true, vmDependency: false,
      replacementMask: this.registry.replacementMask, ports: this.registry.describe(),
      bridge: this.bridge.summary() };
  }
}

module.exports = { currentManifest, NativeHierarchicalRoot };
