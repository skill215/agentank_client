# 高性能技术架构

状态：DD10同步架构。DD3–DD8已冻结physical/search/soft/cache/runtime/build合同；具体生产容量、预算和平台参数仍待v2 benchmark，DD9拥有不可变历史/反事实门，DD10拥有动态语料、平台运行与最终发布门。

## 1. 架构目标

本架构首先约束数据布局、状态所有权、算法复杂度、缓存生命周期和性能验证方式，然后才允许实现游戏功能。

核心原则：

- 正确性和性能都属于架构合同，而不是实现后的优化阶段。
- Minimax 热路径接近零堆分配。
- 物理事实、证明结果、概率风险和策略评分分层存储。
- 所有搜索模式共用同一个 RulesKernel 和 FrameTimeline。
- 缩减深度不能缩减已提交危险的完整生命周期计算。
- 缓存只提供加速，永远不是事实来源。
- 外部模拟器只属于测试冷层，不能进入 RulesKernel、搜索热路径或规则真值链。

## 2. 平台约束

- 指南只提供同步 `onIdle` 入口，没有线程、Worker、SharedArrayBuffer 或 Atomics 合同。
- 正式实现严格单线程。
- 指南要求避免浏览器 API 和网络调用；正式脚本不使用动态加载、网络、Worker、`eval` 或 `new Function`。
- JavaScript 引擎未公开。底层只依赖标准 JavaScript，所有 JIT 相关选择必须由平台 Benchmark 锁定。
- 平台 replay 已确认约 3 秒 `timeout`；精确比较边界未知。累计达到 1.5 秒后永久进入 fallback。

## 3. 冷热分层

### 3.1 冷层

允许使用清晰的模块、固定形状对象和描述性枚举，负责：

- 运行时输入解析；
- 策略与风险根节点选择；
- 规则和配置生成；
- 我方固定技能的构建期专门化与敌方技能整数表生成；
- 诊断与 Benchmark；
- 历史 replay 双轨重建、v1 分析结论注册和窗口提取；
- LegacyPolicyAdapter、对手侧反事实模拟与完整对局 league；
- 最终动作解码。

### 3.2 热层

只接受数值 ABI：

- CommandCode、ActionRef/ActionKey；
- cellId、slot、generation、offset；
- TypedArray；
- bitset；
- 0–10000 定点概率；
- 固定 result code。

热层禁止：

- 每节点创建 Action、Position、Entity、Result 或数组对象；
- 字符串键、无界 Map/Set；
- 动态数组扩容；
- 稀疏数组和越界读取；
- 运行时模块加载；
- 日志和格式化。

## 4. 顶层数据流

    Runtime objects
        -> ObservationAdapter
        -> immutable ObservedRoot
        -> root rule/seat/enemySkill integer classification
        -> TrackedState reconciliation
        -> root SearchState snapshot (singleton PhysicalState or InformationState)
        -> committed hazard / hard viability
        -> immediate forced-win check
        -> InformationState AND/OR Proof
        -> proof-aware hybrid ValueSearch
        -> critical-node restricted stage matrix
        -> recursive robust value / root mixed strategy
        -> ActionEmitter
        -> PendingOwnCommandRegistry

任何复杂搜索开始前，先生成一个低成本 `lastKnownEmergencyAction`。

## 5. 状态分层

### 5.1 ObservedRoot

- 每个 `onIdle` 从运行时重新建立。
- 完整核对实际地图的所有格。
- 保存当前帧可观察的坦克、星星、技能和实体事实。
- 把公开 `enemy.skill.type`、我方技能和可获得的 seat 信息一次性转换为小整数；搜索阶段不再读取字符串。
- 本次回调内只读。

### 5.2 TrackedState

- 保存运行时不能持续暴露、但已经确认或物理推定仍存在的实体。
- 敌方子弹不可见不等于消失。
- 自己在草中的炸弹即使不出现在 `game.bombs` 也必须保留。
- 隐藏事实与概率 belief 分开。

### 5.3 SearchState

`SearchState` 是 tagged union，不是第三套状态对象：

    SearchState = PhysicalState | InformationState

热路径用 `(stateKind, stateOffset)` 两个整数表达 union，不分配 wrapper。它显式区分：

