'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {summarizeRoots}=require('../../tools/agentank/diagnostics/navigation-combat-audit');
function root(frame,action,candidates=[],extra={}){return {frame,emittedAction:action,ownEnemyDistance:15,clearLineToEnemy:0,selected:0,proposal:-1,candidates,...extra};}
test('combat audit separates eligible FIRE from selected FIRE and model risk',()=>{
 const fire={row:0,action:4,hard:0,acceptable:1,dominated:0,immediate:0,horizon:1,unknown:0};
 const s=summarizeRoots([root(0,8,[fire]),root(1,2,[fire],{ownEnemyDistance:5}),root(2,4,[fire],{ownEnemyDistance:5,proposal:0})]);
 assert.equal(s.fireEligibleRoots,3);assert.equal(s.fireEligibleNotTaken,2);assert.equal(s.contactFireEligibleNotTaken,1);assert.equal(s.fireEmitted,1);assert.equal(s.fireWithModelRisk,1);assert.equal(s.firstGeometricContact,1);assert.equal(s.firstFire,2);assert.equal(s.firstStun,0);assert.equal(s.stunOutsideGeometricContact,1);assert.equal(s.searchProposalRoots,1);
});
test('combat audit excludes rejected and dominated FIRE; missing timestamps stay null',()=>{
 const s=summarizeRoots([root(3,1,[{action:4,hard:1,acceptable:1},{action:4,hard:0,acceptable:1,dominated:1}])]);assert.equal(s.fireEligibleRoots,0);assert.equal(s.firstFire,null);assert.equal(s.firstStun,null);assert.equal(s.firstGeometricContact,null);assert.equal(summarizeRoots([]).roots,0);
});
