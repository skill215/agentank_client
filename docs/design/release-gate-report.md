# DD10 验证证据矩阵与当前发布门报告

状态：DD10 同步详细设计报告，2026-07-16。DD9证据矩阵保留，DD10增加滚动语料、平台运行G11和首次发布两级门。

```text
DESIGN_STAGE = DD10_COMPLETE
IMPLEMENTATION_STAGE = NOT_STARTED
RELEASE_DECISION = NOT_RELEASE_ELIGIBLE
```

该结论是有意的硬门结果：当前没有 v2 JavaScript 游戏引擎、生产 bundle、平台前向局或 source/minified 差分，不能用文档完整度、v1 胜率或 DD3 架构原型替代发布证据。

## 1. 判定状态

统一状态只有：

| 状态 | 含义 |
|---|---|
| PASS | 对指定 candidate、manifest 和样本实际运行，证据满足门限 |
| FAIL | 已运行并违反门限；candidate 不可发布 |
| NOT_RUN | 有合同但尚未执行 |
| BLOCKED | 缺实现、平台事实、容量或外部输入，当前不能执行 |
| NOT_APPLICABLE | 对该 candidate 明确不适用并有理由 |
| DESIGN_COMPLETE | 只表示 schema/算法/门已定义，不表示运行 PASS |

空结果、零样本和缺字段永远不是 PASS。所有 PASS 必须包含 candidate fingerprint、样本分母和原始结果 hash。

## 2. Candidate 身份

每个发布候选必须先生成不可变`CandidateManifest`；旧称`ReleaseCandidateManifest`废弃，血缘与canonical hash以[artifact-lineage-contract.md](artifact-lineage-contract.md)为准：

```text
CandidateManifest {
  candidateId
  candidateFingerprint/buildManifestSha256
  targetTankProfileId/targetTankId/targetSkillId/branch
  sourceHash/minifiedHash/bundleHash
  publishArtifactKind/publishArtifactSha256
  buildFingerprint
  ownSkillId
  guide/update/ruleset/ruleCorpus hashes
  reference/fast/proof/value/eval/opponent/plan versions
  SearchSemanticProfileId
  SearchBudgetProfileIds
  RuntimeProfileId
  MemoryCapacityManifest hash
  cache inventory hash
  feature/weight/risk table hashes
  legacy corpus/split fingerprints
  corpusSnapshotId/fingerprint and cohortAssignmentVersion
  simulator/framework provenance
  local/platform engine ids and platformCapabilityProfileId/hash
  exact UTF-8 bundle bytes
  rollbackMode + rollbackCandidate/hash or first-publish exception
  createdAt and forwardCollectionNotBefore
}
```

当前这些字段没有v2实际值，所以candidate id为`NONE`。发布测试不能针对“工作目录当前内容”运行后再补manifest。服务器强制simulation和publish必须使用`publishArtifactSha256`对应的同一UTF-8字节；source通过不能替代将被上传的minified。即使v1、v2使用完全相同的bundle，也因目标TankProfile/tank/skill不同而属于不同CandidateManifest，不能继承simulation、forward或rollback资格。

## 3. 七层证据矩阵

### 3.1 当前矩阵

| 层 | 必须覆盖 | 当前证据 | 当前状态 | 发布含义 |
|---|---|---|---|---|
| 函数级 | parser、reconcile、apply/undo、timeline、hazard、terminal、TT、eval、risk、proof | DD3 独立架构原型；无 v2 kernel | NOT_RUN | 不满足 |
| 复合场景 | 多弹/bomb/技能/hidden/strategy-fusion/cache/fallback | DD4 fixture 与 DD5 disposition 仅为详细设计 | NOT_RUN | 不满足 |
| 全景 onIdle | 真实输入到最终 ActionProgram 的完整管线 | 无 v2 实现 | BLOCKED | 不满足 |
| 终局专项 | 128 帧、同星对枪、runtime、互毁、星差、deadline | 规则合同和历史样本存在；无 v2 穷举结果 | NOT_RUN | 不满足 |
| 完整对局/league | 固定 seed、双方 seat、技能、脚本/v1/v2 对手 | 244 局仅为 v1 历史；无 v2 对局 | BLOCKED | 不满足 |
| source/minified/production | 全语义差分、strip、bytes、cold init | 无 v2 build | BLOCKED | 不满足 |
| 平台 forward | build 冻结后新局、runtime 和结果 | 合格样本 0 | NOT_RUN | 不满足 |

DD3 原型可以证明底层候选结构有可行性，但它使用 synthetic/corpus lower-bound workload，不是完整 v2 规则、搜索或平台发布测试。DD4/DD5 的 “fixture disposition/design complete” 也不能被重命名为 Reference/Fast 实测通过。

### 3.2 历史 v1 证据仅作上下文

