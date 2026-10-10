'use strict';
const assert=require('node:assert/strict');
const {ARRAY:A,SCALAR:S}=require('../../../engine-v2/src/state/fast-state');
const {fastView}=require('./transition-ranking-diagnostic');
const FIELDS=['immediateFatalMass','committedChanceFatalMass','horizonFatalMass','unknownMass','earliestFatalFrame','escapeSlack'];
// Static pose distances, not a safety certificate. Turns consume one frame.
function distances(state){
 const a=state.arrays,target=a[A.SCALAR][S.STAR_CELL],n=state.cells,dist=new Int16Array(n*4).fill(-1);
 if(target>=n)return dist;
 const enemy=a[A.TANK_CELL][1],walk=c=>c>=0&&c<n&&c!==enemy&&a[A.TERRAIN][c]!==1&&a[A.TERRAIN][c]!==2;
 if(!walk(target))return dist;
 const q=[];for(let d=0;d<4;d++){dist[target*4+d]=0;q.push(target*4+d);}
 for(let head=0;head<q.length;head++){const p=q[head],c=p>>2,d=p%4,x=state.x(c),y=state.y(c),px=x-[0,1,0,-1][d],py=y-[-1,0,1,0][d],back=px>=0&&py>=0&&px<state.width&&py<state.height?state.cell(px,py):-1;
  const prev=[c*4+(d+1)%4,c*4+(d+3)%4];if(walk(back))prev.push(back*4+d);
  for(const v of prev)if(dist[v]<0){dist[v]=dist[p]+1;q.push(v);}
 }return dist;
}
function trace(engine){
 const e=engine,s=e.adapter.state,a=s.arrays,o=e.riskController.outcome,view=fastView(s),route=distances(s),rows=[];
 for(let row=0;row<o.count;row++){const p=e.projectedCell[row]*4+e.projectedDirection[row];rows.push({row,action:e.ourActions[row],hard:e.hardStatus[row],allowed:Boolean(e.finalGate.finalAllows(e.adapter.bundle,e.ourActions,e.ourArguments,row,e.ourCount)),acceptable:o.acceptable[row],dominated:o.dominated[row],cell:e.projectedCell[row],direction:e.projectedDirection[row],route:route[p]>=0?route[p]+1:null,robust:o.robustLower[row],expected:o.expectedValue[row],tactical:e.tacticalValue[row],...Object.fromEntries(FIELDS.map(k=>[k,o[k][row]]))});}
 const chosen=rows.find(r=>r.row===e.lastSelectedRow),eligible=chosen&&[1,2,3].includes(chosen.action)?rows.filter(r=>[1,2,3].includes(r.action)&&r.hard===0&&r.allowed&&r.acceptable&&!r.dominated&&r.route!==null&&FIELDS.every(k=>r[k]===chosen[k])):[];
 const best=eligible.reduce((b,r)=>!b||r.route<b.route?r:b,null);
 return {frame:a[A.SCALAR][S.FRAME],mode:e.lastControlMode,strategy:e.strategyId,selected:e.lastSelectedRow,incumbent:e.lastIncumbentRow,proposal:e.lastProposalRow,own:view.tanks[0],star:view.star,enemyVisible:Boolean(e.adapter.enemyVisible),rows,staticProgressOpportunity:!!(e.lastControlMode===3&&chosen&&best&&!Object.values(view.tanks[0].effects).some(x=>x>0)&&(chosen.route===null||best.route<chosen.route)),bestRouteRow:best?.row??null};
}
async function runJob(job,ctx){const arena=require('./native-base-policy-standalone-arena'),Bot=arena.NativeBasePolicyDiagnosticBot,decide=Bot.prototype.decide,frames=[];Bot.prototype.decide=function(c){const r=decide.call(this,c);frames.push(trace(this.engine));return r;};const r=await require('./fresh-game-escape-adapter').runJob({...job,enabled:false},ctx);const baseline=JSON.parse(ctx.readFrozen(job.previousFile));assert.equal(r.signature,baseline.signature,'TRACE_REPLAY_DRIFT');return {...r,starTrace:frames};}
module.exports={FIELDS,distances,trace,runJob};
