# 外部模拟器集成与规则校准合同

## 1. 目标

外部 `agentank-simulator` 用于扩大规则实验、复合场景和完整对局测试能力，但不能成为平台规则真值，也不能改变本项目的 Minimax 语义或生产热路径。

集成必须同时满足：

- 保留 `SearchState = PhysicalState | InformationState`；
- 保留 EnemyAction、HiddenWorld、ChanceOutcome 三种独立量词；
- 保留 InformationState 上的 AND/OR ForcedWin；
- 保留动作级 HardGateStatus 和已提交实体完整生命周期；
- 保留 pure 快速上下界、关键节点受限矩阵和递归鲁棒风险；
- Reference 与 Fast 实现独立，模拟器不进入生产 bundle；
- 未确认规则不能生成严格 Hard、Proof 或 exact terminal value。

## 2. 证据优先级与版本

规则证据严格按以下顺序覆盖：

1. 官方 Updates 中针对规则的明确变更；
2. 当前在线官方 Agent Guide；
3. 我方保存并可复现的真实平台 replay/simulation；
4. 外部 `agentank-simulator` 的实现和测试；
5. `agentank-framework`、用户观察和其他推断。

当前外部来源固定为：

| 来源 | 固定版本 | 用途 |
|---|---|---|
| Agent Guide 本地快照 | SHA-256 `47016cf5f96ccbb69a8849dd0f2cbc14bbca49ed664e687d1d0e8b352d323d90` | 官方 API 与当前规则文本 |
| 官方 Updates | 取 RuleRegistry 记录的页面日期和 URL | 解决指南元数据滞后或旧文本冲突 |
| `cyhhao/agentank-simulator` | commit `1ef804eb2c187138c4c8e5229fb37cd0126beddf` | 外部候选 Oracle、场景和回归 |
| `mythchen-1024/agentank-framework` | commit `b676a7f3b58a3d462635171c73632c00feeafab6` | 构建/迭代参考，不提供技能物理真值 |

升级任一来源前必须先更新 manifest、差分报告和 `RULESET_VERSION` 候选，不允许追踪浮动 `main` 直接生成正式规则。

## 3. 四层验证边界

```text
Official contract + platform replay corpus
                  -> RuleRegistry / RuleCorpus
                  -> independent ReferenceKernel
                  -> differential FastKernel
                  -> production bundle benchmark

External simulator -> candidate fixtures / candidate transitions
                  -> differential triage
                  -> platform calibration request
```

### 3.1 RuleCorpus

保存每条输入状态、联合动作、期望事件序列、观察结果、终局和证据来源。它是可执行测试数据，不包含搜索策略。

### 3.2 ExternalSimulatorAdapter

仅在测试工具中把本项目的 canonical fixture 转成模拟器输入，再把 replay-like events 转成 canonical event trace。它不得：

- 被 FastKernel 调用；
- 与 ReferenceKernel 共享转换代码；
- 自动把模拟器输出写成 GUIDE/PLATFORM_REPLAY_CONFIRMED；
- 用 Node VM runtime 推断平台 runtime；
- 用本地随机地图或星星分布训练严格 Proof。

### 3.3 ReferenceKernel

ReferenceKernel 只从冻结的 RuleRegistry 生成规则。允许清晰对象和完整复制，但必须独立表达 FrameTimeline、观察和终局。外部模拟器只与它做差分，不能成为它的内部依赖。

### 3.4 FastKernel

FastKernel 消费同一冻结规则生成物，用 TypedArray、Arena、整数 ABI 和 make/unmake 实现。正式产物不包含 ExternalSimulatorAdapter、RuleVariant 描述、证据字符串、replay parser 或测试断言。

## 4. 规则冲突与 RuleVariant

规则实现不确定不是 HiddenWorld、ChanceOutcome 或 EnemyAction。它是开发期的模型不确定性，使用独立的：

```text
RuleHypothesisSet
RuleVariantMask
RuleAssumptionMask
```

合同：

