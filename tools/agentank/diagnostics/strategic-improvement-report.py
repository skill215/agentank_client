"""Independent artifact/score/cohort audit for the bounded BP399 experiment.

This intentionally does not import the experiment's JavaScript scoring or
statistics functions. Existing artifacts are read only; the report is new.
"""
import base64
import gzip
import hashlib
import json
import pathlib
import sys

ROOT = pathlib.Path.cwd()
OUT = pathlib.Path(sys.argv[1]).resolve()


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
        value = .5 if stars[0] == stars[1] else float(stars[own] > stars[own ^ 1])
    elif any(crashes):
        value = float(not crashes[own])
    else:
        raise AssertionError('UNEXPECTED_TERMINAL_FOR_THIS_PROTOCOL')
    assert value == {'V2_WIN': 1, 'V1_WIN': 0, 'DRAW': .5}[r['analysisOutcome']]
    return value


def key(r):
    return r['matchUrlId'], r['candidateSeat']


def single(r):
    return int(score(r) == 0 and r['terminalCategory'] == 'SINGLE_CRASH')


def interval(records, tail=.025):
    groups = {}
    for name, delta in records:
        groups.setdefault(name, []).append(delta)
    arrays = list(groups.values())
    if not arrays:
        return {'n': 0, 'maps': 0, 'mean': 0, 'lo': 0, 'hi': 0}
    state = 399120
    means = []
    for _ in range(2000):
        total = count = 0
        for _ in arrays:
            state = (state * 1664525 + 1013904223) & 0xffffffff
            arr = arrays[int(state / 4294967296 * len(arrays))]
            total += sum(arr)
            count += len(arr)
        means.append(total / count)
    means.sort()
    return {'n': len(records), 'maps': len(arrays), 'mean': sum(d for _, d in records) / len(records),
            'lo': means[int(2000 * tail)], 'hi': means[min(1999, int(2000 * (1 - tail)))]}


def doubles(rs):
    groups = {}
    for r in rs:
        groups.setdefault(r['matchUrlId'], []).append(score(r))
    return sum(len(a) == 2 and sum(a) == 0 for a in groups.values())


def compare(before, after):
    index = {key(r): r for r in before}
    assert len(index) == len(before) == len(after)
    pairs = [(r, index[key(r)]) for r in after]
    records = [(r['matchUrlId'], score(r) - score(b)) for r, b in pairs]
    result = interval(records)
    result.update(deltaPoints=sum(d for _, d in records),
                  deathDelta=sum(single(r) - single(b) for r, b in pairs),
                  doubleLossDelta=doubles(after) - doubles(before),
                  nodeRatio=sum(r['audit']['nodes'] for r in after) / max(1, sum(r['audit']['nodes'] for r in before)),
                  interventions=sum(r['audit']['interventions'] for r in after))
    return result


manifest, protocol, summary = [read(OUT / f) for f in ('manifest.json', 'protocol.json', 'rounds.json')]
assert sha(OUT / 'protocol.json') == manifest['protocolHash']
assert sha(OUT / 'scenarios.json.gz') == manifest['scenarioHash']
for file, digest in manifest['sources'].items():
    assert sha(ROOT / file) == digest
    archive = OUT / 'sources' / file
    if archive.exists():
        assert sha(archive) == digest
assert len(summary['rounds']) == 10
assert [r['id'] for r in summary['rounds']] == [f'R{i}' for i in range(111, 121)]
assert sha(OUT / 'frozen-model.json') == read(OUT / 'R114.json')['modelHash']

scenes = {s['matchUrlId']: s for s in json.loads(gzip.decompress((OUT / 'scenarios.json.gz').read_bytes()))}
terrain_sets = []
for name, ids in protocol['splits'].items():
    assert len(ids) == len(set(ids))
    terrain = {json.dumps(scenes[i]['map'], separators=(',', ':')) for i in ids}
    assert len(terrain) == len(ids)
    assert all(not terrain.intersection(old) for old in terrain_sets)
    terrain_sets.append(terrain)

stage_rows = {}
for s in summary['stages']:
    directory = OUT / s['name']
    assert sha(directory / 'matches.ndjson.gz') == s['matchesHash']
    rs = rows(directory / 'matches.ndjson.gz')
    jobs = read(directory / 'jobs.json')
    checkpoints = {c['index']: c['row'] for c in [json.loads(x) for x in (directory / 'checkpoint.ndjson').read_text().splitlines()]}
    assert len(rs) == len(jobs) == len(checkpoints) == s['games']
    for i, r in enumerate(rs):
        assert r == checkpoints[i]
        assert r['job'] == jobs[i]
        assert r['scenarioFingerprint'] == scenes[r['matchUrlId']]['fingerprint']
        for side in ('candidate', 'control'):
            assert r[side]['errorCount'] == r[side]['timeoutCount'] == 0
        assert r['candidateEngine']['rootRestoreFailures'] == r['candidateEngine']['hotAllocations'] == 0
        score(r)
    stage_rows[s['name']] = rs
assert sum(len(r) for r in stage_rows.values()) == summary['executedGames'] <= protocol['limits']['maximumGames']

