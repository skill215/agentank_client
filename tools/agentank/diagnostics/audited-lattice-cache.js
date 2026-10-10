'use strict';
const {HazardKernel}=require('../../../engine-v2/src/fast/hazard');
// Experimental only. Version numbers are not terrain identities across undo branches.
class AuditedLatticeHazard extends HazardKernel {
  constructor(state,entries=4,verify=false){
    super(state,{reverseViabilityCacheEntries:16,reverseLatticeCacheEntries:entries,
      reverseLatticeLayerCache:false,hazardSignatureCache:true,reverseLatticeIncludesOwnProjectiles:true});
    this.verifiedQueries=0;this.oracle=verify?new HazardKernel(state,{hazardSignatureCache:false}):null;
  }
  reverseViable(seat=0){
    const actual=super.reverseViable(seat);
    if(this.oracle){
      const expected=this.oracle.reverseViable(seat);this.verifiedQueries++;
      if(actual!==expected||this.complete!==this.oracle.complete||
        this.narrowProofComplete!==this.oracle.narrowProofComplete||this.horizonTick!==this.oracle.horizonTick)
        throw Error(`LATTICE_ORACLE_DRIFT:${actual}:${expected}`);
    }
    return actual;
  }
  stats(){return {exactHits:this.reverseCacheHitCount,exactMisses:this.reverseCacheMissCount,
    latticeHits:this.reverseLatticeHitCount,latticeMisses:this.reverseLatticeMissCount,
    builds:this.reverseLatticeBuildCount,nodes:this.reverseLatticeBuildNodeCount,
    terrainInvalidations:this.terrainIdentityInvalidations,verifiedQueries:this.verifiedQueries,
    extraBytes:(this.reverseLatticeGrid?.byteLength||0)+
      (this.reverseLatticeValid?.byteLength||0)+(this.reverseLatticeHashLo?.byteLength||0)+(this.reverseLatticeHashHi?.byteLength||0)};}
}
function withLatticeCache(search,engine,entries,verify,execute){
  search.bindIsolatedHard(engine.adapter.bundle);
  const old=search.diagnosticHazard,oldHard=search.diagnosticHard.hazard;
  const hazard=new AuditedLatticeHazard(engine.adapter.state,entries,verify);
  search.diagnosticHazard=hazard;search.diagnosticHard.hazard=hazard;
  try{return {value:execute(),cache:hazard.stats()};}
  finally{search.diagnosticHazard=old;search.diagnosticHard.hazard=oldHard;}
}
module.exports={AuditedLatticeHazard,withLatticeCache};
