'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {attribution}=require('../../tools/agentank/diagnostics/worst-intent-intervention');
test('single-step classification distinguishes reproduced, retained and third outcomes',()=>{
 assert.equal(attribution('V2_WIN','V1_WIN','V1_WIN'),'REPRODUCED_OUTCOME');
 assert.equal(attribution('V2_WIN','V1_WIN','V2_WIN'),'BASELINE_OUTCOME_RETAINED');
 assert.equal(attribution('V2_WIN','V1_WIN','DRAW'),'THIRD_OUTCOME');
 assert.equal(attribution('V1_WIN','V2_WIN','V1_WIN'),'BASELINE_OUTCOME_RETAINED');
});
