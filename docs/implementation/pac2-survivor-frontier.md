# PAC2 SurvivorFrontier 实施记录

状态：**IMPLEMENTED / STRUCTURAL PASS / FULL ARENA REJECTED**，2026-07-24。

权威设计：
[ProjectileSurvivorFrontier 合同](../design/projectile-survivor-frontier-contract.md)。

OpenSpec未初始化，本阶段沿用现有DD/IMP/SR文档权威，不创建第二套规格树。

## 输入基线

- 分支：`codex/v2-global-recovery`；
- PAC1：结构通过、32场景样本行为中性；
- rolling V1历史场景：动态扫描826；
- 全量命令：`826 × 2 repetitions × 4 variants = 6,608`；
- 存储模式：compact，仅manifest、overview、matches.gz、diagnostic-samples.gz。

## 任务

- [x] PAC2.1 固化双frontier量词、endpoint metric与整数常量。
- [x] PAC2.2 实现固定CounterfireDistanceField。
- [x] PAC2.3 实现baseline/constrained forward frontier。
- [x] PAC2.4 生成逐cell setup delay、mobility loss和pressure。
- [x] PAC2.5 接入CombatVector root摘要与StageMatrix。
- [x] PAC2.6 扩展exact cache、诊断计数和PAC2-off模式。
- [x] PAC2.7 增加独立oracle、技能、缓存、所有权和性能UT。
- [x] PAC2.8 运行GR0、IMP6、source/minified differential和32场景因果样本。
- [x] PAC2.9 结构、性能和硬门通过后，运行6,608局compact全量。
- [x] PAC2.10 分析全量W/L/D、击毁、星数、variant、换位和历史baseline转移。

## 实现与性能

- PAC2对每个`SURVIVES`矩阵单元比较baseline与candidate projectile约束后的敌方
  survivor frontier。
- endpoint value只保留敌方最佳反击准备距离和最佳机动性；endpoint数量减少仅作审计。
- 压力只进入expected/tactical residual及StageMatrix cell，不写Hard、Safety、EO、
  robustPressure或strict Proof。
- ready/active shield、teleport、boost及不完整支持返回0压力；root frame内失效的短弹道
  仍由PAC1处理。
- exact cache包含PAC2逐cell和逐row输出，`frontierEnabled`属于缓存身份。

最初dense `cell×direction`扫描的性能烟测失败，P95为off的248.28%。最终实现改为：

```text
固定Uint32 pose bitset
+ 非空word固定列表
+ baseline/constrained顺序复用同一双buffer
+ Counterfire BFS复用同一bitset
+ 相同EnemyAction后继pose精确复用
+ 只保留PAC专用tick-1 ReverseViability双层
```

最终128 roots、5次预热、5批paired测量：

| 指标 | 结果 |
|---|---:|
| P95 on/off | 102.99% |
| paired median | 102.99% |
| frontier builds | 2,560 |
| pressure cells | 1,600 |
| hot allocation / root restore failure | 0 / 0 |

ProductionRoot TypedArray为998,783 bytes，低于本地1,000,000门。构建source/minified为
499,081/481,650 bytes，source/minified差分、strip和sandbox通过；minified仍超过平台
204,800-byte门，因此不是可发布Candidate。

验证：

- PAC2 endpoint/oracle/技能/缓存/所有权专项8/8；
- PAC1回归13/13；
- PAC1/PAC2已接入统一GR0门禁，GR0 168/168；
- IMP6 16/16。

## 32场景因果A/B

`CURRENT`与`SURVIVOR_FRONTIER_OFF`各128局，结果、星差、FIRE及全部动作计数完全一致。
PAC2实际执行：

| 指标 | 数量 |
|---|---:|
| CounterfireDistance build | 1,230 |
| unique survivor frontier | 4,686 |
| pressure cell | 847 |
| setup delay总量 | 1,010 |
| mobility loss总量 | 11 |
| endpoint reduction | 32,480 |
| incomplete | 0 |

因此PAC2不是dormant，但其soft value没有穿过既有Risk/robust floor/StrategyBand/StageMatrix
选择边界。该样本只能证明行为中性，不能证明全量所有root都中性。

## 6,608局全量结果

输入冻结为826场景、813地图、6种出生组合、601条星序列；其中84场景为本轮新发现。
运行耗时约54分23秒，source SHA-256为
`c09aa5c06f1276b6a33be3bb03e9b4b81ef068370c21ebad2e2a651c2594e5e9`。

| 指标 | 结果 |
|---|---:|
| V2胜 / V1胜 / 平 | 585 / 5,712 / 311 |
| `V2胜 + 0.5×平` | 11.20% |
| FIXED_266得分 | 10.78% |
| ROLLING_DISCOVERY得分 | 11.41% |
| FIXED_266单方击毁胜 / 负 | 175 / 365 |
| 全量单方击毁胜 / 负 | 548 / 1,143 |
| avoidable Hard / dominated / restore / timeout / error | 0 / 0 / 0 / 0 / 0 |

终局：

| 终局 | 分母 | V2胜 | V1胜 | 平 |
|---|---:|---:|---:|---:|
| 128帧星数 | 4,450 | 37 | 4,413 | 0 |
| 单方击毁 | 1,691 | 548 | 1,143 | 0 |
| 128帧同星 | 300 | 0 | 0 | 300 |
| 同归于尽星数 | 156 | 0 | 156 | 0 |
| 同归于尽同星 | 11 | 0 | 0 | 11 |

V2发射50,964次，V1发射36,024次；V2多41.5%，但单方击毁仍净负595。结论不是
“FIRE数量不足”，而是FIRE目的质量、压制后的continuation选择、反击暴露和位置价值不足。
V2单方失败中1,092场为projectile/collision，51场为bomb。

换位对：

| family | pair | V1双胜 | V2双胜 | 各胜一局 | V1胜+平 | V2胜+平 | 双平 |
|---|---:|---:|---:|---:|---:|---:|---:|
| NATIVE | 1,652 | 1,228 | 17 | 299 | 79 | 18 | 11 |
| SKILL_CROSS | 1,652 | 1,268 | 10 | 192 | 150 | 22 | 10 |

SKILL_CROSS得分9.99%，低于NATIVE的12.42%，说明技能交换使当前策略更弱，但不是唯一根因。

历史共同局：

- 相对IMP8 common 1,952：40.78%降至10.71%；626个`V2_WIN→V1_WIN`，仅81个反向。
- 相对working `0ed5c5…` common 5,936：13.79%降至11.20%；V2胜550→520，
  平537→289。当前版本只保留41个旧V2胜，同时恢复427个旧V1负局，说明行为大幅重排，
  不是单一小参数漂移。
- PAC2 32场景A/B动作完全相同，因此不能把上述累计退化归因给PAC2；本轮PAC2应保留为
  结构证据，但没有gameplay资格。

全量状态为`REJECTED`。结果目录总计1,047,525 bytes：
`artifacts/diagnostics/v1-v2-working/`
`c09aa5c06f1276b6-r2-compact-discovery-calibration-frozen-`
`p080aa18a0f3f-rolling-3e73e34c/`。

下一步不得继续提高FIRE固定分。应先建立“有目的射击→敌方最佳生存endpoint→我方安全
continuation→终局价值”的可观测链，并定位为何847个PAC2压力cell没有改变根动作。
在因果定位前不再运行6,608局。

## 禁止

- 不提高通用Minimax depth；
- 不按死亡分支或endpoint数量直接加分；
- 不修改Hard、Safety、EO、ForcedWin、RiskProfile、领先保护或stun概率；
- 不执行官方simulate、publish或challenge。
