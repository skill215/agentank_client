# 详细设计决策登记

状态：DD10 同步版，2026-07-16。Accepted 决策具有架构约束力；Provisional 必须由目标阶段验证后才能冻结实现参数。

## 1. 状态

- `ACCEPTED`：用户已确认且与当前架构一致。
- `PROVISIONAL`：方向已接受，具体 ABI/参数需实验或规则证据。
- `DEFERRED`：已确定目标阶段，当前不做选择。
- `SUPERSEDED`：由后续 decision 明确替代，历史记录保留。

## 2. 已接受的架构决策

| ID | 状态 | 决策 | 约束/理由 | 落地阶段 |
|---|---|---|---|---|
| DEC-0001 | ACCEPTED | `SearchState = PhysicalState | InformationState` | 完全可观察和不完全信息不能共用“单一真状态”假设 | DD2、DD6 |
| DEC-0002 | ACCEPTED | `EnemyAction`、`HiddenWorld`、`ChanceOutcome` 使用三个独立量词 | 防止把对手策略、隐藏事实和规则随机性混成一个 scenario group | DD1、DD6 |
| DEC-0003 | ACCEPTED | `HARD_REJECT_PROVEN` 只处理严格终局失败；敌方尚未提交的可能开火进入风险层 | “可能被杀”不是“已经必死”；所有 action 在评分前先做 HardGate 检查 | DD1、DD5、DD6 |
| DEC-0004 | ACCEPTED | InformationState 上已证明的 ForcedWin 优先于所有软策略 | 必须覆盖全部合法敌方动作、隐藏世界和 chance，且无未知规则 | DD1、DD6 |
| DEC-0005 | ACCEPTED | ForcedWin 改为 InformationState 上的 AND/OR Proof | 深度值、经验概率或单条击杀线不能冒充强制胜利 | DD6 |
| DEC-0006 | ACCEPTED | 深层 pure Minimax 返回快速 lower/upper，而不是默认最终值 | 保证 anytime、中断和 fallback 有显式区间 | DD6 |
| DEC-0007 | ACCEPTED | 根和关键节点使用受限矩阵/Double Oracle；允许 mixed policy | 处理同时/对抗动作；强制动作与唯一安全动作除外 | DD6 |
| DEC-0008 | ACCEPTED | 风险使用递归 epsilon-contamination robust backup | risk=0 取最坏；risk=100 仍保留约 1% 最坏成分；具体定点表待校准 | DD6、DD7 |
| DEC-0009 | ACCEPTED | 不运行 Monte Carlo；fallback 运行缩减 Minimax | v1 Monte Carlo 只作为遗产证据，不进入 v2 | DD6、DD8 |
| DEC-0010 | ACCEPTED | 高性能约束先于完整策略设计 | 单线程同步；热路径整数/定点、固定容量、近零临时对象 | DD2–DD8 |
| DEC-0011 | ACCEPTED | 输入可传引用，但搜索内部不得持有会变动的平台对象 | 根入口一次规范化到自有整数状态，避免深层 clone 与外部别名 | DD2 |
| DEC-0012 | ACCEPTED | 已出现的 bullet/bomb 从创建到确认失效一直保留 | 不受 minimax depth 影响；碰墙、土堆、边界、命中等事件驱动失效 | DD2、DD5 |
| DEC-0013 | ACCEPTED | 多 projectile 使用独立 handle/generation，可共享 `shotGroupHandle` | overload 和未来多个 owner 均可表达，不能依赖单个 `enemy.bullet` | DD2、DD5 |
| DEC-0014 | ACCEPTED | Hard 过滤可由 committed hazard 正推与死亡链反推共同生成 | 反推结果必须经 RulesKernel/Terminal 核验；物理死亡不自动等于终局 LOSS | DD5、DD6 |
| DEC-0015 | ACCEPTED | 模块与缓存分离，缓存通过显式合同优化模块 | cache 关闭不能改变语义；跨帧缓存必须有版本、失效和碰撞策略 | DD8 |
| DEC-0016 | ACCEPTED | 一局内动态更新对手参数，不动态调整我方基础权重 | 对手 risk/开火/移动/技能倾向只影响软期望、风险和排序 | DD7 |
| DEC-0017 | ACCEPTED | v1 和 244 局是证据、回归对手与反事实起点，不是 v2 实现基础 | 历史分叉后不复用 replay 后缀；严格结论需完整量词覆盖 | DD4、DD9 |
| DEC-0018 | ACCEPTED | 外部模拟器是候选 Oracle/场景器，不是平台真值 | 固定 commit，差分后再由平台证据升级规则 | DD4、DD9 |
| DEC-0019 | ACCEPTED | framework 只继承构建、分析与迭代闭环 | 其技能和画像为 TODO/空插槽，不提供技能物理或策略真值 | DD7–DD9 |
| DEC-0020 | ACCEPTED | 整局累计达到1.5秒等价预算后永久进入fallback | 244局中7个`timeout`终局确认约3秒平台上限；当前计量机制由DEC-0094修订为校准work counter | DD8、IMP2 |
| DEC-0021 | ACCEPTED | 同星终局按我方 runtime 较高做保守处理 | replay 已确认星数相同时以 runtime 决胜；精确相等和边界仍由 TerminalPolicy variant 表达 | DD1、DD4 |
| DEC-0022 | ACCEPTED | DD0–DD9 顺序具有约束力，DD3 前不冻结底层 ABI | 真实负载垂直切片决定 InformationState、Arena、Delta、Result、Policy | DD0–DD3 |
| DEC-0023 | ACCEPTED | 正式 bundle 剥离 Reference、模拟器、回放、对手命名数据和日志 | 生产只保留生成后的整数规则表与经 A/B 通过的小型先验 | DD8、DD9 |
| DEC-0024 | ACCEPTED | 评分、概率和风险在热路径使用整数/定点尺度 | 浮点只允许离线工具或明确 A/B；语义以归一化整数合同为准 | DD2、DD7 |
| DEC-0025 | ACCEPTED | 动作流水线分离 `SubmissionLegality`、`ExecutionStatus`、`HardGateStatus` 和 `TerminalResolution` | `HARD_REJECT_PROVEN`、显式保守政策拒绝、规则未知和执行失败不再共用一个状态 | DD1 |
| DEC-0026 | ACCEPTED | 时间使用 `platformFrame`、`recordIndex`、`decisionPly`、`phaseOrdinal` 四个独立坐标；实体存绝对 deadline | 防止 callback frame 与 replay 下标错一帧，且 deadline 比剩余帧更易 hash、缓存和失效 | DD1、DD2 |
| DEC-0027 | ACCEPTED | 当前平台主时间线冻结为 timed expiry → star spawn → observe/poll → seat0 action → seat1 action → star collection → projectile → bomb → terminal；poll 新提交命令最早下一帧执行 | Guide 与 244 局有稳定证据；外部模拟器的 bomb-before-action 候选被平台 replay 否定 | DD1、DD4 |
| DEC-0028 | ACCEPTED | 终局按 crash、frame-limit、star、runtime 的显式优先级解析，并严格区分 `runTime` 与 `timeout` | 单方 crash 直接失败；同帧双 crash 与 frame limit 先比星、同星再比 runtime；3 秒 `timeout` 是独立失败 | DD1、DD4 |
| DEC-0029 | ACCEPTED | 每个 UNKNOWN/RuleVariant 必须逐消费者声明行为，禁止静默默认 | Reference 可枚举 variant；Value 传播区间；Proof/严格 Hard 停止；Fast/生产 emitter 按 manifest 禁用或阻塞 | DD1、DD4 |
| DEC-0030 | ACCEPTED | `ActionProgram`、`CommandQueue` 与 `ExecutedFrameAction` 分层；boost 免费转向是同一 action slot 内的复合执行 | `go(2)` 是两个队列项；普通 `turn();fire()` 跨帧；提交动作不能冒充已发生事件 | DD1、DD2 |
| DEC-0031 | ACCEPTED | ForcedWin、ForcedNonloss、ForcedLoss、InevitableLoss 和 ActionRefuted 使用对称量词与覆盖证书 | simultaneity、HiddenWorld、ChanceOutcome 与规则未知不会被错误顺序化或策略融合 | DD1、DD6 |
| DEC-0032 | ACCEPTED | primitive `CommandCode`、arena-local `ActionRef` 和稳定 `ActionKey` 分离 | 任意 ActionProgram 可无损表达；TT/cache 不持有会随 usedCount 重用的地址 | DD2、DD3 |
| DEC-0033 | ACCEPTED | 统一 ResultArena/PolicyArena；deterministic 也是单项 policy，mixed policy 用 0–10000 定点与可复现 XORSHIFT32_V1 最终取样 | 关闭双 Result ABI；PRNG 只影响根 policy 取样，不进入 chance、physics 或 Proof | DD2、DD6 |
| DEC-0034 | ACCEPTED | 实体身份使用 type/slot/generation handle；外部字符串 ID 只作关联提示 | bullet 不保证 ID，外部 ID 长度可变；歧义关联必须保留为关系而非贪心合并 | DD2、DD3 |
| DEC-0035 | ACCEPTED | InformationState 使用 common physical base + immutable exact world support + lossless residual | 多 world 必须并存；top-K 只能裁概率计算，不能裁 Possibility 或破坏联合相关性 | DD2、DD3 |
| DEC-0036 | ACCEPTED | 容量分为 FACT_CRITICAL、SUPPORT_CRITICAL、SEARCH_QUALITY、CACHE_ONLY、OUTPUT_CRITICAL | 事实不得截断，support 不完整显式返回 incomplete，cache 满只允许 miss/替换 | DD2、DD3、DD8 |
| DEC-0037 | ACCEPTED | 平台对象只在根 Adapter 读取一次；null、field absent、invalid 和物理不存在分离 | 搜索不持有平台引用；不可见 bullet/bomb/tank 保留到规则失效或严格反证 | DD2、DD4 |
| DEC-0038 | ACCEPTED | CellT/FrameT/CountT 位宽由 capacity manifest 构建选择，概率/风险/value scale 固定 | corpus 尺寸只是下界；位宽不足必须升级 ABI 或构建失败，不允许饱和/截断 | DD2、DD3 |
| DEC-0039 | ACCEPTED | 多 world 采用 common immutable base + sorted immutable WorldDelta；singleton 使用同一 RulesKernel 的 direct fast path | 两档 oracle 等价；conservative world bytes 比 typed snapshot 低约 85%，full-state median 持平 | DD3、DD4–DD8 |
| DEC-0040 | ACCEPTED | 热池使用预分配 TypedArray SoA，搜索使用预分配显式栈；packed Array 与递归只保留为开发 oracle/历史候选 | 显式栈两档约快 47%/49%；packed 在保守复合负载无优势且占用更多 | DD3–DD8 |
| DEC-0041 | ACCEPTED | possibility support 使用 exact explicit prefix，超出后只能进入 lossless residual iterator | explicit 小集合更快，但性能不能授权裁剪低概率可能性或破坏联合相关性 | DD3、DD4、DD6 |
| DEC-0042 | ACCEPTED | 地图使用 column-major 静态整数层与动态实体池；派生 trajectory 允许版本化 direct-address cache，miss 必须重算 | 两档 cache 有净收益且 checksum 一致；DD8冻结inventory/选择合同，实际大小由实现benchmark写manifest | DD3、DD5、DD8 |
| DEC-0043 | ACCEPTED | ReferenceKernel 使用对象友好独立实现与 canonical trace，不复用 Fast helper | 差分必须能暴露实现错误；Reference 是规则 Oracle，不进入 production bundle | DD4、DD5 |
| DEC-0044 | ACCEPTED | RuleCorpus 支持固定 replayHash 的 prefix-to-state fixture、显式 setup 和 generated variant；每条 rule 绑定 handler 与 UNKNOWN 行为 | 大型平台 fixture 无需复制全 pre-state，但不可省略可重建性或用 replay 后缀补未知字段 | DD4、DD5、DD9 |
| DEC-0045 | ACCEPTED | overload member1 使用固定正轴垂直偏移；frame limit 在完整 recordIndex 127 后解析 | 五个方向覆盖 replay 与一个 128-record runtime replay 提供平台事件证据 | DD4、DD5 |
| DEC-0046 | ACCEPTED | R1 support closure 允许 confirmed、finite variant、typed unknown domain、production blocker 四种显式结果，不允许猜默认值 | 技能 event family 已闭合；概率与精确 deadline 未确认不阻塞状态设计，但会阻塞相应 strict branch | DD4–DD7 |
| DEC-0047 | ACCEPTED | FastKernel 只消费构建期生成的整数 RuleTable，节点内不枚举 RuleVariant | confirmed/common path 可专门化；输出分歧的 variant 必须 unsupported/incomplete，避免慢路径与隐式猜测 | DD5、DD8 |
| DEC-0048 | ACCEPTED | 每个 action 在评分前执行真实 Fast candidate transition、Hard closure、Terminal 聚合并 fully undo | 禁入格只是 broad phase；Hard 不能作为评分后的补救，也不能只按目标 cell 推断 | DD5–DD7 |
| DEC-0049 | ACCEPTED | Hazard 分为 Committed、Possible、Expected 三个物理隔离平面 | 只有已提交事实可进入严格 closure；敌方未来可能动作、隐藏可能和概率权重分别进入 robust/risk 与 expected | DD5–DD7 |
| DEC-0050 | ACCEPTED | ReverseViability 以 phase-accurate tank microstate 反推到最后 committed deadline，并由 TerminalResolver 判定失败 | 开火距离不是必杀证明；物理 crash 不自动等于终局 LOSS | DD5、DD6 |
| DEC-0051 | ACCEPTED | projectile/bomb SourcePlan 事件驱动缓存到规范失效，terrain/entity 变化只失效依赖后缀 | 所有 action/world 共享相同 signature 的 timeline/frontier；cache miss必须重算，容量合同由DD8冻结、数值待benchmark | DD5、DD8 |
| DEC-0052 | ACCEPTED | ValueSearch 严格分离 terminal-game interval、horizon interval 与 ordering point；DRAW utility 为0 | 普通 evaluator不能把point冒充sound terminal bound；depth exact不等于ForcedWin | DD6、DD7 |
| DEC-0053 | ACCEPTED | 深层同时行动pure search只返回`max-min lower / min-max upper`快速包络；仅根/关键节点求受限矩阵 | 计算预算改变区间宽度，不允许任选pure端点当最终值 | DD6 |
| DEC-0054 | ACCEPTED | Double Oracle下界使用受限我方policy的完整敌方BR，上界使用受限敌方policy的完整我方BR；整数regret输出平均策略 | 初始top-K不是最终support；固定iterations/gap不自动complete | DD6 |
| DEC-0055 | ACCEPTED | ForcedWin/Nonloss/Loss使用InformationState observation-consistent AND/OR图，DFPN只补全同一量词图 | hidden/world/chance、双方信息分区和strategy consistency必须进入Coverage | DD6 |
| DEC-0056 | ACCEPTED | Risk backup拆为ChanceOutcome、HiddenWorld、EnemyAction三维递归ε-contamination，每维expected weight为0–9900 | risk=0全worst；risk=100仍保留污染；技能不形成第四量词 | DD6、DD7 |
| DEC-0057 | ACCEPTED | 递归robust value是唯一风险主目标；根expected利用只在同一certified safeFloor内零损失tie-break | `allowedExploitLoss=0`，关闭RiskMatrix与root constraint重复计风险 | DD6 |
| DEC-0058 | ACCEPTED | 任意搜索中断必须发布sound interval/last complete policy；无法保证时返回UNKNOWN/INCOMPLETE | 未访问child用wide bound，capacity/time不能把裁剪结果升级complete | DD6、DD8 |
| DEC-0059 | ACCEPTED | Evaluation使用唯一FeatureRegistry，raw feature与weights分离；Table/Generated只做同语义A/B | profile调分只重做整数dot，普通point不能收紧terminal bound | DD7、DD8 |
| DEC-0060 | ACCEPTED | StrategySelector每真实root选择固定profile bundle，以能力阶段、margin、dwell和hysteresis动态切换 | 强制Win/Hard覆盖；节点不重新运行selector；我方tables/weights整局固定 | DD7 |
| DEC-0061 | ACCEPTED | OpponentModel按confirmed opportunity/choice维护fast/slow/confidence和多维risk preference | 开火/技能/移动概率只形成nominal enemy policy，不改变support、Hard或我方基础参数 | DD7、DD9 |
| DEC-0062 | ACCEPTED | 双方skill进入场地后公开；我方按build专门化一个emitter，敌方root分类为整数id并直接查八descriptor | 节点不枚举skill身份或字符串分派；descriptor不复制Fast物理 | DD7、DD8 |
| DEC-0063 | ACCEPTED | 每个FIRE/BOMB先绑定固定PlanSketch，只有root finalist/实际动作建立PersistentPlan | 避免为高频开火候选复制trajectory；仍保证每个攻击有purpose | DD7 |
| DEC-0064 | ACCEPTED | DD5 SourcePlan与DD7意图Plan分开；Hard始终来自PhysicalState/Hazard | projectile/bomb缓存到失效并按member/suffix dirty；Plan淘汰或改分不能删除安全事实 | DD7、DD8 |
| DEC-0065 | ACCEPTED | 草/cloak/不可见威胁用PossibleShot、BeliefSweep、InformationControl软特征和robust risk处理 | 无必然可观察反馈不能删除Possibility；盲射/bomb/远离隐身位置不产生strict Proof | DD7 |
| DEC-0066 | ACCEPTED | runtime cache inventory只允许11个canonical ids；REGRET_WARM/TRANSITION默认关闭 | Physics value/transition与Information/Value旧名冲突关闭；新增cache需schema/decision/off differential | DD8 |
| DEC-0067 | ACCEPTED | SearchSemanticProfile定义值并进入ValueSearchKey；SearchBudgetProfile/runtime mode只控制工作量 | NORMAL/FALLBACK可共享相同语义完成结果；切换Eval/horizon必须显式换semantic id | DD8 |
| DEC-0068 | ACCEPTED | 累计达到1500ms等价预算后整局永久fallback；初始保守build在2500ms等价预算进入Emergency并预留500ms | 当前按DEC-0094使用校准work counter；约3000ms只作证据reference，reserve需平台P99验证且可提前 | DD8、DD9、IMP2 |
| DEC-0069 | ACCEPTED | fallback继续benchmark-selected缩减Minimax，不固定2步；committed closure、每action Hard、Terminal和root一致性不可缩减 | Emergency是独立极限路径，不代表普通fallback退化为贪心 | DD8 |
| DEC-0070 | ACCEPTED | production由可调用生成函数+薄CLI从固定RuleCorpus/ABI/profile组装普通单文件JS | 手工复制大bundle禁止；相同inputs必须可重复hash | DD8 |
| DEC-0071 | ACCEPTED | production strip Reference/simulator/replay/v1/log/命名数据，并拒绝Worker/async/Math.random/float semantic arrays | 正式包只保留整数表、单线程Fast/Search/Runtime和经A/B准入的cache/prior | DD8、DD9 |
| DEC-0072 | ACCEPTED | capacity/cache/depth/batch等数值只由正确性先行的多层benchmark写入BuildManifest | DD3 synthetic/corpus lower bound不能冒充平台上限；平台byte/engine未知保持release blocker | DD8、DD9 |
| DEC-0073 | ACCEPTED | `LEGACY-244-20260715.1` 以 corpus/artifact/split fingerprints 不可变冻结 | 244局不能被252局快照静默覆盖；match及其全部frame/window是最小分组原子 | DD9 |
| DEC-0074 | SUPERSEDED | 244局按相关组稳定分为Discovery/Calibration/Frozen；Frozen是锁后非盲回归，真正Forward必须post-build采集 | 冻结244的split仍有效；post-244活动语义由DEC-0078/0085接管 | DD9、DD10 |
| DEC-0075 | ACCEPTED | LegacyPolicyAdapter的`EXACT_SOURCE`只由本地文件SHA-256与平台历史codeHash完全相等授予 | 当前仅v20 exact；v21/v22/v24同名文件hash不匹配，只可作独立legacy对手 | DD9 |
| DEC-0076 | ACCEPTED | 双向反事实使用双方独立ObservedTrack；任一因果状态分叉后历史suffix立即失效 | StrictUnavoidable直接引用DD6量词，同时节点禁止逐row选择不同敌方column | DD9 |
| DEC-0077 | SUPERSEDED | 发布是G0–G10全部PASS的非加权AND；设计完成、零样本和v1结果都不能替代v2执行证据 | 硬门原则保留；首次发布与forward循环由DEC-0084的两级门修正 | DD9、DD10 |
| DEC-0078 | ACCEPTED | 历史语料使用append-only MatchLedger、可变CorpusHead和不可变CorpusSnapshot | 总局数动态变化；任何分析/校准/发布报告必须引用精确snapshot fingerprint，不能引用“当前目录” | DD10 |
| DEC-0079 | ACCEPTED | 技能事实必须携带`skillProvenance`，缺失或未观察施法为UNKNOWN而非none | PUBLIC_INPUT_CAPTURE/BUILD_MANIFEST/OBSERVED_CAST可作事实；受控SAME_TANK_INFERRED仅用于discovery，不能支持strict proof/split | DD10 |
| DEC-0080 | ACCEPTED | 平台能力进入版本化CapabilityProfile；生产禁止依赖`Math.imul` | 真实SCRIPT_ERROR确认`Math.imul` absent；Uint16Array/Uint32Array可用；其余能力仍逐项校准 | DD8、DD10 |
| DEC-0081 | ACCEPTED | Poison执行节拍冻结为施加后相对`ACT-HOLD-ACT-HOLD`，绝对平台帧奇偶候选被拒绝 | 30个完整平台样本一致；仅队列为空后的same-frame repoll/ready边界继续variant | DD4、DD7、DD10 |
| DEC-0082 | ACCEPTED | 平台操作由统一可调用函数与薄CLI编排，任何新candidate hash发布前必须取得服务器simulation attestation | build、simulate、publish、challenge、download、analyze职责分离；脚本退出码和RunManifest可恢复 | DD10 |
| DEC-0083 | ACCEPTED | 平台下载与分析artifact采用原子写、内容hash、append ledger、分层错误分类和发布后读取核对 | HTTP/鉴权/限流/网络失败不冒充游戏失败；challenge未知结果必须reconcile，缺失runtime不得填0 | DD10 |
| DEC-0084 | ACCEPTED | 发布门拆为`CANARY_PUBLISH_ELIGIBLE`与`RELEASE_ACCEPTED` | 前者要求G0–G9、G10A Frozen和强制simulation，可授权受控首次上传；后者再要求G10B Forward与G11平台运行完整性，消除“先有forward才能首次发布”的循环 | DD9、DD10 |
| DEC-0085 | ACCEPTED | 已查看的post-244对局统一登记为`DISCOVERY_APPEND`，不得作为当前candidate的forward证据 | DD9机器manifest旧`PREBUILD_QUARANTINE`仅作历史标签；不回写冻结244快照 | DD10 |
| DEC-0086 | ACCEPTED | 平台脚本使用可扩展的非密钥TankProfile Registry管理v1、v2及未来tank；key只由secretRef解析 | 禁止`--key`、默认最近使用tank、key进入registry/log/manifest；mutation必须显式profile | DD10 |
| DEC-0087 | ACCEPTED | Candidate、Run、SimulationAttestation、Forward与远端context同时绑定profile/tank/skill/branch | 同bundle用于不同tank仍生成不同Candidate；simulation、rollback、forward资格禁止跨profile继承 | DD10 |
| DEC-0088 | ACCEPTED | 平台mutation限流按ownerScopeId而不是key调度 | 多key不能绕过共享2秒限制；owner关系未知时归入保守共享scope | DD10 |
| DEC-0089 | ACCEPTED | 新tank首次发布优先归档平台main为可验证基线；确无基线时只能走`FIRST_PUBLISH_NO_ROLLBACK`例外 | 需要独立授权、扩大simulation suite和事故停止策略；普通publish授权不足 | DD10 |
| DEC-0090 | ACCEPTED | Build/Candidate fingerprint payload排除其纯派生`buildId`/`candidateId`，再由fingerprint生成ID | 消除“ID由fingerprint派生但ID又参与fingerprint”的自引用；Run/Registry等非派生ID仍参与fingerprint | DD10实施审计 |
| DEC-0091 | ACCEPTED | 所有重复平台步骤只通过版本化`platform-toolchain.sh`子命令或聚合命令执行 | 防止每次重拼命令产生环境、顺序和证据漂移；入口必须幂等、typed、可测试 | 用户实施约束；DD10 |
| DEC-0092 | ACCEPTED | 六个性能层固定为function/composite/pipeline/terminal/full-game/platform；replay为独立验证轨 | 消除Benchmark合同把replay称第六层、实施计划又把platform称第六层的冲突；历史runtime不混入Fast性能 | IMP0冲突审计 |
| DEC-0093 | ACCEPTED | 现存根级battle-records保持只读迁移输入，新写入才按TankProfile隔离 | 旧artifact缺profile血缘，IMP0自动搬迁或默认归v1会伪造身份；IMP7动态迁移 | IMP0数据审计 |
| DEC-0094 | ACCEPTED | 当前v2生产计时以版本化校准work counter为主；只有CapabilityProfile确认可调用且单调的墙钟才启用wall-clock模式 | 官方simulate确认单callback约1500ms watchdog且无已确认安全墙钟；v1的能力保护与硬节点上限可继承，但`Date.now()`分支是否实际启用不能靠“未超时”反推 | IMP2 runtime probe；DD8修订 |

