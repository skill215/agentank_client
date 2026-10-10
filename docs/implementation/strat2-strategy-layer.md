# STRAT2 strategy layer implementation

状态：**LOCAL STRUCTURAL PASS / ARENA QUALIFICATION NOT RUN**，2026-07-23。

本轮实现 [V2 战略层重构合同](../design/v2-strategy-layer-contract.md) 的
STRAT2-D0 至 D3。没有运行 Discovery、Holdout、全量 V1/V2 arena、官方
simulate、publish 或 challenge。

## 实现结果

生产根选择顺序现在是：

```text
Hard / strict Proof
→ Risk acceptable set
→ committed EscapeObligation
→ Pareto
→ global maximum robustLower safe floor
→ active StrategyBand
→ StageMatrix
→ expected / tactical / stable row
```

主要变化：

- 默认战略由 `STAR_CONTROL` 改为 `KILL_PRESSURE`。
- `KILL_PRESSURE / ATTACK_SETUP / STAR_CONTROL / PRESERVE_LEAD / COMEBACK`
  共用一个 canonical evaluator、一个 RiskProfile 和一套 Minimax。
- strategy 不再选择不同风险参数，也不把 purpose 写成加法 bonus。
- 抢星 GO/TURN 奖励只在 `STAR_CONTROL` 或 `COMEBACK` 生效；可见敌人存在时
  KILL/SETUP 的转向目标是敌人。
- 每动作以固定 `Uint16Array purpose + Uint8Array band/selected` 表示战略目的。
- band 只能缩小已经通过 Hard、Risk、EO、Pareto 和全局 safe floor 的动作集合。
- `RiskAcceptanceController.select` 接受 band mask；Risk 无可接受动作时的
  最小风险 fallback 仍由 Risk 独占，strategy 不恢复动作。
- COMEBACK 用完整击杀目的的最早 hit deadline 与可见星 deadline 比较：
  较早者为 primary，另一类为 support；证据不完整不冒充严格逆转。
- Selector 使用离散 decision vector、deadline、dwell、切换 margin 矩阵和
  事件 modifier；不把各维预先加成一个策略分数。
- active PersistentPlan 只提供 purpose continuity，不能绕过本帧 Hard/Risk/EO。

## ABI 与静态表

活动 policy manifest：

```text
profileId = STRAT2_INTEGER_POLICY_V2
policyAbiRevision = 2
defaultStrategy = KILL_PRESSURE
canonicalEvalProfile = CANONICAL_OUTCOME
defaultBaseRisk = 65
allowedStrategicRobustLoss = 0
strategyDescriptorFingerprint =
  aa0ba635cad4dfe470bd71ee8886d424fb77bc1b0da935e1dd21e35684ef2ec3
```

`StrategyDescriptor` 是固定 TypedArray SoA，包含 primary/support/fallback
purpose mask、capability/root-mode mask、per-strategy dwell、5×5 switch margin、
ordering profile、search hint、fallback strategy 和 reason mask。manifest gate
会从活动表重新计算 fingerprint；表与 manifest 漂移会直接失败。

## 结构验证

| 验证 | 结果 |
|---|---:|
| GR0 Minimax/Hard/Risk/EO gate | 140 / 140 PASS |
| IMP5 policy gate | 191 / 191 PASS |
| IMP6 build/runtime gate | 207 / 207 PASS |
| source/minified differential mismatch | 0 |
| production strip finding | 0 |
| root restore failure（fixture） | 0 |
| Selector/Band instrumented hot allocation | 0 / 0 |

新增 oracle 覆盖：

- 安全直接射击与邻近星并存时，KILL primary 保留 FIRE；
- strategy 不能降低 global robust safe floor；
- Risk 拒绝的 FIRE 不会被 band 恢复；
- STAR 只在自己的 band 内拥有星动作；
- COMEBACK 按击杀/星 deadline 动态分 primary/support；
- StageMatrix cell 不因 strategy 改写；
- mixed/deterministic selection 只使用 selected band；
-真实 `ProductionRootEngine` 经过完整 Hard、Risk、search、matrix 后选择合格 FIRE。

## 本地性能证据

固定 Node v24.16.0、预热后 512 次测量：

| 热路径 | P95 | P99 | TypedArray bytes | instrumented allocation |
|---|---:|---:|---:|---:|
| StrategySelector | 2,214 ns | 12,936 ns | 80 | 0 |
| StrategyBand | 1,774 ns | 2,395 ns | 108 | 0 |

同一工作区、同一 IMP6 基准中，descriptor/deadline 收口前后 full-game P95
从 69,878 µs 变为 52,510 µs，operation 数保持 4,005。该结果只能说明本次
收口没有观察到整局退化；因为启用前没有冻结合法的 shadow 性能基线，
它不能冒充合同中“相对 STRAT2 启用前 P95 ≤102%”的最终证据。

