'use strict';

// Shadow-only dependency checker. It grants no production/Proof authority.
// A finite stress report is deliberately not an invariance certificate.
const REASON=Object.freeze({STATE_MISMATCH:1,HARD_NOT_ALLOWED:2,
  RESPONSE_INCOMPLETE:4,NOT_ALL_TERMINAL_WIN:8,UNSUPPORTED_GAP:16,
  UNSEEN_PROJECTILE_UNPROVED:32,RULE_SCOPE_UNVERIFIED:64,
  STAR_MARGIN_UNPROVED:128});
const POSSIBLE_ENEMY_PROJECTILE=8192;
const HASH=/^[0-9a-f]{64}$/;
function validIdentity(a){return !!a&&Number.isSafeInteger(a.frame)&&a.frame>=0&&
  Number.isSafeInteger(a.hashLo)&&a.hashLo>=0&&a.hashLo<=0xffffffff&&
  Number.isSafeInteger(a.hashHi)&&a.hashHi>=0&&a.hashHi<=0xffffffff&&
  a.action===4&&typeof a.ruleHash==='string'&&HASH.test(a.ruleHash);}
function sameIdentity(a,b){return validIdentity(a)&&validIdentity(b)&&a.frame===b.frame&&a.hashLo===b.hashLo&&
  a.hashHi===b.hashHi&&a.action===b.action&&a.ruleHash===b.ruleHash&&
  typeof a.ruleHash==='string'&&a.ruleHash.length===64;}
function boundCertificate(c,kind,identity){return !!c&&c.kind===kind&&c.status==='VERIFIED'&&
  c.evidenceClass==='RULE_DERIVATION'&&sameIdentity(c.identity,identity)&&
  typeof c.derivationRef==='string'&&c.derivationRef.length>0;}
class TerminalDependencyContract {
  constructor(){this.reasonMask=0;this.status='INCOMPLETE';this.ignoredGapMask=0;}
  evaluate(evidence,current){
    let reasons=0;const id=evidence.identity;
    if(!sameIdentity(id,current))reasons|=REASON.STATE_MISMATCH;
    if(evidence.hardAllowed!==true)reasons|=REASON.HARD_NOT_ALLOWED;
    if(!Number.isSafeInteger(evidence.expected)||evidence.expected<=0||
      evidence.seen!==evidence.expected||evidence.unresolved!==0||
      !Number.isSafeInteger(evidence.wins)||evidence.wins<0||
      !Number.isSafeInteger(evidence.losses)||evidence.losses<0||
      !Number.isSafeInteger(evidence.draws)||evidence.draws<0||
      evidence.wins+evidence.losses+evidence.draws!==evidence.seen||
      evidence.domainComplete!==true)reasons|=REASON.RESPONSE_INCOMPLETE;
    if(evidence.wins!==evidence.expected||evidence.losses!==0||evidence.draws!==0)
      reasons|=REASON.NOT_ALL_TERMINAL_WIN;
    const gap=evidence.gapMask;
    if(!Number.isSafeInteger(gap)||gap<0||(gap&~POSSIBLE_ENEMY_PROJECTILE)!==0)
      reasons|=REASON.UNSUPPORTED_GAP;
    const rules=boundCertificate(evidence.ruleCertificate,'TERMINAL_PHASE_SCOPE',id);
    if(!rules)reasons|=REASON.RULE_SCOPE_UNVERIFIED;
    const irrelevant=boundCertificate(evidence.projectileCertificate,'ENEMY_DEATH_PRESERVED',id);
    if(gap&POSSIBLE_ENEMY_PROJECTILE){if(!irrelevant)reasons|=REASON.UNSEEN_PROJECTILE_UNPROVED;}
    if(!boundCertificate(evidence.starCertificate,'POSITIVE_TERMINAL_STAR_MARGIN',id))
      reasons|=REASON.STAR_MARGIN_UNPROVED;
    this.reasonMask=reasons;this.status=reasons?'INCOMPLETE':'SHADOW_DEPENDENCIES_SATISFIED';
    this.ignoredGapMask=!reasons?(gap&POSSIBLE_ENEMY_PROJECTILE):0;
    return this.status;
  }
}
module.exports={REASON,TerminalDependencyContract,sameIdentity};
