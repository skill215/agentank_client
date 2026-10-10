'use strict';
// Diagnostic only: refresh planning state; never synthesize an action/source.
function refreshOnMissingSource(owner,engine,count,source){
 if(!source&&owner.intent)owner.intent.prepare(engine,count);
 return source;
}
module.exports={refreshOnMissingSource};
