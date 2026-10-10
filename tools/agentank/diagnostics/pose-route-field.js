'use strict';
const {ARRAY}=require('../../../engine-v2/src/state/fast-state');
const UNREACHABLE=65535;
// Experimental static navigation potential, NOT a hazard/Hard certificate.
// Primitive model: one-cell GO and quarter turns each cost one action.
class PoseRouteField {
 constructor(maxCells){
  if(!Number.isInteger(maxCells)||maxCells<1||maxCells*4>=UNREACHABLE)throw RangeError('POSE_ROUTE_CAPACITY');
  this.maxCells=maxCells;this.distance=new Uint16Array(maxCells*4);this.queue=new Uint16Array(maxCells*4);this.terrain=new Uint8Array(maxCells);
  this.width=0;this.height=0;this.cells=0;this.target=-1;this.ready=false;this.builds=0;this.hits=0;this.expansions=0;
  this.bytes=this.distance.byteLength+this.queue.byteLength+this.terrain.byteLength;
 }
 reset(){this.ready=false;}
 open(cell){return cell>=0&&cell<this.cells&&(this.terrain[cell]===0||this.terrain[cell]===3);}
 prepare(state,target){
  if(state.cells>this.maxCells)throw RangeError('POSE_ROUTE_CAPACITY');
  const terrain=state.arrays[ARRAY.TERRAIN];let same=this.ready&&this.width===state.width&&this.height===state.height&&this.target===target;
  if(same)for(let c=0;c<state.cells;c++)if(this.terrain[c]!==terrain[c]){same=false;break;}
  if(same){this.hits++;return this.open(target);}
  this.width=state.width;this.height=state.height;this.cells=state.cells;this.target=target;this.ready=true;this.builds++;this.expansions=0;
  for(let c=0;c<this.cells;c++)this.terrain[c]=terrain[c];this.distance.fill(UNREACHABLE,0,this.cells*4);
  if(!this.open(target))return false;
  let head=0,tail=0;for(let dir=0;dir<4;dir++){const pose=target*4+dir;this.distance[pose]=0;this.queue[tail++]=pose;}
  while(head<tail){const pose=this.queue[head++],cell=pose>>2,dir=pose&3,next=this.distance[pose]+1;this.expansions++;
   const left=cell*4+((dir+1)&3),right=cell*4+((dir+3)&3);
   if(this.distance[left]===UNREACHABLE){this.distance[left]=next;this.queue[tail++]=left;}
   if(this.distance[right]===UNREACHABLE){this.distance[right]=next;this.queue[tail++]=right;}
   const x=cell%this.width,y=(cell/this.width)|0;
   const previous=dir===0?(y+1<this.height?cell+this.width:-1):dir===1?(x>0?cell-1:-1):dir===2?(y>0?cell-this.width:-1):(x+1<this.width?cell+1:-1);
   if(this.open(previous)){const p=previous*4+dir;if(this.distance[p]===UNREACHABLE){this.distance[p]=next;this.queue[tail++]=p;}}
  }
  return true;
 }
 value(cell,direction){return this.ready&&Number.isInteger(cell)&&cell>=0&&cell<this.cells&&Number.isInteger(direction)&&direction>=0&&direction<4?this.distance[cell*4+direction]:UNREACHABLE;}
 progress(cell,direction,nextCell,nextDirection){const a=this.value(cell,direction),b=this.value(nextCell,nextDirection);return a===UNREACHABLE||b===UNREACHABLE?null:a-b;}
}
module.exports={PoseRouteField,UNREACHABLE};