- `RuleHypothesisSet` 只存在于 RuleCorpus、ReferenceKernel 和测试 harness；
- 对一个 fixture 可分别运行所有候选 RuleVariant，产生 outcome interval 或分歧 trace；
- 严格 Proof 只允许使用已确认且当前激活的唯一 RuleVariant；
- 活跃规则存在未解决分歧时，Proof 返回 `UNKNOWN`，Value 传播跨变体 lower/upper；
- 变体不能作为第四个运行时 scenario 维度进入生产 Minimax；
- 平台确认后生成唯一整数规则表并递增 `RULESET_VERSION`，生产热路径不承担分支成本。

## 5. 当前模拟器规则分类

### 5.1 可作为已确认规则的交叉验证

只有同时得到官方指南/Updates 支持的部分可进入严格规则表，例如：

- shield 最多持续 4 帧，可抵挡两次 bullet hit；bomb hit 消耗整个 shield；
- bomb 引信 10 帧、爆炸后冷却 10 帧、十字范围 2；
- overload 下一次成功 FIRE 产生两颗 projectile；
- freeze 不丢弃已排队命令；
- teleport 到星星目标时落在合法相邻格，并带拿星锁、近敌 fire lock 和短暂显形；
- boost 的两格 go 与每帧首次免费 turn；
- 子弹互相穿过时，只有平台回归补齐后才升级当前 USER_CONFIRMED 条目。

交叉验证只说明模拟器在该条规则上与官方一致；证据等级仍来自官方或平台，而不是模拟器本身。

### 5.2 仅作为待校准候选变体

以下是外部模拟器的具体实现，不得直接支持严格 Proof：

- 后手 freeze 不追溯取消先手在施放帧已经完成的动作；
- stun 的 normal/reverse 概率为 50/50；
- poison 使用全局帧奇偶控制行动 cadence；
- teleport 在合法相邻格之间均匀随机；
- overload 第二颗子弹从坦克旁侧一格开始，方向与第一颗相同；
- 内部存在多 projectile，但观察 API 只返回遍历到的第一颗可见 bullet；
- 同帧多弹命中、土堆破坏、shield 消耗和双杀的逐事件顺序。

这些候选分别拥有 rule id，不能被合并成一个笼统的 `SIMULATOR_MODE`。

### 5.2.1 DD1 已否定的模拟器 phase 候选

外部模拟器实现 `effect expiry/bomb → A → B → bullet`。平台 244 局 ordered replay 只支持其中的 seat0→seat1 和 action-before-bullet；其 bomb-before-action 与平台证据冲突：38 个 bomb explosion frame 均在双方 action 后，存在 projectile 时还全部在 projectile 后，并且已有坦克当帧移动进/出 blast 后分别死亡/存活的因果样本。

因此当前平台主 phase 冻结为：

```text
timed expiry
  -> star spawn
  -> observe/poll
  -> seat0 action
  -> seat1 action
  -> star collection
  -> projectile substeps
  -> bomb resolution
  -> terminal
```

ExternalSimulatorAdapter 在相关 fixture 上必须输出显式 `EXPECTED_RULE_MISMATCH`，不得通过重排 canonical expected events 掩盖差异。若未来模拟器更新，只能在固定新 commit 后重新校准。

### 5.3 明确不采用的本地参数

- poison 冷却 25：与官方当前 20 帧冲突；
- 默认 300 帧终局：不是本项目暂定的 128 帧平台终局；
- bot 单回合 20/100ms timeout：不是平台整局 3 秒 runtime；
- 本地随机地图和随机星星分布：只用于压力测试；
- Node 22、VM 和子进程耗时：只属于模拟器工具环境。

## 6. Minimax 接入方式

模拟器规则只能通过 RulesKernel 边界影响搜索：

1. RuleRegistry 冻结 `RULESET_VERSION`、`phaseOrderId` 和技能整数表；
2. ObservationAdapter 把真实 `me/enemy/game` 转成 canonical root；
3. RulesKernel 根据联合动作产生 Physical successor；
4. InformationKernel 根据我方观察签名重新分区；
5. SearchDriver 在不读取模拟器对象的情况下运行 Proof、Value 和 Risk backup。

禁止为“适配模拟器”改变以下语义：

- 不能把玩家 A/B 行动顺序错误地当作我方/敌方先后 Minimax；
- 不能把随机 stun/teleport 当作敌方战略动作；
- 不能把隐藏 overload 第二弹当作规则随机性；它是规则确定、观察不完全时的 HiddenWorld；
- 不能用模拟器胜率替代强制胜利覆盖证书；
- 不能因为模拟器只有一个可见 `enemy.bullet` 而把内部 projectile pool 限制为一颗。

