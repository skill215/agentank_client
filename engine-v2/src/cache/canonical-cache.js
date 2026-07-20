"use strict";

const { CACHE_ID, CACHE_FLAG, CACHE_MISS, CACHE_DEPENDENCY } =
  require("../abi/cache-runtime-codes");
const { CACHE_CONFIG } = require("../generated/runtime-config");

class CanonicalCache {
  constructor(cacheId, entryCount, ways, enabled) {
    if (cacheId < 0 || cacheId >= CACHE_ID.COUNT || entryCount < ways ||
        entryCount % ways || (entryCount & (entryCount - 1)) || (ways !== 2 && ways !== 4))
      throw new RangeError("invalid canonical cache layout");
    this.cacheId = cacheId; this.entryCount = entryCount; this.ways = ways;
    this.bucketMask = entryCount / ways - 1; this.enabled = enabled ? 1 : 0;
    this.valid = new Uint8Array(entryCount); this.flags = new Uint8Array(entryCount);
    this.depth = new Uint8Array(entryCount); this.keyLo = new Uint32Array(entryCount);
    this.keyHi = new Uint32Array(entryCount); this.signatureLo = new Uint32Array(entryCount);
    this.signatureHi = new Uint32Array(entryCount); this.version = new Uint32Array(entryCount);
    this.generation = new Uint16Array(entryCount); this.dependencyMask = new Uint16Array(entryCount);
    this.dependencySignature = new Uint32Array(entryCount); this.value0 = new Int32Array(entryCount);
    this.value1 = new Int32Array(entryCount); this.value2 = new Uint32Array(entryCount);
    this.value3 = new Uint32Array(entryCount); this.currentGeneration = 1;
    this.probeCount = 0; this.hitCount = 0; this.writeCount = 0; this.replacementCount = 0;
    this.invalidationCount = 0; this.collisionCount = 0; this.staleCount = 0;
    this.hotAllocationCount = 0;
  }
  setEnabled(enabled) { this.enabled = enabled ? 1 : 0; }
  startGeneration() {
    this.currentGeneration = (this.currentGeneration + 1) & 0xffff;
    if (!this.currentGeneration) { this.valid.fill(0); this.currentGeneration = 1; }
    return this.currentGeneration;
  }
  bucketStart(keyLo) { return ((keyLo & this.bucketMask) * this.ways) >>> 0; }
  matches(slot, keyLo, keyHi, signatureLo, signatureHi, version, generation) {
    if (!this.valid[slot]) return 0;
    if (this.keyLo[slot] !== (keyLo >>> 0) || this.keyHi[slot] !== (keyHi >>> 0)) return 0;
    if (this.signatureLo[slot] !== (signatureLo >>> 0) ||
        this.signatureHi[slot] !== (signatureHi >>> 0)) { this.collisionCount += 1; return 0; }
    if (this.version[slot] !== (version >>> 0) || this.generation[slot] !== generation) {
      this.staleCount += 1; return 0;
    }
    return 1;
  }
  probe(keyLo, keyHi, signatureLo, signatureHi, version, generation = this.currentGeneration) {
    this.probeCount += 1; if (!this.enabled) return CACHE_MISS;
    const start = this.bucketStart(keyLo);
    for (let way = 0; way < this.ways; way += 1) { const slot = start + way;
      if (this.matches(slot, keyLo, keyHi, signatureLo, signatureHi, version, generation)) {
        this.hitCount += 1; return slot; } }
    return CACHE_MISS;
  }
  read(slot, out, offset = 0) {
    if (slot === CACHE_MISS || slot < 0 || slot >= this.entryCount || !this.valid[slot] ||
        offset + 4 > out.length) return 0;
    out[offset] = this.value0[slot]; out[offset + 1] = this.value1[slot];
    out[offset + 2] = this.value2[slot]; out[offset + 3] = this.value3[slot]; return 4;
  }
  replacementSlot(start, version, generation) {
    let candidate = CACHE_MISS; let candidateDepth = 0xff;
    for (let way = 0; way < this.ways; way += 1) { const slot = start + way;
      if (!this.valid[slot]) return slot;
      if (this.version[slot] !== (version >>> 0) || this.generation[slot] !== generation) return slot;
      if (!(this.flags[slot] & (CACHE_FLAG.PROTECTED | CACHE_FLAG.PINNED)) &&
          this.depth[slot] <= candidateDepth) { candidate = slot; candidateDepth = this.depth[slot]; }
    }
    return candidate;
  }
  write(keyLo, keyHi, signatureLo, signatureHi, version, generation, dependencyMask,
      dependencySignature, flags, depth, value0, value1, value2, value3) {
    if (!this.enabled) return CACHE_MISS; const start = this.bucketStart(keyLo); let slot = CACHE_MISS;
    for (let way = 0; way < this.ways; way += 1) { const at = start + way;
      if (this.matches(at, keyLo, keyHi, signatureLo, signatureHi, version, generation)) {
        slot = at; break; } }
    if (slot === CACHE_MISS) slot = this.replacementSlot(start, version, generation);
    if (slot === CACHE_MISS) return CACHE_MISS;
    if (this.valid[slot]) this.replacementCount += 1;
    this.valid[slot] = 1; this.keyLo[slot] = keyLo >>> 0; this.keyHi[slot] = keyHi >>> 0;
    this.signatureLo[slot] = signatureLo >>> 0; this.signatureHi[slot] = signatureHi >>> 0;
    this.version[slot] = version >>> 0; this.generation[slot] = generation;
    this.dependencyMask[slot] = dependencyMask; this.dependencySignature[slot] = dependencySignature >>> 0;
    this.flags[slot] = flags; this.depth[slot] = depth; this.value0[slot] = value0;
    this.value1[slot] = value1; this.value2[slot] = value2 >>> 0; this.value3[slot] = value3 >>> 0;
    this.writeCount += 1; return slot;
  }
  invalidateDependencies(dirtyMask, dependencySignature = null) {
    let count = 0;
    for (let slot = 0; slot < this.entryCount; slot += 1) if (this.valid[slot] &&
        (this.dependencyMask[slot] & dirtyMask) && (dependencySignature === null ||
        this.dependencySignature[slot] === (dependencySignature >>> 0))) {
      this.valid[slot] = 0; count += 1; }
    this.invalidationCount += count; return count;
  }
  invalidateEntity(entitySignature) {
    return this.invalidateDependencies(CACHE_DEPENDENCY.ENTITY, entitySignature >>> 0);
  }
  clear() { this.valid.fill(0); }
}

