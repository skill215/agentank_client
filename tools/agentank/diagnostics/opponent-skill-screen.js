'use strict';
const assert=require('node:assert/strict');
function skillsFor(seat,skill){assert.ok(seat===0||seat===1);assert.ok(['stun','shield','teleport'].includes(skill));const skills=['stun','stun'];skills[1-seat]=skill;return skills;}
async function runJob(job,ctx){const event=require('./strategic-event-simulator'),load=event.load;let applied;
 event.load=async(...args)=>{const e=await load(...args),wrap=e.wrap;return {...e,wrap:(...xs)=>{const m=wrap(...xs),Base=m.AgenTankSimulator;return {...m,AgenTankSimulator:class extends Base{constructor(options){applied=skillsFor(job.seat,job.opponentSkill);super({...options,skills:applied});}}};}};};
 try{const r=await require('./factorial-method-screen').runJob(job,ctx);assert.deepEqual(applied,skillsFor(job.seat,job.opponentSkill));return {...r,opponentSkill:job.opponentSkill,appliedSkills:applied,scope:'Same V3 policy with stun/shield/teleport loadouts; not distinct algorithm opponents. Fresh-map paired screen; not platform runtime acceptance.'};}finally{event.load=load;}
}
module.exports={skillsFor,runJob};