冻结 v1 行为回归实际记录：

- 244 个去重 match，10,752 个可比较决策；
- 基线与当时 current 都是本地 `3ab856...`，动作差异 0、脚本异常 0、多命令帧 0；
- 本地单决策 median 3.143 ms、P95 9.992 ms、P99 14.478 ms、max 42.915 ms；
- 本地单局 median 115.81 ms、P95 408.32 ms、max 556.07 ms；
- 该回归关闭了基于墙钟的 1.5 秒熔断，时间只能做相同 harness 的相对参考。

这证明旧回归工具和 v24 行为快照可重放，不证明 v2 速度、正确性或胜率，也不证明平台 3 秒安全。

## 4. Mandatory release gates

### G0 设计与 manifest 一致性

要求：DD0–DD10 术语、量词、状态、cache、runtime、build、rolling corpus、platform operations 和 release 只有一个 owner；所有 JSON/schema/link 可机械检查；无未登记冲突。文档或语料数量从清单动态计算，禁止把扫描时计数写成未来门限。

当前：`PASS`。DD0–DD10 owner/invariant冲突审计与当前JSON/link检查已完成；该PASS只允许进入实现handoff，文件数量变化时必须重新机械计算。

### G1 规则与 Reference Oracle

要求：

- 每个 runtime-reachable R0/R1 行为有 confirmed/common handler 或明确 conservative unsupported 路径；
- ReferenceKernel 与平台 fixture 的 canonical trace 一致；
- UNKNOWN/RuleVariant 不被猜值或升级 Proof；
- ExternalSimulator mismatch 均分类，不能当平台真值。

当前：合同 `DESIGN_COMPLETE`，实现 `NOT_RUN`。开放 R0/R1 variant 和 R2 概率按 DD4 的生产行为继续受限。

### G2 Reference/Fast 差分

要求：所有函数、复合、终局、replay checkpoint 和随机/穷举小状态上，state/event/observation/terminal/coverage 完全一致；unsupported 也必须一致。每次 branch 后 root 全字段/hash 还原。

绝对门：

```text
terminal mismatch = 0
state/event mismatch = 0
root restore failure = 0
unexplained UNKNOWN mismatch = 0
```

当前：`BLOCKED`，两个 v2 kernel 均未实现。

### G3 Terminal、Hard 与 Proof 零假阳性

要求在完整带分母的 suite 上：

```text
terminal false positive = 0
HARD_REJECT_PROVEN false positive = 0
ForcedWin/Nonloss/Loss false positive = 0
strategy-fusion violation = 0
incomplete promoted to strict = 0
per-row response promoted to ForcedLoss = 0
```

每个 action 都必须 Fast apply 后、评分前通过 Terminal/Hard；Committed hazard closure 不因搜索缩深丢失。当前：`NOT_RUN`。

### G4 容量、缓存和故障恢复

要求：

- FACT/SUPPORT/OUTPUT overflow 不能静默截断；
- SEARCH overflow 只降完成度；CACHE overflow 等价 miss；
- 11 个 cache 分别关闭时语义结果不变；
- collision、generation、reroot、terrain/entity invalidation 故障注入无 stale read；
- Entity/SourcePlan 事实持续到物理失效。

绝对门：root restore、stale semantic read、真实实体截断均为 0。当前：`NOT_RUN`；容量数值仍 `BENCHMARK_SELECTED_PENDING`。

### G5 历史重建与双向反事实

要求：

- 244 局 immutable roots/split 校验；
- rolling MatchLedger/CorpusHead/CorpusSnapshot可重建，追加不改变已关闭cohort；
- skill/terminal provenance完整，UNKNOWN不折成none、missing runtime不折成0；
- factual reconstruction、unknown/confidence、窗口和标签有完整分母；
- 分叉后 replay suffix consumption 为 0；
- TruthTrack 泄漏为 0；
- 双方使用相同 DD6 量词；
- frozen 集未参与锁后调参。

当前：244 snapshot integrity/split `PASS`；rolling ledger/provenance迁移、runner、重建和结果 `NOT_RUN`。总体 G5 不通过。

### G6 正向机制保护

必须在与负样本配对的 PositiveWindow 和复合 fixture 中保护：

- immediate/committed FIRE kill；
- 开火后可躲与不可躲的几何区分；
- Escape/BombEscape；
- stun/overload/shield/teleport 等技能价值；
- star deadline、terminal trade 和领先互换；
- hidden information control、草丛/路径压制。

严格机制 fixture 不得回退；软质量门由 calibration 预注册，不能看 frozen 后修改。当前：`NOT_RUN`。

### G7 Runtime 与 fallback

平台门必须证明：