## 构建与发布阻塞

当前可重复构建：

```text
source SHA-256   f891aba8516a7f586d3063cacfbfa3ecf5016254002749f1f2478392939a5438
minified SHA-256 9bd10087c1223bb709ad82b218810a32a7a10e5d4ff1cccaf87d007d243f6cd8
source bytes     460,915
minified bytes   444,622
platform limit   204,800
```

source/minified 行为一致，但 minified 超限 239,822 bytes。因此当前工作源
不是 Candidate，也不能进入官方 simulate。该问题在 STRAT2 前已经存在；
本轮没有用删减安全、搜索或 Information 语义换取体积。

## 未完成资格

`OI-ARCH-019` 保持 `DECIDED`，不标记 `CLOSED`，直到以下证据同时完成：

1. 快速 Discovery 与独立 Holdout 证明不是局部样本优化；
2. 固定全量 arena 证明单方击毁胜局至少提升 10%；
3. runtime-independent `V2_WIN + 0.5×DRAW` 严格超过 60%；
4. 各 variant、WIN→LOSS、LOSS→WIN、星差、击毁差和动作转移完整对账；
5. full-game 相对性能与 production code-size 门通过；
6. 所有 Hard、Proof、Risk domination、root restore、timeout/error 仍为零。

下一步应先运行 StrategyBand 的小型 Discovery/封存 Holdout，而不是直接修改
FIRE/STAR 分数或立即消耗全量 arena。

## D3 机制抽样

在正式 Discovery/Holdout 前，增加一个不读取封存 Holdout 的因果抽样：

```text
./tools/strategy-priority-sample-toolchain.sh run
```

它从 SS-A0 的 96 个 Discovery 场景中用固定盐选择 32 个场景，运行四种换位、
一次 repetition，并比较三个诊断模式：

- `CURRENT`：当前动态战略；
- `FORCE_STAR_CONTROL`：只在 `GLOBAL_MODE.NORMAL` 强制 `STAR_CONTROL`；
- `BAND_OFF`：保留统一评价、Risk、Minimax 和 StageMatrix，只取消 StrategyBand
  缩圈。

该工具记录全局 safe-floor 上的合格 FIRE 机会、进入最终 band 的机会、实际选择
FIRE 的机会、攻击 setup、无目的射击、战略/动作分布、W/L/D 和硬不变量。
它只验证“开火优先级机制是否生效”，属于 Discovery sample，不替代 D4 胜率、
击毁、性能或 code-size 资格。

### 2026-07-23 抽样结果

固定 32 个 Discovery 场景、四种换位、每模式 128 局已完成；封存 Holdout
payload 读取数为 0。报告位于
`artifacts/diagnostics/strategy-priority-sample/strat2-0d1b0d3b2c5a5180/`，
总大小 65,886 bytes，manifest fingerprint 为
`735979b838b3560c6a84007ebffed5e6774009917ed72e909d91ccc79cce3c5f`。

| 模式 | W/L/D | 分析得分 | FIRE/decision | 有目的FIRE/FIRE | 合格FIRE转化 | 星差 |
|---|---:|---:|---:|---:|---:|---:|
| CURRENT | 7/119/2 | 6.25% | 8.44% | 15.71% | 81/81 | -188 |
| FORCE_STAR_CONTROL | 23/93/12 | 22.66% | 6.04% | 9.34% | 47/47 | -109 |
| BAND_OFF | 7/119/2 | 6.25% | 8.60% | 15.29% | 82/82 | -190 |

硬不变量在三个模式均为 0：avoidable Hard、risk-dominated selection、root
restore、timeout 和 error 均未触发。使用 WSL 原生 `TMPDIR=/tmp` 后 GR0
为 144/144 PASS。

结论分为三层：

1. **广义开火倾向已提升。** CURRENT 相对强制 STAR 的 FIRE rate 提升
   2.41 个百分点（8.44% 对 6.04%），有目的 FIRE 比例提升 6.37 个百分点。
2. **StrategyBand 的因果贡献未观察到。** 合格 FIRE 在 CURRENT 和强制 STAR
   中一旦出现都 100% 进入并被选择；关闭 band 后 W/L/D 逐局不变，FIRE rate
   反而由 8.44% 微升至 8.60%。当前提升主要来自去除 KILL 路径的抢星奖励、
   朝敌目标和由此形成的后续轨迹，不是 band 在相同 safe-floor 集合中提升
   FIRE。
3. **攻击质量尚不合格。** CURRENT 的 1,216 次 FIRE 中仅 191 次带严格攻击
   purpose，1,025 次（84.29%）没有 direct/intercept/shield-break/setup/
   denial/belief-sweep 目的。且本抽样 CURRENT 得分显著低于强制 STAR；因此
   不能把“开火更多”当成 STRAT2 成功，也不能进入 Holdout 或 D4。

