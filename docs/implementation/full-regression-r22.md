# 全量回归验证 R22（value-depth 残差/性能修复后）

状态：2026-07-20。对照冻结 R21（`workingSourceSha256 = d2f0791d…`）。
当前工作源 `81febbed…`（`sourceIdentity()`）。未 publish、未改参数。

## 结论

| 维度 | 判定 |
|---|---|
| 安全门（19,136 Capsule） | **无劣化**（全部不变量仍为 0） |
| 历史死亡窗口存活 | **明显更好**：50 → **85**（净 +35） |
| 存活控制 | **无劣化**：68 → 68（`SURVIVE→DIE` = 0） |
| 评估标签 | `NET_IMPROVEMENT_WITH_REGRESSIONS`（主池有 5 例 `SURVIVE→DIE`） |
| 性能（capsule-all 墙钟） | **更好**：141.0s → **44.3s**（约 −69%；含负载波动，见下） |

## 1. Capsule-all 安全门

```bash
./tools/fast-regression-toolchain.sh verify --cohort initial-full --lane capsule-all
```

| 不变量 | R21 | R22 |
|---|---:|---:|
| completed | 19136 | 19136 |
| avoidable Hard reject | 0 | 0 |
| risk-dominated selection | 0 | 0 |
| strict Proof false positive | 0 | 0 |
| root restore failure | 0 | 0 |
| Capsule failure | 0 | 0 |

报告：`artifacts/fast-regression/reports/capsule-all/0ebc66a20a5c4b1798297c185abd23de4b18dec18e41eb4e2d325919df5e551f.json`

## 2. Focused 死亡窗口 vs R21

```bash
./tools/fast-regression-toolchain.sh diagnose-focused \
  --cohort native-poison-death \
  --report-name native-poison-death-value-depth-perf-r22
./tools/fast-regression-toolchain.sh compare-focused \
  --before-name native-poison-death-post-migration-full-r21 \
  --after-name native-poison-death-value-depth-perf-r22 \
  --output-name full-regression-r22-vs-r21
```

| 指标 | R21 | R22 | Δ |
|---|---:|---:|---:|
| 主池固定续局存活 | 50 / 256 | **85 / 256** | **+35** |
| `DIE→SURVIVE` | — | 40 | |
| `SURVIVE→DIE` | — | **5** | |
| 控制存活 | 68 / 96 | 68 / 96 | 0 |
| 控制 `SURVIVE→DIE` | — | **0** | |

比较报告：`artifacts/fast-regression/reports/full-regression-r22-vs-r21/1841ef8c…json`

### 5 例主池 `SURVIVE→DIE`（需知情，不掩盖）

| match / frame | R21 动作 | R22 动作 |
|---|---|---|
| `mat_1pf8…` :36 | TURN_LEFT | FIRE |
| `mat_4BxA…` :42 | TURN_LEFT | FIRE |
| `mat_5oMg…` :26 | GO | TURN_RIGHT |
| `mat_7wBd…` :26 | TURN_LEFT | GO |
| `mat_FaNO…` :94 | TURN_LEFT | FIRE |

模式：多数为死亡压力破平后改选 FIRE/GO，固定续局下反而致死。控制集未退化。

## 3. 失败桶（avoidable 165）

| 桶 | R21 | R22 |
|---|---:|---:|
| `CURRENT_SURVIVOR` | 50 | **85** |
| `NO_ACCEPTABLE_RESCUE` | 55 | **45** |
| `DOMINATED_RESCUE` | 39 | **26** |
| `RESCUE_AT_OR_ABOVE_FLOOR` | 12 | 5 |
| `LOWER_ROBUST_RESCUE` | 9 | 4 |

`DOMINATED_RESCUE` 根因：

| 根因 | R21 | R22 |
|---|---:|---:|
| `VALUE_DEPTH_NON_DISCRIMINATION` | 23 | **12** |
| `PATH_RISK_INVERSION` | 7 | 6 |
| 其他 | 9 | 8 |

报告：`artifacts/fast-regression/reports/dominated-rescue-value-depth-perf-r22/e7d3b56d…json`

## 4. 性能

| 项 | R21 | R22 |
|---|---:|---:|
| capsule-all `totalRuntimeMicros` | 141.027 s | **44.304 s** |
| capsule 本体 | 110.006 s | **21.297 s** |
| preload | 1.387 s | 1.278 s |

说明：与 R21 文档相同，单次墙钟受 WSL/负载影响，**不能**当作平台 3000 ms 证据。
算法侧 Info soft-top / 预留 continuation / 死亡压力跳过 policy 采样，与更短 capsule
时间方向一致；正式性能结论仍需固定输入 + 预热 + 五批 P95。

## 总判

- **更好**：主池存活大幅上升；dominated / value-depth / no-acceptable 桶收缩；安全门干净。
- **有回归**：5 例主池 `SURVIVE→DIE`（控制 0）→ 标签为 `WITH_REGRESSIONS`，不能只报净 +35。
- **性能未变差**：本次 capsule-all 明显更快；无证据表明全量回归变慢。