- 当前每局累计校准work包括completed + current callback；若未来Capability确认wall clock，则保持相同累计语义；
- 达到1500ms等价work limit后在同局永久进入FALLBACK；
- 单callback约1500ms watchdog使用更早的独立work安全界，不能与整局门合并；
- FALLBACK 仍运行 benchmark-selected 缩减 Minimax，并保留全部 Hard/Terminal/committed closure；
- 达到2500ms等价work limit进入EMERGENCY，500ms reserve在平台P99下足够；
- 任一 batch 最坏/P99 不耗尽 reserve；
- 3 秒附近不继续投机搜索；
- timeout、runTime 判负、callback error 均为 0。

本地 Node 数据不能锁定平台门。当前：`BLOCKED`，平台 engine、byte limit、batch P99 和 v2 runtime 均未知。

### G8 搜索、风险与策略质量

要求：pure interval sound、matrix full best-response gap 合法、DFPN 只闭合完整节点、递归 epsilon-contamination 与 Reference 小状态一致；风险 0–100 只改变软 robust backup，不改变 Hard/Proof。OpponentModel 只由本局 event 更新敌方参数。

参数选择顺序：Discovery 生成候选 → Calibration 选定 → candidate manifest 冻结 → Frozen 只验证。当前：算法合同完成，参数和实现 `NOT_RUN`。

### G9 Production build 与 source/minified

要求：

- deterministic generator 输出一个 own-skill specialized、同步单线程 bundle；
- Reference/simulator/replay/v1/log/命名对手/离线 JSON 全部 strip；
- 禁止 Worker/async/Math.random/float semantic arrays/hot Map/Set；
- source 与 minified 在相同输入/seed 下完整 semantic fingerprint 一致；
- exact minified UTF-8 bytes不超过204800（190000开始告警）、cold init、arena/cache bytes 在平台限制内；source bytes只作本地维护门，不能替代上传门。
- target capability sandbox中不提供`Math.imul`仍可parse/init/运行全部必需fixture；Uint/位运算结果与离线oracle一致。

当前：`BLOCKED`，无 v2 bundle，平台 byte/engine limit 未知。

### G10 Frozen 与 platform forward

要求：

- CandidateManifest引用Snapshot中派生出的全部 frozen-regression 局，在 candidate 冻结后一次性运行，不用于回调参数；当前不可变244快照恰好派生63局，但实现与门限不得写死该数字；
- true forward batch 在 candidate/build hash 和采集起点冻结后生成；
- 两 seat、主要技能、hidden、bomb、overload、终局和 runtime 具有预注册覆盖；
- batch 关闭前不因中间结果修改 candidate；
- 任一硬错误、timeout/runtime/error 阻塞发布。

G10拆为两个不可互相替代的子门：

- `G10A_FROZEN`：CandidateManifest引用的Frozen cohort全部在candidate冻结后一次性运行，只读结果、不回调参数；当前`LEGACY-244` snapshot对应63局，但执行器从snapshot/assignment派生分母，不写死63；它在canary publish前必须PASS；
- `G10B_FORWARD`：同一published hash在预注册ForwardBatch中采集真实平台局；它只用于最终`RELEASE_ACCEPTED`。

当前：frozen split 已锁但未运行，`G10A_FROZEN=NOT_RUN`；合格 forward match 为0，`G10B_FORWARD=NOT_RUN`；因此G10总体`NOT_RUN`。

### G11 平台运行与artifact完整性

要求：

- 每个新candidate hash发布前，服务器`/simulate` suite全部通过并生成不可变SimulationAttestation；
- Run TankProfile、Candidate target、GET context、SimulationAttestation和远端published context的profile/tank/skill/branch完全一致；
- publish mutation由单写锁保护，返回后GET读取当前tank并核对远端code hash；
- challenge触发、轮询和下载可恢复；未知mutation结果先reconcile，不盲目重复挑战；
- 429遵守`nextSimulationAt`，401/400/网络/服务器错误分类正确且不计为战术胜负；
- summary/events/raw三件套采用临时文件、校验、hash、原子rename后才提交MatchLedger；
- 分析绑定candidate、CorpusSnapshot、analyzer/schema版本，L0基础设施问题先于技能/策略归因；
- TankRegistry只保存secretRef，不保存key；v1/v2/未来profile的run、baseline、snapshot分母和回滚证据保持隔离；同ownerScopeId的多key共享限流调度；
- 任何缺artifact、hash冲突、ledger重复冲突、错误局误归因或未解决发布状态均为0。

当前：合同与schema为`DESIGN_COMPLETE`；统一runner、ledger/analyzer迁移及端到端执行`NOT_RUN`。

## 5. 两级非加权判定公式

首次受控上传和最终验收都不是加权总分：

