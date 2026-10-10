# STRAT3 portfolio rearchitecture implementation

状态：`RST1 IMPLEMENTED / GAMEPLAY NOT QUALIFIED`

## 实施结果

- `CANONICAL_OUTCOME` 改为稳定的 profile 0 `BASELINE_OUTCOME`；
- `ProductionRoot` 在搜索前只调用 `prepareNeutralSearch()`；
- `StrategySelector.prepare()` 移至 Risk/EO/Pareto/safe floor 后；
- `KILL_PRESSURE` 只能由合格攻击证据激活；
- `StrategyBandSlab` 增加中立 anchor、五战略候选mask和最终owner；
- StageMatrix仍只运行一次且cell不含strategy加分；
- FinalActionGate 确定动作后才提交 strategy state；
- FORCE_STAR/BAND_OFF 诊断包装器已改接新接口，避免A/B空操作。

## 结构验收

```text
test:minimax-core  56/56 PASS
test:gr0           173/173 PASS
test:imp5          14/14 PASS
```

第一次GR0的单个失败来自Windows TEMP只读；使用`TMPDIR=/tmp TEMP=/tmp TMP=/tmp`
后同一代码173/173通过，不是算法失败。

新增性质约束：

- neutral evaluator 对五个 strategyId 动作分数一致；
- selector prepare 不提交current/generation；
- Risk rejected FIRE 不进入proposal且不能激活KILL；
- neutral base anchor始终留在portfolio；
- strategy prepare严格发生在Risk gate之后；
- FORCE_STAR/BAND_OFF确实包装STRAT3的prepare/buildPortfolio。

## 性能与构建资格

当前只通过“固定数组、热路径零分配和绝对耗时很小”的结构门，没有通过“相对前版不退化”
或发布容量门：

| 根组件 | STRAT3 P95 | 旧STRAT2 P95 | 热分配 |
|---|---:|---:|---:|
| selector prepare | 3,778ns | 约2,094–2,214ns | 0 |
| portfolio build | 4,870ns | 约1,774–2,024ns | 0 |

两项绝对值均低于5us/root，但相对微基准已经退化，不能据此声称“性能不降低”。需要在语义
稳定后压缩扫描、mask和proposal记录，并以完整root/search pipeline的同输入基准最终裁决。

IMP6为15/16：source/minified语义指纹一致，cold init、callback、sandbox和内存语义通过；
唯一失败为本地未压缩源码容量：505,662 > 500,000 bytes。ProductionRoot TypedArray为
998,836 / 1,000,000 bytes，只剩1,164 bytes余量。minified为487,967 bytes，超过平台
204,800-byte门283,167 bytes。因此RST1不是Candidate，也不能进入官方simulate。

## 快速样本

结果目录：

```text
artifacts/diagnostics/strategy-priority-sample/strat2-5b49244d5f22a57c/
```

固定32场景，每模式128局：

| 模式 | V2胜 | V1胜 | 平 | 得分 | 星差 | 单方击毁胜/负 |
|---|---:|---:|---:|---:|---:|---:|
| CURRENT | 29 | 84 | 15 | 28.51% | -72 | 8 / 25 |
| FORCE_STAR_CONTROL | 29 | 84 | 15 | 28.51% | -72 | 8 / 25 |
| BAND_OFF | 29 | 84 | 15 | 28.51% | -72 | 8 / 25 |

CURRENT执行1,002次FIRE，其中308次有攻击purpose；249个qualified FIRE机会全部被选择。
Hard avoidable、risk dominated、root restore、timeout、error均为0。

相对同一32场景的旧动态STRAT2约6.25%，本阶段恢复约22.26个百分点；相对旧强制STAR
约22.66%，提高约5.85个百分点。但三模式动作完全一致，说明恢复来自中立基础估值和
调用顺序，不是portfolio已经学会战略选择。

## 停止结论

不运行固定266或6,608局，不形成Candidate，不执行官方simulate/publish/challenge。
下一阶段只允许：

1. committed-only membership + soft robust value逐项恢复；
2. 为各strategy生成真正不同的多步Plan候选；
3. 保留本阶段neutral anchor作为绝对回归基线。

禁止通过FIRE/STAR固定加分、切换evaluator或放宽Hard/Risk让strategy产生差异。