class CacheBank {
  constructor(options = {}) {
    this.caches = new Array(CACHE_ID.COUNT); this.generation = 1; this.hotAllocationCount = 0;
    for (let id = 0; id < CACHE_ID.COUNT; id += 1) this.caches[id] = new CanonicalCache(id,
      options.entryCount?.[id] || CACHE_CONFIG.ENTRY_COUNT[id],
      options.ways?.[id] || CACHE_CONFIG.WAYS[id],
      options.enabled?.[id] ?? CACHE_CONFIG.ENABLED[id]);
  }
  get(cacheId) { return cacheId >= 0 && cacheId < CACHE_ID.COUNT ? this.caches[cacheId] : null; }
  beginMatch() { this.generation = (this.generation + 1) & 0xffff; if (!this.generation) this.generation = 1;
    for (let id = 0; id < CACHE_ID.COUNT; id += 1) this.caches[id].startGeneration(); return this.generation; }
  setEnabled(cacheId, enabled) { const cache = this.get(cacheId); if (!cache) return 0;
    cache.setEnabled(enabled); return 1; }
  invalidate(dirtyMask, dependencySignature = null) { let count = 0;
    for (let id = 0; id < CACHE_ID.COUNT; id += 1)
      count += this.caches[id].invalidateDependencies(dirtyMask, dependencySignature); return count; }
  totalBytes() { let bytes = 0;
    for (let id = 0; id < CACHE_ID.COUNT; id += 1) { const cache = this.caches[id];
      for (const key of Object.keys(cache)) if (ArrayBuffer.isView(cache[key])) bytes += cache[key].byteLength; }
    return bytes;
  }
}

class FeatureCacheAdapter {
  constructor(cacheBank) { this.cache = cacheBank.get(CACHE_ID.FEATURE_CACHE);
    this.out = new Int32Array(4); this.hitCount = 0; this.computeCount = 0; this.hotAllocationCount = 0; }
  evaluate(evaluator, feature, input, stateLo, stateHi, actionKey, version, dependencyMask,
      dependencySignature) {
    const keyLo = (stateLo + actionKey * 257 + feature * 17) >>> 0;
    const keyHi = (stateHi ^ (actionKey * 65537) ^ feature) >>> 0;
    const signatureLo = (stateLo ^ actionKey ^ (feature << 16)) >>> 0;
    const signatureHi = (stateHi + actionKey + feature) >>> 0;
    const slot = this.cache.probe(keyLo, keyHi, signatureLo, signatureHi, version);
    if (slot !== CACHE_MISS) { this.hitCount += 1; return this.cache.value0[slot]; }
    const value = evaluator.evaluateFeature(feature, input); this.computeCount += 1;
    this.cache.write(keyLo, keyHi, signatureLo, signatureHi, version, this.cache.currentGeneration,
      dependencyMask, dependencySignature, CACHE_FLAG.COMPLETE, 0, value, 0, 0, 0); return value;
  }
}

module.exports = { CanonicalCache, CacheBank, FeatureCacheAdapter };