下一步应针对 1,025 次无目的 FIRE 做同根分类，查明它们由 matrix search、
fallback band、plan continuation 还是旧 tactical score 选出；然后让可验证
攻击 purpose 覆盖真正有效的射击，并抑制无目的射击。禁止用全局 FIRE 加分
继续提高数量。

## D3.1 可达弹道的 possible-hit 开火资格

同根分类进一步证明，旧 CURRENT 的 1,216 次 FIRE 中：

- 可见敌方时无 direct/intercept 目的 359 次；
- 隐藏敌方且无 belief coverage 666 次；
- 1,211 次 FIRE 已在 StrategyBand 内；
- 只有 5 次在 band 外，且均属于 no-acceptable/FinalGate 一类路径。

因此本步没有继续放宽 StrategyBand，而是补全 `CombatVector` 的攻击目的定义：

```text
当前射线未直接命中敌方
→ 沿弹丸在墙、土或边界前的轨迹计算逐格到达帧
→ 用有截止帧的局部 BFS 验证敌方是否能在对应帧前到达该格
→ 能到达则标记 soft INTERCEPT / possibleHit
```

边界固定为：

- possible-hit 只提供攻击资格和 expected tactical value；
- `robustPressure = 0`，因为敌方可以选择不进入弹道；
- 不产生 `DIRECT_KILL`、Hard 或 strict Proof；
- 仍必须经过 Risk、EO、global robust safe floor、StrategyBand 和 StageMatrix；
- 隐藏敌方且 belief coverage 为 0 时不提升；
- 墙、土和边界终止弹道；
- query 使用固定 TypedArray、generation stamp 和精确键缓存，热路径零分配。

局部 BFS 与独立全图最短路 oracle 在两种地形、四个方向、全部敌方格以及
`enemyCanAct=0/1` 上逐项核对，命中资格、最早命中帧和完整度均一致。GR0
结构门更新为 145/145 PASS。

### 256 局因果 A/B

最终优化源码绑定的紧凑报告位于
`artifacts/diagnostics/strategy-priority-sample/strat2-908b3ecb96dd62b4/`，
包含固定 32 个 Discovery 场景、四种换位、每模式 128 局。manifest
fingerprint 为
`83e0fbae0bdba2adc02fd4ec0050af83bcbab29eab819b3191282b4944a94657`，
engine source fingerprint 为
`dffccd526cba063355d8951bd661c1d19c3f5858ec35408d6041a2c568dc85fb`。

| 指标 | possible-hit ON | OFF | ON−OFF |
|---|---:|---:|---:|
| W/L/D | 9/118/1 | 7/119/2 | +2胜、-1负、-1平 |
| 分析得分 | 7.42% | 6.25% | +1.17pp |
| 星差 | -181 | -188 | +7 |
| FIRE | 1,289 | 1,216 | +73 |
| FIRE/decision | 8.84% | 8.44% | +0.40pp |
| 有目的 FIRE/FIRE | 28.62% | 15.70% | +12.92pp |
| possible-hit opportunity | 173 | 0 | +173 |
| possible-hit FIRE selected | 174 | 0 | +174 |
| 单方击毁胜/负 | 8/20 | 7/24 | +1胜、-4负 |

逐局转移为 `LOSS→WIN=4`、`WIN→LOSS=2`、`DRAW→LOSS=1`。avoidable
Hard reject、risk-dominated selection、root restore failure、timeout 和
error 均为 0。

这证明“敌方能在弹丸到达前进入射线”是一个正向但有限的攻击资格扩展：它提高
了开火数量和攻击目的覆盖，也没有以更多单方被击毁换取结果。但 7.42% 仍远低于
资格线，不能据此进入 Holdout 或完整 arena；剩余主要问题仍是隐藏无 belief 的
611 次 FIRE、可见仍无目的的 309 次 FIRE，以及整体目标/搜索选择质量。

### 性能与构建

原全图距离场的变化敌方冷路径 P95 约为 32.8µs；有截止帧的局部 BFS 五批
测量中冷路径 P95 中位数为 9.77µs，降低约 70%，热路径分配为 0。相同查询的
paired warm P95 比值五批中位数为 98.34%，但有两批受 WSL 调度尾部影响超过
120%，所以这里只作为性能方向证据，不冒充 SR 的严格资格 benchmark。

最终可重复构建结果：

```text
source SHA-256   7c992b9b4228fdb8adc4fdef7b743291ba62d78705addac48b07032f08ff9dbf
minified SHA-256 d0d05672fee469e4e8b1980a828ae87dd2ebb365b9780df70bffc1fdacbe7bd8
source bytes     465,912
minified bytes   449,520
platform limit   204,800
```

source/minified differential mismatch 和 production strip finding 均为 0；
体积仍超限 244,720 bytes，不能形成 Candidate 或执行官方 simulate。
