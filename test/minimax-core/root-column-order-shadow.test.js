'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {reorder}=require('../../tools/agentank/diagnostics/root-column-order-shadow');
test('column permutations preserve domain and leave source order untouched',()=>{const a=[2,0,3,1];assert.deepEqual(reorder(a,'IDENTITY'),a);assert.deepEqual(reorder(a,'REVERSE'),[1,3,0,2]);assert.deepEqual(reorder(a,'ROTATE'),[0,3,1,2]);assert.deepEqual(a,[2,0,3,1]);assert.throws(()=>reorder(a,'bad'));});
