# Match synchronization workflow

Run the complete workflow from WSL:

```sh
npm run matches:update
```

The script loads `AGENTANK_KEY_V1` from `.env.agentank.local`, creates a timestamped
batch, downloads only matches that do not already have valid `summary.json`,
`events.json`, and `raw.json`, then rebuilds all indexes and reports.

To resume or rebuild a specific batch:

```sh
npm run matches:update -- battle-records/all-missing-YYYYMMDD-HHMM-cst
```

Outputs:

- `battle-records/index/match-ids.txt`: one unique, complete Match ID per line.
- `battle-records/index/match-index.json`: preferred local path and duplicate copies.
- `battle-records/index/tank-skills.json`: observed skill votes by tank ID.
- `<batch>/manifest.json`: self-contained batch manifest reconstructed from raw files.
- `<batch>/analysis.json`, `matches.csv`, `failures.csv`, and `ANALYSIS.md`.
- `<batch>/classified/`: Match ID indexes by result, opponent, skill, version, and risk.

Individual stages are also available as `matches:index`, `matches:skills`,
`matches:manifest`, `matches:analyze`, `matches:classify`, and `matches:report`.
Network writes use atomic temporary files and retry each request up to five times.
An interrupted batch can be resumed by passing the same output directory.
