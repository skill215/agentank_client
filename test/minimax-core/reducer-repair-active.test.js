'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {firstDifference,compact}=require('../../tools/agentank/diagnostics/reducer-repair-active');
const b=v=>Buffer.from(v).toString('base64');
test('paired action comparison distinguishes common prefix from later off-trajectory roots',()=>{
 assert.equal(firstDifference(b([1,2,3]),b([1,2,3])),-1);
 assert.equal(firstDifference(b([1,2,3]),b([1,4,3])),1);
 assert.equal(firstDifference(b([1,2]),b([1,2,3])),2);
});
test('active report strips full root and control traces while retaining compact streams',()=>{
 const m={candidateEngine:{rootFrames:[{}],rootRestoreFailures:0},control:{actionFrames:[{}],compactActionStream:'AQ=='}};
 const c=compact(m);assert.equal(c.candidateEngine.rootFrames,undefined);assert.equal(c.control.actionFrames,undefined);
 assert.equal(c.control.compactActionStream,'AQ==');assert.equal(m.candidateEngine.rootFrames.length,1);
});
