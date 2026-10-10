'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {withClock}=require('../../tools/agentank/diagnostics/deterministic-v1-clock');
test('diagnostic clock is fixed inside VM, without changing host Date',()=>{const s=vm.createContext({}),host=Date;assert.equal(withClock(s,()=>vm.runInContext('Date.now()',s)),100000);assert.equal(Date,host);assert.ok(vm.runInContext('Date.now()',s)>100000);assert.equal(Object.hasOwn(s,'Date'),false);});
test('clock restores original property even when callback throws',()=>{const s={Date:'original'};assert.throws(()=>withClock(s,()=>{throw Error('FAIL');}),/FAIL/);assert.equal(s.Date,'original');});
