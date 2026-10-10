'use strict';
const {HARD_STATUS}=require('../../../engine-v2/src/abi/fast-codes');
const {PROOF_STATUS}=require('../../../engine-v2/src/abi/search-codes');
const {STRATEGY_PURPOSE:P}=require('../../../engine-v2/src/abi/policy-codes');
const COMBAT=P.DIRECT_KILL|P.ADVANTAGEOUS_FIRE|P.AIM_SETUP|P.INTERCEPT|P.ESCAPE_DENIAL|P.SHIELD_BREAK|P.ZONE_DENIAL|P.BELIEF_SWEEP|P.ATTACK_APPROACH;
const MASS=Object.freeze(['immediateFatalMass','horizonFatalMass','unknownMass','committedFatalMass']);
const navigation=a=>a>=1&&a<=3;
function eligible(e,row){const o=e.riskController.outcome;return row>=0&&row<o.count&&e.hardStatus[row]===HARD_STATUS.ALLOW&&o.acceptable[row]&&!o.dominated[row]&&navigation(e.ourActions[row])&&!(e.strategyBands.purpose[row]&COMBAT);}
function noRiskWorse(o,row,incumbent){for(const k of MASS)if(o[k]&&o[k][row]>o[k][incumbent])return false;return !o.escapeSlack||o.escapeSlack[row]>=o.escapeSlack[incumbent];}
function selectNavigationFamily(engine,consumer,count,incumbent){
 if(engine.lastControlMode!==3||engine.lastProofStatus===PROOF_STATUS.PROVEN||engine.lastSelectionWasStrictRescue||engine.lastSelectionWasVerifiedDirectKill||!eligible(engine,incumbent))return incumbent;
 if(!consumer.prepare(engine,count)||!consumer.known[incumbent])return incumbent;
 let best=incumbent;
 for(let row=0;row<count;row++)if(eligible(engine,row)&&consumer.known[row]&&noRiskWorse(engine.riskController.outcome,row,incumbent)&&consumer.progress[row]>consumer.progress[best])best=row;
 return best;
}
module.exports={selectNavigationFamily,noRiskWorse};
