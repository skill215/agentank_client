# V2 第一轮 fallback 性能调试与调优后对战

状态：`PERFORMANCE_TARGET_MET / STRUCTURAL_GATE_PASS / GAMEPLAY_REVIEW_REQUIRED / CANDIDATE_NOT_FROZEN`，2026-07-17。

> 历史状态说明：本文记录结构修复前一轮的参数选择与待 review 结果。后续 working source 已重新执行性能矩阵、失败分类和 2,128 场完整对战；当前结论见 [v2-projectile-terminal-structural-repair-v2.md](v2-projectile-terminal-structural-repair-v2.md)。本文中的 `FRAME_FLOOR_24K_D1` 不再是当前选择。

## 1. 结论

V2 已在相同逐帧观察输入上达到比冻结 V1 更短的本地执行时间。选定 profile 为 `FRAME_FLOOR_24K_D1`，参数 fingerprint `a3d927a3c14c0da5df6d96c628fd65bc788836a5543c578d3e716d72d7d6a23a`。

固定输入 benchmark 中，V2 总决策耗时为 V1 的 75.72%，callback P95 为 V1 的 77.00%。调优后的 2,128 场互动对战中，V2 总耗时为 V1 的 74.44%，每局 P95 为 V1 的 72.61%；相对调优前结构版，V2 总耗时下降 14.59%，P95 下降 18.98%。这些是同机相对结果，不是平台 3 秒证明。

玩法结果相对调优前下降 8 个总胜局，原生下降 14/1,064。因此本地资格状态为 `PASS_PENDING_GAMEPLAY_REVIEW`，不能直接冻结发布。两个 repetition 的原生胜局分别为 272/532 和 255/532，且 340/1,064 个重复组终局签名不稳定；当前证据不能证明 14 场净变化是 fallback 引起的系统性退化，但合同要求显式 review。

## 2. 性能矩阵

预注册计划为 [v2-runtime-performance-matrix-v1.json](../../config/engine-v2/v2-runtime-performance-matrix-v1.json)。16 张 Calibration 地图生成 32 个 driver matches、64 条双方视角状态序列；重复回放后 V1 和每个 V2 profile 都执行 8,708 个完全相同的观察 callback。每个 profile 另运行 64 场四格玩法样本。

| Profile | 固定输入总耗时/V1 | P95/V1 | 小样本原生胜局 | 结论 |
|---|---:|---:|---:|---|
| `CURRENT_24K_D2` | 87.83% | 86.33% | 16/32 | 合格 |
| `BALANCED_18K_FRAME104` | 68.62% | 71.97% | 16/32 | 合格 |
| `V1_STYLE_12K_FRAME96` | 53.19% | 60.29% | 14/32 | 合格但玩法排序较低 |
| `FRAME_FLOOR_24K_D1` | 75.72% | 77.00% | 19/32 | 选中 |

选择顺序在运行前固定为原生胜局、总耗时、P95，而不是选择最快 profile。四个 profile 的 avoidable Hard reject、root restore failure、tracked hot allocation、V2 error/timeout 均为 0。

完整机器报告：[runtime-matrix-report.json](../../artifacts/benchmarks/v1-v2-runtime/812587a97242b9cd-29ad6448ed66/runtime-matrix-report.json)，fingerprint `f90708cd539a985ea91c69d5040c828e1d7442463872a50bf2fee71353fdd241`。

## 3. 选定 fallback

选定 profile 保留原 12K/24K/48K work thresholds，并加入确定性 frame floor 64/100/124。它不是把 128 帧或 3 秒平均切片：work counter 与 frame floor 任一先到即降级。

| Mode | Depth | Node | Proof | Matrix iterations |
|---|---:|---:|---:|---:|
| Normal | 3 | 128 | 128 | 48 |
| Degraded | 2 | 96 | 64 | 32 |
| Fallback | 1 | 48 | 32 | 16 |
| Emergency | 0 | 0 | 0 | 0 |

Fallback 仍运行非零 Minimax；Emergency 仅关闭 Value/Proof，Hard、Terminal、已提交危险闭包和 FinalActionGate 不缩减。完整对战 runtime mode 决策数为 Normal 82,739、Degraded 78,581、Fallback 24,996、Emergency 3,821。

## 4. 调优后完整对战

266 个动态历史场景、两个 repetitions、四个座位/技能变体，共 2,128 场：

| 分组 | 对局 | V2 胜 | V2 负 |
|---|---:|---:|---:|
| 原生 V1 stun / V2 poison | 1,064 | 527 | 537 |
| 技能交叉 | 1,064 | 638 | 426 |
| 合计 | 2,128 | 1,165 | 963 |

相对冻结 V2 的可比 1,952 场，V2 从 731 胜提升为 1,068 胜，增加 337 胜；原生从 315/976 提升为 478/976，增加 163 胜。

相对性能调优前结构版的 2,128 个同局 matchId：

| 转移 | 场数 |
|---|---:|
| WIN → WIN | 1,035 |
| LOSS → LOSS | 825 |
| LOSS → WIN | 130 |
| WIN → LOSS | 138 |

原生为 55 个 `LOSS→WIN`、69 个 `WIN→LOSS`，净 −14。技能交叉净 +6。该变化必须 review，但不能忽略本地 V1 wall-clock fallback 和 340 个重复不稳定组。

128 帧终局共 947 场，其中同星 173 场。V2 本地累计耗时低于 V1 的 169 场全部由 V2 获胜；V2 更高的 4 场全部失败。调优前同星局为 V2 更低 138 场、更高 36 场，说明本地终局性能方向明显改善。

完整报告：[working-arena-overview.json](../../artifacts/diagnostics/v1-v2-working/812587a97242b9cd-r2-discovery-calibration-frozen-pa3d927a3c14c-rolling-3c663bc6/working-arena-overview.json)，fingerprint `2bcdf20e7d27b22d2b6cf165159be08808706b184c79ff377c395c36ded9cc51`。

## 5. 逐帧 action 证据

Post-Tuning 报告使用 `ACTIONS` trace：2,128 场、190,137 帧全部有连续 frame record，`actionTrace.length == frames`，缺局或错位均为 0。共记录 375,303 个实际 callback action；4,971 个 seat-frame 为 `null/HOLD_NO_CALLBACK`，表示 poison/freeze/调度没有调用该 seat，不是 trace 缺失。

V2 每个 callback 记录 action、root、InformationState 完整性、selected Hard、allow count、Proof、深度、节点、分数、runtime mode 和本地耗时。四个 role 报告总计约 374MB；`FULL` trace 只应针对失败样本生成。

## 6. 严格门与发布状态

调优后完整 Arena：avoidable Hard reject 0、root restore failure 0、tracked hot allocation 0、V2 timeout/error 0；205 次动作拒绝全部是所有候选均拒绝的 unavoidable 状态。

本地资格报告：[local-qualification-report.json](../../artifacts/qualification/v2-local/812587a97242b9cd-pa3d927a3c14c/local-qualification-report.json)，fingerprint `5e89a4e18458c5029e29ce4bb7104d93bd21672d5f720dcd492ca9c30160b7cf`。

当前仍有两个发布 blocker：

1. 用户尚未 review 原生 −14 和 69 个 `WIN→LOSS`；
2. 当前只是 working source/parameter 资格，尚未冻结为新 Candidate，也没有绑定精确 minified publish hash。

IMP9 preflight 已加入本地 V1/V2 attestation 强制检查；缺失或未关闭 review 时，官方 simulation 之前即 fail closed。即使完成本地 review，平台整局 3 秒 simulation 仍必须重新执行，本地结果不能替代。
