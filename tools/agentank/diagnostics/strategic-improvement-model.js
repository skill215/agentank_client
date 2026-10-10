'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ARRAY, SCALAR } = require('../../../engine-v2/src/state/fast-state');
const { NONE_FRAME, ACTION } = require('../../../engine-v2/src/abi/fast-codes');
const hash = x => crypto.createHash('sha256').update(Buffer.isBuffer(x)?x:String(x)).digest('hex');
const score = r => r.analysisOutcome === 'V2_WIN' ? 1 : r.analysisOutcome === 'DRAW' ? .5 : 0;
const clip = (x, n = 1) => Math.max(-n, Math.min(n, x));

// Only current observable policy state enters features. No map ID, seed, suffix,
// opponent hidden state, final outcome, or simulator random draws are available.
function snapshot(engine, baselineAction) {
  const a = engine.adapter.state.arrays, frame = a[ARRAY.SCALAR][SCALAR.FRAME];
  const risk = engine.riskController.outcome, owner = engine.basePolicy.owner;
  const search = engine.basePolicy.policySearch, rows = [];
  for (let row = 0; row < engine.ourCount; row++) {
    const action = engine.ourActions[row];
    const allowed = engine.hardStatus[row] === 0 && owner.allowedRow[row] === 1 &&
      action !== ACTION.NONE && action !== ACTION.CAST_TELEPORT &&
      engine.finalGate.finalAllows(engine.adapter.bundle, engine.ourActions,
        engine.ourArguments, row, engine.ourCount);
    rows.push({ row, action, allowed, value: owner.backedValue[row],
      horizon: risk.horizonFatalMass[row], immediate: risk.immediateFatalMass[row],
      future: risk.futureFireFatalMass[row] || 0,
      possible: risk.possibleProjectileFatalMass[row] || 0,
      committed: risk.committedFatalMass[row] || 0 });
  }
  return { frame, baselineAction, stars: a[ARRAY.TANK_STARS][0] - a[ARRAY.TANK_STARS][1],
    ownStunned: a[ARRAY.TANK_STUN_UNTIL][0] !== NONE_FRAME && a[ARRAY.TANK_STUN_UNTIL][0] > frame,
    enemyStunned: a[ARRAY.TANK_STUN_UNTIL][1] !== NONE_FRAME && a[ARRAY.TANK_STUN_UNTIL][1] > frame,
    turnStreak: engine.turnStreak, distance: engine.manhattan(a[ARRAY.TANK_CELL][0], a[ARRAY.TANK_CELL][1]),
    searchDepth: search.currentDepth, rows };
}
function alternatives(s) {
  const base = s.rows.find(r => r.action === s.baselineAction && r.allowed);
  if (!base) return [];
  const rows = s.rows.filter(r => r.allowed && r.action !== base.action);
  // Two fixed proposal families: strongest search alternative and lowest
  // future-fire alternative. This same short list is used offline and online.
  const byValue = rows.slice().sort((a,b) => b.value-a.value || a.action-b.action);
  const byRisk = rows.slice().sort((a,b) => a.future-b.future || b.value-a.value || a.action-b.action);
  return [...new Map([byValue[0],byRisk[0]].filter(Boolean).map(r => [r.action,r])).values()];
}
function features(s, alt) {
  const b = s.rows.find(r => r.action === s.baselineAction);
  const dFuture = clip((b.future-alt.future)/10000), dValue = clip((alt.value-b.value)/25000);
  const x = [1,dValue,dFuture,clip((b.horizon-alt.horizon)/10000),clip((b.immediate-alt.immediate)/10000),
    clip(s.stars/3)*dFuture,Number(s.ownStunned)*dFuture,Number(s.enemyStunned)*dFuture,
    s.frame/128*dValue,clip(s.turnStreak/4)*(Number(alt.action===1)-Number(b.action===1))];
  for (const action of [1,2,3,4,5,8]) x.push(Number(alt.action===action)-Number(b.action===action));
  return x;
}
function solve(a,b) {
  const n=b.length, m=a.map((r,i)=>[...r,b[i]]);
  for(let j=0;j<n;j++) {
    let p=j; for(let i=j+1;i<n;i++) if(Math.abs(m[i][j])>Math.abs(m[p][j])) p=i;
    [m[j],m[p]]=[m[p],m[j]]; assert.ok(Math.abs(m[j][j])>1e-12,'SINGULAR_FIT');
    const t=m[j][j]; for(let k=j;k<=n;k++) m[j][k]/=t;
    for(let i=0;i<n;i++) if(i!==j) {const f=m[i][j];for(let k=j;k<=n;k++)m[i][k]-=f*m[j][k];}
  }
  return m.map(r=>r[n]);
}
function fit(examples) {
  assert.ok(examples.length); const n=examples[0].x.length;
  const a=Array.from({length:n},(_,i)=>Array.from({length:n},(_,j)=>i===j?1:0)),b=Array(n).fill(0);
  for(const e of examples) for(let i=0;i<n;i++) {b[i]+=e.x[i]*e.delta;for(let j=0;j<n;j++)a[i][j]+=e.x[i]*e.x[j];}
  return {kind:'RIDGE_PAIRED_ADVANTAGE',lambda:1,weights:solve(a,b),examples:examples.length,
    maps:new Set(examples.map(e=>e.map)).size,
    min:Array.from({length:n},(_,i)=>Math.min(...examples.map(e=>e.x[i]))),
    max:Array.from({length:n},(_,i)=>Math.max(...examples.map(e=>e.x[i]))),acceptedBins:[]};
}
function predict(model,x) {return model.weights.reduce((s,w,i)=>s+w*x[i],0);}
function supported(model,x) {return model.maps>=24 && x.every((v,i)=>v>=model.min[i]-.05 && v<=model.max[i]+.05);}
function bin(p) {return p>=.25?'high':p>=.05?'medium':'low';}
function choose(s,model,gated=true) {
  const rows=alternatives(s).map(r=>({row:r,x:features(s,r)}));
  const options=rows.map(o=>({...o,p:predict(model,o.x)})).filter(o=>o.p>=.05 && (!gated ||
    supported(model,o.x) && model.acceptedBins.includes(bin(o.p))));
  options.sort((a,b)=>b.p-a.p || a.row.action-b.row.action);
  return options[0] || null;
}
// Resample maps, preserving all their seats/suffix replicates. Descriptive CI;
// not a per-state safety certificate or a platform generalization guarantee.
function interval(records,tail=.025,reps=2000) {
  const groups=new Map(); for(const r of records){const g=groups.get(r.map)||[];g.push(r.delta);groups.set(r.map,g);}
  const arrays=[...groups.values()]; if(!arrays.length)return {n:0,maps:0,mean:0,lo:0,hi:0};
  let state=399120;const rnd=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const means=[];for(let k=0;k<reps;k++){let sum=0,n=0;for(let i=0;i<arrays.length;i++){const a=arrays[Math.floor(rnd()*arrays.length)];for(const d of a){sum+=d;n++;}}means.push(sum/n);}
  means.sort((a,b)=>a-b);
  return {n:records.length,maps:arrays.length,mean:records.reduce((s,r)=>s+r.delta,0)/records.length,
    lo:means[Math.floor(reps*tail)],hi:means[Math.min(reps-1,Math.floor(reps*(1-tail)))]};
}
function calibrate(model,rootRecords) {
  const result={};
  for(const name of ['medium','high']) {
    const selected=[];
    for(const r of rootRecords){const c=choose(r.snapshot,model,false);if(!c || bin(c.p)!==name || !supported(model,c.x))continue;
      const label=r.labels.find(l=>l.action===c.row.action);assert.ok(label);
      selected.push({map:r.map,delta:label.delta,deathDelta:label.deathDelta});}
    const ci=interval(selected,.0125); // two predeclared bins, Bonferroni tails
    const deaths=selected.reduce((s,r)=>s+r.deathDelta,0);
    const accepted=ci.maps>=8 && ci.lo>.01 && deaths<=0;
    result[name]={...ci,deathDelta:deaths,accepted};
  }
  model.acceptedBins=Object.keys(result).filter(k=>result[k].accepted);
  model.calibration=result;return model;
}
function alignedSearchSource(source) {
  const from='if ("v1-deterministic" === "v1-deterministic" && ownChance > 1) {';
  assert.equal(source.split(from).length,2);source=source.replace(from,'if (false && ownChance > 1) {');
  const begin=source.indexOf('terminalUtility(engine, terminal, depth, pathScore, top = 0) {');
  const end=source.indexOf('\npairedLeaf(',begin);assert.ok(begin>0&&end>begin);
  return source.slice(0,begin)+`terminalUtility(engine, terminal, depth, pathScore, top = 0) {
    return terminal === TERMINAL.WIN0 ? 100000 : terminal === TERMINAL.WIN1 ? -100000 : terminal === TERMINAL.DRAW ? 0 : this.leaf(engine, pathScore, top);
  }
`+source.slice(end);
}
module.exports={hash,score,snapshot,alternatives,features,fit,predict,supported,bin,choose,interval,calibrate,alignedSearchSource};
