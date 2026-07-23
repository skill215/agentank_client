# DeadlineKernel（CONTINUATION 多帧逃生）

状态：2026-07-20 完成接线与门禁。相对 EscapeObligation 的下一语义增量。

## 结论

实现并接入 `DeadlineKernel`：在 **committed** bomb/projectile 的 Hazard 时间线上，用与
`reverseViable` 同构的 HOLD/turn/GO 奇偶规则求解：

- `earliestArrival` / `slack = deadline - earliestArrival`
- `firstAction` 动作码（优先 GO/TURN，有移动逃生时丢弃 FIRE/HOLD）
- `proofStatus`：ESCAPE_EXISTS / TRAPPED / INCOMPLETE

EscapeObligation 在仍暴露时用 Deadline 的 move/turn first-action 做**同帧硬收窄**，避免再选 FIRE。

| 门禁 | 结果 |
|---|---|
| `test/sr3/deadline-kernel.test.js` + EscapeObligation UT | 7/7 PASS |
| `npm run test:4` | **190/190 PASS** |
| 工作源 | `608e5c483c8656fbc2f63be24cc143d474e765ad67df1934a0d8de2c0dfe7749` |

## CONTINUATION 8 再探针

相对 B0 先验 8 例（允许源漂移）：

| 项 | EO-only | +DeadlineKernel |
|---|---:|---:|
| 选中动作改变 | 0 | **1** |
| 固定续写存活 | 0 | **1** |
| 仍死亡 | 8 | **7** |

存活样本：`8bb15faa:20` FIRE → **TURN_LEFT**（`dies=false`）。

其余 7 例多为 projectile / Deadline 未给出 move first-action（`firstN=0`），或逃生链首步仍死于固定敌方续写。

报告 fingerprint：`ee4066568173df3ecdb8e0788022ef14cc5e93f2ed96cc6e8be0ca359a667d2b`  
路径：`artifacts/fast-regression/reports/death-category-continuation-post-deadline/latest.json`

```bash
./tools/fast-regression-toolchain.sh probe-death-categories \
  --allow-source-drift \
  --prior-report artifacts/fast-regression/reports/death-category-probe-b0/latest.json \
  --category-filter CONTINUATION_ESCAPE_GAP \
  --output-name death-category-continuation-post-deadline
```

## 实现

- `engine-v2/src/fast/deadline-kernel.js`
- `engine-v2/src/runtime/escape-obligation.js`（调用 Deadline、同帧收窄）
- `production-root`：`risk.classify(..., committedSlack)` 接入真实 slack
- `test/sr3/deadline-kernel.test.js`

## 边界

- 不替代 Hard；不把 possible/hidden 升格为 Hard。
- 同帧收窄仅在 Deadline 给出 **move/turn** first-action 且仍暴露时。
- 不按爆圈内 manhattan 分档（保留 EO 对 chance-geometry 的保护）。

## 下一步

1. 加强 projectile deadline（命中 tick / 侧向闪避）覆盖剩余 CONTINUATION。  
2. 或并行 Information / value-depth（23+17）。

→ 已完成：见 [deadline-projectile-aware](deadline-projectile-aware.md)（3/8 存活）。
