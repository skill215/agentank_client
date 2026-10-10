#!/usr/bin/env python3
import json,pathlib,hashlib,math,sys
p=pathlib.Path(sys.argv[1]).resolve();read=lambda f:json.loads((p/f).read_text());sha=lambda b:hashlib.sha256(b).hexdigest()
protocol=read('clean-process-protocol.json');result=read('clean-process-verification.json')
assert sha((p/'sources/hotspot-performance-clean-check.js').read_bytes())==protocol['sourceSha256']
assert sha((p.parents[2]/'tools/agentank/diagnostics/hotspot-performance-clean-check.js').read_bytes())==protocol['sourceSha256']
blocks=[read(f'clean-block-{i}.json') for i in range(6)]
def stats(values):
    logs=list(map(math.log,values));seed=405621;boots=[]
    for _ in range(2000):
        total=0
        for _ in logs:
            seed=(seed*1664525+1013904223)&0xffffffff;total+=logs[int(seed/4294967296*len(logs))]
        boots.append(math.exp(total/len(logs)))
    q=lambda xs,v:sorted(xs)[int((len(xs)-1)*v)]
    return dict(n=len(values),ratio=math.exp(sum(logs)/len(logs)),median=q(values,.5),lo=q(boots,.025),hi=q(boots,.975),p95=q(values,.95))
def eqstats(a,b):
    for k,v in b.items():assert math.isclose(a[k],v,rel_tol=1e-11),(k,a[k],v)
def signature(r):
    return [r['candidate'].get('compactActionStream'),r['candidate'].get('compactArguments'),r['control'].get('compactActionStream'),r['control'].get('compactArguments'),r['counts'],r['analysisOutcome'],r['terminalCategory']]
records=[]
for i in range(30):
    rows=[b['result'][i] for b in blocks];formal=read(f'R{791+i}.json')
    for b,r in enumerate(rows):
        assert blocks[b]['mode']==r['mode']==protocol['order'][b]
        assert r['round']==formal['round'];assert math.isclose(r['decisionMs'],sum(r['decisionTimesMs']),rel_tol=1e-12)
        assert signature(r['row'])==signature(rows[0]['row'])
        assert r['signature']==formal['semanticSha256']
        assert sha(json.dumps(signature(r['row']),ensure_ascii=False,separators=(',',':')).encode())==r['signature']
        for side in ['candidate','control']:assert r['row'][side]['errorCount']==0 and r['row'][side]['timeoutCount']==0
        assert r['row']['candidateEngine']['rootRestoreFailures']==0 and r['row']['candidateEngine']['hotAllocations']==0
    total=lambda m:sum(r['decisionMs'] for r in rows if r['mode']==m)
    expected=dict(versusOriginal=total(result['selected'])/total('original'),versusRecompiled=total(result['selected'])/total('recompiled'),negativeControl=total('recompiled')/total('original'))
    stored=result['records'][i]
    for k,v in expected.items():assert math.isclose(stored['ratios'][k],v,rel_tol=1e-12)
    repeat=rows[5]['decisionMs']/rows[0]['decisionMs'];assert math.isclose(stored['repeat'],repeat,rel_tol=1e-12)
    records.append(dict(env=formal['env'],origin=formal['origin'],ratios=expected,repeat=repeat))
qualified=True
for mode in ['versusOriginal','versusRecompiled']:
    s=stats([r['ratios'][mode] for r in records]);eqstats(result[mode]['stats'],s)
    groups={field+':'+key:stats([r['ratios'][mode] for r in records if r[field]==key]) for field in ['env','origin'] for key in {r[field] for r in records}}
    for k,v in groups.items():eqstats(result[mode]['groups'][k],v)
    passed=s['ratio']<=.95 and s['hi']<1 and s['p95']<=1.1 and all(v['n']>=6 and v['ratio']<1 for v in groups.values())
    assert result[mode]['qualified']==passed;qualified &= passed
for key,values in [('negativeControl',[r['ratios']['negativeControl'] for r in records]),('baselineRepeat',[r['repeat'] for r in records])]:
    s=stats(values);eqstats(result[key],s);qualified &= .95<=s['ratio']<=1.05
assert result['qualified']==qualified and result['games']==180 and result['warmupGames']==48
answer=dict(status='PASS',games=180,processes=6,pairedCases=30,qualified=qualified,checks=['full action/argument/outcome identity','fresh-source negative control','timing reconstruction','independent bootstrap and strata','final qualification','source fingerprint'])
(p/'clean-process-independent-audit.json').write_text(json.dumps(answer,indent=2)+'\n');print(json.dumps(answer))
