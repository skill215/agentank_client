'use strict';
// Development oracle only. No production utility bound is assumed here.
function interval(lo,hi=lo){
 if(!Number.isSafeInteger(lo)||!Number.isSafeInteger(hi)||lo>hi)throw Error('INVALID_INTERVAL');
 return {lo:lo===0?0:lo,hi:hi===0?0:hi};
}
function extrema(children,kind){
 if(!children.length)throw Error('EMPTY_DOMAIN');
 const op=kind==='min'?Math.min:kind==='max'?Math.max:null;
 if(!op)throw Error('INVALID_QUANTIFIER');
 return interval(children.reduce((v,c)=>op(v,c.lo),children[0].lo),
  children.reduce((v,c)=>op(v,c.hi),children[0].hi));
}
function expectation(children,weights){
 if(!children.length||children.length!==weights.length)throw Error('INVALID_WEIGHTS');
 let lo=0,hi=0,total=0;
 for(let i=0;i<children.length;i++){
  const w=weights[i];if(!Number.isSafeInteger(w)||w<0)throw Error('INVALID_WEIGHTS');
  const lower=children[i].lo*w,upper=children[i].hi*w;
  if(!Number.isSafeInteger(lower)||!Number.isSafeInteger(upper))throw Error('UNSAFE_ARITHMETIC');
  lo+=lower;hi+=upper;total+=w;
  if(!Number.isSafeInteger(lo)||!Number.isSafeInteger(hi)||!Number.isSafeInteger(total))throw Error('UNSAFE_ARITHMETIC');
 }
 if(!total)throw Error('EMPTY_MASS');
 return interval(Math.floor(lo/total),Math.ceil(hi/total));
}
function robust(children,weights,epsilon){
 if(!Number.isSafeInteger(epsilon)||epsilon<0||epsilon>10000)throw Error('INVALID_EPSILON');
 return expectation([extrema(children,'min'),expectation(children,weights)],[epsilon,10000-epsilon]);
}
function strictWinner(rows){
 if(rows.length<2)return -1;
 for(let i=0;i<rows.length;i++)if(rows.every((r,j)=>i===j||rows[i].lo>r.hi))return i;
 return -1;
}
function pureMatrix(cells){
 const rows=cells.map(row=>extrema(row,'min'));
 return {rows,value:extrema(rows,'max'),winner:strictWinner(rows)};
}
function verify(){
 const assert=require('node:assert/strict');
 const ranges=[];for(let lo=-1;lo<=1;lo++)for(let hi=lo;hi<=1;hi++)ranges.push(interval(lo,hi));
 let matrices=0,completions=0,certificates=0;
 for(const a of ranges)for(const b of ranges)for(const c of ranges)for(const d of ranges){
  const result=pureMatrix([[a,b],[c,d]]);matrices++;if(result.winner>=0)certificates++;
  for(let av=a.lo;av<=a.hi;av++)for(let bv=b.lo;bv<=b.hi;bv++)
   for(let cv=c.lo;cv<=c.hi;cv++)for(let dv=d.lo;dv<=d.hi;dv++){
    const values=[Math.min(av,bv),Math.min(cv,dv)],v=Math.max(...values);completions++;
    assert.ok(result.value.lo<=v&&v<=result.value.hi);
    if(result.winner>=0)assert.ok(values[result.winner]>values[1-result.winner]);
   }
 }
 return {matrices,completions,strictCertificates:certificates,falseCertificates:0,
  scope:'finite pure max-min value only; not mixed-policy optimality or terminal Proof',productionModified:false};
}
if(require.main===module)console.log(JSON.stringify(verify(),null,2));
module.exports={interval,extrema,expectation,robust,strictWinner,pureMatrix,verify};
