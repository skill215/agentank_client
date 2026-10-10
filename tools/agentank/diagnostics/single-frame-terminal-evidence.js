'use strict';

// Diagnostic evidence only. No action owner, Risk writer, or production import.
const {FastState,ARRAY,SCALAR}=require('../../../engine-v2/src/state/fast-state');
const {ACTION,FAST_STATUS,SKILL,NONE_CELL,TERMINAL}=require('../../../engine-v2/src/abi/fast-codes');
const ENEMY_ACTIONS=Object.freeze([ACTION.NONE,ACTION.GO,ACTION.TURN_LEFT,
  ACTION.TURN_RIGHT,ACTION.FIRE,ACTION.THROW_BOMB,ACTION.CAST_STUN]);
const {normalizeCooldownStun}=require('./cooldown-stun-normalization');
const {inspectBallisticWitness}=require('./ballistic-terminal-witness');
const {inspectTerminalEntry}=require('./terminal-entry-premises');

class TerminalEvidenceFold {
  reset(expected, inputComplete, hardAllowed) {
    this.expected=expected;this.inputComplete=Boolean(inputComplete);
    this.hardAllowed=Boolean(hardAllowed);this.seen=0;this.wins=0;this.draws=0;
    this.losses=0;this.unresolved=0;this.mask=0n;return this;
  }
  add(index, result) {
    if(!Number.isInteger(index)||index<0||index>=this.expected)
      throw Error('TERMINAL_EVIDENCE_INDEX');
    const bit=1n<<BigInt(index);if(this.mask&bit)throw Error('TERMINAL_EVIDENCE_DUPLICATE');
    this.mask|=bit;this.seen++;
    if(result==='WIN')this.wins++;else if(result==='DRAW')this.draws++;
    else if(result==='LOSS')this.losses++;else this.unresolved++;
  }
  status() {
    if(!this.inputComplete||!this.hardAllowed||this.expected<=0||this.seen!==this.expected||this.unresolved)
      return 'INCOMPLETE';
    return this.wins===this.expected?'ALL_TERMINAL_WIN':'COMPLETE_NOT_ALL_WIN';
  }
}

function evaluateShadow(engine, nodeBudget=64, normalizeCooldown=false, inspectBallistics=false) {
  const source=engine.adapter.state,search=engine.basePolicy.policySearch;
  const a=source.arrays,frame=a[ARRAY.SCALAR][SCALAR.FRAME];
  let row=-1;for(let i=0;i<engine.ourCount;i++)if(engine.ourActions[i]===ACTION.FIRE)row=i;
  const conditions={enemyVisible:Boolean(engine.adapter.enemyVisible),
    informationComplete:Boolean(engine.adapter.informationComplete),
    symmetricStun:a[ARRAY.TANK_SKILL][0]===SKILL.STUN&&a[ARRAY.TANK_SKILL][1]===SKILL.STUN,
    fireGenerated:row>=0,hardAllowed:row>=0&&engine.hardStatus[row]===0};
  // Even with incomplete observations, enumerate as diagnostic conditional
  // evidence. The fold cannot certify it; there is no fail-open switch.
  search.bindIsolatedHard(engine.adapter.bundle);
  const state=new FastState(source.width,source.height);
  for(let i=0;i<source.arrays.length;i++)state.arrays[i].set(source.arrays[i]);state.initializeHash();
  const Kernel=search.diagnosticKernel.constructor,kernel=new Kernel(state);
  let ballisticWitness=null;
  if(inspectBallistics){const advance=kernel.advanceProjectiles;kernel.advanceProjectiles=function(){ballisticWitness=inspectBallisticWitness(state);return advance.call(this);};}
  let expected=0;for(const action of ENEMY_ACTIONS)
    expected+=search.chanceAlternatives(source,0,ACTION.FIRE)*search.chanceAlternatives(source,1,action);
  const fold=new TerminalEvidenceFold().reset(expected,Object.values(conditions).every(Boolean),conditions.hardAllowed);
  const cells=[];let index=0;
  if(row>=0)outer:for(const enemyAction of ENEMY_ACTIONS)
    for(let c0=0;c0<search.chanceAlternatives(source,0,ACTION.FIRE);c0++)
      for(let c1=0;c1<search.chanceAlternatives(source,1,enemyAction);c1++){
        if(index>=nodeBudget)break outer;
        const mark=state.deltaUsed*1024+state.eventUsed;
        ballisticWitness=null;
        const normalizedEnemyAction=normalizeCooldown?normalizeCooldownStun(enemyAction,
          a[ARRAY.TANK_SKILL][1],a[ARRAY.TANK_SKILL_READY][1],frame,
          (engine.adapter.informationGapMask&~8192)===0):enemyAction;
        const status=kernel.applyFrame(ACTION.FIRE,engine.ourArguments[row],normalizedEnemyAction,NONE_CELL,c0,c1);
        const terminal=state.arrays[ARRAY.SCALAR][SCALAR.TERMINAL_CODE];
        const applied=status===FAST_STATUS.APPLIED||status===FAST_STATUS.APPLIED_TERMINAL;
        const result=!applied?'INCOMPLETE':terminal===TERMINAL.WIN0?'WIN':
          terminal===TERMINAL.WIN1?'LOSS':terminal===TERMINAL.DRAW?'DRAW':'UNRESOLVED';
        fold.add(index,result);cells.push({index,enemyAction,normalizedEnemyAction,chance0:c0,chance1:c1,result,status,failureReason:kernel.failureReason,ballisticWitness,
          ownCrash:state.arrays[ARRAY.TANK_CRASH][0],enemyCrash:state.arrays[ARRAY.TANK_CRASH][1]});
        state.undoTo(mark);index++;
      }
  for(let i=0;i<source.arrays.length;i++)for(let j=0;j<source.arrays[i].length;j++)
    if(source.arrays[i][j]!==state.arrays[i][j])throw Error('TERMINAL_EVIDENCE_RESTORE');
  return {frame,sourceHashLo:source.hashLo,sourceHashHi:source.hashHi,action:ACTION.FIRE,row,
    entryPremise:inspectBallistics?inspectTerminalEntry(source,conditions.enemyVisible,engine.adapter.informationGapMask,conditions.fireGenerated,conditions.hardAllowed):null,
    conditions,informationGapMask:engine.adapter.informationGapMask,status:fold.status(),expected,seen:fold.seen,wins:fold.wins,draws:fold.draws,
    losses:fold.losses,unresolved:fold.unresolved,cells,authority:'CONDITIONAL_LOCAL_SHADOW',
    strictProof:false,actionOverride:false};
}
module.exports={TerminalEvidenceFold,evaluateShadow};
