'use strict';
const assert = require('node:assert/strict');
const { ACTION } = require('../../../engine-v2/src/abi/fast-codes');
const key = r => `${r.mode || r.variant.mode}:${r.id || r.matchUrlId}:${r.seat ?? r.candidateSeat}`;
const stream = (r, side = 'candidate') => Buffer.from(r[side].compactActionStream, 'base64');
const score = r => r.analysisOutcome === 'V2_WIN' ? 1 : r.analysisOutcome === 'DRAW' ? .5 : 0;
const death = r => r.analysisOutcome === 'V1_WIN' && r.terminalCategory === 'SINGLE_CRASH';
function semantic(r) {
  return { id:r.matchUrlId, seat:r.candidateSeat, fingerprint:r.scenarioFingerprint, frames:r.frames,
    outcome:r.analysisOutcome, terminal:r.terminalCategory, counts:r.counts, reason:r.result.reason,
    candidate:r.candidate.compactActionStream, control:r.control.compactActionStream,
    args:[r.candidate.compactArguments,r.control.compactArguments] };
}
function firstDifference(a,b) {
  const x=stream(a),y=stream(b), args=r=>new Map(r.candidate.compactArguments.map(v=>[v[0],v.slice(1)]));
  const aa=args(a),bb=args(b);
  for(let i=0;i<Math.min(x.length,y.length);i++)
    if(x[i]!==y[i] || JSON.stringify(aa.get(i))!==JSON.stringify(bb.get(i))) return i;
  return null;
}
function allowedActions(root) {
  return [...new Set(root.candidates.filter(c=>c.hard===0 && c.finalAllowed &&
    c.action!==ACTION.NONE && c.action!==ACTION.CAST_TELEPORT).map(c=>c.action))].sort((a,b)=>a-b);
}
function jobKey(j) {return `${key(j)}:${j.frame}:${j.action}`;}
function createPlan(cells, original, baselines, replays) {
  const replay=new Map(replays.map(r=>[key(r),r])), old=new Map(original.map(r=>[key(r),r]));
  const base=new Map(baselines.map(r=>[`${r.matchUrlId}:${r.candidateSeat}`,r]));
  const rounds=[], branchJobs=new Map(), noopJobs=new Map();
  for(const [kind,offset] of [['restore-first',null],['oracle-first',null],['oracle-tail',2],['oracle-tail',5],['oracle-tail',9]]) {
    for(const mode of ['R15','R29']) {
      const cases=[];
      for(const c of cells.filter(c=>c.mode===mode)) {
        const r=replay.get(key(c)), source=old.get(key(c)), b=base.get(`${c.id}:${c.seat}`);
        assert.ok(r&&source&&b); assert.deepEqual(semantic(r),semantic(source));
        const regression=death(source)&&!death(b);
        if(kind==='oracle-tail'&&!regression)continue;
        const index=kind==='oracle-tail'?stream(r).length-1-offset:firstDifference(b,r);
        const root=index===null?null:r.roots[index];
        const entry={...c,regression,index,frame:root?.frame??null,selected:root?.selectedAction??null,
          reason:root?.reason??null,actions:[],status:'NO_ROOT'};
        if(root && index>=0) {
          assert.equal(root.frame,index,'FRAME_DECISION_INDEX_MISMATCH');
          const legal=allowedActions(root);entry.legal=legal;
          if(legal.includes(entry.selected)) {
            const j={...c,frame:root.frame,action:entry.selected};noopJobs.set(jobKey(j),j);
          }
          if(kind==='restore-first') {
            entry.wanted=stream(b)[index];
            entry.actions=legal.includes(entry.wanted)?[entry.wanted]:[];
            entry.status=entry.actions.length?'ELIGIBLE':'BASELINE_ACTION_BLOCKED';
          } else {entry.actions=legal;entry.status=legal.length?'ELIGIBLE':'NO_LEGAL_ACTION';}
          for(const action of entry.actions.filter(a=>a!==entry.selected)) {
            const j={...c,frame:root.frame,action};branchJobs.set(jobKey(j),j);
          }
        }
        cases.push(entry);
      }
      rounds.push({id:'R'+(71+rounds.length),mode,kind,offset,cases});
    }
  }
  return {rounds,noopJobs:[...noopJobs.values()],branchJobs:[...branchJobs.values()]};
}
function prefixMatches(a,b,index,wanted) {
  if(!Number.isInteger(index)||index<0)return false;
  for(const side of ['candidate','control']) {
    const x=stream(a,side),y=stream(b,side);
    if(x.length<=index||y.length<=index||!x.subarray(0,index).equals(y.subarray(0,index)))return false;
    if(side==='candidate'&&y[index]!==wanted)return false;
    const args=r=>r[side].compactArguments.filter(v=>v[0]<index);
    if(JSON.stringify(args(a))!==JSON.stringify(args(b)))return false;
  }
  return true;
}
module.exports={key,jobKey,stream,score,death,semantic,firstDifference,allowedActions,createPlan,prefixMatches};
