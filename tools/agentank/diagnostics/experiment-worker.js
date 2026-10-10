'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
async function main(){
 const task=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
 const readFrozen=file=>{
  const target=path.resolve(task.root,file),input=task.inputs.find(i=>i.path===target);
  assert.ok(input,'UNPINNED_INPUT:'+target);const data=fs.readFileSync(target);assert.equal(hash(data),input.sha256,'INPUT_DRIFT');return data;
 };
 readFrozen(task.adapter);
 const result=await require(task.adapter).runJob(task.payload,{root:task.root,readFrozen});
 fs.writeFileSync(task.resultFile,JSON.stringify(result)+'\n',{flag:'wx'});
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;});
