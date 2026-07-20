# High-performance historical replay

Status: implemented, locally accepted, and exercised by the complete `initial-full` replay.

## Scope

This work changes only how immutable historical Replay Capsules are loaded and replayed. It does not
run a new V1/V2 arena, change V2 decision semantics, or weaken any safety assertion.

## Root cause removed

The legacy reader received a 64-character fingerprint but treated it as a fuzzy reference. Every
Capsule read rebuilt and filtered the complete Capsule file list. For 19,136 logical Capsules over
about 19,216 physical files, this implied roughly 367 million path checks through WSL on NTFS.

Full fingerprints now map directly to:

`replay-capsules/<first-two-hex>/<fingerprint>.json`

Cohort entries use their already persisted `relativePath`. Short interactive references retain the
old fuzzy lookup, but the regression path never uses it.

## Execution architecture

1. `compile-replay` reads and fingerprints every source Capsule exactly once.
2. Capsules are grouped by match id, source run, simulator identity, source hashes, assignment, and
   restore policy. Equal public match ids from different capture runs remain separate.
3. Every shorter action and decision trace must be an exact prefix of the selected authority trace.
4. Large window diagnostics and repeated scenario/trace objects are discarded from the runtime
   image. Only one authority prefix and the independent evaluation targets remain.
5. The compact corpus is stored as one gzip-compressed, content-addressed memory image with both
   compressed and raw SHA-256 values in its immutable manifest.
6. `capsule-all` verifies the manifest, both hashes, cohort fingerprint, Capsule root, and exact
   target denominator before executing any replay.
7. One simulator advances each compatible historical prefix once. Every target still receives an
   independent cold `ProductionRootEngine`, preserving the existing `OBSERVE_ONLY` fact-memory
   semantics.

The compiled image is a rebuildable performance cache, not a replacement evidence authority. The
source Capsules and cohort remain immutable truth.

## Initial-full result

- Source logical Capsules: 19,136.
- Public historical match/variant/repetition ids: 2,392.
- Source-isolated replay bundles: 2,403.
- Source bytes read during one-time compilation: 1,745,707,130.
- Legacy prefix frames: 701,151.
- Shared physical prefix frames: 213,644.
- Repeated physical frames removed: 487,507.
- Physical prefix reduction: 3.2818x.
- Compiled uncompressed image: 120,327,177 bytes.
- Compiled gzip image: 21,870,868 bytes.
- Warm compiled-image load plus compressed/raw hash verification: 1,911,427 microseconds.
- Compiled manifest fingerprint:
  `4ba6b18fc7bebaa8f76f15f9b52cc14bdc91835443df7df71897be2690084d71`.

The 32-match/256-Capsule differential benchmark produced zero result mismatches. The batched replay
portion took about 2.49 seconds after a 3.08-second raw source preload, versus 5.62 seconds for the
O(1)-lookup legacy replay. Persisting the compiled memory image removes that repeated raw preload
from later edit loops.

## Correctness constraints

The new path is accepted only when all of these remain identical to legacy replay:

- physical fingerprint;
- fact-memory fingerprint, including historical runtime state;
- observed-decision and verified-event counts;
- emitted command and returned action;
- Hard, risk dominance, strict Proof, root restore, and ObservationSafetyFrontier audits.

The complete structural suite passes 145/145 tests. The fixed `initial-full` replay subsequently
completed 19,136/19,136 Capsules in 149,436,225 internal microseconds and produced an `ACCEPTED`
report with zero invariant failures. The immutable report fingerprint is
`c9782bca3f4185ab24d65f5ca2a46facb11ef4a5eeeaba182c448a7100220088`.
