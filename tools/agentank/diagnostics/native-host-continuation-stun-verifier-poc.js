"use strict";

// BP43 exact first-action intervention verifier.  The candidate root may use
// AttackPose for its first action, but both roots use the same host-shaped
// continuation afterwards.  Therefore a dominance certificate applies to the
// action that is actually emitted; it does not depend on committing a hidden
// AttackPose continuation plan in later callbacks.

const { NativeStunTurnDomainCompactionPoc } = require(
  "./native-stun-turn-domain-compaction-poc");

class NativeHostContinuationStunVerifierPoc extends
    NativeStunTurnDomainCompactionPoc {
  constructor(mode = "off", options = {}) {
    super(mode, options);
    this.candidatePolicyId = this.basePolicyId;
  }

  summary() {
    return { ...super.summary(),
      semantics: "HOST_CONTINUATION_FIRST_ACTION_STUN_VERIFIER",
      firstActionInterventionOnly: true,
      sharedHostContinuation: true,
      basePolicyId: this.basePolicyId,
      candidatePolicyId: this.candidatePolicyId };
  }
}

module.exports = { NativeHostContinuationStunVerifierPoc };
