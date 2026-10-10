'use strict';
const assert=require('node:assert/strict');
const previous=require('./focused-extension-design');
const SPECS=Object.freeze({baseline:{track:'reference'},R29:{track:'reference'},
 'uniform-reverse':{track:'mechanism-control',hypothesis:'At depth one, reversing root reply order should preserve complete game behavior.'},
 'weight-order':{track:'quality',hypothesis:'Allocate existing shared search work to the most likely opponent replies first; reuse existing opponent weights without changing scores or budget.'},
 'uniform-depth':{track:'quality',hypothesis:'Compare all root replies at one complete ply, removing uneven depth caused by budget exhaustion.'},
 'R29-weight-order':{track:'quality',hypothesis:'Only after weight-order has positive means in both environments and sufficient support, test adding the old path repair.'}});
function reorder(search,engine,audit){const seq=search.rootColumnSequence,n=engine.enemyCount,state=engine.adapter.state;
 const weight=c=>search.rootEnemyDomainMask[c]?search.opponentWeight(engine,state,engine.enemyActions[c]):-1;
 for(let i=1;i<n;i++){const c=seq[i],w=weight(c);let j=i;while(j>0&&weight(seq[j-1])<w){seq[j]=seq[j-1];j--;audit.orderMoves++;}seq[j]=c;}
}
function compile(root){const base=require('./continuous-improvement-design').compile(root);
 return {install(engine,mode,bot,audit,shadow){assert.ok(SPECS[mode]);base.install(engine,mode==='R29'||mode==='R29-weight-order'?'R29':'baseline',bot,audit,shadow);const s=engine.basePolicy.policySearch;
  if(mode==='uniform-depth'||mode==='uniform-reverse')s.scheduledDepth=()=>1;
  if(mode.includes('weight-order')||mode==='uniform-reverse'){const build=s.buildRootColumnSequence.bind(s);s.buildRootColumnSequence=function(e){const n=build(e);audit.orderRoots++;
   if(mode==='uniform-reverse'){for(let i=0,j=n-1;i<j;i++,j--){const x=s.rootColumnSequence[i];s.rootColumnSequence[i]=s.rootColumnSequence[j];s.rootColumnSequence[j]=x;}}
   else reorder(s,e,audit);return n;};}
 }};
}
function chooseNext(batch,active,pool,retired,seen,rank,qualified,frozen=null,supports={}){
 if(batch>=7)return previous.chooseNext(batch,active,pool,retired,seen,rank,qualified,frozen,supports);
 const eligible=m=>(supports[m]?.maps||0)>=24&&(supports[m]?.batches||0)>=2,next=active.filter(m=>!retired.includes(m));
 if(next.length<2&&next.includes('weight-order')&&eligible('weight-order')&&pool['weight-order']?.worstMean>0&&!seen.includes('R29-weight-order'))next.push('R29-weight-order');
 return {active:next,frozen:null,phase:next.length?'DISCOVERY':'REFERENCE_AUDIT',action:!next.length?'PIVOT_TO_REFERENCE_MODEL_AUDIT':active.some(m=>retired.includes(m))?'RETIRE_AND_REALLOCATE':active.some(m=>!eligible(m))?'BUILD_MINIMUM_SUPPORT':'RETAIN_AND_REPLICATE'};
}
function verifyControl(rows){const ref=new Map(rows.filter(r=>r.job.mode==='uniform-reverse').map(r=>[previous.key(r),r]));let checked=0;
 for(const r of rows.filter(r=>r.job.mode==='uniform-depth')){assert.ok(ref.has(previous.key(r)));assert.equal(previous.signature(r),previous.signature(ref.get(previous.key(r))),'SHALLOW_ORDER_INVARIANCE_FAILED');checked++;}return checked;
}
module.exports={...previous,SPECS,compile,reorder,chooseNext,verifyControl};
