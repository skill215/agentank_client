'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {SearchPhaseProfiler}=require('../../tools/agentank/diagnostics/search-phase-profiler');
test('nested exclusive costs partition elapsed and preserve receiver/result',()=>{
  let clock=0;const proto={inner(){clock+=3;return this.value;}};
  const object=Object.assign(Object.create(proto),{value:7,outer(){clock+=2;const result=this.inner();clock+=5;return result;}});
  const original=object.outer,p=new SearchPhaseProfiler(()=>clock);
  p.wrap(object,'outer','outer');p.wrap(object,'inner','inner');assert.equal(object.outer(),7);
  assert.deepEqual(p.rows.outer,{calls:1,inclusiveMs:10,selfMs:7});
  assert.deepEqual(p.rows.inner,{calls:1,inclusiveMs:3,selfMs:3});
  p.close();assert.equal(object.outer,original);assert.equal(Object.hasOwn(object,'inner'),false);
});
test('throws are preserved and stack/restoration remain valid',()=>{
  const error=Error('test'),object={run(){throw error;}},original=object.run;
  const p=new SearchPhaseProfiler();p.wrap(object,'run','run');
  assert.throws(()=>object.run(),e=>e===error);assert.equal(p.stack.length,0);assert.equal(p.rows.run.calls,1);
  p.close();assert.equal(object.run,original);
});
