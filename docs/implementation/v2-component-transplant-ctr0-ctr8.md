# V2组件因果验证 CTR0–CTR8

状态：`CTR0–CTR6 ACCEPTED / CTR7–CTR8 BLOCKED`  
日期：2026-07-31

## 结论

V3 已被严格限定为冻结 V1 的模块化实验宿主。它只用于回答“单个 V2 组件替换 V1
对应端口后是否更好”，不再被称为修复后的 V2。

本轮没有任何组件满足：

- `BEHAVIOR_POSITIVE`：独立 Discovery 至少提升3个百分点；
- `PERFORMANCE_POSITIVE`：动作等价且 function/root P95 至少改善5%。

因此：

```text
V3_COMPONENT_BEST = V3_BASE
V2_REPAIRED       = 未创建
CTR7              = BLOCKED_NO_POSITIVE_COMPONENT
CTR8              = BLOCKED_NO_CANDIDATE_AND_NEEDS_21_FRESH_SCENARIOS
```

这不是把 V3 直接用作 V2，也没有把 V1/V3 源码装进 V2 bundle。

## CTR0：身份与数据隔离

冻结身份：

| 实现 | 含义 | SHA-256 |
|---|---|---|
| `V1_ORACLE` | 冻结 V1 脚本 | `8da68843…e82e` |
| `V3_BASE` | 冻结 V1 行为 + 模块接口 | 行为绑定同一 V1 hash |
| `V2_BASE` source | 真实 V2 ProductionRoot | `0a648d83…4f4f` |
| `V2_BASE` minified | 真实 V2 上传字节候选 | `efc5491b…9e96` |
| `V3_NATIVE_BASELINE` | 无 VM 的 V1-compatible V3 | 明确 `isV2=false` |

64场景、双换位逐帧差分得到：

| 场景 | 局 | 比较帧 | 动作差异 |
|---:|---:|---:|---:|
| 64 | 128 | 9,080 | **0** |

旧 `NATIVE_REPAIRED` 已重标为 `V3_NATIVE_BASELINE_EQUIVALENCE`。其50%只证明
V3/V1等价，不是V2恢复。

当前动态历史池：

| 项 | 数量 |
|---|---:|
| 唯一真实场景 | 1,243 |
| 已暴露场景 | 896 |
| 真正未暴露场景 | 347 |
| 固定盲测需求 | 368 |
| 缺口 | **21** |

未复用旧 Holdout，也未读取新的 Final Holdout。

## CTR1：事实层

`V3_PLUS_VC1_SHADOW` 对 `V3_BASE` 的16场景/32局 Discovery：

| 指标 | 结果 |
|---|---:|
| W/L/D | 16 / 16 / 0 |
| 得分 | 50.00% |
| 动作差异 | 0 |
| projectile lifecycle UT | 8 / 8 |
| capacity / ambiguity / hot allocation | 0 / 0 / 0 |
| 总耗时比 | 103.03% |
| 最大P95比 | 99.11% |

结论：`CORRECT_NEUTRAL`。事实合同正确，但未达到5%性能收益，不能作为回迁升级。

## CTR2：Hard、Deadline与EO

| 组件 | Discovery | 所有权结果 | 分类 |
|---|---:|---|---|
| Physical Hard final | 50.00% | 1次preferred reject，0次安全override | `CORRECT_NEUTRAL` |
| DeadlineKernel | 24/24定向合同通过 | 证据服务 | `CORRECT_NEUTRAL` |
| final-only EO | 50.00% | committed rescue 0 | `CORRECT_NEUTRAL` |
| 早期 EO | 38.67% | 明显退化 | `NEGATIVE` |

final-only EO 没有 `DIE→SURVIVE`，所以不读取 Safety Holdout。

### 2026-08-03 final-only EO重新验证

旧结论使用的final-only接线仍受 `Information supportComplete` 总开关影响，因此在大量拥有
有效PhysicalState的帧上没有真正运行。修正为只依赖committed PhysicalState，并要求
`preferred PROVEN_DEAD + replacement PROVEN_VIABLE + Hard ALLOW` 后：

- Discovery 32局：`LOSS→WIN=1`，得分53.13%，负向转换0；
- Holdout 96局：W/L/D逐局不变，4次严格救援中3次消除单方死亡，`SURVIVE→DIE=0`；
- 128局共5个初始严格提案，restore/search/allocation硬不变量均为0。

