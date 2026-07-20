"use strict";

const { invariant } = require("../core/errors");

function mix(value, input) { return Math.imul((value ^ (input >>> 0)) >>> 0, 16777619) >>> 0; }
function mixText(value, text) { let output = value; for (let i = 0; i < text.length; i += 1) output = mix(output, text.charCodeAt(i)); return output; }
function eventSeat(event, tankIds) {
  if (event.by === 0 || event.by === 1) return event.by;
  const object = event.objectId || event.sourceObjectId || event.tank?.id;
  if (object === tankIds[0]) return 0; if (object === tankIds[1]) return 1; return -1;
}

class DualTrackReplay {
  constructor(frameCount) {
    invariant(Number.isSafeInteger(frameCount) && frameCount >= 0, "TRACK_FRAME_COUNT_INVALID", "frame count");
    this.frameCount = frameCount; this.truthLo = new Uint32Array(frameCount); this.truthHi = new Uint32Array(frameCount);
    this.observedLo = [new Uint32Array(frameCount), new Uint32Array(frameCount)];
    this.observedHi = [new Uint32Array(frameCount), new Uint32Array(frameCount)];
    this.unknownMask = [new Uint16Array(frameCount), new Uint16Array(frameCount)];
    this.provenanceMask = [new Uint16Array(frameCount), new Uint16Array(frameCount)];
    this.publicInputCaptured = 0; this.hotAllocationCount = 0;
  }

  ingest(records, tankIds, publicInputCapture = null) {
    this.publicInputCaptured = publicInputCapture ? 1 : 0;
    let truthLo = 2166136261; let truthHi = 0x9e3779b9; const observedLo = [2166136261, 2166136261];
    const observedHi = [0x9e3779b9, 0x9e3779b9];
    for (let frame = 0; frame < this.frameCount; frame += 1) {
      for (const event of records[frame] || []) {
        const encoded = JSON.stringify(event); truthLo = mixText(truthLo, encoded); truthHi = mix(truthHi, truthLo ^ frame);
        const seat = eventSeat(event, tankIds); const globallyVisible = event.type === "star" || event.type === "game" ||
          event.type === "map" || event.type === "bullet" || event.type === "bomb";
        for (let side = 0; side < 2; side += 1) {
          const captured = publicInputCapture?.[side]?.[frame];
          if (captured !== undefined) { observedLo[side] = mixText(observedLo[side], JSON.stringify(captured));
            observedHi[side] = mix(observedHi[side], observedLo[side] ^ frame); this.provenanceMask[side][frame] |= 1; }
          else if (seat === side || globallyVisible) { observedLo[side] = mixText(observedLo[side], encoded);
            observedHi[side] = mix(observedHi[side], observedLo[side] ^ frame); this.provenanceMask[side][frame] |= 2; }
          else this.unknownMask[side][frame] |= 1;
        }
      }
      this.truthLo[frame] = truthLo; this.truthHi[frame] = truthHi;
      for (let side = 0; side < 2; side += 1) { this.observedLo[side][frame] = observedLo[side];
        this.observedHi[side][frame] = observedHi[side]; }
    }
    return this;
  }

  observation(side, frame) {
    invariant(side === 0 || side === 1, "TRACK_SIDE_INVALID", "side");
    invariant(frame >= 0 && frame < this.frameCount, "TRACK_FRAME_INVALID", "frame");
    return Object.freeze({ trackKind: "OBSERVED", side, frame, signatureLo: this.observedLo[side][frame],
      signatureHi: this.observedHi[side][frame], unknownMask: this.unknownMask[side][frame],
      provenanceMask: this.provenanceMask[side][frame] });
  }

  truth(frame) { return { trackKind: "TRUTH", signatureLo: this.truthLo[frame], signatureHi: this.truthHi[frame] }; }
  bytes() { return this.truthLo.byteLength + this.truthHi.byteLength + this.observedLo.reduce((n, x) => n + x.byteLength, 0) +
    this.observedHi.reduce((n, x) => n + x.byteLength, 0) + this.unknownMask.reduce((n, x) => n + x.byteLength, 0) +
    this.provenanceMask.reduce((n, x) => n + x.byteLength, 0); }
}

function policyAction(observation, actionCount = 5) {
  invariant(observation && observation.trackKind === "OBSERVED" &&
    observation.signatureLo !== undefined && observation.signatureHi !== undefined,
    "POLICY_OBSERVATION_REQUIRED", "policy cannot receive TruthTrack");
  return ((observation.signatureLo ^ observation.signatureHi ^ observation.unknownMask) >>> 0) % actionCount;
}

function divergence(baseline, candidate, frame) {
  const changed = baseline.signatureLo !== candidate.signatureLo || baseline.signatureHi !== candidate.signatureHi;
  return { divergent: changed, divergenceFrame: changed ? frame : null,
    historicalSuffixConsumedFrames: 0 };
}

module.exports = { DualTrackReplay, policyAction, divergence, eventSeat };
