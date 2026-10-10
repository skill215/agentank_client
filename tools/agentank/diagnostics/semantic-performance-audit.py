#!/usr/bin/env python3
"""Independent checkpoint, pairing, timing, selection and source-integrity audit."""
import json, hashlib, pathlib, sys, math
out=pathlib.Path(sys.argv[1]).resolve()
batch=int(sys.argv[sys.argv.index('--batch')+1]) if '--batch' in sys.argv else 10
root=out.parents[2]
read=lambda p:json.loads(p.read_text())
sha=lambda b:hashlib.sha256(b).hexdigest()
p=read(out/'protocol.json')
for f,h in p['sourceHashes'].items():
    assert sha((root/f).read_bytes())==h, f
    assert sha((out/'sources'/pathlib.Path(f).name).read_bytes())==h
assert len(p['scenarios'])==100 and len({s['terrain'] for s in p['scenarios']})==100
assert sum(s['origin']=='historical-reuse' for s in p['scenarios'])==34

def stats(values):
    logs=list(map(math.log,values)); seed=405621; boots=[]
    for _ in range(2000):
        total=0
        for _ in logs:
            seed=(seed*1664525+1013904223)&0xffffffff
            total+=logs[int(seed/4294967296*len(logs))]
        boots.append(math.exp(total/len(logs)))
    q=lambda xs,v:sorted(xs)[int((len(xs)-1)*v)]
    return dict(n=len(values),ratio=math.exp(sum(logs)/len(logs)),median=q(values,.5),lo=q(boots,.025),hi=q(boots,.975),p95=q(values,.95))

def same_stats(got,expected):
    for k,v in expected.items():assert math.isclose(got[k],v,rel_tol=1e-11), (k,got[k],v)

def signature(r):
    return [r['candidate'].get('compactActionStream'),r['candidate'].get('compactArguments'),r['control'].get('compactActionStream'),r['control'].get('compactArguments'),r['counts'],r['analysisOutcome'],r['terminalCategory']]

def stage(name):
    jobs=read(out/name/'jobs.json'); rows=[]
    for line in (out/name/'checkpoint.ndjson').read_text().splitlines():
        e=json.loads(line); assert sha(e['payload'].encode())==e['sha256']; rows.append(json.loads(e['payload']))
    assert len(rows)==len(jobs)
    for i,r in enumerate(rows):
        assert r['job']==jobs[i]; assert signature(r)==signature(rows[0])
        for side in ['candidate','control']:assert r[side]['errorCount']==0 and r[side]['timeoutCount']==0
        assert r['candidateEngine']['rootRestoreFailures']==0 and r['candidateEngine']['hotAllocations']==0
        assert math.isclose(r['decisionMs'],sum(r['audit']['decisionTimesMs']),rel_tol=1e-12)
    return rows
pre=[r for i in range(8) for r in stage('preflight-'+str(i))]
assert len(pre)==24 and sum(r['audit']['shadowLeaves'] for r in pre)>0
active=['bulk-terrain','direct-bfs']; history=[]; games=24
for b in range(1,batch+1):
    plan=read(out/f'batch-{b}-plan.json');assert plan['active']==active
    assert plan['priorEvaluationHash']==(None if b==1 else sha((out/f'batch-{b-1}-evaluation.json').read_bytes()))
    for number in range(621+(b-1)*10,631+(b-1)*10):
        rows=stage('R'+str(number)); games+=len(rows); rec=read(out/f'R{number}.json'); history.append(rec)
        assert rec['round']==number and rec['exact'] and len(rows)==rec['games']==2*(1+len(active))
        assert list(rec['ratios'])==active
        assert rec['id']==p['scenarios'][number-621]['id']
        modes=[r['job']['mode'] for r in rows];assert modes==modes[::-1]
        for mode in ['baseline']+active:
            times=[r['decisionMs'] for r in rows if r['job']['mode']==mode];assert len(times)==2 and times==rec['timing'][mode]
            if mode!='baseline':assert math.isclose(rec['ratios'][mode],sum(times)/sum(rec['timing']['baseline']),rel_tol=1e-12)
        assert math.isclose(rec['baselineRepeatRatio'],rec['timing']['baseline'][1]/rec['timing']['baseline'][0],rel_tol=1e-12)
    ev=read(out/f'batch-{b}-evaluation.json');assert ev['measuredModes']==active
    evidence={m:stats([r['ratios'][m] for r in history if m in r['ratios']]) for m in active}
    for m,s in evidence.items():same_stats(ev['evidence'][m],s)
    retired=[]
    if b in [2,4]:retired=[m for m in active if (evidence[m]['lo']>1.05 if b==2 else evidence[m]['ratio']>=.99 and evidence[m]['lo']>.95)]
    active=[m for m in active if m not in retired]
    if b==7 and active:active=[min(active,key=lambda m:evidence[m]['ratio'])]
    assert ev['active']==active and ev['retired']==retired
    same_stats(ev['baselineNoise'],stats([r['baselineRepeatRatio'] for r in history[-10:]]))
if '--batch' not in sys.argv:
    summary=read(out/'summary.json');assert summary['rounds']==len(history)==100 and summary['totalPersistedGames']==games
    assert summary['formalGames']==games-24 and summary['productionTree']==p['productionTree']
    assert summary['productionUnchanged'] and not summary['productionAdoption']
    confirmation=history[70:]; noise=stats([r['baselineRepeatRatio'] for r in confirmation]);same_stats(summary['confirmationBaselineNoise'],noise)
    qualified=[]
    for m in active:
        s=stats([r['ratios'][m] for r in confirmation]);v=summary['final'][m];same_stats(v['stats'],s)
        groups={field+':'+key:stats([r['ratios'][m] for r in confirmation if r[field]==key]) for field in ['env','origin'] for key in {r[field] for r in confirmation}}
        for key,g in groups.items():same_stats(v['groups'][key],g)
        passed=s['ratio']<=.95 and s['hi']<1 and s['p95']<=1.10 and .95<=noise['ratio']<=1.05 and all(g['n']>=6 and g['ratio']<1 for g in groups.values())
        assert v['qualified']==passed
        if passed:qualified.append(m)
    assert summary['qualifiedDiagnostic']==qualified
result=dict(status='PASS',rounds=batch*10,games=games,sourceFiles=len(p['sourceHashes']),checks=['checkpoint SHA256','complete-game semantic pairing','health','timing reconstruction','independent bootstrap','selection/retirement/freeze','source integrity','final qualification' if '--batch' not in sys.argv else 'batch completeness'])
name='independent-audit.json' if '--batch' not in sys.argv else f'batch-{batch}-audit.json'
(out/name).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
