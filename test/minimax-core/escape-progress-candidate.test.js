'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {choose,PRIORITY}=require('../../tools/agentank/diagnostics/escape-progress-candidate');
function fixture(){const i=JSON.parse(fs.readFileSync('artifacts/native-causal-audit/bp413-handoff-go/run/jobs/case3-seed0-at104-2.result.json')).intervention;return {view:i.view,width:i.state.width,height:i.state.height,risk:i.risk,rows:i.rows.map(r=>({...r,eligible:!!i.risk.acceptable[r.row]&&!i.risk.dominated[r.row]})),incumbent:1,mode:1};}
test('static progress fixes frozen tie without mutation; stale row excluded',()=>{const f=fixture(),before=JSON.stringify(f),r=choose(f);assert.equal(r.row,0);assert.equal(r.reason,'SHORTER_STATIC_EXIT');assert.ok(r.distances.every(x=>x.row<f.risk.count));assert.equal(JSON.stringify(f),before);});
test('every earlier risk/certificate priority is preserved',()=>{for(const k of PRIORITY){const f=fixture();f.risk[k][0]++;assert.equal(choose(f).row,1,k);}});
test('unsupported effects, extra bombs, mode, ineligible and hard-rejected rows abstain',()=>{for(const change of [f=>f.mode=2,f=>f.view.tanks[0].effects.stun=1,f=>f.view.bombs.push(f.view.bombs[0]),f=>f.rows[0].hard=1,f=>f.rows[0].finalAllowed=false,f=>f.rows[0].eligible=false,f=>f.risk.escapeSuccessorReady=0]){const f=fixture();change(f);assert.equal(choose(f).row,1);}});
