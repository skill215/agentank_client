"use strict";
const {ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
// Experimental, root-local cache for projectileThreat only. Exact dependency
// comparison after slot selection; a state hash is never an identity proof.
class ProjectileFeatureCache {
  constructor(state,capacity=64) {
    this.capacity=capacity;this.cells=state.cells;
    this.fields=[ARRAY.TANK_CELL,ARRAY.TANK_DIR,ARRAY.TANK_BOOST_UNTIL,
      ARRAY.PROJECTILE_ACTIVE,ARRAY.PROJECTILE_OWNER,ARRAY.PROJECTILE_CELL,ARRAY.PROJECTILE_DIR];
    this.stride=4+this.fields.reduce((n,k)=>n+state.arrays[k].length,0);
    this.keys=new Uint32Array(capacity*this.stride);
    this.terrain=new Uint8Array(capacity*this.cells);this.valid=new Uint8Array(capacity);
    this.values=new Int32Array(capacity);this.scratch=new Uint32Array(this.stride);
    this.calls=0;this.hits=0;this.misses=0;
  }
  evaluate(state,owner,compute,receiver,verify=false) {
    if(state.cells!==this.cells)throw Error('CACHE_GEOMETRY_CHANGED');
    this.calls++;
    let p=0;const key=this.scratch,a=state.arrays;
    key[p++]=state.width;key[p++]=state.height;key[p++]=owner;key[p++]=a[ARRAY.SCALAR][SCALAR.FRAME];
    for(let f=0;f<this.fields.length;f++){const values=a[this.fields[f]];
      for(let i=0;i<values.length;i++)key[p++]=values[i];}
    const slot=((state.hashLo^state.hashHi^owner)>>>0)%this.capacity;
    const offset=slot*this.stride,terrainOffset=slot*this.cells;
    let same=this.valid[slot]!==0;
    for(let i=0;same&&i<this.stride;i++)if(this.keys[offset+i]!==key[i])same=false;
    const terrain=a[ARRAY.TERRAIN];
    for(let i=0;same&&i<this.cells;i++)if(this.terrain[terrainOffset+i]!==terrain[i])same=false;
    if(same){this.hits++;const value=this.values[slot];
      if(verify&&compute.call(receiver,state,owner)!==value)throw Error('CACHE_VALUE_MISMATCH');
      return value;}
    this.misses++;const value=compute.call(receiver,state,owner);
    this.keys.set(key,offset);
    for(let i=0;i<this.cells;i++)this.terrain[terrainOffset+i]=terrain[i];
    this.values[slot]=value;this.valid[slot]=1;return value;
  }
  bytes(){return this.keys.byteLength+this.terrain.byteLength+this.valid.byteLength+this.values.byteLength+this.scratch.byteLength;}
}
module.exports={ProjectileFeatureCache};
