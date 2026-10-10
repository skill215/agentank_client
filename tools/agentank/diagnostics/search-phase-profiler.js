'use strict';
// Diagnostic only: inclusive and exclusive time must never be added together.
class SearchPhaseProfiler {
  constructor(clock=()=>performance.now()){this.clock=clock;this.stack=[];this.rows={};this.restore=[];}
  wrap(object,key,label){
    if(!object||typeof object[key]!=='function')throw Error(`MISSING_PROFILE_METHOD:${label}`);
    const original=object[key],own=Object.hasOwn(object,key),profiler=this;
    this.rows[label]={calls:0,inclusiveMs:0,selfMs:0};
    object[key]=function(...args){
      const frame={start:profiler.clock(),child:0};profiler.stack.push(frame);
      try{return original.apply(this,args);}finally{
        const elapsed=profiler.clock()-frame.start;profiler.stack.pop();
        const row=profiler.rows[label];row.calls++;row.inclusiveMs+=elapsed;row.selfMs+=elapsed-frame.child;
        const parent=profiler.stack.at(-1);if(parent)parent.child+=elapsed;
      }
    };
    this.restore.push(()=>{if(own)object[key]=original;else delete object[key];});
  }
  close(){for(const restore of this.restore.reverse())restore();this.restore.length=0;}
}
function profileSearch(search,engine,execute){
  search.bindIsolatedHard(engine.adapter.bundle);
  const p=new SearchPhaseProfiler(),hard=search.diagnosticHard;
  try{
    for(const [object,key,label] of [
      [search.diagnosticKernel,'applyFrame','transition'],[hard,'classifyApplied','hard'],
      [hard.hazard,'rebuild','hazardRebuild'],[hard.hazard,'reverseViable','reverseViability'],
      [search.leafEvaluator,'evaluate','leaf'],[search.leafEvaluator,'projectileThreat','projectileFeature'],
      [search.leafEvaluator,'bombPressure','bombFeature'],
      [search.pathUtility,'scoreTransition','pathBefore'],[search.pathUtility,'scoreAppliedTransition','pathAfter'],
      [engine.adapter.state,'undoTo','undo']])p.wrap(object,key,label);
    const start=performance.now(),value=execute();
    return {value,profile:{elapsedMs:performance.now()-start,phases:p.rows}};
  }finally{p.close();}
}
module.exports={SearchPhaseProfiler,profileSearch};
