# Benchmark 合同

## 1. 目标

Benchmark 与坦克源码同等重要，用于：

- 验证性能架构，不只验证局部函数；
- 比较可替换实现；
- 发现冷启动、GC、缓存失效和极端分支；
- 为 Arena、深度、节点数和 fallback profile 提供数据；
- 阻止正确性或性能回归。

所有结果区分本地 JavaScript 与 AgenTank 平台。平台结果是最终锁定依据。

## 2. 正确性 Oracle

### 2.1 ReferenceKernel

- 独立、清晰、允许对象和完整状态复制。
- 不与 FastKernel 共享状态转换代码。
- 只用于本地测试。

### 2.2 ExternalSimulatorAdapter

- 固定到 manifest 中的 simulator commit，不跟随浮动分支；
- 将 canonical fixture 转为外部模拟器输入，并把 event replay 转回 canonical trace；
- 用于候选规则发现、复合场景生成和差分定位；
- 不与 ReferenceKernel/FastKernel 共享转换代码；
- 一致只记为 EXTERNAL_SIM_MATCH，冲突必须回到官方 Updates 或平台 replay/simulation 仲裁。

### 2.3 FastKernel

- 正式 TypedArray/Arena/差量实现。

### 2.4 验证链

    official contract + platform replay/simulation
      -> RuleCorpus / RuleRegistry
      -> calibrate independent ReferenceKernel
      -> differential test FastKernel
      -> differential source/minified bundle
      -> benchmark production bundle

    external simulator
      -> candidate fixture/trace
      -> compare with RuleCorpus and ReferenceKernel
      -> request platform calibration on mismatch

规则 UNKNOWN 时 Reference/Fast 都必须显式返回 UNKNOWN，不允许同样猜错后互相证明。外部模拟器匹配不能让 UNKNOWN 自动升级。

## 3. 六层性能 Benchmark 与独立回放轨

六个性能层固定为：函数、复合、全景pipeline、终局、完整对局、source/minified平台。
回放承担事实重建、回归和离线吞吐验证，属于独立验证轨；它不替代第六层production/platform
测量，也不把历史平台runtime混入本地FastKernel指标。

### 3.1 函数级

测试：

- 输入解析与完整 20x20 地图核对；
- terrain/bitset 更新；
-实体观察协调；
-动作编码、生成、排序；
- applyJointPhysical 与 ObservationPartition；
- undoTo；
- FrameTimeline phase；
-增量 hash；
- TT/ProofCache probe/write；
-轨迹生成与后缀失效；
-危险贡献增删；
- ReverseViability broad phase；
- Exact Narrow Phase；
- BFS、0-1 BFS、bucket queue；
- DeadlineKernel；
-定点评分、sigmoid LUT、概率归一化；
- EnemyAction/HiddenWorld/ChanceOutcome 独立生成；
- InformationState canonicalization 与共同动作生成；
- pureLower/pureUpper 与纯鞍点检测；
-受限阶段矩阵、best response、平均策略和 exploitability gap；
-递归 epsilon-contamination RiskMatrix；
-整数 regret matching；
- root skill string -> integer id 分类；
- RuleVariant 与 HiddenWorld/Chance 编码隔离；
- canonical simulator event trace adapter（仅测试工具）。

每项测首次调用、稳态、最坏输入、分配和输出 hash。

### 3.2 复合场景

至少包含：

- 多子弹交叉射线与炸弹倒计时；
- overload 两弹和多 hit shield；
- overload 两颗 projectile 独立 hit 两次 shield、bomb 一次消耗整个 shield；
-子弹摧毁土堆后改变射线/爆炸；
-双方同帧移动、开火、炸弹、技能；
-隐藏敌人、不可见弹、草中炸弹；
-两个不可区分 HiddenWorld 必须使用同一我方动作的 strategy-fusion trap；
-同一敌方 information set 不得在不同 HiddenWorld 选择不同动作、不同敌方 information set 可选择不同动作的双向 strategy-fusion trap；
-相同/不同 observation signature 的后继合并与分裂；
-action-dependent teleport/stun chance 概率；
-ActiveShotPlan/ActiveBombPlan 与新危险冲突；
-地形变化、缓存局部失效、search reroot；
-Pending command 实际执行失败；
-Arena 接近容量和 EmergencyReserve；
-NORMAL -> DEGRADED -> FALLBACK；
- A/B seat 镜像、phase order 变体与先后手 freeze；
- 单数 `enemy.bullet` 观察下的多 projectile belief；
- 官方 poison 20 与外部 simulator 25 的冲突拦截。

### 3.3 全景状态

从运行时样式输入一直执行到最终 action code：

- 20x20 真实地图；
-双方坦克和技能；
-多实体完整时间线；
-星星与终局 deadline；
-InformationState、hidden belief 和 command belief；
-opponent model；
-Active Plan；
-多层 pure bounds、关键节点受限矩阵、TacticalClosure 和递归 robust backup。

测整个 onIdle 管线，而不是只测 search。

### 3.4 终局专项

