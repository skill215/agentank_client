# V2 SR0–SR6 结构修复实施轨道

本轨道与 IMP0–IMP9 并列，不重写旧 Candidate、官方 timeout 或历史 arena。统一入口为
`./tools/structural-repair-toolchain.sh verify|accept --stage SRn`。每一阶段的 gate、acceptance
和 overview 都写入 `artifacts/reports/structural-repair/SRn`，带内容指纹并在 `history` 下保留
不可变副本。状态只允许 `ACCEPTED`、`REJECTED`、`BLOCKED`；前序 acceptance 未接受时后序
verify 必须 fail closed。

SR0 固定 266 场景、2 repetitions、4 variants 的 2,128 局 cohort。平台原始 winner、reason
和报告不被修改；共享 `AnalysisOutcome` 仅派生忽略 runtime 的 V1/V2/DRAW。未来历史记录只进入
Rolling Discovery，不改变 SR0 分母。

SR1–SR4 的生产热路径只能使用预分配 TypedArray/整数运算，关键微基准固定 Node、固定输入、预热
后五批测量，P95 不超过前序 120%。SR5 只有在全部语义门通过后才优化，并生成使用通用
`qualificationAcceptanceRef` 的新 Candidate。SR6 只执行官方 simulate，不包含 publish 或 challenge。

## SR4 Minimax 核心约束

SR4 不再把 Minimax 正确性隐含在少数集成对局里。`test/minimax-core` 是独立约束套件，必须与
SR0–SR4 回归一起通过。测试 oracle 不调用被测求解器计算期望值，固定覆盖：

- 全部 2×2 三值终局矩阵的 pure maximin/minimax bound 与精确有理数矩阵值；
- OUR/ENEMY 交替量词，以及 ForcedWin、ForcedNonloss、ForcedLoss 的 AND/OR 穷举；
- HiddenWorld、ChanceOutcome、ObservationSplit 的不同量词和不完整 support fail-closed；
- 递归整数 epsilon-contamination、区间传播、未知叶与 observation envelope；
- root 可达子图预算、零预算、迭代加深中断、最后完整深度和 root restore；
- StageMatrix slab 复用、缺失 cell、严格预算、支配行、策略概率质量与确定性；
- production root 的逐行最坏值、全局 max-min、InformationState 截断完整性和缓存无关语义。

任何空 support、childCount 超过输入、非法前向边、fractional value/risk/probability、陈旧 risk
transform 或未设置的复用 matrix cell 都必须返回 `INVALID/INCOMPLETE/UNKNOWN`，不得通过 TypedArray
截断或旧 slab 内容生成 exact/proven 结论。预算只统计 root 可达节点；显式零预算不得隐式执行一个
节点或一次 regret iteration。

## SR4 战斗质量门

SR4 固定 cohort 继续使用 2,128 局 runtime-independent `AnalysisOutcome`。门槛是逻辑 AND：

- 单方击毁胜局基线为 325，要求至少增加 10%，整数下界为 358；
- V2 分析胜率使用已约定的平均结算：胜=1、平=0.5、负=0，并且必须严格大于
  60%；全链路用整数 score units（胜=2、平=1）计算，runtime winner 不进入该指标；
- runtime winner 不计胜，全部 Hard、Proof、dominated selection、root restore、timeout/error 门仍为零。

不得用总胜率抵消击毁门，也不得用击毁增长抵消总胜率或任何结构不变量。

`DEPTH_SCORE_DIVISOR` 只属于旧 action heuristic；新 `ActionOutcome` 与 StageMatrix 共用独立的
`ROBUST_SEARCH_DIVISOR`（默认 2）。该值必须通过同一 controller 字段进入 root value 与 cell
value，禁止两个位置各写一个除数。

## 动态 V1 Rolling Discovery

冻结 SR0 的 266 场不被扩写。工具每次从 `battle-records/index/match-index.json` 动态扫描当前全部
V1 对局，生成内容寻址的 `sr4-rolling-discovery-cohort.json`，每个条目保存完整地图、双方出生位置/
方向、历史星生成序列及各自指纹。新增于冻结 SR0 的场景执行一次 repetition 和四种座位/技能换位；
它们只负责发现回归和验证零 Hard/restore/timeout/error，不反向改写固定 cohort 的预注册胜率门。

当前扫描样本是 546 场，其中 280 场新增于冻结 SR0，包含 540 个地图几何、6 种双边出生布局和
385 条星序列；这些数字只是当前 artifact 的 denominator，后续扫描必须随本地历史记录增长。
