'use strict';
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
function saveFailure(output,records,pending,error){
 fs.writeFileSync(path.join(output,'partial-matches.ndjson.gz'),zlib.gzipSync(records.map(JSON.stringify).join('\n')+(records.length?'\n':'')),{flag:'wx'});
 fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({status:'BLOCKED',completed:records.length,pending,error:{name:error.name,message:error.message,stack:error.stack},productionAdoption:false},null,2),{flag:'wx'});
}
module.exports={saveFailure};
