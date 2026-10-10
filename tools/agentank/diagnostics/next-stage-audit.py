"""Independent persisted-data audit; no games or production mutations."""
import base64
import csv
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'artifacts/native-causal-audit/bp407-next-stage'

def read(path):
    return json.loads(path.read_text())

def digest(data):
    return hashlib.sha256(data).hexdigest()

def compact(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()

def semantic(row):
    return [row['candidate']['compactActionStream'], row['candidate']['compactArguments'],
            row['control']['compactActionStream'], row['control']['compactArguments'],
            row['counts'], row['analysisOutcome'], row['terminalCategory']]

def health(row):
    for side in ['candidate', 'control']:
        assert row[side]['timeoutCount'] == row[side]['errorCount'] == 0

def checkpoint(name):
    result = []
    for line in (OUT / 'diagnosis' / (name + '.ndjson')).read_text().splitlines():
        envelope = json.loads(line)
        assert digest(envelope['payload'].encode()) == envelope['sha256']
        result.append(json.loads(envelope['payload']))
    return result

def interval(values, geometric=False):
    # Map is the sampling unit; one value per distinct map in this audit.
    data = [math.log(v) for v in values] if geometric else values
    state = 405621 if geometric else 399120
    boot = []
    for _ in range(2000):
        xs = []
        for _ in data:
            state = (state * 1664525 + 1013904223) & 0xffffffff
            xs.append(data[math.floor(state / 4294967296 * len(data))])
        boot.append(math.exp(mean(xs)) if geometric else mean(xs))
    boot.sort()
    return {'maps': len(data), 'mean': math.exp(mean(data)) if geometric else mean(data),
            'lo': boot[49 if geometric else 50], 'hi': boot[1949 if geometric else 1950]}

def prefix(base, row, frame, action):
    for side in ['candidate', 'control']:
        a, b = base64.b64decode(base[side]['compactActionStream']), base64.b64decode(row[side]['compactActionStream'])
        assert a[:frame] == b[:frame]
        assert [x for x in base[side]['compactArguments'] if x[0] < frame] == [x for x in row[side]['compactArguments'] if x[0] < frame]
        if side == 'candidate':
            assert b[frame] == action


def run():
    runtime = OUT / 'runtime'
    rp, dp = read(runtime / 'protocol.json'), read(OUT / 'diagnosis/protocol.json')
    for filename, protocol in [('next-stage-runtime.js', rp), ('decision-bottleneck-diagnostics.js', dp)]:
        assert digest((ROOT / 'tools/agentank/diagnostics' / filename).read_bytes()) == protocol['sourceSha256']
    tree = hashlib.sha256()
    def visit(relative):
        for p in sorted((ROOT / relative).iterdir(), key=lambda p: p.name):
            rel = relative / p.name
            if p.is_dir():
                visit(rel)
            else:
                tree.update(str(rel).encode() + b'\0' + p.read_bytes() + b'\0')
    visit(Path('engine-v2/src'))
    assert tree.hexdigest() == rp['productionTree'] == dp['productionTree']
    rs = read(runtime / 'summary.json')
    for mode, build in rs['builds'].items():
        for kind in ['source', 'minified']:
            blob = (runtime / 'build' / mode / (kind + '.js')).read_bytes()
            assert digest(blob) == build[kind + 'Sha256']
            if kind == 'minified':
                assert len(blob) == build['bytes'] <= build['limit']
    native = read(runtime / 'native.json')['rows']
    checked = 0
    for name in ['native', 'baseline-source', 'candidate-source', 'baseline-minified', 'candidate-minified', 'baseline-memory', 'candidate-memory'] + ['timing-' + str(i) for i in range(4)]:
        rows = read(runtime / (name + '.json'))['rows']
        assert len(rows) == 16
        for i, row in enumerate(rows):
            health(row)
            assert digest(compact(semantic(row))) == row['signature']
            assert semantic(row) == semantic(native[i])
            checked += 1
    mb, mc = [read(runtime / (m + '-memory.json'))['rows'] for m in ['baseline', 'candidate']]
    for b, c in zip(mb, mc):
        assert b['candidateEngine']['observedTypedArrays'] == c['candidateEngine']['observedTypedArrays']
    timing = [read(runtime / ('timing-' + str(i) + '.json'))['rows'] for i in range(4)]
    maps = defaultdict(list)
    for i, case in enumerate(rs['cases']):
        ms = [block[i]['candidateEngine']['runtimeMicros'] / 1000 for block in timing]
        assert ms == case['ms']
        ratio = (ms[1] + ms[2]) / (ms[0] + ms[3])
        assert abs(ratio - case['ratio']) < 1e-12
        maps[case['id']].append(ratio)
    cluster = interval([math.exp(mean(map(math.log, x))) for x in maps.values()], True)
    assert cluster['hi'] < 1
    baseline, budgets, cf = [checkpoint(n) for n in ['baseline', 'budget', 'counterfactual']]
    assert [len(x) for x in [baseline, budgets, cf]] == [16, 128, 624]
    cohort = read(OUT / 'diagnosis/cohort.json')
    ds = read(OUT / 'diagnosis/summary.json')
    assert len({digest(compact(c['scene']['map'])) for c in cohort}) == 16
    for b, ref in zip(baseline, cohort):
        assert semantic(b['baseline']) == semantic(ref['reference'])
        arrays = list(b['root']['state']['arrays']); arrays[5] = [0, 0]
        assert digest(compact(arrays)) == b['root']['state']['physicalSha256']
    seen = set()
    for r in budgets:
        k = (r['case'], r['budget'], r['rep']); assert k not in seen; seen.add(k)
        b = baseline[r['case']]; health(r['row'])
        assert r['row']['candidateEngine']['rootRestoreFailures'] == r['row']['candidateEngine']['hotAllocations'] == 0
        arrays = list(r['root']['state']['arrays']); arrays[5] = [0, 0]
        assert digest(compact(arrays)) == r['root']['state']['physicalSha256'] == b['root']['state']['physicalSha256']
        prefix(b['baseline'], r['row'], b['root']['frame'], r['root']['selectedAction'])
        if r['budget'] == 128:
            assert semantic(b['baseline']) == semantic(r['row'])
    seen = set()
    for r in cf:
        k = (r['case'], r['action'], r['suffix']); assert k not in seen; seen.add(k)
        b = baseline[r['case']]; health(r['row'])
        assert r['audit']['forceSeen'] == r['audit']['forceApplied'] == 1
        assert r['row']['candidateEngine']['rootRestoreFailures'] == r['row']['candidateEngine']['hotAllocations'] == 0
        prefix(b['baseline'], r['row'], b['root']['frame'], r['action'])
        assert any(x['action'] == r['action'] and x['hardAllowed'] and x['finalAllowed'] for x in b['root']['rows'])
        assert r['score'] == {'V2_WIN': 1, 'DRAW': .5, 'V1_WIN': 0}[r['row']['analysisOutcome']]
        assert r['death'] == int(r['row']['counts']['crashes'][b['seat']] > 0)
    records = []
    for r in ds['rootResults']:
        branches = [c for c in cf if c['case'] == r['case']]
        actions = sorted({c['action'] for c in branches})
        def value(action, key='score', validation=True):
            rows = [c for c in branches if c['action'] == action and (c['suffix'] >= 4) == validation]
            assert len(rows) == 4
            return mean(c[key] for c in rows)
        selected = min(actions, key=lambda a: (-value(a, validation=False), a != r['baselineAction'], a))
        assert selected == r['selectionChosenAction']
        delta = value(selected) - value(r['baselineAction'])
        assert delta == r['heldoutDelta']
        for b, result in r['budgets'].items():
            reps = [x for x in budgets if x['case'] == r['case'] and x['budget'] == int(b)]
            assert len(reps) == 2
            assert semantic(reps[0]['row']) == semantic(reps[1]['row'])
            assert reps[0]['root']['selectedAction'] == reps[1]['root']['selectedAction'] == result['action']
            assert result['action'] in actions, 'Missing counterfactual support must not become zero'
            assert value(result['action']) - value(r['baselineAction']) == result['validationDelta']
        records.append({'case': r['case'], 'stratum': r['stratum'], 'baselineAction': r['baselineAction'], 'chosenAction': selected, 'ownerAllowed': r['chosenOwnerAllowed'], 'scoreDelta': delta, 'deathDelta': value(selected, 'death') - value(r['baselineAction'], 'death')})
    crossfit = interval([r['scoreDelta'] for r in records])
    for key in ['mean', 'lo', 'hi']:
        assert crossfit[key] == ds['crossfitDiagnosticDelta'][key]
    budget_stats = {}
    for b in ['64', '128', '256', '512']:
        v = interval([r['budgets'][b]['validationDelta'] for r in ds['rootResults']])
        for key in ['mean', 'lo', 'hi']:
            assert v[key] == ds['budgetValidationDeltas'][b][key]
        budget_stats[b] = {**v, 'changedActions': sum(r['budgets'][b]['action'] != r['baselineAction'] for r in ds['rootResults']), 'meanNodes': mean(r['budgets'][b]['nodes'] for r in ds['rootResults']), 'meanDecisionMsExploratory': mean(mean(r['budgets'][b]['decisionMs']) for r in ds['rootResults'])}
    report = {'status': 'PASS', 'productionTree': tree.hexdigest(), 'runtimeRowsRehashed': checked, 'checkpointHashesVerified': len(baseline) + len(budgets) + len(cf), 'prefixesRechecked': len(budgets) + len(cf), 'budgetPhysicalStatesRehashed': len(budgets), 'counterfactualPhysicalStates': 'Verified by runtime assertions; full intervention-state snapshots were not retained in counterfactual checkpoints.', 'runtimeMapClusterRatio': cluster, 'runtimeTimeReduction': 1 - cluster['mean'], 'runtimeTimeReductionInterval': [1 - cluster['hi'], 1 - cluster['lo']], 'crossfitScore': crossfit, 'crossfitDeath': interval([r['deathDelta'] for r in records]), 'casesWithHigherHeldoutDeath': [r['case'] for r in records if r['deathDelta'] > 0], 'budgetStats': budget_stats, 'budgetCounterfactualMissing': 0, 'positiveCases': sum(r['scoreDelta'] > 0 for r in records), 'zeroCases': sum(r['scoreDelta'] == 0 for r in records), 'negativeCases': sum(r['scoreDelta'] < 0 for r in records), 'totalNewGamesIncludingWarmups': 960, 'limitations': 'Intervals describe reused, selected maps and fixed suffix seeds. Runtime process/order uncertainty is not fully covered by the map bootstrap. No remote certification or population gain claim.'}
    with (OUT / 'case-diagnostics.csv').open('w') as f:
        writer = csv.DictWriter(f, fieldnames=list(records[0])); writer.writeheader(); writer.writerows(records)
    (OUT / 'independent-audit.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report))

if __name__ == '__main__':
    run()