- `PhysicalState`：一个完整物理世界，用于 RulesKernel、完全可观察分支和 chance 转换；
- `InformationState`：我方当前不可区分的 PhysicalState 集合、概率 belief、观察历史与共同可提交命令；
- 根决策和所有存在隐藏信息的我方决策都以 InformationState 为节点；
- 只有 decision-relevant hidden variables 收敛为单一等价类时，才进入 PhysicalState singleton fast path。

branch-local 小型 PhysicalScratch 可以按深度预分配；并存 WorldRecord 必须 immutable，不能共用唯一 depth slot。地形、实体、世界集合和危险等大型状态使用专用差量与撤销。搜索绝不修改 ObservedRoot 或真实 PersistentArena。

PhysicalState 必须携带影响同帧转换的 `phaseOrderId/seatId`、双方 skillId、shield hit count、effect/ready deadline 和 queue timing。未知 phase 不得默认“我方先手”；开发期通过 RuleVariant 运行 ReferenceKernel，正式构建只接受已冻结 phase table。

### 5.4 Pending commands

- 调用 `me.fire()` 或 `me.throwBomb()` 只表示命令入队。
- 实体到实际执行 phase 才创建。
- FIRE 可能被消耗但不产生子弹。
- Active Plan 支持 PENDING_EXECUTION、ACTIVE、COMPLETED、INVALIDATED。

## 6. Arena 生命周期

- MatchArena：静态地图、邻接、射线、坐标和规则常量。
- PersistentArena：实体注册表、Active Plan、对手模型和跨帧缓存。
- FrameArena：当前观察、根候选、临时路径和根阶段矩阵。
- SearchArena：按深度状态、动作、结果、差量和搜索工作区。
- CacheArena：固定容量的专用缓存。
- EmergencyReserve：正常路径不用，容量异常时保障事实完整。

搜索期间不扩容。真实实体溢出时使用 EmergencyReserve 并永久降级；假设分支溢出时当前迭代返回 INCOMPLETE，不能生成证明。

## 7. 物理状态转换

所有搜索通过唯一联合动作入口：

    applyJointPhysical(parentPhysicalOffset, ourActionRef, enemyActionRef,
                       chanceCode, childPhysicalOffset)

它使用固定 FrameTimeline phase，先收集同 phase 事件，再统一结算。函数返回整数状态码；大型修改进入专用 DeltaArena。

分支开始保存统一 BranchMark，结束时分别撤销地形、实体、危险贡献、所有可回退 pool usedCount 和哈希。每次完整迭代结束检查：

- root hash 恢复；
- delta 指针恢复；
- world/information/action/result/policy/coverage 等 pool usedCount 恢复；
- terrain bitset 恢复；
- entity active mask 恢复。

失败时丢弃当前结果，从只读 Root 重建并进入 fallback。

## 8. 搜索控制

- 同时行动节点惰性展开联合动作阶段矩阵。
- Proof 与 Value 语义分离，但共享物理转换及完整覆盖产生的证明。
- 深层 pure Minimax 只计算序列化 `pureLower/pureUpper` 快速界；二者相等且依赖 cell 全部具有 cutoff-eligible 完整界时才是精确纯鞍点值。
- 根节点和战术关键深层节点可运行受限矩阵求解；由 best response 驱动动作加入，而不是固定纯评分 top-K。
- regret solver 输出平均策略、lower、upper 和 exploitability gap；固定迭代次数不能单独生成 complete。
- EnemyAction、HiddenWorld、ChanceOutcome 保留独立量词、概率和覆盖证书，不能压成一个统一对手场景列。
- ForcedWin 在 InformationState 上执行 OR(我方共同动作)/AND(敌方回应、可能世界、chance、观察后继) Proof。
- 风险采用每个 state/joint-action 上递归的 epsilon-contamination robust backup，不只在根节点二次混合 scalar value。
- 迭代加深始终保留最后完整深度。
- 下一深度预计无法完成时，改做证明补全、TacticalClosure 或当前关键阶段矩阵精化。
- 搜索深度计联合决策节点；物理时间始终计真实帧。
- 只有双方都无决策机会的帧才允许压缩。

完整算法、量词和中断合同见 [hybrid-solver-contracts.md](hybrid-solver-contracts.md)。

递归 DFS 与显式栈 DFS 同时作为 Architecture Validation Prototype 实现；正式构建只保留平台 Benchmark 的胜者。

## 9. 时间模式

