'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {firstDifference}=require('./reducer-repair-active');
const {EXACT_BLOCK}=require('../../../engine-v2/src/base-policy-specialized/policy-search');
function classify(root){
 const a=root.rows.find(r=>r.action===root.current),b=root.rows.find(r=>r.action===root.alternative);
 assert.ok(a&&b);const bonus=r=>r.backed-r.blend;
 const dominates=(x,y)=>x.worst>=y.worst&&x.expected>=y.expected&&(x.worst>y.worst||x.expected>y.expected);
 return {current:a,alternative:b,deltaWorst:b.worst-a.worst,deltaExpected:b.expected-a.expected,
  deltaBonus:bonus(b)-bonus(a),deltaAdjustedWorst:b.worst+bonus(b)-a.worst-bonus(a),
  alternativeDominated:root.rows.some(r=>dominates(r,b)),currentDominatesAlternative:dominates(a,b),
  actionClass:a.action===4?'FIRE_REMOVED':a.action===8?'STUN_REMOVED':'MOVEMENT_OR_ORIENTATION',
  currentBlocks:Object.entries(EXACT_BLOCK).filter(([,v])=>a.block&v).map(([k])=>k),
  alternativeBlocks:Object.entries(EXACT_BLOCK).filter(([,v])=>b.block&v).map(([k])=>k)};
}
function verifyPrefix(before,after,root){
 const at=firstDifference(before.candidate.compactActionStream,after.candidate.compactActionStream);
 assert.equal(at,root.frame,'ROOT_FRAME_ASSOCIATION');
 for(const [m,action] of [[before,root.current],[after,root.alternative]])assert.equal(Buffer.from(m.candidate.compactActionStream,'base64')[at],action);
 const a=Buffer.from(before.control.compactActionStream,'base64'),b=Buffer.from(after.control.compactActionStream,'base64');
 assert.ok(a.length>=at&&b.length>=at);assert.deepEqual(a.subarray(0,at),b.subarray(0,at),'OPPONENT_PREFIX');
 return at;
}
function run(root,output){
 assert.ok(!fs.existsSync(output),'OUTPUT_EXISTS');const base=path.join(root,'artifacts/native-causal-audit');
 const inputs=['bp317-reducer-active-verified/matches.ndjson.gz','bp326-worst-intent-active/matches.ndjson.gz','bp326-worst-intent-active/diagnostic-samples.ndjson.gz','bp323-root-value-separation/roots.ndjson.gz'];
 const hash=b=>crypto.createHash('sha256').update(b).digest('hex');const provenance=[];
 const data=inputs.map(p=>{const b=fs.readFileSync(path.join(base,p));provenance.push({path:p,bytes:b.length,sha256:hash(b)});return zlib.gunzipSync(b).toString().trim().split('\n').map(JSON.parse);});
 const [before,after,samples,shadow]=data,records=[],groups={};assert.equal(before.length,32);assert.equal(after.length,32);
 for(const m of after){const b=before.find(x=>x.matchUrlId===m.matchUrlId&&x.candidateSeat===m.candidateSeat);assert.ok(b);
  if(b.analysisOutcome===m.analysisOutcome)continue;
  const r=samples.find(x=>x.id===m.matchUrlId&&x.seat===m.candidateSeat);assert.ok(r);verifyPrefix(b,m,r);
  const s=shadow.find(x=>x.id===r.id&&x.seat===r.seat&&x.frame===r.frame);assert.ok(s);assert.deepEqual(r.rows,s.rows,'SAME_ROOT_ROW_DRIFT');assert.equal(r.current,s.current);
  const key=b.analysisOutcome+'->'+m.analysisOutcome,c=classify(r);
  const g=groups[key]||(groups[key]={count:0,fireRemoved:0,stunRemoved:0,dominatedAlternative:0,budgetBlockedAlternative:0,depthLeafAlternative:0});g.count++;
  g.fireRemoved+=c.actionClass==='FIRE_REMOVED';g.stunRemoved+=c.actionClass==='STUN_REMOVED';g.dominatedAlternative+=c.alternativeDominated;
  g.budgetBlockedAlternative+=c.alternativeBlocks.includes('BUDGET');g.depthLeafAlternative+=c.alternativeBlocks.includes('DEPTH_LEAF');
  records.push({id:r.id,seat:r.seat,frame:r.frame,before:b.analysisOutcome,after:m.analysisOutcome,...c});
 }
 assert.equal(records.length,12);const overview={games:32,changedOutcomes:records.length,groups,records,newBattles:0,
  checks:{sameCandidatePrefix:true,sameOpponentPrefix:true,identicalHistoricalRootRows:true},
  limitations:['First divergence plus whole-game transition is not a one-action causal intervention','Depth leaf is a normal heuristic horizon, not automatically a bug','No attack purpose or self-escape certificate is stored in these root rows','Raw value dominance is not risk dominance and does not include intent']};
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({inputs:provenance,newBattles:0},null,2));
 fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));console.log(JSON.stringify({groups,records},null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]);
module.exports={classify,verifyPrefix};
