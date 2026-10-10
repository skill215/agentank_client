'use strict';
const fs=require('node:fs'),path=require('node:path'),z=require('node:zlib'),assert=require('node:assert/strict');
const {hash}=require('./strategic-improvement-model'),prior=require('./budget-order-scenarios');
function generate(index){const s=prior.generate(index);s.matchUrlId='synthetic-bp404-'+index;s.fingerprint='';s.fingerprint=hash(JSON.stringify(s));return s;}
function select(root){const dir=path.join(root,'artifacts/native-causal-audit'),read=n=>JSON.parse(z.gunzipSync(fs.readFileSync(path.join(dir,n,'scenarios.json.gz')))),terrain=s=>hash(JSON.stringify(s.map));
 const previous=prior.select(root),last=read('bp403-budget-order-hundred-rounds'),all=[...new Map([...previous.all,...last].map(s=>[s.matchUrlId,s])).values()];
 const excluded=new Set(['bp394-multiseed-ten-rounds','bp399-strategic-improvement-ten-rounds','bp400-adaptive-hundred-rounds','bp401-continuous-hundred-rounds','bp402-focused-extension-hundred-rounds','bp403-budget-order-hundred-rounds'].flatMap(read).map(terrain));
 const p398=JSON.parse(fs.readFileSync(path.join(dir,'bp398-selective-risk-ten-rounds/manifest.json'))),ids=new Set([...p398.development,...p398.validation]);
 for(const s of all)if(ids.has(s.matchUrlId))excluded.add(terrain(s));
 const historical=[];for(const s of all.slice().sort((a,b)=>hash('loop404:'+a.matchUrlId).localeCompare(hash('loop404:'+b.matchUrlId)))){
  if(s.origin==='synthetic'||excluded.has(terrain(s)))continue;excluded.add(terrain(s));historical.push({...s,origin:'historical'});
 }assert.equal(historical.length,24,'HISTORICAL_RESERVE_DRIFT');
 const used=new Set(all.map(terrain)),synthetic=[];for(let i=20000;synthetic.length<276;i++){const s=generate(i),h=terrain(s);if(used.has(h))continue;used.add(h);synthetic.push(s);}
 const selected=synthetic.slice(0,210);let n=210;for(let i=0;i<30;i++){if(i<24)selected.push(historical[i],synthetic[n++],synthetic[n++]);else selected.push(synthetic[n++],synthetic[n++],synthetic[n++]);}
 assert.equal(n,276);return {all,selected,remainingHistorical:0,newHistoricalFound:0,sourceFiles:[...new Set([...previous.sourceFiles,...historical.filter(s=>s.source).map(s=>s.source.relativePath)])]};
}
module.exports={generate,select};