## 3. 已确定方向、待详细设计冻结

| ID | 状态 | 方向 | 未冻结内容 | 依赖 issue / 阶段 |
|---|---|---|---|---|
| DEC-0101 | SUPERSEDED | 小状态复制与 make/unmake 同时实现 A/B | 由 DEC-0039/0040 冻结 multi-world delta、singleton fast path 与显式栈 | OI-ARCH-001，DD2–DD3 |
| DEC-0102 | SUPERSEDED | 地图为固定尺寸整数网格，静态地形与动态实体分层 | 由 DEC-0042 冻结基本布局；平台最大规格仍归 OI-R3-008/DD8 | OI-ARCH-002，DD2–DD3 |
| DEC-0103 | SUPERSEDED | 共享 RulesKernel/Terminal/Hard，SearchProfile 只缩减工作量 | 由DEC-0067/0068/0069冻结；具体depth/batch由manifest benchmark选择 | OI-R3-003/004，DD8/DD9 |
| DEC-0104 | SUPERSEDED | Plan 在实体存活期间缓存 trajectory、deadline、score dependency | 由DEC-0063/0064与Plan合同冻结；容量/替换仍归DD8 | OI-ARCH-008 CLOSED，DD7–DD8 |
| DEC-0105 | SUPERSEDED | 对手画像事件驱动、快慢两层更新 | 由DEC-0061冻结语义；具体alpha/阈值仍由DD9校准 | OI-R3-002，DD7/DD9 |
| DEC-0106 | SUPERSEDED | 隐藏威胁使用联合 InformationState + symbolic residual | 由 DEC-0039/0041 冻结 exact prefix + lossless residual 与 overflow 行为 | OI-ARCH-001，DD2–DD3 |
| DEC-0107 | SUPERSEDED | 构建期按我方技能专门化，敌方八技能保留紧凑 descriptor | 由DEC-0062/0070/0071冻结；平台字节/性能仍是发布门 | OI-R3-005/008，DD7–DD9 |

