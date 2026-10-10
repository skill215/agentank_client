'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),z=require('node:zlib');
const {hash}=require('./strategic-improvement-model');
function reachable(map,start){const seen=new Set([start.join(',')]),q=[start];for(let i=0;i<q.length;i++){const [x,y]=q[i];for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const a=x+dx,b=y+dy,k=a+','+b;if(map[a]?.[b]&&'.o'.includes(map[a][b])&&!seen.has(k)){seen.add(k);q.push([a,b]);}}}return q;}
function generate(index){let random=parseInt(hash('BP402_SYNTHETIC_V1:'+index).slice(0,8),16);const next=()=>{random=(Math.imul(random,1664525)+1013904223)>>>0;return random/4294967296;};
 for(let attempt=0;attempt<10000;attempt++){
  const map=Array.from({length:19},(_,x)=>Array.from({length:15},(_,y)=>{if(x===0||x===18||y===0||y===14)return 'x';const r=next();return r<.14?'x':r<.24?'m':r<.32?'o':'.';}));
  const positions=[[2,2],[16,12]];for(const [x,y]of positions)for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)map[x+dx][y+dy]='.';
  const cells=reachable(map,positions[0]),walkable=map.flat().filter(x=>'.o'.includes(x)).length;
  if(!cells.some(([x,y])=>x===16&&y===12)||cells.length/walkable<.95)continue;
  const options=cells.filter(([x,y])=>positions.every(([a,b])=>Math.abs(a-x)+Math.abs(b-y)>=3));
  const stars=[0,32,64,96].map(frame=>({frame,position:options[Math.floor(next()*options.length)].slice()}));
  const s={schemaVersion:1,scenarioKind:'SYNTHETIC_CONNECTED_PRESSURE_V1',matchUrlId:'synthetic-bp402-'+String(index).padStart(4,'0'),mapHash:hash(JSON.stringify(map)),matchSeed:String(random),originalSubjectSeat:0,map,
   starts:positions.map((position,i)=>({id:'synthetic-seat-'+i,position,direction:i?'down':'up'})),stars,originalFrames:128,originalResult:null,origin:'synthetic',generator:{version:'BP402_SYNTHETIC_V1',index,attempt},fingerprint:''};
  s.fingerprint=hash(JSON.stringify(s));return s;
 }throw Error('GENERATOR_REJECTION_LIMIT');
}
function select(root){const base=path.join(root,'artifacts/native-causal-audit'),read=name=>JSON.parse(z.gunzipSync(fs.readFileSync(path.join(base,name,'scenarios.json.gz'))));
 const all=read('bp386-bomb-phase-calibrated'),p398=JSON.parse(fs.readFileSync(path.join(base,'bp398-selective-risk-ten-rounds/manifest.json'))),ids=new Set([...p398.development,...p398.validation]);
 const excluded=new Set([...read('bp394-multiseed-ten-rounds'),...read('bp399-strategic-improvement-ten-rounds'),...read('bp400-adaptive-hundred-rounds'),...read('bp401-continuous-hundred-rounds'),...all.filter(s=>ids.has(s.matchUrlId))].map(s=>hash(JSON.stringify(s.map))));
 const remaining=[];for(const s of all.slice().sort((a,b)=>hash('loop402:'+a.matchUrlId).localeCompare(hash('loop402:'+b.matchUrlId)))){const h=hash(JSON.stringify(s.map));if(excluded.has(h))continue;excluded.add(h);remaining.push({...s,origin:'historical'});}
 assert.ok(remaining.length>=60);const allTerrain=new Set(all.map(s=>hash(JSON.stringify(s.map)))),synthetic=[];
 for(let i=0;synthetic.length<240;i++){const s=generate(i),h=hash(JSON.stringify(s.map));if(allTerrain.has(h))continue;allTerrain.add(h);synthetic.push(s);}
 const selected=synthetic.slice(0,210);for(let i=0;i<30;i++)selected.push(remaining[i*2],remaining[i*2+1],synthetic[210+i]);
 return {all,selected,remainingHistorical:remaining.length-60};
}
module.exports={generate,reachable,select};
