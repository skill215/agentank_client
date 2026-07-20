"use strict";

const { CACHE_ID, CACHE_FLAG, CACHE_MISS } =
  require("../abi/cache-runtime-codes");
const { CACHE_CONFIG } = require("../generated/runtime-config");
const { PathDistanceField } = require("./path-distance-field");

// Production-only cache layout. Diagnostic counters and FeatureCacheAdapter
// are deliberately absent so probes and writes pay only semantic work.
class ProductionCanonicalCache {
  constructor(cacheId) {
    const entryCount = CACHE_CONFIG.ENTRY_COUNT[cacheId]; const ways = CACHE_CONFIG.WAYS[cacheId];
    this.entryCount = entryCount; this.ways = ways; this.bucketMask = entryCount / ways - 1;
    this.enabled = CACHE_CONFIG.ENABLED[cacheId]; this.valid = new Uint8Array(entryCount);
    this.flags = new Uint8Array(entryCount); this.depth = new Uint8Array(entryCount);
    this.keyLo = new Uint32Array(entryCount); this.keyHi = new Uint32Array(entryCount);
    this.signatureLo = new Uint32Array(entryCount); this.signatureHi = new Uint32Array(entryCount);
    this.version = new Uint32Array(entryCount); this.generation = new Uint16Array(entryCount);
    this.dependencyMask = new Uint16Array(entryCount); this.dependencySignature = new Uint32Array(entryCount);
    this.value0 = new Int32Array(entryCount); this.value1 = new Int32Array(entryCount);
    this.value2 = new Uint32Array(entryCount); this.value3 = new Uint32Array(entryCount);
    this.currentGeneration = 1; this.byteSize = this.valid.byteLength + this.flags.byteLength +
      this.depth.byteLength + this.keyLo.byteLength + this.keyHi.byteLength +
      this.signatureLo.byteLength + this.signatureHi.byteLength + this.version.byteLength +
      this.generation.byteLength + this.dependencyMask.byteLength + this.dependencySignature.byteLength +
      this.value0.byteLength + this.value1.byteLength + this.value2.byteLength + this.value3.byteLength;
  }
  setEnabled(enabled) { this.enabled = enabled ? 1 : 0; }
  startGeneration() { this.currentGeneration = (this.currentGeneration + 1) & 0xffff;
    if (!this.currentGeneration) { this.valid.fill(0); this.currentGeneration = 1; }
    return this.currentGeneration; }
  bucketStart(keyLo) { return ((keyLo & this.bucketMask) * this.ways) >>> 0; }
  matches(slot, keyLo, keyHi, signatureLo, signatureHi, version, generation) {
    return this.valid[slot] && this.keyLo[slot] === (keyLo >>> 0) &&
      this.keyHi[slot] === (keyHi >>> 0) && this.signatureLo[slot] === (signatureLo >>> 0) &&
      this.signatureHi[slot] === (signatureHi >>> 0) && this.version[slot] === (version >>> 0) &&
      this.generation[slot] === generation ? 1 : 0;
  }
  probe(keyLo, keyHi, signatureLo, signatureHi, version, generation = this.currentGeneration) {
    if (!this.enabled) return CACHE_MISS; const start = this.bucketStart(keyLo);
    for (let way = 0; way < this.ways; way += 1) { const slot = start + way;
      if (this.matches(slot, keyLo, keyHi, signatureLo, signatureHi, version, generation)) return slot; }
    return CACHE_MISS;
  }
  replacementSlot(start, version, generation) {
    let candidate = CACHE_MISS; let depth = 0xff;
    for (let way = 0; way < this.ways; way += 1) { const slot = start + way;
      if (!this.valid[slot] || this.version[slot] !== (version >>> 0) ||
          this.generation[slot] !== generation) return slot;
      if (!(this.flags[slot] & (CACHE_FLAG.PROTECTED | CACHE_FLAG.PINNED)) &&
          this.depth[slot] <= depth) { candidate = slot; depth = this.depth[slot]; } }
    return candidate;
  }
  write(keyLo, keyHi, signatureLo, signatureHi, version, generation, dependencyMask,
      dependencySignature, flags, depth, value0, value1, value2, value3) {
    if (!this.enabled) return CACHE_MISS; const start = this.bucketStart(keyLo); let slot = CACHE_MISS;
    for (let way = 0; way < this.ways; way += 1) { const at = start + way;
      if (this.matches(at, keyLo, keyHi, signatureLo, signatureHi, version, generation)) { slot = at; break; } }
    if (slot === CACHE_MISS) slot = this.replacementSlot(start, version, generation);
    if (slot === CACHE_MISS) return CACHE_MISS; this.valid[slot] = 1;
    this.keyLo[slot] = keyLo >>> 0; this.keyHi[slot] = keyHi >>> 0;
    this.signatureLo[slot] = signatureLo >>> 0; this.signatureHi[slot] = signatureHi >>> 0;
    this.version[slot] = version >>> 0; this.generation[slot] = generation;
    this.dependencyMask[slot] = dependencyMask; this.dependencySignature[slot] = dependencySignature >>> 0;
    this.flags[slot] = flags; this.depth[slot] = depth; this.value0[slot] = value0;
    this.value1[slot] = value1; this.value2[slot] = value2 >>> 0; this.value3[slot] = value3 >>> 0;
    return slot;
  }
  invalidateDependencies(dirtyMask, dependencySignature = null) { let count = 0;
    for (let slot = 0; slot < this.entryCount; slot += 1) if (this.valid[slot] &&
        (this.dependencyMask[slot] & dirtyMask) && (dependencySignature === null ||
        this.dependencySignature[slot] === (dependencySignature >>> 0))) {
      this.valid[slot] = 0; count += 1; }
    return count;
  }
}

class ProductionCacheBank {
  constructor() { this.caches = new Array(CACHE_ID.COUNT); this.generation = 1; this.byteSize = 0;
    for (let id = 0; id < CACHE_ID.COUNT; id += 1) { const cache = new ProductionCanonicalCache(id);
      this.caches[id] = cache; this.byteSize += cache.byteSize; }
    this.pathField = new PathDistanceField(); this.byteSize += this.pathField.byteSize; }
  get(cacheId) { return cacheId >= 0 && cacheId < CACHE_ID.COUNT ? this.caches[cacheId] : null; }
  beginMatch() { this.generation = (this.generation + 1) & 0xffff; if (!this.generation) this.generation = 1;
    for (let id = 0; id < CACHE_ID.COUNT; id += 1) this.caches[id].startGeneration();
    this.pathField.reset(); return this.generation; }
  setEnabled(cacheId, enabled) { const cache = this.get(cacheId); if (!cache) return 0;
    cache.setEnabled(enabled); return 1; }
  invalidate(dirtyMask, dependencySignature = null) { let count = 0;
    for (let id = 0; id < CACHE_ID.COUNT; id += 1)
      count += this.caches[id].invalidateDependencies(dirtyMask, dependencySignature);
    if (dirtyMask & CACHE_DEPENDENCY.TERRAIN) this.pathField.invalidate(); return count; }
  totalBytes() { return this.byteSize; }
}

module.exports = { ProductionCanonicalCache, ProductionCacheBank };