- NORMAL：累计校准work未接近fallback软界；若未来墙钟被确认，则可使用对应毫秒界。
- DEGRADED：预测下一批工作会逼近1.5秒等价门，逐步减少深度、候选、belief K 和昂贵特征。
- FALLBACK：达到1.5秒等价work limit后永久进入，继续运行缩减 Minimax。
- EMERGENCY：达到2.5秒等价work limit、单callback安全界、Arena异常或一致性失败时，只保留确定危险、终局必要动作和最低成本搜索。

不按 128 帧平均分配时间。EndgameSolver 独立计算，但其耗时仍计入 3 秒总限制。

当前v2官方环境没有已确认安全可用的墙钟，默认使用零对象分配的整数work counter，并按build/hash绑定的平台source/minified P99校准。v1的`Date.now()`能力保护与固定节点上限作为证据继承；只有CapabilityProfile把墙钟确认为可调用且单调时，才允许在回调/固定批次边界低频读取。单callback约1500ms watchdog与整局约3秒限制分开处理。

## 10. 策略和技能边界

- 完整 StrategySelector 每个真实根状态运行一次。
- 一次搜索内冻结对手模型和根策略上下文。
- 假设节点只通过预生成 EvalProfile 做少量硬阶段切换。
- 每个真实根选择并冻结 RiskProfileId；节点内按 hypothetical stateRiskClass 通过整数查表递归计算 robust backup。
- 技能在冷层编译为能力标志、规则常量和静态函数；热路径不进行字符串技能分派。
- 我方技能在发布构建时专门化为唯一 emitter；敌方技能在开局公开，因此正式包保留八种紧凑 descriptor，并在根回调转换成 `enemySkillId` 后按整数表访问。
- 技能不能绕过 HardGateStatus、TerminalResolver 或 Proof 完整性。
- 未经平台确认的外部模拟器规则通过 ReferenceKernel 的 RuleVariant 表达，不增加生产 Minimax 的运行时 scenario 维度。

## 11. 生产构建

开发源码模块化；本地构建脚本生成一个普通 JavaScript 文件：

- 顶层 `onIdle`；
- 多个静态辅助函数；
- 固定数组、常量和查表；
- 无 import/export/require；
- 删除 ExternalSimulatorAdapter、ReferenceKernel、Benchmark、日志、未使用的我方技能 emitter、RuleVariant 描述和诊断格式化；
- 删除 HistoricalReplayAdapter、LegacyPolicyAdapter、LegacyFindingRegistry、反事实 runner、replay JSON/CSV、match id 和命名对手参数；
- 保留八种可能敌方技能所需的紧凑 capability/transition/hazard 表；
- 保留低成本 root 恢复、容量和 result code 检查。

构建报告必须包含精确 UTF-8 脚本字节数、初始化时间、Arena 字节数、各缓存容量、RULESET_VERSION、source manifest hash 和敌方技能表保留清单。若启用离线蒸馏先验，还必须记录 `legacyPriorVersion`、corpus fingerprint、生成物 bytes 和关闭该先验的 A/B 结果。JavaScript 字符数不能替代 UTF-8 字节数。

## 12. 实施阶段门

详细顺序、准入条件和冻结条件以 [detailed-design-roadmap.md](detailed-design-roadmap.md) 为准。总阶段为：

1. DD0 规范收口。
2. DD1 动作、调度、时间线和终局语义。
3. DD2 状态、观察、实体和数值 ABI。
4. DD3 真实负载 Architecture Validation Prototype。
5. DD4 独立慢速 ReferenceKernel 与规则校准。
6. DD5 Fast RulesKernel、实体、危险和硬失败层。
7. DD6 Proof、Value、Risk 和 InformationState 搜索。
8. DD7 Plan、策略、评分、对手模型和技能。
9. DD8 缓存、时间控制、fallback 和生产构建。
10. DD9 历史冻结集、双向反事实、平台前向验证和发布门。

DD3 已用真实 InformationState、多 projectile/bomb、observation partition、受限矩阵、apply/undo 和 mixed-policy output 完成垂直切片，并冻结 immutable WorldDelta、TypedArray SoA、explicit stack 与 generated BranchMark。DD8已冻结完整Cache/Runtime/Build合同；生产容量和预算数值由v2 benchmark写入manifest并受DD9 release gate约束。

任何模块突破时间、空间、分配或一致性合同，都必须回到架构阶段修改，不能留到最终调优。