- frame 128 同星；
-同星近距离对枪，可躲与不可躲；
-同时击毁；
-领先时有利互换；
-落后时唯一逆转；
-最后可拿星/阻止拿星；
-子弹命中在终局前、同 phase、终局后；
-炸弹爆炸在终局边界；
-技能最后生效窗口；
-已进入 fallback 的 EndgameSolver；
-累计 runtime 较高的保守同星判定。

小型终局使用 ReferenceKernel 穷举 Oracle。

### 3.5 完整对局

- 完整至终局或提前结束。
-固定地图、技能、对手、随机 seed。
-旧坦克作为行为基线和对手。
-脚本化对手覆盖冲锋、龟缩、抢星、盲射、技能爆发和风格切换。
-批量统计累计 runtime、fallback 点、胜率和硬违规。
-通过平台 simulation 校准本地性能与规则。
-外部模拟器只用于大规模本地筛选；候选胜率不能替代平台验证。

### 3.6 独立回放验证轨（不计入六层性能层）

- 固定保存真实观察序列。
-逐帧重放 ObservationAdapter。
-检查 root hash、实体协调、HardGateStatus、选择动作、缓存命中和失效。
-比较不同版本总 runtime。
-回放 corpus 必须覆盖失败、runtime、error、隐藏、炸弹、overload 和终局。

历史 replay 必须进一步分成：

- `FactualReplay`：只验证真实前缀、观察重建、动作漂移和事件一致性；
- `FailureWindow`：从 failure origin、最后可避免帧、不可逆点到终局；
- `PositiveWindow`：击杀、逃生、炸弹逃生、技能价值、终局互换和性能热点；
- `BidirectionalCheckpoint`：交换受控方，分别搜索我方和历史敌方能否避免死亡；
- `CounterfactualBranch`：动作分叉后由 ReferenceKernel 和 policy/best response 继续，不消费失效的历史后缀。

每个检查点同时保存 `TruthTrack`、双方各自 `ObservedTrack`、重建 confidence、RuleAssumptionMask、match/frame 定位和 corpus fingerprint。禁止把 TruthTrack 隐藏事实输入被测 policy。

可避免性分别报告：

- `TRACE_AVOIDABLE`：只针对已复现实际下一回应；
- `MODEL_AVOIDABLE`：针对历史对手模型，属于软证据；
- `ROBUST_AVOIDABLE`：共同动作覆盖所有合法回应/世界/chance 后非输；
- `STRICT_UNAVOIDABLE`：按 ForcedLoss 量词完整覆盖所有共同动作、敌方反制、相关世界/chance 和观察后继；
- `UNKNOWN`：重建、规则或搜索覆盖不足。

原则边界见 [legacy-evidence-contract.md](legacy-evidence-contract.md)，完整 schema、分叉门和结果准入见 [counterfactual-validation-contract.md](counterfactual-validation-contract.md)。

## 4. 搜索实现 A/B

必须比较：

- RecursiveSearchDriver vs StackSearchDriver。
- TypedArray vs packed Array 的候选热结构。
- small-state copy + large delta vs 更完整 make/unmake。
- TableEvaluator vs GeneratedEvaluator。
- 2-way vs 4-way TT。
-不同 TT 容量。
- dirty clear vs generation stamp。
-内嵌 LUT vs 开局生成 LUT。
-TransitionCache enabled vs disabled。
-pure bounds only vs critical-node restricted matrix（正确性按 Reference interval 验证）。
-full matrix vs Double Oracle restricted matrix。
-singleton PhysicalState fast path vs 通用 InformationState path。
-external simulator enabled vs disabled 只比较测试吞吐；生产 bundle hash/bytes 必须完全不受 Adapter 影响。

测试输入、动作顺序、seed 和输出必须相同。

## 5. 统一指标

正确性：

- terminal mismatch；
- hard violation；
- forced-win miss；
- proof false positive；
-strategy fusion；
-EnemyAction/HiddenWorld/ChanceOutcome 量词混用；
-pure bound 被错误标成 exact；
-依赖 heuristic/incomplete cell 的相等 pure bounds 被错误升级；
-定点截断把非零真实区间压成 gap==0 并错误升级 exact；
-exploitability gap 与 complete 标志不一致；
-recursive risk value mismatch；
- undo/root hash failure；
- Fast/Reference state mismatch；
- UNKNOWN 被错误升级；
- EXTERNAL_SIM_MATCH 被错误升级为 strict rule；
- RuleVariant 被错误混入 HiddenWorld/Chance；
- stale cache read；
-非法 action emitted。
- replay hidden-truth leakage；
- 历史分叉后错误消费 replay suffix；
- 历史单例死亡被错误升级为 Hard/Proof；
- 双向反事实两侧使用不一致量词；
- 正向 Kill/EscapeWindow 被安全改动破坏。

性能：

