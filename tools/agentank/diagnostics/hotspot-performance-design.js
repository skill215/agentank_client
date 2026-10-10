'use strict';
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),assert=require('node:assert/strict');
const previous=require('./semantic-performance-design');
const MODES=['lazy-forward','lazy-parity'];
function replace(s,a,b){assert.equal(s.split(a).length,2,'PATCH_DRIFT');return s.replace(a,b);}
function transform(s,mode){
 if(mode==='baseline')return s;assert.ok(MODES.includes(mode));
 s=replace(s,'const forward = this.target(cell, direction);','const forward = viable ? NONE_CELL : this.target(cell, direction);');
 if(mode==='lazy-parity'){
  const start=s.indexOf('        for (let direction = 0; direction < 4; direction += 1) {\n          let viable = next[cell * 4 + direction];');assert.ok(start>0);
  const end=s.indexOf('\n      }\n      if (latticeIndex >= 0',start);assert.ok(end>start);
  const block=s.slice(start,end);
  s=s.slice(0,start)+`        if (tick & 1) {
          const pose = cell * 4;
          current[pose] = next[pose]; current[pose + 1] = next[pose + 1];
          current[pose + 2] = next[pose + 2]; current[pose + 3] = next[pose + 3];
        } else {
${block}
        }`+s.slice(end);
 }
 return s;
}
function compile(root){const file=path.join(root,'engine-v2/src/fast/hazard.js'),s=fs.readFileSync(file,'utf8'),methods={};
 for(const mode of ['baseline',...MODES]){const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(transform(s,mode),file);methods[mode]=m.exports.HazardKernel.prototype.reverseViable;}
 return methods;
}
function cloneHazard(h){const o=Object.create(Object.getPrototypeOf(h));for(const [k,v]of Object.entries(h))o[k]=ArrayBuffer.isView(v)?new v.constructor(v):v;return o;}
function verifyHazard(h,o){for(const key of Object.keys(o)){if(key==='state')continue;assert.deepEqual(h[key],o[key],'HAZARD_STATE_DRIFT:'+key);}}
module.exports={...previous,MODES,transform,compile,cloneHazard,verifyHazard};
