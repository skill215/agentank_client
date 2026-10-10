"""Independent round, score, cohort and batch-decision audit for BP402."""
import itertools
import base64
import gzip
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path.cwd()
OUT = pathlib.Path(sys.argv[1]).resolve()
BATCH = int(sys.argv[sys.argv.index('--batch') + 1]) if '--batch' in sys.argv else 10
FINAL = '--batch' not in sys.argv


def read(p):
    return json.loads(p.read_text())


def sha(p):
    return hashlib.sha256(p.read_bytes()).hexdigest()


def rows(p):
    return [json.loads(s) for s in gzip.decompress(p.read_bytes()).splitlines()]


def score(r):
    own = r['candidateSeat']
    stars, crashes = r['counts']['stars'], r['counts']['crashes']
    if r['result']['reason'] == 'frameLimit' or all(crashes):
        v = .5 if stars[0] == stars[1] else float(stars[own] > stars[own ^ 1])
    elif any(crashes):
        v = float(not crashes[own])
    else:
        raise AssertionError('UNEXPECTED_TERMINAL')
    assert v == {'V2_WIN': 1, 'V1_WIN': 0, 'DRAW': .5}[r['analysisOutcome']]
    return v


def key(r):
    return r['job']['round'], r['job']['env'], r['matchUrlId'], r['candidateSeat']


def single(r):
    return int(score(r) == 0 and r['terminalCategory'] == 'SINGLE_CRASH')


def doubles(rs):
    d = {}
    for r in rs:
        d.setdefault((r['job']['round'], r['job']['env'], r['matchUrlId']), []).append(score(r))
    return sum(len(x) == 2 and sum(x) == 0 for x in d.values())


def compare(base, candidate):
    index = {key(r): r for r in base}
    assert len(index) == len(base) == len(candidate)
    paired = [(r, index[key(r)]) for r in candidate]
    result = {'n': len(paired), 'maps': len({r['matchUrlId'] for r in candidate}),
              'deltaPoints': sum(score(r) - score(b) for r, b in paired),
              'semanticChanges': sum(any(r[side][field] != b[side][field] for side in ['candidate', 'control'] for field in ['compactActionStream', 'compactArguments']) or score(r) != score(b) for r, b in paired),
              'deathDelta': sum(single(r) - single(b) for r, b in paired),
              'doubleLossDelta': doubles(candidate) - doubles(base),
              'nodeRatio': sum(r['audit']['nodes'] for r in candidate) / max(1, sum(r['audit']['nodes'] for r in base)),
              'leafExecutionRatio': sum(r['audit']['leafExecutions'] for r in candidate) / max(1, sum(r['audit']['leafExecutions'] for r in base)),
              'cacheHits': sum(r['audit']['cacheHits'] for r in candidate),
              'transitionRatio': sum(r['audit']['transitions'] for r in candidate) / max(1, sum(r['audit']['transitions'] for r in base))}
    result['mean'] = result['deltaPoints'] / max(1, len(paired))
    return result


def interval(base, candidate):
    index = {key(r): r for r in base}
    groups = {}
    for r in candidate:
        groups.setdefault(r['matchUrlId'], []).append(score(r) - score(index[key(r)]))
    arrays = [(sum(a), len(a)) for a in groups.values()]
    if not arrays:
        return [0, 0]
    state = 399120
    means = []
    for _ in range(6000):
        total = count = 0
        for _ in arrays:
            state = (state * 1664525 + 1013904223) & 0xffffffff
            a, n = arrays[int(state / 4294967296 * len(arrays))]
            total += a
            count += n
        means.append(total / count)
    means.sort()
    return [means[int(6000 * (.05 / 120))], means[min(5999, int(6000 * (1 - .05 / 120)))]]


def verify_comparisons(all_rows, summaries, role='validation', verify_intervals=False):
    for mode, envs in summaries.items():
        for env, expected in envs.items():
            candidate = [r for r in all_rows if r['job']['mode'] == mode and r['job']['env'] == env and (role == 'all' or r['job']['role'] == role)]
            keys = {key(r) for r in candidate}
            base = [r for r in all_rows if r['job']['mode'] == 'baseline' and key(r) in keys]
            actual = compare(base, candidate)
            for k, value in actual.items():
                assert abs(value - expected[k]) < 1e-12, (mode, env, k, value, expected[k])
            if verify_intervals:
                lo, hi = interval(base, candidate)
                assert abs(lo - expected['lo']) < 1e-12
                assert abs(hi - expected['hi']) < 1e-12


manifest, protocol = read(OUT / 'manifest.json'), read(OUT / 'protocol.json')
assert sha(OUT / 'protocol.json') == manifest['protocolHash']
assert sha(OUT / 'scenarios.json.gz') == manifest['scenarioHash']
for file, digest in manifest['sourceHashes'].items():
    assert sha(ROOT / file) == digest
    assert sha(OUT / 'sources' / file) == digest
