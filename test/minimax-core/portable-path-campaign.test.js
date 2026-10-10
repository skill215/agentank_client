'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {port,MODULE}=require('../../tools/agentank/build/portable-path-candidates');
const {select,transformScenario}=require('../../tools/agentank/diagnostics/portable-path-campaign');
const {install}=require('../../tools/agentank/diagnostics/path-component-variants');
const {ACTION}=require('../../engine-v2/src/abi/fast-codes');
const root=path.resolve(__dirname,'../..'),file=path.join(root,MODULE),source=fs.readFileSync(file,'utf8');
function utility(mode){const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(port(source,mode),file);return new m.exports.NativeBasePolicyPathUtility();}
test('independent source ports match frozen diagnostic definitions across actions, signed odd values and turn history',()=>{
  for(const [mode,reference] of [['R15','reference-half'],['R29','turn-streak-extra-zero']]){
    const native=utility(mode),wrapped=utility('baseline');install({basePolicy:{policySearch:{pathUtility:wrapped}}},reference);
    for(const value of [-24001,-401,-1,0,1,401,24001]){
      for(const u of [native,wrapped]){u.fireTransitionUtility=()=>value;u.goEdgeUtility=()=>value;u.bombPlacementUtility=()=>value;}
      for(const action of Object.values(ACTION))for(const previous of [ACTION.GO,ACTION.TURN_LEFT,ACTION.TURN_RIGHT])for(const streak of [0,1,2,3,9])for(const top of [1,2,3]){
        assert.equal(native.scoreTransition({},action,ACTION.GO,previous,streak,top),wrapped.scoreTransition({},action,ACTION.GO,previous,streak,top));
        assert.equal(native.scoreAppliedTransition({},action,ACTION.GO,0,0xffffffff),wrapped.scoreAppliedTransition({},action,ACTION.GO,0,0xffffffff));
      }
    }
  }
});
test('source port rejects drift rather than silently applying a partial intervention',()=>{
  assert.throws(()=>port(source.replace('if (next === 2) score -= 60','if (next === 2) score -= 61'),'R29'),/DRIFT/);
  assert.throws(()=>port(source.replace('return score;','return 3;'),'R15'),/DRIFT/);
  assert.throws(()=>port(source,'unknown'));assert.equal(port(source,'baseline'),source);
});
const scene={schemaVersion:1,matchUrlId:'test',map:[['a','b'],['c','d'],['e','f']],starts:[{position:[0,0],direction:'up'},{position:[2,1],direction:'right'}],stars:[{frame:0,position:[1,0]},{frame:7,position:[2,1]}],fingerprint:'old'};
test('rotation transforms rectangular coordinates, directions and stars consistently and is invertible',()=>{
  const r=transformScenario(scene,'rotate90');assert.deepEqual(r.map,[['b','d','f'],['a','c','e']]);
  assert.deepEqual(r.starts[0],{position:[1,0],direction:'right'});assert.deepEqual(r.stars[1].position,[0,2]);
  let back=scene;for(let n=0;n<4;n++)back=transformScenario(back,'rotate90');
  for(const field of ['map','starts','stars'])assert.deepEqual(back[field],scene[field]);assert.equal(scene.fingerprint,'old');
});
test('mirror reverses horizontal heading and is invertible; star acceleration preserves initial and ordered events',()=>{
  const a=transformScenario(scene,'mirror-x'),b=transformScenario(a,'mirror-x');
  for(const field of ['map','starts','stars'])assert.deepEqual(b[field],scene[field]);
  assert.equal(a.starts[1].direction,'left');const early=transformScenario(scene,'star-early');
  assert.deepEqual(early.stars.map(t=>t.frame),[0,3]);assert.deepEqual(early.map,scene.map);
  assert.notEqual(early.fingerprint,scene.fingerprint);assert.equal(early.parentFingerprint,scene.fingerprint);
});
test('cohorts are deterministic, group duplicate maps, and fail on undersized populations',()=>{
  const scenes=Array.from({length:10},(_,i)=>({...scene,matchUrlId:String(i),map:[[Math.floor(i/2)]]}));
  const a=select(scenes,'test',4);assert.deepEqual(a,select(scenes.slice().reverse(),'test',4));
  assert.equal(new Set(a.map(s=>JSON.stringify(s.map))).size,4);assert.throws(()=>select(scenes,'test',6),/UNDERFLOW/);
});
