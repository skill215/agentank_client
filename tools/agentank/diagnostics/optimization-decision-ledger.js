'use strict';
// Tuning-governance records, never in-game action decisions.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const decisions=['retain','improve','reject','rollback','defer','accept'];
const causes=['NONE','INTEGRITY','EXECUTION','SAFETY','NO_TRIGGER','NO_EFFECT','REGRESSION','INSUFFICIENT_DATA','COST','MODEL_SCOPE'];
const nonempty=x=>typeof x==='string'&&x.trim().length>0;
function evidence(items,root){assert.ok(Array.isArray(items)&&items.length,'EVIDENCE_REQUIRED');for(const e of items){assert.match(e.sha256,/^[a-f0-9]{64}$/);assert.equal(hash(fs.readFileSync(path.resolve(root,e.path))),e.sha256,'EVIDENCE_DRIFT:'+e.path);}}
function validate(record,prior,root){
 assert.equal(record.version,1);assert.match(record.id,/^OPT-D-\d{4}$/);assert.ok(nonempty(record.at)&&Number.isFinite(Date.parse(record.at)),'TIMESTAMP');
 const registered=prior.find(e=>e.record.type==='register'&&e.record.id===record.id);
 if(record.type==='register'){
  assert.ok(!registered,'DUPLICATE_DECISION');assert.match(record.process,/^OPT-P-\d{3}$/);
  for(const k of ['title','hypothesis','scope','baseline','falsifier','nextStep'])assert.ok(nonempty(record[k]),k);
  assert.ok(['process','algorithm'].includes(record.category));assert.ok(['prospective','retrospective'].includes(record.registration));
  assert.ok(record.parent===null||prior.some(e=>e.record.id===record.parent),'UNKNOWN_PARENT');
  assert.ok(Array.isArray(record.alternatives)&&record.alternatives.length>=2,'ALTERNATIVES');
  for(const a of record.alternatives)for(const k of ['name','benefit','risk','reason'])assert.ok(nonempty(a[k]),'ALTERNATIVE_'+k);
  assert.ok(Array.isArray(record.criteria)&&record.criteria.length,'CRITERIA');
  for(const c of record.criteria){for(const k of ['id','metric','rule','unit'])assert.ok(nonempty(c[k]),'CRITERION_'+k);assert.ok(['hard','soft'].includes(c.kind));}
  assert.ok(new Set(record.criteria.map(c=>c.id)).size===record.criteria.length,'DUPLICATE_CRITERION');
  for(const k of ['games','seconds'])assert.ok(Number.isFinite(record.budget[k])&&record.budget[k]>=0,'BUDGET');
 }else{
  assert.equal(record.type,'review');assert.ok(registered,'UNREGISTERED_DECISION');assert.match(record.reviewId,/^OPT-R-\d{4}$/);
  assert.ok(!prior.some(e=>e.record.reviewId===record.reviewId),'DUPLICATE_REVIEW');assert.ok(decisions.includes(record.disposition));
  assert.ok(['process','local','independent','runtime','release'].includes(record.stage));assert.ok(causes.includes(record.primaryCause));
  assert.ok(Array.isArray(record.secondaryCauses)&&record.secondaryCauses.every(c=>causes.includes(c)));
  for(const k of ['reason','nextStep','limitations'])assert.ok(nonempty(record[k]),k);
  assert.ok(['passed','failed','inconclusive','not_run'].includes(record.outcome));
  assert.ok(Array.isArray(record.experiments));assert.ok(Array.isArray(record.assessments));
  for(const a of record.assessments){assert.ok(registered.record.criteria.some(c=>c.id===a.criterion),'UNKNOWN_CRITERION');assert.ok(['pass','fail','unknown'].includes(a.status));assert.ok(nonempty(a.evidencePath));}
  assert.ok(new Set(record.assessments.map(a=>a.criterion)).size===record.assessments.length,'DUPLICATE_ASSESSMENT');
  for(const k of ['attemptedGames','completedGames','independentUnits'])assert.ok(Number.isSafeInteger(record.cost[k])&&record.cost[k]>=0,'COST');
  assert.ok(record.cost.completedGames<=record.cost.attemptedGames);
  for(const k of ['executionSeconds','analysisSeconds'])assert.ok(record.cost[k]===null||Number.isFinite(record.cost[k])&&record.cost[k]>=0,'TIME_COST');
  assert.ok(Array.isArray(record.metrics));for(const m of record.metrics){assert.ok(nonempty(m.name)&&nonempty(m.unit)&&nonempty(m.source));assert.ok(m.value===null||Number.isFinite(m.value));}
  assert.equal(typeof record.productionAdoption,'boolean');
  if(record.disposition==='accept'){
   const checked=new Map(record.assessments.map(a=>[a.criterion,a.status]));
   assert.ok(registered.record.criteria.every(c=>checked.get(c.id)==='pass'),'ACCEPTANCE_CRITERIA_INCOMPLETE');
   assert.equal(record.outcome,'passed');
   if(registered.record.category==='algorithm')assert.equal(record.stage,'release','LOCAL_IS_NOT_ACCEPTANCE');
  }
  if(record.productionAdoption)assert.ok(record.disposition==='accept'&&record.stage==='release','INVALID_ADOPTION');
 }
 evidence(record.evidence,root);
}
function load(dir,root=process.cwd()){
 if(!fs.existsSync(dir))return[];
 const files=fs.readdirSync(dir).filter(f=>/^\d{6}\.json$/.test(f)).sort(),events=[];
 for(const f of files){const e=JSON.parse(fs.readFileSync(path.join(dir,f)));const {sha256,...body}=e;assert.equal(e.seq,events.length+1,'EVENT_SEQUENCE');assert.equal(e.previous,events.at(-1)?.sha256??null,'EVENT_CHAIN');assert.equal(hash(JSON.stringify(body)),sha256,'EVENT_HASH');validate(e.record,events,root);events.push(e);}return events;
}
function append(dir,record,root=process.cwd()){
 fs.mkdirSync(dir,{recursive:true});const lock=path.join(dir,'.lock'),fd=fs.openSync(lock,'wx');
 try{const events=load(dir,root);validate(record,events,root);const body={seq:events.length+1,previous:events.at(-1)?.sha256??null,record};const e={...body,sha256:hash(JSON.stringify(body))};
 const file=path.join(dir,String(e.seq).padStart(6,'0')+'.json'),tmp=file+'.tmp';const out=fs.openSync(tmp,'wx');try{fs.writeFileSync(out,JSON.stringify(e,null,2)+'\n');fs.fsyncSync(out);}finally{fs.closeSync(out);}fs.linkSync(tmp,file);fs.unlinkSync(tmp);return e;
 }finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
const rate=(numerator,denominator)=>({numerator,denominator,value:denominator?numerator/denominator:null});
function report(events){
 const regs=events.filter(e=>e.record.type==='register').map(e=>e.record),reviews=events.filter(e=>e.record.type==='review').map(e=>e.record);
 const latest=regs.map(r=>({decision:r,review:reviews.filter(x=>x.id===r.id).at(-1)||null}));
 const groups={};for(const p of [...new Set(regs.map(r=>r.process))])for(const category of ['process','algorithm']){
  const rows=latest.filter(x=>x.decision.process===p&&x.decision.category===category),assessed=rows.filter(x=>['passed','failed'].includes(x.review?.outcome)&&!['INTEGRITY','EXECUTION'].includes(x.review.primaryCause));
  const alg=category==='algorithm',qualified=rows.filter(x=>x.review&&['independent','runtime','release'].includes(x.review.stage)&&['passed','failed'].includes(x.review.outcome)&&!['INTEGRITY','EXECUTION'].includes(x.review.primaryCause));
  const reasons={};for(const x of rows)if(x.review&&x.review.primaryCause!=='NONE')reasons[x.review.primaryCause]=(reasons[x.review.primaryCause]||0)+1;
  groups[p+':'+category]={registered:rows.length,pending:rows.filter(x=>!x.review).length,stageSuccess:rate(assessed.filter(x=>x.review.outcome==='passed').length,assessed.length),optimizationSuccess:alg?rate(qualified.filter(x=>x.review.outcome==='passed').length,qualified.length):null,acceptance:rate(rows.filter(x=>x.review?.disposition==='accept').length,rows.filter(x=>x.review).length),failureReasons:reasons,feasibility:rate(rows.filter(x=>{const h=x.decision.criteria.filter(c=>c.kind==='hard');return h.length&&h.every(c=>x.review?.assessments.some(a=>a.criterion===c.id&&a.status==='pass'));}).length,rows.filter(x=>{const h=x.decision.criteria.filter(c=>c.kind==='hard');return h.length&&h.every(c=>x.review?.assessments.some(a=>a.criterion===c.id&&a.status!=='unknown'));}).length),unresolved:rows.filter(x=>x.review&&['inconclusive','not_run'].includes(x.review.outcome)).length};
 }
 // Latest costs per exact experiment group; overlapping groups must not be summed.
 const costs=new Map();for(const r of reviews){const key=r.experiments.slice().sort().join('|');if(key)costs.set(key,r.cost);}
 return {version:1,scope:'Registered tuning decisions only; historical completeness is not implied. Stage success is not population improvement.',groups,decisions:latest.map(x=>({id:x.decision.id,title:x.decision.title,category:x.decision.category,disposition:x.review?.disposition??'pending',stage:x.review?.stage??null,outcome:x.review?.outcome??'not_run'})),costAggregation:'Exact experiment groups deduplicated; groups may overlap. Do not sum without per-run reconciliation.',costs:[...costs].map(([experiments,cost])=>({experiments,cost})),ratePolicy:'Zero denominators are null; deferred/inconclusive/unrun are not failed. One decision once, latest review. Local seed repetitions are not independent terrains.'};
}
if(require.main===module){try{const [cmd,dir,file]=process.argv.slice(2);if(cmd==='append')console.log(JSON.stringify(append(dir,JSON.parse(fs.readFileSync(file))).record));else if(cmd==='report')console.log(JSON.stringify(report(load(dir)),null,2));else if(cmd==='verify')console.log(JSON.stringify({verified:load(dir).length}));else throw Error('append DIR RECORD | report DIR | verify DIR');}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={hash,append,load,report,validate};
