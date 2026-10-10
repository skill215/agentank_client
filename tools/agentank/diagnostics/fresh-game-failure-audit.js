'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {hash}=require('./optimization-decision-ledger');
function classify({outcome,ownDead,enemyDead,ownStars,enemyStars,reason}){
 if(outcome!=='V1_WIN')return outcome==='V2_WIN'?'WIN':'DRAW';
 if(ownDead)return enemyDead?'LOSS_BOTH_CRASHED':'LOSS_OWN_CRASHED';
 if(reason==='frameLimit'&&ownStars<enemyStars)return 'LOSS_ALIVE_STAR_DEFICIT';
 return 'LOSS_OTHER';
}
function summarizeReplay(r,id,source){
 const seat=r.seat,enemy=seat^1,records=r.replay.replayData.replay.records,ids=r.replay.replayData.replay.meta.players.map(x=>x.tank.id);
 const stars=[0,0],dead=[0,0],starEvents=[],crashEvents=[],positions=r.replay.replayData.replay.meta.players.map(x=>x.tank.position.slice());
 let firstOwnStar=null,lastOwnStar=null,stationary=0,longestStationary={length:0,from:null,to:null},segmentStart=0,ownMoves=0;
 for(const [frame,events]of records.entries()){
  const before=positions[seat].join(',');
  for(const [at,e]of events.entries()){
   if(e.type==='star'&&e.action==='collected'){assert.ok(e.by===0||e.by===1);stars[e.by]++;starEvents.push({frame,by:e.by,position:e.position});if(e.by===seat){firstOwnStar??=frame;lastOwnStar=frame;}}
   if(e.type==='tank'&&e.action==='go'){const i=ids.indexOf(e.objectId);assert.ok(i>=0);positions[i]=e.position.slice();if(i===seat)ownMoves++;}
   if(e.type==='tank'&&e.action==='crashed'){const i=e.index===0||e.index===1?e.index:ids.indexOf(e.objectId);assert.ok(i>=0);dead[i]++;crashEvents.push({frame,seat:i,eventIndex:at,bombExplodedInFrame:events.some(x=>x.type==='bomb'&&x.action==='exploded'),bulletMovedInFrame:events.some(x=>x.type==='bullet'&&x.action==='go'),events});}
  }
  if(positions[seat].join(',')===before){if(!stationary)segmentStart=frame;stationary++;if(stationary>longestStationary.length)longestStationary={length:stationary,from:segmentStart,to:frame};}else stationary=0;
 }
 assert.deepEqual(stars,r.row.counts.stars,'STAR_COUNT_DRIFT');assert.deepEqual(dead,r.row.counts.crashes,'CRASH_COUNT_DRIFT');
 const actions=Array.from(Buffer.from(r.row.candidate.compactActionStream,'base64')),actionCounts={};for(const a of actions)actionCounts[a]=(actionCounts[a]||0)+1;
 assert.equal(actions.length,records.length,'ACTION_FRAME_COUNT');
 const ownCrash=crashEvents.find(e=>e.seat===seat),d={outcome:r.row.analysisOutcome,ownDead:dead[seat]>0,enemyDead:dead[enemy]>0,ownStars:stars[seat],enemyStars:stars[enemy],reason:r.row.result.reason};
 return {id,sceneId:r.sceneId,mapHash:r.mapHash,seat,source,sourceSha256:hash(fs.readFileSync(source)),...d,category:classify(d),frames:records.length,starGap:d.ownStars-d.enemyStars,firstOwnStar,lastOwnStar,framesAfterLastOwnStar:lastOwnStar===null?records.length:records.length-1-lastOwnStar,ownMoves,longestStationary,actionCounts,starEvents,crashEvents,crashContext:!ownCrash?'NO_CRASH':ownCrash.bombExplodedInFrame?'CRASH_WITH_BOMB_EVENT':ownCrash.bulletMovedInFrame?'CRASH_WITH_BULLET_EVENT':'CRASH_OTHER_OR_UNKNOWN'};
}
function run(sourceDir,out){
 const begin=performance.now(),corpus=JSON.parse(fs.readFileSync(path.join(sourceDir,'scene-corpus.json'))),manifest=JSON.parse(fs.readFileSync(path.join(sourceDir,'manifest.json')));
 for(const f of manifest.files)assert.equal(hash(fs.readFileSync(f.path)),f.sha256,'SOURCE_DRIFT:'+f.path);
 const selected=corpus.games.filter(g=>!g.enabled);assert.equal(selected.length,64);assert.equal(new Set(selected.map(g=>g.sceneId)).size,32);
 const rows=selected.map(g=>{const file=path.join(sourceDir,g.replayFile);assert.equal(hash(fs.readFileSync(file)),g.replaySha256);return summarizeReplay(JSON.parse(fs.readFileSync(file)),g.id,file);});
 const counts={},crashContexts={},bySeat={0:{},1:{}};for(const r of rows){counts[r.category]=(counts[r.category]||0)+1;bySeat[r.seat][r.category]=(bySeat[r.seat][r.category]||0)+1;if(r.outcome==='V1_WIN')crashContexts[r.crashContext]=(crashContexts[r.crashContext]||0)+1;}
 const lost=rows.filter(r=>r.outcome==='V1_WIN'),ranked=Object.entries(counts).filter(([k])=>k.startsWith('LOSS_')).sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
 const episodes=rows.filter(r=>r.category==='LOSS_ALIVE_STAR_DEFICIT').map(r=>({game:r.id,sceneId:r.sceneId,seat:r.seat,starGap:r.starGap,window:r.longestStationary,source:r.source,sourceSha256:r.sourceSha256,selection:'All alive star-deficit losses; stationary window is a descriptive locator, not proof of avoidable loss.'}));
 const summary={batch:'BP416',decisionId:'OPT-D-0004',newGames:0,sourceGames:64,sourceTerrainClusters:32,excludedDuplicateCandidateGames:64,counts,bySeat,losses:lost.length,rankedLossCategories:ranked.map(([category,count])=>({category,count,lossFraction:count/lost.length,terrains:new Set(lost.filter(r=>r.category===category).map(r=>r.sceneId)).size})),crashContexts,priority:ranked[0]?.[0]??null,priorityMeaning:'Largest observed loss category only; not estimated recoverable wins or proven causal mechanism.',productionAdoption:false,cost:{attemptedGames:0,completedGames:0,independentUnits:0,executionSeconds:(performance.now()-begin)/1000,analysisSeconds:null},limitations:['BP415 generated-map/stun-opponent distribution only.','Two seats share a terrain; category counts are descriptive, not independent Bernoulli samples.','Bomb/bullet-in-frame labels are contextual co-occurrence; replay lacks authoritative crash-source links.','Turning, nonmovement and star drought can be justified by tactical risk; no policy defect inferred from action counts alone.'],nextStep:'Replay the complete largest-loss-category cohort with read-only policy/mode/risk instrumentation. Confirm a reproducible mechanism before writing a new policy candidate.'};
 for(const [name,x]of Object.entries({'summary.json':summary,'game-diagnoses.json':rows,'priority-scenes.json':episodes}))fs.writeFileSync(path.join(out,name),JSON.stringify(x,null,2)+'\n');return summary;
}
if(require.main===module)console.log(JSON.stringify(run(process.argv[2],process.argv[3]),null,2));
module.exports={classify,summarizeReplay,run};
