'use strict';
// Diagnostic policy candidate. Static exit distance is a tie-break, not a safety proof.
const {fastView}=require('./transition-ranking-diagnostic');
const {geometricEscape}=require('./bomb-event-diagnostic');
const PRIORITY=['escapeSuccessorProof','escapeSuccessorExposed','escapeSuccessorSlack','escapeSuccessorBranches','immediateFatalMass','committedChanceFatalMass','horizonFatalMass','unknownMass','earliestFatalFrame','escapeSlack'];
const DX=[0,1,0,-1],DY=[-1,0,1,0];
function choose({view,width,height,risk,rows,incumbent,mode}){
 const unchanged=reason=>({row:incumbent,reason,distances:[]});
 if(mode!==1||!risk.escapeSuccessorReady||incumbent<0||incumbent>=risk.count)return unchanged('MODE_OR_EVIDENCE');
 if(risk.escapeSuccessorProof[incumbent]!==2)return unchanged('PROOF');
 if(Object.values(view.tanks[0].effects).some(x=>x>0))return unchanged('OWN_EFFECT');
 if(view.bombs.length!==1||view.bombs[0].remaining<1||view.bombs[0].remaining>8)return unchanged('BOMB_SCOPE');
 const bomb=view.bombs[0],map=Array.from({length:width},(_,x)=>Array.from({length:height},(_,y)=>['.','x','m','o'][view.terrain[y*width+x]]));
 const blast=[bomb.position];for(let d=0;d<4;d++)for(let n=1;n<=2;n++){const x=bomb.position[0]+DX[d]*n,y=bomb.position[1]+DY[d]*n,t=map[x]?.[y];if(t===undefined||t==='x')break;blast.push([x,y]);if(t==='m')break;}
 const [x,y]=view.tanks[0].position;if(!blast.some(p=>p[0]===x&&p[1]===y))return unchanged('OUTSIDE_BLAST');
 const eligible=r=>r.row<risk.count&&r.eligible&&r.hard===0&&r.finalAllowed&&[1,2,3].includes(r.action)&&PRIORITY.every(k=>Number.isFinite(risk[k]?.[r.row])&&risk[k][r.row]===risk[k][incumbent]);
 if(!rows.some(r=>r.row===incumbent&&eligible(r)))return unchanged('INCUMBENT');
 const distances=rows.filter(eligible).map(r=>{
  const pose={x,y,direction:['up','right','down','left'].indexOf(view.tanks[0].direction)};
  if(r.action===1){const nx=x+DX[pose.direction],ny=y+DY[pose.direction],t=map[nx]?.[ny],enemy=view.tanks[1].position;if(t!==undefined&&t!=='x'&&t!=='m'&&!(nx===enemy?.[0]&&ny===enemy?.[1])){pose.x=nx;pose.y=ny;}}
  else pose.direction=(pose.direction+(r.action===2?3:1))%4;
  const route=geometricEscape(map,pose,blast,view.tanks[1].position);return {row:r.row,action:r.action,moves:route.moves===null?null:route.moves+1};
 });
 const old=distances.find(r=>r.row===incumbent);let best=old;
 for(const r of distances)if(r.moves!==null&&r.moves<=bomb.remaining+1&&(best.moves===null||r.moves<best.moves))best=r;
 return {row:best.row,reason:best.row===incumbent?'NO_PROGRESS_GAIN':'SHORTER_STATIC_EXIT',distances};
}
function propose(engine,controller,incumbent,mask,envelope){
 const state=engine.adapter.state,o=controller.outcome;
 const rows=Array.from(engine.ourActions).slice(0,o.count).map((action,row)=>({row,action,hard:engine.hardStatus[row],eligible:Boolean(engine.strategicArbiter.eligible(o,mask,envelope,row)),finalAllowed:Boolean(engine.finalGate.finalAllows(engine.adapter.bundle,engine.ourActions,engine.ourArguments,row,engine.ourCount))}));
 return choose({view:fastView(state),width:state.width,height:state.height,risk:o,rows,incumbent,mode:engine.lastControlMode});
}
module.exports={PRIORITY,choose,propose};
