# 当前源码全量历史回归（R21 evidence）

状态：2026-07-20 完成。R21 是迁移后的证据修订号，不是新的算法版本；工作源码指纹仍为
`d2f0791d...`，与 `NO_ACCEPTABLE_RESCUE` R20 修复相同。本轮没有生成新 V1/V2 对战，
没有修改参数，也没有调用官方 simulate/publish。

## 全量安全门

固定 `initial-full` cohort 的 19,136 个 Replay Capsule 全部执行完成：

| 不变量 | 结果 |
|---|---:|
| completed | 19,136 / 19,136 |
| avoidable Hard reject | 0 |
| risk-dominated selection | 0 |
| strict Proof false positive | 0 |
| root restore failure | 0 |
| Capsule failure | 0 |

报告：[capsule-all R21](../../artifacts/fast-regression/reports/capsule-all/a701aff1f9faa087553b278c58f6af2c775d1ab0c5f1b80174098759642ebfa5.json)。

## 相对 R17

固定死亡窗口和控制窗口共 352 帧：

| 指标 | R17 | 当前 | 变化 |
|---|---:|---:|---:|
| 历史死亡窗口存活 | 49 / 256 | 50 / 256 | `DIE -> SURVIVE` 1，`SURVIVE -> DIE` 0 |
| 存活控制 | 68 / 96 | 68 / 96 | 0 退化 |
| `NO_ACCEPTABLE_RESCUE` | 56 | 55 | -1 |
| 剩余可避免失败 | 116 | 115 | -1 |

评估为 `NET_IMPROVEMENT_NO_REGRESSION`。改善点仍是 `mat_9sAI...` 帧 87：由
`TURN_LEFT` 改为 `GO` 并存活。

报告：[R21 vs R17](../../artifacts/fast-regression/reports/full-regression-r21-vs-r17/027adfa802863c3d04643da6841d6a55d48af0c6db06ef1014f89e78e37f5d3d.json)。

## 相对 R12 的累计变化

历史死亡窗口存活从 39 增至 50：14 个 `DIE -> SURVIVE`、3 个固定 continuation
`SURVIVE -> DIE`，净增加 11。96 个存活控制仍为 68，零退化。

三个固定 continuation 退化为 `mat_9yOK...` 帧 26、`mat_1cgt...` 帧 51 和
`mat_2bz...` 帧 79。策略一致分析已经证明前两个当前策略实际存活；第三个仍受四帧终局边界和
历史对手后续动作缺失影响，不能证明替代动作在完整对手响应下更安全。因此累计比较仍正确标记
为 `NET_IMPROVEMENT_WITH_REGRESSIONS`，不能用净 +11 隐藏证据边界。

报告：[R21 vs R12](../../artifacts/fast-regression/reports/full-regression-r21-vs-r12/1573d862e4ab13120d0fe32667d71cc698557eb4f66e6f5b0b044db7daf2bea8.json)。

## 剩余问题

165 个固定 continuation 下存在逃生动作的根，目前分类为：

| 类别 | 数量 |
|---|---:|
| 当前动作存活 | 50 |
| `NO_ACCEPTABLE_RESCUE` | 55 |
| `DOMINATED_RESCUE` | 39 |
| `RESCUE_AT_OR_ABOVE_FLOOR` | 12 |
| `LOWER_ROBUST_RESCUE` | 9 |

39 个 dominated rescue 的根因仍为 value-depth non-discrimination 23、path-risk inversion 7、
frontier 未激活 4、其他不完整支持 4、possible-projectile 支持 1。

报告：[R21 failure buckets](../../artifacts/fast-regression/reports/dominated-rescue-post-migration-r21/43db5cc52afc3118e03a547431dc716a050dfbce1e6c67a83f3d09c4702eac68.json)。

## 性能说明

WSL 迁移后的 compiled corpus 预加载从 1.843 秒降至 1.387 秒，但本次完整回归总耗时从
128.456 秒上升到 141.027 秒，约慢 9.8%。本地单次运行受系统负载影响，且当前任务没有改变
算法；因此本报告不宣称性能改善，也不把该耗时作为平台 3000 ms 证据。后续性能结论必须使用
固定输入、预热和五批 P95 benchmark。

## 结论

当前源码完整复现 R20 的窄范围结构收益：相对 R17 净增加一个存活根且零退化，所有底层安全门
保持为零。由于迁移和 `.gitignore` 修改没有改变算法，本轮没有额外游戏性增益。下一步仍应按计划
进行 Production 体积压缩；若继续处理剩余死亡选择，应先建立终局边界后的对手响应证据，不能继续
放宽本次风险门兜底。
