'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),Module=require('node:module');
const {hash}=require('./strategic-improvement-model');
const {signature}=require('./continuous-improvement-design');
const MODES=['bulk-terrain','direct-bfs'];
function replace(s,a,b){assert.equal(s.split(a).length,2,'PATCH_DRIFT');return s.replace(a,b);}
function transform(s,mode){
 if(mode==='baseline')return s;
 if(mode==='bulk-terrain'){
  s=replace(s,'for (let cell = 0; cell < state.cells; cell += 1)\n        this.rootTerrain[cell] = terrain[cell];','this.rootTerrain.set(terrain.subarray(0, state.cells));');
  return replace(s,'for (let cell = 0; cell < state.cells; cell += 1)\n      this.starCacheTerrain[base + cell] = terrain[cell];','this.starCacheTerrain.set(terrain.subarray(0, state.cells), base);');
 }
 assert.equal(mode,'direct-bfs');
 s=replace(s,'let head = 0; let tail = 1; this.cellQueue[0] = star;','const geometryReady = this.geometryWidth === state.width && this.geometryHeight === state.height;\n    const terrain = state.arrays[ARRAY.TERRAIN];\n    let head = 0; let tail = 1; this.cellQueue[0] = star;');
 return replace(s,'const next = this.target(state, cell, direction);\n        if (next === NONE_CELL || distance[base + next] ||\n            !this.walkable(state, next, NONE_CELL)) continue;',
 'const next = geometryReady && cell !== NONE_CELL ? this.neighbor[cell * 4 + direction] : this.target(state, cell, direction);\n        if (next === NONE_CELL || distance[base + next] || terrain[next] === TERRAIN.WALL || terrain[next] === TERRAIN.DIRT) continue;');
}
function compile(root){const file=path.join(root,'engine-v2/src/base-policy-specialized/policy-leaf.js'),src=fs.readFileSync(file,'utf8'),classes={};
 for(const mode of ['baseline',...MODES]){const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(transform(src,mode),file);classes[mode]=m.exports.NativeBasePolicyLeafEvaluator;}
 return classes;
}
function quantile(xs,q){const a=xs.slice().sort((a,b)=>a-b);return a[Math.floor((a.length-1)*q)];}
function stats(values){assert.ok(values.length);const logs=values.map(Math.log),mean=xs=>xs.reduce((n,x)=>n+x,0)/xs.length;let seed=405621;
 const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;},boot=[];
 for(let n=0;n<2000;n++){let sum=0;for(let i=0;i<logs.length;i++)sum+=logs[Math.floor(rand()*logs.length)];boot.push(Math.exp(sum/logs.length));}
 return {n:values.length,ratio:Math.exp(mean(logs)),median:quantile(values,.5),lo:quantile(boot,.025),hi:quantile(boot,.975),p95:quantile(values,.95)};
}
function choose(batch,active,evidence){
 const retired=batch===2||batch===4?active.filter(m=>batch===2?evidence[m].lo>1.05:evidence[m].ratio>=.99&&evidence[m].lo>.95):[];
 let next=active.filter(m=>!retired.includes(m));
 if(batch===7&&next.length)next=[next.sort((a,b)=>evidence[a].ratio-evidence[b].ratio)[0]];
 return {active:next,retired,decision:batch===7?(next.length?'FREEZE_BEST_FOR_CONFIRMATION':'FREEZE_REFERENCE_NOISE_AUDIT'):retired.length?'RETIRE_NO_PRACTICAL_GAIN':next.length?'RETAIN_AND_MEASURE':'REFERENCE_NOISE_AUDIT'};
}
function qualify(rows,mode){const selected=rows.filter(r=>r.ratios[mode]!==undefined),s=stats(selected.map(r=>r.ratios[mode]));
 const groups={};for(const field of ['env','origin'])for(const key of new Set(selected.map(r=>r[field])))groups[field+':'+key]=stats(selected.filter(r=>r[field]===key).map(r=>r.ratios[mode]));
 return {stats:s,groups,qualified:selected.length===30&&s.ratio<=.95&&s.hi<1&&s.p95<=1.10&&Object.values(groups).every(g=>g.n>=6&&g.ratio<1)};
}
module.exports={MODES,transform,compile,stats,choose,qualify,hash,signature};
