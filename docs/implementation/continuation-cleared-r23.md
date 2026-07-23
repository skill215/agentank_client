# CONTINUATION 清零 + 全量回归 R23

状态：2026-07-20。在 projectile-aware Deadline 之后消化剩余 CONTINUATION，并跑
capsule-all + focused 对照 R21 / R22c。

## 结论

| 维度 | 结果 |
|---|---|
| CONTINUATION 8 固定续写 | **8 / 8 存活**（此前 3/8） |
| `npm run test:4` | **205/205 PASS** |
| Capsule-all 不变量 | **全部 0**（ACCEPTED） |
| 主池 vs R21 | 50→**86**（+36，`SURVIVE→DIE`=6） |
| 主池 vs R22c | 75→**86**（+11，`SURVIVE→DIE`=7） |
| 控制 vs R21/R22c | 68→**67**（`SURVIVE→DIE`=1） |
| 评估 | `NET_IMPROVEMENT_WITH_REGRESSIONS` |

## CONTINUATION 修复要点

在 `EscapeObligation` 中（配合 `enemyFireDepth`）：

1. **Bomb prep**：未进爆圈但 fuse slack≤6 → 强制 GO 起步（降级原地 TURN）
2. **Contact prep**：贴敌 → 强制 Deadline first-action，降级 GO
3. **Clearing GO + 近敌 / 低 fireDepth**：清出 GO 让位给 TURN
4. **堵死转向**：一侧 TURN 后 GO 撞墙则降级该 TURN（`64c3` TURN_LEFT）
5. **Soft scene**：仅当场上已有弹丸时，用 fireDepth≤1 做背敌转向（避免无实体误伤 CAST_POISON）
6. **Risk**：`escapeMobilityRank` 不再让 FIRE 压过 CAST_POISON（修 chance-geometry 夹具）

另：Info ForcedWin 授权行时**不**在 `!informationComplete` 下发布 Hard `PROVEN`
（修 21 个 capsule `strictProofOnIncomplete`；Step 6 潜伏，本轮全量才暴露）。

## CONTINUATION 8 再探针

```bash
./tools/fast-regression-toolchain.sh probe-death-categories \
  --allow-source-drift \
  --prior-report artifacts/fast-regression/reports/death-category-probe-b0/latest.json \
  --category-filter CONTINUATION_ESCAPE_GAP \
  --output-name death-category-continuation-cleared
```

| 项 | 值 |
|---|---:|
| `survivalAvoided` | **8** |
| `survivalStillDies` | **0** |
| `actionChanged` | 8 |
| fingerprint | `270609098b936b7ab508a65c22566f99e428572d1f5e938083d5b62e6297d8e8` |

## 全量回归

```bash
./tools/fast-regression-toolchain.sh verify --cohort initial-full --lane capsule-all
./tools/fast-regression-toolchain.sh diagnose-focused \
  --cohort native-poison-death \
  --report-name native-poison-death-continuation-cleared-r23
./tools/fast-regression-toolchain.sh compare-focused \
  --before-name native-poison-death-post-migration-full-r21 \
  --after-name native-poison-death-continuation-cleared-r23 \
  --output-name full-regression-r23-vs-r21
```

| 不变量 | R21 | R23 |
|---|---:|---:|
| avoidable Hard reject | 0 | 0 |
| risk-dominated selection | 0 | 0 |
| strict Proof false positive | 0 | 0 |
| root restore failure | 0 | 0 |
| Capsule failure | 0 | 0 |

Capsule fingerprint：`1ea04cb0222cbea23d8e931a72659d94a179419a80160b167015021e62be438d`  
墙钟约 45s（`totalRuntimeMicros ≈ 44.9s`）。

### Focused vs R21

| 指标 | R21 | R23 | Δ |
|---|---:|---:|---:|
| 主池存活 | 50 | **86** | +36 |
| `DIE→SURVIVE` | — | 42 | |
| `SURVIVE→DIE` | — | **6** | |
| 控制存活 | 68 | 67 | −1 |

### Focused vs R22c（短收敛+Step6）

| 指标 | R22c | R23 | Δ |
|---|---:|---:|---:|
| 主池存活 | 75 | **86** | +11 |
| `SURVIVE→DIE` | — | **7** | |
| 控制 | 68 | 67 | −1 |

工作源：`4d849fa1cc0491097e7bb198ff0f4fa774539cf7bf87ca6a5689701e387a129f`

## 边界 / 下一步

- CONTINUATION 样本已清零；主池净值上升，但同帧强制偏强带来 **6–7** 例
  `SURVIVE→DIE` 与 **1** 例控制回归。
- **已短收敛**：见 [short-convergence-r23b](short-convergence-r23b.md)
  （vs R22c `SURVIVE→DIE`=0，主池 75→87，CONTINUATION 仍 8/8）。
- Production 瘦身仍独立。
