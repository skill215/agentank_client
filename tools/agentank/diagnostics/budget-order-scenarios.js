'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),z=require('node:zlib');
const {hash}=require('./strategic-improvement-model');
const prior=require('./focused-extension-scenarios');
function generate(index){const s=prior.generate(index);s.matchUrlId='synthetic-bp403-'+index;s.fingerprint='';s.fingerprint=hash(JSON.stringify(s));return s;}
function select(root){const directory=path.join(root,'artifacts/native-causal-audit'),read=name=>JSON.parse(z.gunzipSync(fs.readFileSync(path.join(directory,name,'scenarios.json.gz'))));
 const old=read('bp386-bomb-phase-calibrated'),last=read('bp402-focused-extension-hundred-rounds'),oldIds=new Set(old.map(s=>s.matchUrlId));
 const terrain=s=>hash(JSON.stringify(s.map)),used=new Set([...old,...last].map(terrain));
 const indexPath='battle-records/index/match-index.json',index=JSON.parse(fs.readFileSync(path.join(root,indexPath))),historical=[];
 for(const entry of index.entries){if(!entry.complete||oldIds.has(entry.matchId))continue;
  const relative=path.join('battle-records',entry.preferredPath,'raw.json'),resolved=path.resolve(root,relative);assert.ok(resolved.startsWith(path.join(root,'battle-records')+path.sep));
  const bytes=fs.readFileSync(resolved),raw=JSON.parse(bytes),replay=raw.replayData,mp=replay?.map;if(!mp?.map||!replay.replay?.records)continue;
  if(used.has(hash(JSON.stringify(mp.map))))continue;
  const stars=[];replay.replay.records.forEach((events,frame)=>{for(const e of events)if(e.type==='star'&&e.action==='created')stars.push({frame,position:e.position.slice()});});
  assert.ok(stars.length&&stars[0].frame===0);assert.equal(mp.players.length,2);assert.ok(mp.map.flat().every(c=>'.xmo'.includes(c)));
  const s={schemaVersion:1,scenarioKind:'LOCAL_INDEX_MAP_STAR_SEQUENCE',matchUrlId:entry.matchId,mapHash:hash(JSON.stringify(mp.map)),matchSeed:String(replay.matchSeed??'UNKNOWN'),originalSubjectSeat:0,map:mp.map,
   starts:mp.players.map((p,i)=>({id:'local-seat-'+i,position:p.position.slice(),direction:p.direction})),stars,originalFrames:replay.replay.records.length,originalResult:replay.replay.meta?.result||null,
   origin:'historical',source:{relativePath:relative,sha256:hash(bytes),note:'Map and star timeline from other local skill-discovery records; current experiment always uses two stun skills and frozen V1.'},fingerprint:''};
  s.fingerprint=hash(JSON.stringify(s));historical.push(s);used.add(terrain(s));
 }
 historical.sort((a,b)=>hash('loop403:'+a.matchUrlId).localeCompare(hash('loop403:'+b.matchUrlId)));assert.ok(historical.length>=30);
 const synthetic=[];for(let i=10000;synthetic.length<270;i++){const s=generate(i),t=terrain(s);if(used.has(t))continue;synthetic.push(s);used.add(t);}
 const selected=synthetic.slice(0,210);for(let i=0;i<30;i++)selected.push(historical[i],synthetic[210+i*2],synthetic[211+i*2]);
 return {all:[...new Map([...old,...last,...historical].map(s=>[s.matchUrlId,s])).values()],selected,remainingHistorical:14+historical.length-30,newHistoricalFound:historical.length,sourceFiles:[indexPath,...historical.slice(0,30).map(s=>s.source.relativePath)]};
}
module.exports={select,generate};
