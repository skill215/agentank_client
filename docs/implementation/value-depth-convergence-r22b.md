# 短收敛 R22b（SURVIVE→DIE 收紧）

状态：2026-07-20。针对 R22 的 5 例主池 `SURVIVE→DIE` 做死亡压力选择收紧。

## 改动

`RiskAcceptanceController`：

- `ESCAPE_ROBUST_SLACK = 80`：近打平的 robust 不能让 FIRE 抬高 safeFloor / 支配 GO·TURN；
- 逃生类同级：`GO` 与 `TURN_*` 同 mobility rank；
- 同级且在 slack 内：按更高 `expected` 破平（避免 min-tactical 抬炸弹/空转）。

## 结果 vs R21

| 指标 | R22（激进） | R22b（收敛） |
|---|---:|---:|
| 主池存活 | 85 | **75** |
| `SURVIVE→DIE` | 5 | **1** |
| 控制退化 | 0 | 0 |
| 净增益 | +35 | **+25** |

剩余 1 例：`826c5155:26` TURN→GO（committed bomb+projectile）。

评估仍为 `NET_IMPROVEMENT_WITH_REGRESSIONS`（仅 1 回归），显著干净于 R22。

报告：`artifacts/fast-regression/reports/full-regression-r22b-vs-r21/`