scenes = {s['matchUrlId']: s for s in json.loads(gzip.decompress((OUT / 'scenarios.json.gz').read_bytes()))}
ids = [i for group in protocol['batchMaps'] for i in group]
assert len(ids) == len(set(ids)) == 300
terrain = [json.dumps(scenes[i]['map'], separators=(',', ':')) for i in ids]
assert len(set(terrain)) == 300
assert sum(scenes[i]['origin'] == 'historical' for i in ids) == 60
assert all(scenes[i]['origin'] == 'synthetic' for i in ids[:210])
for offset in range(210, 300, 3):
    assert [scenes[i]['origin'] for i in ids[offset:offset+3]] == ['historical', 'historical', 'synthetic']
pre = rows(OUT / 'preflight/matches.ndjson.gz')
assert len(pre) == 24
assert read(OUT / 'preflight.json')['exactEquivalence']
history, batch_rows, stages = [], [], []
start = 321 + (BATCH - 1) * 10
for number in range(321, 321 + BATCH * 10):
    directory = OUT / ('R' + str(number))
    execution = read(directory / 'execution.json')
    assert sha(directory / 'matches.ndjson.gz') == execution['sha256']
    rs, jobs = rows(directory / 'matches.ndjson.gz'), read(directory / 'jobs.json')
    assert len(rs) == len(jobs) == execution['games']
    checkpoints = [json.loads(s) for s in (directory / 'checkpoint.ndjson').read_text().splitlines()]
    assert len(checkpoints) == len(rs)
    assert {c['index'] for c in checkpoints} == set(range(len(rs)))
    for c in checkpoints:
        assert c['row'] == rs[c['index']]
    plan = read(OUT / ('batch-' + str((number - 321) // 10 + 1) + '-plan.json'))
    offset = (number - 321) % 10
    expected_ids = set(plan['maps'][offset * 3:offset * 3 + 3])
    assert len(rs) == len(plan['modes']) * 12
    assert {(r['job']['mode'], r['job']['env'], r['matchUrlId'], r['candidateSeat']) for r in rs} == set(itertools.product(plan['modes'], ['original', 'event'], expected_ids, [0, 1]))
    for i, r in enumerate(rs):
        assert r['job'] == jobs[i]
        assert r['matchUrlId'] in expected_ids
        assert r['scenarioFingerprint'] == scenes[r['matchUrlId']]['fingerprint']
        assert r['job']['role'] == ('discovery' if offset < plan['discoveryRounds'] else 'validation')
        assert r['job']['mode'] in plan['modes']
        assert r['job']['origin'] == scenes[r['matchUrlId']]['origin']
        for side in ('candidate', 'control'):
            assert r[side]['errorCount'] == r[side]['timeoutCount'] == 0
        assert r['candidateEngine']['rootRestoreFailures'] == r['candidateEngine']['hotAllocations'] == 0
        score(r)
    if number >= start:
        verify_comparisons(rs, read(OUT / ('R' + str(number) + '.json'))['comparisons'], 'all')
        batch_rows += rs
    history += rs
    stages.append(execution)
evaluation = read(OUT / ('batch-' + str(BATCH) + '-evaluation.json'))
assert evaluation['completedRounds'] == BATCH * 10
assert evaluation['completedGames'] == len(history) + 24
verify_comparisons(batch_rows, evaluation['batchValidation'])
verify_comparisons(history, evaluation['cumulativeValidation'])
for mode, ev in evaluation['evidence'].items():
    a, b = [evaluation['cumulativeValidation'][mode][env] for env in ('original', 'event')]
    assert ev['rngConflict'] == (a['mean'] * b['mean'] < 0 and abs(a['mean'] - b['mean']) >= .04)
    assert ev['strong'] == (min(a['maps'], b['maps']) >= 48 and all(x['lo'] > 0 and x['mean'] >= .02 and x['deathDelta'] <= 0 and x['doubleLossDelta'] <= 0 and x['nodeRatio'] <= 1.25 and x['transitionRatio'] <= 1.25 for x in (a, b)))
    looks = len({r['job']['batch'] for r in history if r['job']['mode'] == mode and r['job']['role'] == 'validation'})
    cost = any(x['nodeRatio'] > 1.25 or x['transitionRatio'] > 1.25 for x in (a, b))
    inactive = min(a['maps'], b['maps']) >= 24 and a['semanticChanges'] + b['semanticChanges'] == 0
    negative = looks >= 2 and a['mean'] < 0 and b['mean'] < 0 and a['deltaPoints'] + b['deltaPoints'] <= -4
    futile = min(a['maps'], b['maps']) >= 72 and all(x['hi'] < .02 for x in (a, b))
    assert ev['retire'] == (cost or inactive or negative or futile)
    if ev['retire']:
        assert mode in evaluation['retired']
for mode, support in evaluation['discoverySupport'].items():
    rs = [r for r in history if r['job']['mode'] == mode and r['job']['role'] == 'discovery']
    assert support == {'maps': len({r['matchUrlId'] for r in rs}), 'batches': len({r['job']['batch'] for r in rs})}
if BATCH == 7:
    for mode in evaluation['nextActive']:
        assert evaluation['discoverySupport'][mode]['maps'] >= 24
        assert evaluation['discoverySupport'][mode]['batches'] >= 2
assert evaluation['productionChampion'] == 'baseline'
assert not set(evaluation['nextActive']) & set(evaluation['retired']) or BATCH >= 8
assert set(read(OUT / ('batch-' + str(BATCH) + '-plan.json'))['stateBefore']['retired']) <= set(evaluation['retired'])
if BATCH >= 8:
    frozen = read(OUT / 'batch-7-evaluation.json')['nextActive']
    assert read(OUT / ('batch-' + str(BATCH) + '-plan.json'))['stateBefore']['active'] == frozen
    assert evaluation['nextActive'] == frozen
if BATCH > 1:
    plan = read(OUT / ('batch-' + str(BATCH) + '-plan.json'))
    assert plan['priorEvaluationHash'] == sha(OUT / ('batch-' + str(BATCH - 1) + '-evaluation.json'))
    assert plan['stateBefore'] == read(OUT / ('batch-' + str(BATCH - 1) + '-evaluation.json'))['stateAfter']
result = {'status': 'INDEPENDENT_BATCH_AUDIT_PASS', 'batch': BATCH, 'rounds': BATCH * 10,
          'games': len(history) + 24, 'decision': evaluation['decision'],
          'verified': ['source/archive hashes', '300 unique terrains', 'checkpoint rows', 'score reconstruction', 'paired comparisons', 'work counters', 'decision evidence', 'state chain', 'frozen final confirmation'],
          'scriptSha256': sha(pathlib.Path(__file__))}
if FINAL:
    summary = read(OUT / 'summary.json')
    assert summary['rounds'] == 100 and summary['executedGames'] == len(history) + 24
    assert summary['executedGames'] <= protocol['budget']['maximumGames']
    confirmation = [r for r in history if r['job']['batch'] >= 8]
    verify_comparisons(confirmation, summary['finalComparisons'], verify_intervals=True)
    for origin, expected in summary['finalByOrigin'].items():
        verify_comparisons([r for r in confirmation if r['job']['origin'] == origin], expected, verify_intervals=True)
    def supported(envs, maps):
        return all(x['maps'] >= maps and x['mean'] >= .02 and x['lo'] > 0 and x['deathDelta'] <= 0 and x['doubleLossDelta'] <= 0 and x['nodeRatio'] <= 1.25 and x['transitionRatio'] <= 1.25 for x in envs.values())
    qualified = [m for m in summary['finalModes'] if supported(summary['finalComparisons'][m], 48) and all(supported(summary['finalByOrigin'][origin][m], 24) for origin in ['historical', 'synthetic'])]
    assert qualified == summary['finalQualifiedDiagnostic']
    versus_old = {}
    for mode in summary['finalModes']:
        versus_old[mode] = {}
        for env in ('original', 'event'):
            candidate = [r for r in confirmation if r['job']['mode'] == mode and r['job']['env'] == env]
            base = [r for r in confirmation if r['job']['mode'] == 'R29' and r['job']['env'] == env]
            report = compare(base, candidate)
            report['adjustedDescriptiveInterval'] = interval(base, candidate)
            versus_old[mode][env] = report
    result.update(status='INDEPENDENT_100_ROUND_AUDIT_PASS', decisions=[read(OUT / ('batch-' + str(b) + '-evaluation.json'))['decision'] for b in range(1, 11)],
                  finalModes=summary['finalModes'], finalQualifiedDiagnostic=summary['finalQualifiedDiagnostic'], finalComparisons=summary['finalComparisons'], finalByOrigin=summary['finalByOrigin'],
                  confirmationVersusOldR29=versus_old, stageSeconds=summary['stageSeconds'], productionUnchanged=summary['productionUnchanged'], productionAdoption=False,
                  workflowSuperiority='Not established by an equal-budget optimizer comparison; candidate performance and process decisions are separately recorded.')
target = OUT / ('independent-audit.json' if FINAL else 'batch-' + str(BATCH) + '-audit.json')
encoded = json.dumps(result, indent=2, ensure_ascii=False) + '\n'
if target.exists():
    assert target.read_text() == encoded
else:
    target.write_text(encoded)
print(json.dumps({'status': result['status'], 'rounds': result['rounds'], 'games': result['games'], 'decision': evaluation['decision']}))
