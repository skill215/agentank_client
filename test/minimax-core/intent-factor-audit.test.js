'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {maximizers}=require('../../tools/agentank/diagnostics/intent-factor-audit');
test('factor comparison isolates early strategic intent from expectation preference',()=>{
 const rows=[{action:1,worst:-311,expected:-304,blend:-310,backed:-310,nominal:-310},
 {action:2,worst:-411,expected:-407,blend:-411,backed:-261,nominal:-261}];
 assert.deepEqual(maximizers(rows,'BLEND_INTENT'),[2]);assert.deepEqual(maximizers(rows,'WORST_INTENT'),[2]);
 assert.deepEqual(maximizers(rows,'BLEND_NO_INTENT'),[1]);assert.deepEqual(maximizers(rows,'WORST_LATE_INTENT'),[1]);
});
test('unresolved numeric ties remain explicit rather than fabricating a final action',()=>{
 const row={worst:1,expected:2,blend:1,backed:1,nominal:1};
 assert.deepEqual(maximizers([{...row,action:1},{...row,action:4}],'WORST_INTENT'),[1,4]);
 assert.throws(()=>maximizers([{...row,action:1}],'invalid'));
});