# Independently rebuild paired labels and verify exact pre-intervention commands.
label_checks = 0
for phase in ('R113', 'R114', 'R115'):
    captures = {key(r): r for r in stage_rows[phase + '-capture']}
    branches = stage_rows[phase + '-branches']
    labels = read(OUT / (phase + '-labels.json'))
    for ri, record in enumerate(labels):
        group = [r for r in branches if r['job']['rootIndex'] == ri]
        origin = captures[(record['map'], record['seat'])]
        frame = record['snapshot']['frame']
        baseline = {r['job']['suffix']: r for r in group if r['job']['action'] == record['snapshot']['baselineAction']}
        assert len(baseline) == 4
        for r in group:
            assert r['candidateEngine']['forceApplied'] == 1
            for side in ('candidate', 'control'):
                before = base64.b64decode(origin[side]['compactActionStream'])
                after = base64.b64decode(r[side]['compactActionStream'])
                assert before[:frame] == after[:frame]
                assert [a for a in origin[side]['compactArguments'] if a[0] < frame] == [a for a in r[side]['compactArguments'] if a[0] < frame]
            assert base64.b64decode(r['candidate']['compactActionStream'])[frame] == r['job']['action']
        for label in record['labels']:
            arm = [r for r in group if r['job']['action'] == label['action']]
            assert len(arm) == 4
            assert sum(score(r) - score(baseline[r['job']['suffix']]) for r in arm) / 4 == label['delta']
            assert sum(single(r) - single(baseline[r['job']['suffix']]) for r in arm) / 4 == label['deathDelta']
            assert sum(r['deathWithinFour'] for r in arm) == label['fourFrameDeaths']
            label_checks += 1

reports = {}
for phase in ('R116', 'R118', 'R119', 'R120'):
    saved = read(OUT / (phase + '.json'))['comparisons']
    reports[phase] = {}
    for mode, expected in saved.items():
        actual = compare(stage_rows[phase + '-baseline'], stage_rows[phase + '-' + mode])
        for field, value in actual.items():
            assert abs(value - expected[field]) < 1e-12, (phase, mode, field)
        reports[phase][mode] = actual
reports['R117'] = {'aligned': compare(stage_rows['R116-baseline'], stage_rows['R117-aligned'])}
versus_old = {mode: compare(stage_rows['R120-R29'], stage_rows['R120-' + mode]) for mode in ('gated', 'ungated', 'aligned')}


def passes(r):
    return r['deltaPoints'] > 0 and r['lo'] > 0 and r['deathDelta'] <= 0 and r['doubleLossDelta'] <= 0 and r['nodeRatio'] <= 2


qualified = [mode for mode in ('gated', 'ungated', 'aligned') if all(passes(reports[r][mode]) for r in ('R118', 'R120'))]
model = read(OUT / 'frozen-model.json')
held = read(OUT / 'R115.json')
report = {
    'status': 'INDEPENDENT_AUDIT_PASS', 'rounds': 10, 'executedGames': summary['executedGames'],
    'stageSeconds': sum(s['seconds'] for s in summary['stages']), 'wallSeconds': summary['seconds'],
    'cohortMaps': {name: len(ids) for name, ids in protocol['splits'].items()},
    'labelChecks': label_checks, 'acceptedBins': model['acceptedBins'], 'calibration': model['calibration'],
    'singleStepHeldout': held['singleStep'], 'advantageMSE': held['advantageMSE'], 'zeroAdvantageMSE': held['zeroAdvantageMSE'],
    'matches': reports, 'confirmationVersusOldR29': versus_old,
    'qualifiedDiagnosticCandidates': qualified, 'productionAdoption': False,
    'methodAssessment': {
        'measurement': 'Exact baseline/R29 replicas, branch-prefix equality, event-keyed randomness, isolated terrain and frozen model verified.',
        'performance': 'No new method qualifies.' if not qualified else 'Diagnostic qualification only; platform and deployment validation outstanding.',
        'conservativeFallback': 'No calibrated bin; gated policy retains baseline.' if not model['acceptedBins'] else 'Only supported calibrated bins can intervene.',
        'prediction': 'Heldout ridge beats zero-advantage MSE.' if held['advantageMSE'] < held['zeroAdvantageMSE'] else 'Heldout ridge fails to beat zero-advantage MSE.',
        'efficiency': 'Offline label acquisition is included in game/time cost. Matched frozen R29 comparison evaluates policies, not equal-budget optimization workflows.',
        'stoppingDecision': 'End this preregistered batch. Do not tune gates/features against test results or adopt a point-estimate winner.'},
    'limitations': [
        'Known historical corpus, one opponent, two stun skills, local scoring excludes raw runtime tie-break.',
        'Local simulator still has unresolved platform deviations; aligned candidate is not a verified platform model.',
        'Four suffix draws per root are noisy; bin bootstrap is not a per-state safety bound.',
        'Any-death four-frame labels do not isolate future-fire source calibration.',
        'One-step baseline-continuation labels can become invalid under repeated interventions.',
        'Search node ratio does not certify online CPU/allocation budget or minified deployment portability.',
        'No equal-budget randomized comparison of full optimization workflows; diagnostic rigor is not proof of better win rate.'],
    'verified': {'sourceHashes': True, 'archivedSources': True, 'artifactHashes': True,
                 'terrainIsolation': True, 'scoresRecomputed': True, 'pairedLabelsRecomputed': True,
                 'mapBootstrapRecomputed': True, 'modelFrozen': True, 'errors': 0, 'timeouts': 0},
    'reportSourceSha256': sha(pathlib.Path(__file__))}
target = OUT / 'independent-report.json'
assert not target.exists()
target.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
print(json.dumps(report, indent=2, ensure_ascii=False))
