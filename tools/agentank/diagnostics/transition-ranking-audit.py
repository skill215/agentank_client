"""Independent reconstruction of BP409 persisted diagnostic evidence."""
import collections
import hashlib
import json
import math
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'artifacts/native-causal-audit/bp409-transition-ranking'

def read(p): return json.loads(p.read_text())
def sha(b): return hashlib.sha256(b).hexdigest()
def compact(x): return json.dumps(x,separators=(',',':'),ensure_ascii=False).encode()
def signature(r):
 return sha(compact([r['candidate']['compactActionStream'],r['candidate']['compactArguments'],r['control']['compactActionStream'],r['control']['compactArguments'],r['counts'],r['analysisOutcome'],r['terminalCategory']]))
def diff(a,b,p=''):
 if a==b:return []
 if isinstance(a,dict) and isinstance(b,dict):
  return [d for k in dict.fromkeys([*a,*b])for d in diff(a.get(k),b.get(k),p+'.'+k if p else k)]
 if isinstance(a,list) and isinstance(b,list):
  return [d for i in range(max(len(a),len(b)))for d in diff(a[i]if i<len(a)else None,b[i]if i<len(b)else None,p+'.'+str(i))]
 return [{'field':p,'model':a,'reference':b}]

def main():
 protocol=read(OUT/'run/protocol.json');state=read(OUT/'run/state.json')
 for f in protocol['pinnedInputs']:assert sha(Path(f['path']).read_bytes())==f['sha256']
 cohort=read(ROOT/'artifacts/native-causal-audit/bp407-next-stage/diagnosis/cohort.json')
 old=read(ROOT/'artifacts/native-causal-audit/bp407-next-stage/diagnosis/summary.json')
 frozen=read(ROOT/'artifacts/native-causal-audit/bp407-next-stage/diagnosis/failure-state-dataset.json')['cases']
 records=[];classes=collections.Counter();failure=collections.Counter();fields=collections.Counter();first=[];later=[];flips=[];unverified_rows=0;leaves=0;matrix=0
 for case in range(16):
  file=OUT/f'run/jobs/root-{case}.result.json';r=read(file);ledger=next(j for j in state['jobs']if j['id']==f'root-{case}')
  assert sha(file.read_bytes())==ledger['resultHash'];assert r['games']==1 and r['integrityPassed'] and r['safetyPassed']
  assert signature(r['row'])==signature(cohort[case]['reference'])==r['baselineSignature']
  cap=r['captured'];trans=r['transitions'];cs=trans['cells'];assert len(cs)==trans['branches']<=256
  arrays=list(cap['state']['arrays']);arrays[5]=[0,0];assert sha(compact(arrays))==frozen[case]['root']['state']['physicalSha256']
  assert diff(trans['initialModel'],trans['initialReference'])==trans['initialDifferences']
  grouped=collections.defaultdict(list);frame_leaves=cap['trace']['leaves'];leaves+=len(frame_leaves);assert len(frame_leaves)<=4096
  for c in cs:
   classes[c['classification']]+=1
   if c['classification']=='MODEL_UNSUPPORTED':failure[c['failureReason']]+=1
   if c['predicted'] is not None: assert diff(c['predicted'],c['reference'])==c['differences']
   if c['classification'] in ['TRANSITION_MATCH','TRANSITION_MISMATCH']:
    assert not trans['initialDifferences'] and not c['spawnSuppressed'] and c['randomCalls']==c['expectedRandomCalls']
    assert bool(c['differences'])==(c['classification']=='TRANSITION_MISMATCH')
   if c['classification']=='TRANSITION_MISMATCH':
    assert c['status'] in [1,2]
    for d in c['differences']:fields[d['field']]+=1;assert d['reference']-d['model']==1 and d['field'].endswith('skillReady')
  for c in cap['trace']['cells']:grouped[c['row']].append(c);matrix+=1
  for row,cells in grouped.items():
   first.append(cells[0]);later.extend(cells[1:]);a=cap['rows'][row]
   assert all(c['ownAction']==a['action']for c in cells)
   worst=min(c['value']for c in cells);expected=math.trunc(sum(c['value']*c['weight']for c in cells)/sum(c['weight']for c in cells))
   score=worst+math.trunc((expected-worst)*cap['blend']/10000)
   assert score==a['rootScore']==a['decomposition']['reconstructed']
   if a['backedValue'] is not None:assert a['backedValue']-score==a['decomposition']['intentAdjustment']
   for c in cells:
    assert c['leavesFrom']<=c['leavesTo']<=len(frame_leaves)
    for l in frame_leaves[c['leavesFrom']:c['leavesTo']]:
     if l['kind']=='heuristic':assert max(-25000,min(25000,sum(l['components'])))+l['pathAdjustment']==l['value']
  # Post-decision buffers may include appended fallback rows that were never
  # evaluated at this root. A nonzero old mask is not current search evidence.
  unverified_rows+=sum(a['rootScore']is not None and a['row']not in grouped for a in cap['rows'])
  valid=[a for a in cap['rows']if a['row']in grouped and a['ownerAllowed']and a['hardAllowed']and a['finalAllowed']]
  flip=None
  if valid:
   selected=next(a for a in valid if a['action']==cap['selectedAction']);assert selected['backedValue']==max(a['backedValue']for a in valid)
   raw_best=max(valid,key=lambda a:a['rootScore'])
   if raw_best['action']!=selected['action']:
    flip={'case':case,'withoutIntentBestAction':raw_best['action'],'selectedAction':selected['action'],'rawBest':raw_best['rootScore'],'selectedRaw':selected['rootScore'],'selectedBacked':selected['backedValue']};flips.append(flip)
  previous=next(x for x in old['rootResults']if x['case']==case)
  per=collections.Counter(c['classification']for c in cs)
  records.append({'case':case,'seat':r['row']['candidateSeat'],'frame':cap['frame'],'stratum':cohort[case]['stratum'],'searchActive':cap['searchActive'],'searchEntry':cap['searchEntry'],'selectedAction':cap['selectedAction'],'crossfitChosenAction':previous['selectionChosenAction'],'priorHeldoutDelta':previous['heldoutDelta'],'inputDifferences':trans['initialDifferences'],'transitionCounts':dict(per),'rows':[a for a in cap['rows']if a['row']in grouped],'intentFlip':flip})
 nodes_first=sum(c['nodes']for c in first);nodes_later=sum(c['nodes']for c in later)
 summary={'status':'PASS','games':len(records),'optimizationRounds':0,'singleStepPairs':sum(classes.values()),'classifications':dict(classes),'initiallyDifferentCases':[r['case']for r in records if r['inputDifferences']],'mismatchCases':[r['case']for r in records if r['transitionCounts'].get('TRANSITION_MISMATCH')],'mismatchFields':dict(fields),'unsupportedReasons':dict(failure),'rootActionsReconstructed':len(first),'rootResponseCellsReconstructed':matrix,'leafRecords':leaves,'nodeAllocation':{'firstResponseNodes':nodes_first,'laterResponseNodes':nodes_later,'firstResponseShare':nodes_first/(nodes_first+nodes_later),'laterResponses':len(later),'laterWithBudgetLeaves':sum(c['budgetLeaves']>0 for c in later),'laterAtMostTwoNodes':sum(c['nodes']<=2 for c in later)},'intentChanges':flips,'postDecisionRowsExcludedForMissingTrace':unverified_rows,'productionTree':protocol['batches'][0]['rounds'][0]['jobs'][0]['payload']['productionTree'],'productionChanged':False,'populationGainClaimed':False,'remainingUnknowns':['Reference star spawning suppressed on cloned branches; 264 branches are not full-world equivalence evidence.','Case 2 has hidden-enemy root uncertainty.','Only one-step transitions audited. Deep branch error and actual platform cooldown authority remain unresolved.','Leaf component averages describe visited leaves, not a linear explanation of minimax root value.','Observed budget imbalance is not proof that previously rejected budget/order strategies improve quality.']}
 (OUT/'independent-audit.json').write_text(json.dumps(summary,indent=2)+'\n');(OUT/'case-analysis.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(summary))

if __name__=='__main__':main()