## 7. 性能合同

模拟器集成不得增加生产搜索的对象分配或动态分派：

- 我方发布时已知技能编译成一个专用 action emitter；
- 八种敌方技能保留紧凑 capability/transition/hazard descriptor；
- 根回调只把公开 `enemy.skill.type` 转换一次为 `enemySkillId`；
- 热路径按小整数和定长表访问，不保留技能字符串或插件对象；
- `phaseOrderId`、技能 id、shield hit count、effect deadline 和 command timing 进入状态/hash；
- RuleVariant 循环只在测试工具运行；生产构建固定单一规则，不乘大 Minimax 分支数；
- 外部模拟器的 clone、Map、对象事件和 replay JSON 不复用到 FastKernel。

## 8. 校准测试矩阵

每个候选规则至少准备：

- 单一规则最小 fixture；
- 交换双方 seat 的镜像 fixture；
- 同帧复合事件 fixture；
- 可见/不可见 observation fixture；
- 终局边界 fixture；
- source/minified FastKernel 差分 fixture。

必须优先校准：

1. runtime 精确相等和 3 秒 comparator；
2. 敌方多弹 observation relation；overload 几何已由 DD4 平台 replay 确认；
3. 多弹/多 bomb 对共享土堆、两 hit shield 和坦克的精确结算；
4. 同格移动、swap 和迎面 crash；
5. stun、teleport 的 chance 概率（support 已由 DD4 闭合）；
6. poison cadence、freeze 空队列 polling 和技能 ready frame；
7. 隐藏 bomb/projectile 的再观察与失效条件。

## 9. 准入门

一项模拟器规则只有同时满足以下条件才能进入正式规则表：

1. 有唯一 rule id、输入、事件 trace 和预期观察；
2. 已按证据层级解决冲突；
3. ReferenceKernel 与平台 corpus 一致；
4. FastKernel 与 ReferenceKernel 全量差分一致；
5. 规则变化已触发对应缓存版本失效；
6. 复合和全景 Benchmark 未突破时间、内存和临时分配门限。

无法满足时保留 UNKNOWN/RuleVariant，不允许为了提高本地模拟胜率降低证明标准。

## 10. 历史检查点 Adapter

`HistoricalCheckpointAdapter` 与 ExternalSimulatorAdapter 同属测试工具，但职责不同：

- 从真实平台 replay 构建 `TruthTrack`；
- 分别从我方和敌方视角构建不泄漏隐藏真值的 `ObservedTrack(side)`；
- 生成死亡、逃生、击杀、技能、终局和 runtime 检查点；
- 把检查点转换为 ReferenceKernel/FastKernel 共用的 canonical fixture；
- 保存重建 confidence、RuleAssumptionMask、corpus fingerprint 和原始 match/frame 定位。

真实 replay 事件的证据等级高于外部模拟器，但 replay parser 的推断不自动成为平台事实。无法唯一重建的字段必须进入 HiddenWorld、RuleVariant 或 UNKNOWN。

## 11. 双向反事实与对手模拟

历史检查点支持交换受控方：既测试新策略能否避免我方历史死亡，也搜索历史敌方是否能够避免其死亡。运行模式和可避免性标签以 [legacy-evidence-contract.md](legacy-evidence-contract.md) 为准。

分叉合同：

1. checkpoint 之前复现真实事件；
2. 完全相同的联合状态/命令前缀可继续消费历史事件；
3. 任一动作、实体或观察分叉后，历史后缀立即失效；
4. 后续敌方动作来自 LegacyPolicyAdapter、TraceOpponentProfile、脚本 policy 或 ReferenceKernel best response；
5. 后续物理只由冻结 RuleVariant 的 ReferenceKernel/FastKernel 产生；
6. `TRACE_AVOIDABLE`、`MODEL_AVOIDABLE` 只提供软证据；只有完整量词覆盖的 `ROBUST_AVOIDABLE`、`STRICT_UNAVOIDABLE` 可写入 Proof fixture。

完整 v1/v2 league 可以在外部模拟器上大规模筛选，但 simulator 规则不一致的场景必须标记对应 RuleVariant，不能把本地胜率升级为平台规则或严格证明。
