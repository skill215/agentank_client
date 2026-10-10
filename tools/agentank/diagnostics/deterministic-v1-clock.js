'use strict';
const PROTOCOL='V1_CONSTANT_CLOCK_PROGRESS_FALLBACK_V1';
function ConstantClock(){throw Error('DIAGNOSTIC_CLOCK_CONSTRUCTOR_UNSUPPORTED');}
Object.defineProperty(ConstantClock,'now',{value:()=>100000});Object.freeze(ConstantClock);
function withClock(sandbox,callback){
 const prior=Object.getOwnPropertyDescriptor(sandbox,'Date');
 Object.defineProperty(sandbox,'Date',{value:ConstantClock,configurable:true,writable:false});
 try{return callback();}finally{if(prior)Object.defineProperty(sandbox,'Date',prior);else delete sandbox.Date;}
}
module.exports={PROTOCOL,withClock};
