'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {crashOutcome}=require('../../tools/agentank/diagnostics/terminal-risk-semantics-audit');
const {RiskAcceptanceController}=require('../../engine-v2/src/search/risk-acceptance-controller');
const {NativeBasePolicySearch}=require('../../engine-v2/src/base-policy-specialized/policy-search');
const {ARRAY}=require('../../engine-v2/src/state/fast-state');
test('terminal audit distinguishes own death from losing a mutual crash',()=>{assert.equal(crashOutcome(1,1,2,1),'WIN');assert.equal(crashOutcome(1,1,1,1),'DRAW');assert.equal(crashOutcome(1,1,0,1),'LOSS');assert.equal(crashOutcome(1,0,2,1),'LOSS');});
test('characterization: generic fatal backup cannot preserve known winning death utility',()=>{const r=new RiskAcceptanceController();assert.ok(r.binaryFatalBackup(10000,9375,1000)<0);});
test('characterization: specialized search values leading mutual crash positively but equal trade negatively',()=>{const arrays=[];arrays[ARRAY.TANK_CRASH]=[1,1];arrays[ARRAY.TANK_STARS]=[2,1];const s=Object.create(NativeBasePolicySearch.prototype),e={adapter:{state:{arrays}}};assert.equal(s.terminalUtility(e,0,1,0),100000);arrays[ARRAY.TANK_STARS]=[1,1];assert.equal(s.terminalUtility(e,0,1,0),-60000);});
