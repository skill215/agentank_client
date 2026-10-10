'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {ResponseSupportLedger,reason}=require('./response-support-ledger');
const {productionTreeSha256}=require('./native-base-policy-standalone-arena');
function audit(rows){const ledger=new ResponseSupportLedger(),actions=new Uint8Array(32),allowed=new Uint8Array(32),records=[];
 const summary={roots:rows.length,residualRoots:0,strictCompleteRoots:0,observedOmitted:0,observedOmittedCoveredByResidual:0,reasons:{},actualMisses:{},extraSearchNodes:0};
 for(const r of rows){assert.ok(r.columns.length<=32);for(let i=0;i<r.columns.length;i++){actions[i]=r.columns[i].action;allowed[i]=r.columns[i].allowed;}
  ledger.update(actions,allowed,r.columns.length,false); // archived roots do not prove generator completeness
  if(ledger.residualMask)summary.residualRoots++;summary.strictCompleteRoots+=ledger.complete;
  for(let a=0;a<24;a++)if(ledger.residualMask&(1<<a)){const k=reason(a);summary.reasons[k]=(summary.reasons[k]||0)+1;}
  if(!(ledger.searchedMask&(1<<r.actual))){summary.observedOmitted++;if(ledger.residualMask&(1<<r.actual))summary.observedOmittedCoveredByResidual++;
   const k=reason(r.actual);summary.actualMisses[k]=(summary.actualMisses[k]||0)+1;}
  records.push({id:r.id,seat:r.seat,frame:r.frame,generatedMask:ledger.generatedMask,searchedMask:ledger.searchedMask,residualMask:ledger.residualMask,
   generatorComplete:ledger.generatorComplete,supportComplete:ledger.complete,actual:r.actual});
 }
 return {summary,records};}
function run(root,output){if(fs.existsSync(output))throw Error('OUTPUT_EXISTS');
 const input=path.join(root,'artifacts/native-causal-audit/bp320-opponent-calibration/roots.ndjson.gz'),bytes=fs.readFileSync(input);
 const source=JSON.parse(fs.readFileSync(path.join(path.dirname(input),'manifest.json'))),tree=productionTreeSha256(root);assert.equal(tree,source.tree);
 const rows=zlib.gunzipSync(bytes).toString().trim().split('\n').map(JSON.parse),result=audit(rows);
 fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({tree,input,inputSha256:crypto.createHash('sha256').update(bytes).digest('hex'),mode:'OFFLINE_SUPPORT_SHADOW',newBattles:0},null,2));
 fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(result.summary,null,2));fs.writeFileSync(path.join(output,'roots.ndjson.gz'),zlib.gzipSync(result.records.map(JSON.stringify).join('\n')+'\n'));
 console.log(JSON.stringify(result.summary,null,2));}
if(require.main===module)run(process.cwd(),process.argv[2]);
module.exports={audit};