```text
CANARY_PUBLISH_ELIGIBLE =
  candidateManifestComplete
  AND every G0..G9 == PASS
  AND G10A_FROZEN == PASS
  AND mandatoryServerSimulationSuite == PASS
  AND (
        rollbackMode == VERIFIED_BASELINE
        OR rollbackMode == FIRST_PUBLISH_NO_ROLLBACK
           AND expandedSimulationSuite == PASS
           AND explicitFirstPublishNoRollbackAuthorization
      )
  AND no hard platform-operation blocker

RELEASE_ACCEPTED =
  CANARY_PUBLISH_ELIGIBLE
  AND G10B_FORWARD == PASS
  AND G11 == PASS
  AND no mandatory issue is OPEN/BLOCKED for reachable production behavior
  AND forwardValidationCount > 0 with preregistered coverage
```

`CANARY_PUBLISH_ELIGIBLE`只授权同一profile、同一hash的受控首次上传和预注册挑战，不等于算法已正式验收。上传后任何代码/配置变化都会产生新candidate，旧forward不能继承。新tank若平台没有可归档的main基线，必须走单独的`FIRST_PUBLISH_NO_ROLLBACK`例外；普通publish授权不能替代它。该拆分消除了“必须先有post-publish forward才能允许首次publish”的循环。

高胜率、更多击杀、平均速度或 99% 估计都不能抵消一个 Hard/Proof false positive、stale cache、root restore、timeout 或非法 action。

具体胜率下界、forward 局数、软机制容忍度、nodes/ms、depth、cache size 和 matrix/DFPN budget 在第一轮正确实现 benchmark 前不猜数字。门限必须在看 frozen/forward 结果之前写入 candidate test plan。

## 6. 当前阻塞清单

| Blocker | 需要的最小证据 | 影响 |
|---|---|---|
| 无 v2 ReferenceKernel | 平台 fixture trace suite | G1–G3/G5 |
| 无 v2 FastKernel/undo | 全字段差分与故障注入 | G2–G4 |
| 无 Value/Matrix/Proof/Risk 实现 | 小状态 Oracle、coverage 和 interval tests | G3/G8 |
| 无 DualTrack/Counterfactual runner | 244 局 factual + 双向结果 | G5/G6 |
| 无rolling MatchLedger/CorpusSnapshot实现 | 动态append、去重、原子snapshot和污染测试 | G5/G10/G11 |
| skill/terminal analyzer仍是legacy语义 | provenance迁移、missing≠none/0 golden report | G5/G6/G11 |
| R3 数值未 benchmark-selected | 六层本地 + 平台 profile | G4/G7/G8 |
| 平台 engine/byte limit 未知 | source/minified platform upload/profile | G7/G9 |
| 无 production build | strip、bytes、semantic differential | G9 |
| frozen 尚未对 candidate 运行 | 一次性封存报告 | G10 |
| forward 合格样本为 0 | post-build platform batch | G10 |
| 无统一platform runner | simulation attestation、publish verify、challenge reconcile、atomic download端到端报告 | G11 |
| 无多TankProfile registry/identity隔离 | v1/v2 profile注册、key轮换、跨profile污染与owner-scope限流fault test | G0/G10/G11 |

这些是实现/发布阻塞，不是继续修改 DD1–DD10 语义的理由。若实现发现状态不可表达、量词不可执行或性能架构根本不成立，必须回退其依赖 DD，而不是在 release 脚本里绕过。

## 7. 执行顺序

```text
1. 实现 Reference + Rule fixture
2. 实现 Fast/Hard/Terminal + exhaustive differential
3. 实现 Value/Matrix/Proof/Risk + small-state oracle
4. 实现 Eval/Strategy/Opponent/Skill/Plan
5. 实现 11 caches、RuntimeController、production generator
6. 实现rolling ledger/snapshot、provenance迁移和统一platform runner
7. 实现 DualTrack/window/counterfactual/analyze harness
8. Discovery -> Calibration，冻结全部 candidate 参数
9. 跑函数/复合/全景/终局/完整对局与 fault matrix
10. 跑 source/minified/strip/bytes和无Math.imul capability suite
11. 对candidate code执行强制服务器simulation；全部通过才取得canary资格
12. 在锁保护下publish同一hash并GET核对，随后执行预注册challenge/download/reconcile
13. 一次性跑frozen并关闭platform forward batch
14. 仅当 G0..G11 全 PASS 才标记`RELEASE_ACCEPTED`
```

## 8. 当前结论

DD10 已定义了“需要什么证据才能受控上传与最终验收”，但当前还没有实现证据。准确结论是：

```text
DETAILED_DESIGN_HANDOFF_READY
V2_IMPLEMENTATION_NOT_STARTED
V2_RELEASE_NOT_ELIGIBLE
```

后续实现报告必须更新本文件的 candidate id、每个 gate 的原始 evidence link/hash、分母和判定；不能直接把 `NOT_RUN` 改成 PASS 而不附可复现结果。