- total runtime；
- callback max；
- p50/p95/p99；
- cold-start latency；
- steady-state nodes/ms；
- completed decision depth；
-joint transitions；
-hidden worlds / observation partitions / chance outcomes；
-restricted matrix rows/columns 与 exploitability gap；
-prune rate；
-TT/Proof/Path/Plan hit rate；
-Arena peak；
-EmergencyReserve usage；
-temporary allocations；
-GC/pause evidence；
-fallback transition time；
-script/init/arena bytes；
-exact UTF-8 bundle bytes、source/minified 行为差分；
-root skill classification cost 与敌方 descriptor lookup cost；
-ExternalSimulatorAdapter 吞吐单独报告，禁止并入 FastKernel nodes/ms。
- HistoricalReplayAdapter、窗口提取和反事实 runner 吞吐单独报告，禁止并入 FastKernel nodes/ms；
- 历史检查点 factual reproduction rate、reconstruction unknown rate；
- TRACE/MODEL/ROBUST/STRICT/UNKNOWN 分布；
- 历史死亡逃脱率、敌方逃脱率和正向击杀保留率；
- last avoidable frame 到 point-of-no-return/terminal 的距离分布；
- 离线先验生成物 bytes、线上 lookup 成本和 enabled/disabled A/B。

## 6. 测量方法

- 固定 seed 与 deterministic action ordering。
- 同一进程先测冷启动，再测独立稳态。
- 多轮运行报告中位数与高分位，不采用最快单次。
- 时间读取不放在每个节点；Benchmark harness 可使用环境高精度时钟。
- 正式脚本由CapabilityProfile选择计时模式：当前使用零临时对象的整数work counter；只有可调用且单调的墙钟被平台证据确认后才低频读取。两种模式都以平台source/minified replay runtime校准。
- 基准代码不进入生产 bundle。
- Node VM/subprocess timeout、默认 300 帧和本地 runtime 不能用于设置平台 3 秒 profile。

## 7. 性能与正确性阶段门

发布优先级严格为：

1. 零 terminal/hard/proof 规则错误。
2. 零 runtime/error 和状态恢复失败。
3. 零 stale cache 与容量静默截断。
4. 概率与胜率校准。
5. 在此前提下比较胜率、深度和策略质量。

任何硬正确性或 3 秒 runtime 失败都阻止发布，不允许用更高平均胜率抵消。

具体数值阈值在第一轮平台基线后写入，不在架构阶段凭感觉固定。

## 8. Regression manifest

每个可比较构建记录：

- code hash；
- RULESET_VERSION；
- guide hash；
-official updates manifest/hash；
-external simulator commit；
-framework commit（若构建脚本仍引用其思路或工具）；
-RuleCorpus version 与 platform replay corpus ids；
- LEGACY_CORPUS_VERSION、corpus fingerprint 与 split manifest；
- LegacyFindingRegistry version、窗口 extractor version 与 reconstruction version；
- LegacyPolicyAdapter 支持的 v1 code hash 集；
-build profile；
-memory manifest；
-search profile；
-feature/weight version；
-opponent model version；
-benchmark corpus version；
-local engine/version；
-platform run identifiers。

## 9. Architecture Validation Prototype

第一批代码只包含：

- Arena 与数值 ABI；
-状态复制/差量/撤销；
-hash/TT；
-假联合动作；
-两套 SearchDriver；
-两套 evaluator；
-六层 Benchmark harness 的骨架；
-RuleCorpus schema、ExternalSimulatorAdapter 接口和 source manifest 校验。
- HistoricalReplayAdapter、双轨重建、窗口 schema 和分叉门禁骨架。

在冻结底层布局前，Prototype 还必须加入 DD3 真实负载垂直切片：最大规格地图、多 projectile/bomb、隐藏 tank/queue、歧义 entity association、多个 immutable world、lossless residual、双方 information history partition、restricted matrix、apply/undo、统一 Result/Coverage 和 mixed-policy output。容量故障注入必须逐类覆盖 FACT/SUPPORT/SEARCH/CACHE/OUTPUT。只测试假联合动作或孤立微函数不足以冻结 WorldSnapshot/Delta、Arena、Event、Result、Policy 或 Cache 物理 ABI。

它不需要形成完整可对战坦克，但必须能够执行上述端到端垂直场景。完成真实负载 A/B 后才允许冻结底层并进入完整 ReferenceKernel/FastKernel。外部模拟器 Adapter 可以先接入 fixture 管线，但不能参与底层性能胜者选择或生产代码生成。完整阶段门见 [detailed-design-roadmap.md](detailed-design-roadmap.md)。

## 10. 外部模拟器专项门禁

固定使用 `cyhhao/agentank-simulator@1ef804eb2c187138c4c8e5229fb37cd0126beddf` 建立三类结果：

- MATCH：canonical trace 与冻结规则一致；
- EXPECTED_MISMATCH：已登记差异，例如 poison cooldown、frame limit、runtime；
- UNRESOLVED_MISMATCH：需要平台 fixture 仲裁，阻止相关规则进入严格 Proof。

每次升级 simulator commit 必须重新运行：

1. 所有最小规则 fixture；
2. seat 镜像与同帧复合 fixture；
3. 隐藏观察 fixture；
4. 终局 fixture；
5. 完整 RuleCorpus 差分；
6. 旧/新 simulator 差异报告。

升级外部模拟器本身不能递增正式 RULESET_VERSION；只有平台规则结论变化才递增。外部工具版本单独进入 regression manifest。