因此final-only strict rescue改判为 `CORRECT_POSITIVE_SAFETY`。早期EO仍保持`NEGATIVE`，
二者不是同一个所有权合同。

## CTR3：Minimax、Proof与搜索所有权

Minimax/AND-OR/StageMatrix 理论 UT 为 **91/91**：

- alternating/simultaneous max-min；
- Chance、HiddenWorld、Observation量词；
- robust backup；
- incomplete/budget前缀不能变成exact或Proof；
- cache on/off、iterative deepening与root restore；
- dominated row与StageMatrix bounds。

整局因果结果：

| 组件 | 得分 | 行为 | 性能/结论 |
|---|---:|---|---|
| strict ForcedWin | 50.00% | 0净转换 | `CORRECT_NEUTRAL` |
| exact value dominance | 50.00% | exact ownership 0 | 总耗时约132.5%，P95约143.8% |
| 完整 TacticalCore owner | 6.25% | 严重退化 | `NEGATIVE` |

数学内核正确，但没有任何搜索子组件获得动作所有权证据。搜索继续是 evidence service。

## CTR4：攻击目的拆分

攻击适配器按 `purpose flag + primary purpose` 隔离，避免一个动作被同时算成多个组件。
PAC/SurvivorFrontier专项 UT 为 **41/41**。

| 组件 | 得分 | 观察 | 分类 |
|---|---:|---|---|
| direct kill | 50.00% | V1已做同样开火 | `CORRECT_NEUTRAL` |
| aim setup | 50.00% | movement/turn目的，但owner只接受FIRE | `INTERFACE_BLOCKED` |
| intercept | 50.00% | primary隔离后零动作变化 | `CORRECT_NEUTRAL` |
| escape denial / PAC | 50.00% | 动作变化，crash 14:15，但净胜负0 | `CORRECT_NEUTRAL` |
| shield break | 50.00% | stun/stun无覆盖 | `NO_COVERAGE` |
| zone denial | 50.00% | 缺post-bomb自逃证书 | `INTERFACE_BLOCKED` |
| survivor frontier | 50.00% | 无frontier-qualified动作变化 | `CORRECT_NEUTRAL` |

没有组件达到+3pp Discovery门，因此没有读取 Combat Holdout。

### 2026-08-03 final-only verified attack重新验证

旧CTR4 owner受全局Information完整度约束，且先在所有purpose动作中选行、再要求结果是FIRE，
没有准确验证“V2攻击证据是否能改善V1动作”。重构为共享Physical/Combat前缀和final-only
FIRE owner后，完整的direct-kill+response-reduction合同在Discovery净值为0：2个败转胜，
同时2个胜转败，退化都来自非direct压制覆盖移动动作。

将非direct压制降回Shadow，只允许严格direct-kill取得提案后，Discovery为17/15/0；独立
Holdout为47/44/5，相对同配置Shadow产生1个败转胜、1个败转平、0个负转换。被击毁38→36，
FIRE 548→560，星数不变。但得分仅提高1.56个百分点且`p=0.5`，因此归类
`DIRECTIONALLY_POSITIVE_NEUTRAL`，仍不进入累计BEST。这个结果修正了旧的“完全零覆盖”
判断，但不构成生产所有权证据。

### 2026-08-03 preemptive soft-safety Shadow

在strict rescue BEST上，将V2 future-FIRE/possible-projectile栈接到V1
`PREEMPTIVE_SAFETY`端口，仅作Shadow且`eligible=0`。Discovery 32局动作完全等价。
V1实际预防动作25次，V2给出1,046次差异化推荐；重合21次且动作全部一致，但V2独有
1,025次，其中928次V1继续TacticalSearch。另有4次V1几何预防在V2完整四帧计算中没有
fatal source。

因此该组件是高召回、低精度的风险证据，不是动作所有者。分类为
`CORRECT_EVIDENCE_ONLY / ACTION_OWNER_REJECTED`，不读取Holdout，也不通过削弱V1预防规则
来制造表面一致性。

### 2026-08-03 inline stability

最终边界稳定性Shadow在Discovery发现7个安全GO候选；宽Active产生1个败转胜和1个胜转负，
净值0。离散的`possibleRisk==0`子合同在Discovery为1败转胜、0退化，但独立Holdout的
6个动作差异产生1败转胜、1胜转平、1平转负，Shadow与Active均为46/46/4、50%，`p=1.0`。

