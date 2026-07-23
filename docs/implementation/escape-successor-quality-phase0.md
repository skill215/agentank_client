# Escape Successor Quality — Phase 0

状态：2026-07-21。DeadlineKernel 产出 per-successor 证明质量字段，供后续
Escape Quality 字典序使用。本阶段**不**改 demote / Risk 排序。

## 动机

R23b 把「谁属于逃生集合」与「集合内谁更好」混在 demote 里。Quality 需要
**Deadline 证明含义明确**的 per-row 输出，而不能复用已写入 Safety death mass
的 `committedPressure` 分段启发式。

## API

文件：`engine-v2/src/fast/deadline-kernel.js`

### `SUCCESSOR_PROOF`

| 值 | 名 | 含义 |
|---|---|---|
| 0 | `PROVEN_DEAD` | 可证无逃生链 / tick1 lethal / 不可走 |
| 1 | `UNKNOWN` | 闭包不完整，不能证明 VIABLE |
| 2 | `PROVEN_VIABLE` | `viableTick1` 且 `hazard.complete && narrowProofComplete` |

### `evaluateSuccessor(bundle, cell, direction)`

| 字段 | 含义 |
|---|---|
| `proofStatus` | 上表三值 |
| `stillExposedAtDeadline` | committed 炸弹 footprint 或敌弹 hit-timeline（布尔） |
| `slack` | `deadlineTick - arrival`；不可达为 `-128` |
| `viableNextActionCount` | 从该 pose 出发 GO/TURN 落在 `viableTick2` 的个数 |
| `coverageComplete` | `hazard.complete && narrowProofComplete` |

### `evaluateSuccessorActions(bundle, actions, count, out)`

对每行 `successor(action)` 填并行数组（`proofStatus` / `stillExposedAtDeadline` /
`slack` / `viableNextActionCount` / `coverageComplete`）。

### Reverse 层

`buildReverse` 额外快照 `viableTick2`（与 `viableTick1` 同形）。

## 验收

- `npm run test:4` 中 `test/sr3/deadline-kernel.test.js` 新增夹具通过
- 不改 `EscapeObligation` demote、`restrictRiskController`、`lexicographicRiskLess`

## 落地备注（Phase 1+）

Risk 高优先只消费 `proofStatus` + `stillExposedAtDeadline`（避免 tied exposure 时
`branches` 误伤）。`slack` / `viableNextActionCount` 作细 tie-break。

全文见 [escape-quality-phases.md](escape-quality-phases.md)。
