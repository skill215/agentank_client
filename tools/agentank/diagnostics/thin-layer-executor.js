'use strict';
const {FixedLayerScheduler}=require('./fixed-layer-scheduler');
const {SearchCommitSlab}=require('./search-commit-slab');
const {SearchTransactionWorkspace}=require('./search-transaction-workspace');
class ThinLayerExecutor {
 constructor(search,kernel,state){
  this.search=search;this.kernel=kernel;this.state=state;
  this.workspace=new SearchTransactionWorkspace(search,kernel,state);
  this.commit=new SearchCommitSlab(search);this.scheduler=new FixedLayerScheduler();
  this.result={complete:false,value:this.commit,evidence:null};
  this.evaluate=this.evaluateLayer.bind(this);this.schedule=this.getDepth.bind(this);
  this.cell=this.rootCell.bind(this);this.apply=this.applyFrame.bind(this);
  this.engine=null;this.count=0;this.eligibility=null;this.prepare=null;this.depth=0;this.active=0;
 }
 getDepth(){return this.depth;}
 rootCell(engine,row,column){this.search.perRootBudget=0x3fffffff;return this.originalCell.call(this.search,engine,row,column);}
 applyFrame(a,b,c,d,e,f){this.scheduler.consume();return this.originalApply.call(this.kernel,a,b,c,d,e,f);}
 evaluateLayer(depth){
  this.workspace.restoreSearch();this.depth=depth;
  try{const s=this.search,ok=this.prepare.call(s,this.engine,this.count,this.eligibility);
   this.result.complete=Boolean(ok&&!s.lastBudgetLeafCount&&!s.lastFastIncompleteCount&&!s.lastHardIncompleteCount&&!s.lastNoActionLeafCount&&!s.lastTopLeafCount);
   if(this.result.complete)this.commit.capture(s);return this.result;
  }finally{this.workspace.rollback();}
 }
 run(engine,count,eligibility,prepare,limit=4096,cap=3,admit=null){
  if(this.active)throw Error('EXECUTOR_REENTRY');
  if(engine.adapter.state!==this.state||this.search.diagnosticKernel!==this.kernel)throw Error('EXECUTOR_BINDING_DRIFT');
  const s=this.search;this.originalSchedule=s.scheduledDepth;this.originalCell=s.rootCell;this.originalApply=this.kernel.applyFrame;
  const maximum=Math.min(cap,this.originalSchedule.call(s,engine));
  this.engine=engine;this.count=count;this.eligibility=eligibility;this.prepare=prepare;
  this.workspace.begin();this.commit.valid=0;this.active=1;let finished=false;
  s.scheduledDepth=this.schedule;s.rootCell=this.cell;this.kernel.applyFrame=this.apply;
  try{this.scheduler.run(limit,maximum,this.evaluate,admit);
   if(this.scheduler.committed)this.commit.restore(s);else this.workspace.restoreSearch();finished=true;return this.scheduler;
  }finally{
   s.scheduledDepth=this.originalSchedule;s.rootCell=this.originalCell;this.kernel.applyFrame=this.originalApply;
   try{if(!finished){this.workspace.rollback();this.workspace.restoreSearch();}}
   finally{this.workspace.end();this.active=0;this.engine=null;this.prepare=null;this.eligibility=null;}
  }
 }
}
module.exports={ThinLayerExecutor};