因此连续转向计数和局部零风险不足以取得动作所有权。组件保留Shadow，宽版和zero-risk版均
标记`ACTION_OWNER_REJECTED`，不加入累计BEST。

### 2026-08-03 cumulative accepted BEST

新增规范模式`BEST_ACCEPTED_COMPONENTS`，只累计共享事实桥与final-only strict committed
rescue。固定64场景/128局相对`V3_BASE`为63/61/4、50.78%，被击毁52:57；6个救援提案均为
完整committed证书，root restore、search nodes和热分配为0。由于只有1个非零换位对且
`p=1.0`，该结果只维持`CORRECT_POSITIVE_SAFETY`资格，不构成通用动作强度显著提升。
所有中性或负向组件继续排除在BEST之外，真实V2 production保持不变。

## CTR5：Strategy、Plan与PVA

本轮修复了一个真实的 V3 实验接线错误：`navigateWhenHidden` 在函数内部执行动作，旧适配器却
先运行 V1，再评估 V2，导致共享 frame 已被 `ACTION_EMIT` 结束。修复前418/418次均为
`failureNotPrepared`，旧“50%中性”证据无效。

修复为“先生成V2 proposal；合格时经过 `executeAction → FinalActionGate → ACTION_EMIT`，
否则完整回退V1”后：

| 指标 | V2 Strategy替换 | V3_BASE |
|---|---:|---:|
| W/L/D | 7 / 23 / 2 | — |
| 得分 | **25.00%** | 50.00%对称基准 |
| paired p | **0.003906** | — |
| 星 | 6 | 39 |
| crash | 13 | 9 |
| 完整评估 | 496 | — |
| 合格覆盖 | 467 | — |
| `failureNotPrepared` | 0 | — |

目标/战略是显著负向。PlanSketch、PersistentPlan和PVA依赖上游有效目标，因此标记
`DEPENDENCY_BLOCKED`，不单独取得动作所有权，也不读取 Strategy/Plan Holdout。

## CTR6–CTR8

没有 `BEHAVIOR_POSITIVE` 或 `PERFORMANCE_POSITIVE` 组件，所以 CTR6 的累计 BEST 为空。
CTR7 没有可回迁组件。

为了确认真实差距，使用已暴露的 V3R Discovery 跑了冻结精确 V2 bundle 对 V3_BASE，
64场景、128局：

| 指标 | V2_BASE | V3_BASE |
|---|---:|---:|
| 胜 / 负 / 平 | 12 / 116 / 0 | 116 / 12 / 0 |
| 分析得分 | **9.38%** | 90.62% |
| 星 | 33 | 135 |
| crash | 116 | 19 |
| FIRE | 266 | 388 |
| BOMB | 158 | 19 |
| stun | 0 | 211 |
| timeout/error | 0 | 0 |

这证明当前问题是全局控制质量：V2少开火、不用技能、过度放弹且大量被击毁。它不能靠把
任一现有V2组件塞进V1控制结构来恢复。

CTR8 未读取。原因同时有两个：

1. 没有 `V2_REPAIRED` 候选；
2. 新盲测场景还差21个。

## 工具与复现

```bash
./tools/v2-component-transplant-toolchain.sh inventory
./tools/v2-component-transplant-toolchain.sh freeze
./tools/v2-component-transplant-toolchain.sh verify-equivalence
./tools/v2-component-transplant-toolchain.sh verify
./tools/v2-component-transplant-toolchain.sh arena \
  --role DISCOVERY \
  --cohort config/engine-v3/v3-repair-cohort.json
./tools/v2-component-transplant-toolchain.sh report
npm run test:v3
npm run test:minimax-core
```

机器报告：

- identity fingerprint：`7c3583a1…9ad19`；
- CTR report fingerprint：`0fa0d0ed…153`；
- [身份清单](../../config/engine-v3/v2-component-transplant-identity.json)；
- [未暴露场景 inventory](../../config/engine-v3/v2-component-transplant-inventory.json)；
- [CTR0–CTR8 acceptance](../../config/engine-v3/v2-component-transplant-acceptance.json)。

本轮未调用官方 simulate、publish 或 challenge。