## 4. 必须由后续决策关闭的冲突

这些条目不是允许“自由实现”的空白。目标阶段必须新增 decision 或将既有 provisional 冻结。

| 待决 ID | 状态 | 当前冲突 | 目标阶段 | Open issue / 处理 |
|---|---|---|---|---|
| DEC-P001 | SUPERSEDED | `TERMINAL_DRAW`、`DRAW`、`UNKNOWN_RULE` 与 `NON_TERMINAL` 返回集合不一致 | DD1 | DEC-0025、DEC-0028；OI-ARCH-003 CLOSED |
| DEC-P002 | SUPERSEDED | 非法动作、执行失败、硬终局失败当前被 `HARD_INVALID` 混合表达 | DD1 | DEC-0025；OI-ARCH-004 CLOSED |
| DEC-P003 | SUPERSEDED | ForcedLossRecovery 允许比较 HARD_INVALID，但没有 Nonloss/Loss 对称量词和证书 | DD1/DD6 | DEC-0031；OI-ARCH-005 CLOSED |
| DEC-P004 | SUPERSEDED | Result 字段同时存在 `resultWorst/resultBestAction` 与 `completedDepth`/policy 版本 | DD2/DD3 | DEC-0033；OI-ARCH-006 CLOSED |
| DEC-P005 | SUPERSEDED | Cache 清单和命名在多份文档不一致 | DD8 | DEC-0066；OI-ARCH-007 CLOSED |
| DEC-P006 | SUPERSEDED | RiskMatrix 与 safe-exploitation constrained objective 可能重复施加风险 | DD6 | DEC-0056/0057；OI-ARCH-009 CLOSED |
| DEC-P007 | SUPERSEDED | mixed policy 的定点概率、取样和 PRNG 状态未定义 | DD2/DD6 | DEC-0033；OI-ARCH-010 CLOSED |
| DEC-P008 | SUPERSEDED | 未解决 RuleVariant 在生产构建中的禁用、区间或 fallback 路径未逐条定义 | DD1/DD4 | DEC-0029；OI-R0-011 CLOSED |

## 5. 修改规则

- 决策不得删除；被替代时标记 `SUPERSEDED` 并引用新 ID。
- 参数实验不能修改 Accepted 的语义边界。
- 平台规则证据变化先更新 RuleRegistry/open issue，再修改依赖决策。
- 任何影响 hash、cache、proof、terminal 或 bundle 的变更必须列出失效范围。
