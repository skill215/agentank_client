'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),assert=require('node:assert/strict'),crypto=require('node:crypto');
function run(root,output){assert.ok(!fs.existsSync(output));const base=path.join(root,'artifacts/native-causal-audit'),inputs=[];
 const read=name=>{const file=path.join(base,name,'diagnostic-samples.ndjson.gz'),bytes=fs.readFileSync(file);inputs.push({path:path.relative(root,file),sha256:crypto.createHash('sha256').update(bytes).digest('hex')});return zlib.gunzipSync(bytes).toString().trim().split('\n').map(JSON.parse);};
 const fresh=read('bp358-cooldown-stun-shadow'),old=read('bp354b-terminal-evidence-support'),oracle=read('bp353-terminal-risk-simulator-oracle');let changed=0,unchanged=0;
 for(const r of fresh){const p=old.find(p=>p.id===r.id&&p.seat===r.seat),o=oracle.find(o=>o.id===r.id&&o.seat===r.seat);assert.ok(p&&o);assert.equal(r.cells.length,p.cells.length);assert.equal(r.informationGapMask,p.informationGapMask);assert.equal(r.status,'INCOMPLETE');
  for(const c of r.cells){const before=p.cells.find(x=>x.index===c.index);assert.ok(before);assert.equal(c.enemyAction,before.enemyAction);assert.equal(c.chance0,before.chance0);assert.equal(c.chance1,before.chance1);
   if(c.normalizedEnemyAction!==c.enemyAction){assert.equal(c.enemyAction,8);assert.equal(c.normalizedEnemyAction,0);assert.equal(before.result,'INCOMPLETE');const ref=o.cells.find(x=>x.ownAction===4&&x.enemyAction===c.enemyAction&&x.chance0===c.chance0&&x.chance1===c.chance1);assert.ok(ref);for(const key of ['result','ownCrash','enemyCrash'])assert.equal(c[key],ref[key]);changed++;}
   else{for(const key of ['result','ownCrash','enemyCrash'])assert.equal(c[key],before[key]);unchanged++;}
  }
 }
 assert.equal(fresh.length,7);assert.equal(changed,3);const result={inputs,roots:7,changed,unchanged,changedSimulatorDifferences:0,unchangedBranchDrift:0,unresolved:fresh.reduce((n,r)=>n+r.unresolved,0),allWinRoots:fresh.filter(r=>r.wins===r.expected).length,productionAdoption:false};fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'overview.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
if(require.main===module)run(process.cwd(),process.argv[2]);
