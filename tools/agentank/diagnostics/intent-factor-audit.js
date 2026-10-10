'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const {firstDifference}=require('./reducer-repair-active');
function maximizers(rows,mode){
 let best=null,result=[];
 for(const r of rows){const bonus=r.backed-r.blend;let key;
  if(mode==='BLEND_INTENT')key=[r.backed,r.nominal];
  else if(mode==='BLEND_NO_INTENT')key=[r.blend,r.nominal-bonus];
  else if(mode==='WORST_INTENT')key=[r.worst+bonus,r.expected+bonus,r.backed,r.nominal];
  else if(mode==='WORST_LATE_INTENT')key=[r.worst,r.expected,r.backed,r.nominal];
  else throw Error('UNKNOWN_MODE');
  let cmp=best?0:1;if(best)for(let i=0;i<key.length;i++)if(key[i]!==best[i]){cmp=key[i]>best[i]?1:-1;break;}
  if(cmp>0){best=key;result=[r.action];}else if(cmp===0)result.push(r.action);
 }return result;
}
function run(root,output){
 if(fs.existsSync(output))throw Error('OUTPUT_EXISTS');const base=path.join(root,'artifacts/native-causal-audit');
 const read=p=>zlib.gunzipSync(fs.readFileSync(path.join(base,p))).toString().trim().split('\n').map(JSON.parse);
 const rows=read('bp323-root-value-separation/roots.ndjson.gz'),before=read('bp317-reducer-active-verified/matches.ndjson.gz'),after=read('bp324-worst-first-active/matches.ndjson.gz');
 const modes=['BLEND_INTENT','BLEND_NO_INTENT','WORST_INTENT','WORST_LATE_INTENT'],summary={},records=[];
 for(const mode of modes)summary[mode]={roots:rows.length,uniqueChanged:0,ties:0};
 for(const r of rows){const options={};for(const mode of modes){const set=maximizers(r.rows,mode);options[mode]=set;
   if(set.length>1)summary[mode].ties++;else if(set[0]!==r.current)summary[mode].uniqueChanged++;}
  assert.ok(options.BLEND_INTENT.includes(r.current));assert.ok(options.WORST_LATE_INTENT.includes(r.alternative));records.push({...r,options});
 }
 const flips=[];for(const m of after){const b=before.find(x=>x.matchUrlId===m.matchUrlId&&x.candidateSeat===m.candidateSeat);if(b.analysisOutcome===m.analysisOutcome)continue;
  const index=firstDifference(b.candidate.compactActionStream,m.candidate.compactActionStream);assert.ok(index>=0);
  // Simulator callbacks are frame-indexed in this frozen cohort; verify prior
  // BP324 first shadow divergence matches both actions before treating as a root.
  const r=records.find(x=>x.id===m.matchUrlId&&x.seat===m.candidateSeat&&x.frame===index);assert.ok(r);
  assert.equal(r.current,Buffer.from(b.candidate.compactActionStream,'base64')[index]);assert.equal(r.alternative,Buffer.from(m.candidate.compactActionStream,'base64')[index]);
  flips.push({id:r.id,seat:r.seat,frame:r.frame,before:b.analysisOutcome,after:m.analysisOutcome,current:r.current,alternative:r.alternative,
   options:r.options,rows:r.rows});
 }
 const targets=records.filter(r=>r.seat===0&&(r.id==='mat_I52zYeSqz1RCC3Vqs'&&r.frame===48||r.id==='mat_2oo7Bhd32HH4mziLA'&&r.frame===39));
 const overview={summary,flips,targets,notes:['Offline factor comparison, not ACTIVE gains','Ties remain sets; downstream risk/action-priority tie-break not guessed',
  'WORST_INTENT adds the unchanged intent bonus to both endpoints; no global safety-bound claim','First divergence associations are not isolated one-step outcome proofs']};
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(overview,null,2));
 fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({inputs:['bp323-root-value-separation','bp317-reducer-active-verified','bp324-worst-first-active'],newBattles:0,modes},null,2));
 fs.writeFileSync(path.join(output,'roots.ndjson.gz'),zlib.gzipSync(records.map(r=>JSON.stringify({id:r.id,seat:r.seat,frame:r.frame,current:r.current,options:r.options})).join('\n')+'\n'));
 console.log(JSON.stringify({summary,flips:flips.map(({rows,...x})=>x),targets:targets.map(r=>({id:r.id,options:r.options}))},null,2));
}
if(require.main===module)run(process.cwd(),process.argv[2]);
module.exports={maximizers};
