# DD10 动态历史语料与证据生命周期合同

状态：DD10 规范合同，2026-07-16。本文是持续增长历史对局的权威；[legacy-corpus-manifest.md](legacy-corpus-manifest.md) 继续拥有 `LEGACY-244-20260715.1` 不可变快照，但不再代表当前全部历史。

关联：`DEC-0073`、`DEC-0074`、`DEC-0078` 至 `DEC-0080`、`DEC-0086` 至 `DEC-0089`；`OI-ARCH-015`、`OI-ARCH-016`、`OI-ARCH-018`、`OI-PLAT-002`、`OI-PLAT-005`；机器格式见[dd10-corpus.schema.json](dd10-corpus.schema.json)，canonical hash见[artifact-lineage-contract.md](artifact-lineage-contract.md)。

## 1. 目标与非目标

本合同解决四个问题：

1. v1/未来版本的战斗数量持续增长，任何实现不得写死 244、252、255 或其他总数；
2. 已冻结快照必须可复现，新下载不能改变旧 match、group 或 role；
3. 历史 replay 未保存的技能输入、runtime 或隐藏观察不能被分析器伪造；
4. 新战斗可以立即用于 Discovery，同时不能冒充未见的 Forward evidence。

本合同不改变平台物理、Terminal、Hard、Proof 或 Risk。历史结果只能产生证据、fixture、软参数和回归输入，不能凭胜率覆盖规则权威。

## 2. 四个不同对象

```text
MatchLedger            append-only 的去重 match 登记簿
CorpusHead             某次读取时 Ledger 的最新完整水位
CorpusSnapshot         指定水位、文件根和 schema 的不可变切片
CohortAssignment       已关闭相关组的一次性用途分配
```

### 2.1 MatchLedger

每个 `urlId` 恰有一个 canonical entry：

```text
matchUrlId / platform numeric id / replayHash
createdAt / settledAt / ingestionAt
subjectTankProfileId / subjectTankId / subjectCodeHash / subjectCodeVersion / seat
opponentTankId / opponentCodeHash / opponentCodeVersion / seat
mapId / mapHash
resultReasonRaw / terminalClass / winnerSeat
recordedMatch / scoreEligibility / standingDelta
ownSkillId / ownSkillEvidence
enemySkillId / enemySkillEvidence
summary/events/raw artifact hash + byte length + schema status
sourceBatchId / firstSeenRunId
disposition / cohortId / forwardBatchId
```

Ledger 只追加新 entry 或追加 provenance/验证记录。已经封存的原始 artifact 不原地改写；同一键出现不同内容时进入 `LEDGER_CONFLICT`，不能“选择较新文件”。

### 2.2 CorpusHead

`CorpusHead` 是派生指针，不是版本名称：

```text
headId
ledgerWatermark
uniqueMatchCount       derived
artifactRoot
latestCreatedAt
generatedAt
```

2026-07-16 本次只读扫描观察到 255 个唯一 match；该数字仅证明动态机制已经必要，不进入常量、目录协议、测试分母或发布条件。

### 2.3 CorpusSnapshot

快照必须保存：

```text
snapshotId
ledgerWatermark
subjectTankProfileIds
canonical match id list/root
artifact roots
schema/rule/analyzer versions
createdAt and purpose
```

`LEGACY-244-20260715.1`继续不可变并登记为v1 profile。252、255或未来水位只有在显式封存并计算fingerprint后才成为Snapshot；普通`CorpusHead`不能被报告为冻结语料。用于Candidate/Frozen/Forward的Snapshot默认只能包含一个`subjectTankProfileId`；多profile快照只用于跨版本研究，不能直接作为某一tank的发布分母。

### 2.4 CohortAssignment

用途为：

```text
DISCOVERY
CALIBRATION
FROZEN_REGRESSION
FORWARD_VALIDATION
```

match 的全部 frame/window/checkpoint 必须同属一个 cohort。已经关闭的 cohort 永不因后续 match 改角色。

## 3. 技能证据 provenance

实时根输入中的 `me.skill.type/enemy.skill.type` 是公开事实；历史 raw replay 却通常只在施放时保存 `skill_cast`。两者不得混为一谈。

```text
PUBLIC_INPUT_CAPTURE       本局真实 onIdle 输入或平台元数据直接保存
BUILD_MANIFEST             我方精确 codeHash 对应构建声明
OBSERVED_CAST              本局 raw replay 的 sourceObjectId/by 直接确认
SAME_TANK_INFERRED         由同 tank 其他对局回填
UNKNOWN                    无足够证据
```

规则：

- `PUBLIC_INPUT_CAPTURE`、`BUILD_MANIFEST`、`OBSERVED_CAST` 可以进入相应范围的物理重建；
- `SAME_TANK_INFERRED` 只可用于 Discovery、软对手先验和人工索引；
- `UNKNOWN` 必须保持 unknown，禁止规范化为 `none`；
- 平台当前八技能集合不包含“未施放即 none”的推理规则；
- `events.json` 的展示字段不能替代 raw 的 `sourceObjectId/targetObjectId/by`；
- 当前 244 机器 manifest 中的 `enemySkills.none=79` 是历史 schema v1 对“未观察到 cast”的错误标签，只能按 `UNKNOWN` 迁移；不能作为实际技能或 split key；
- 我方技能按 `subjectCodeHash + build manifest` 记录，不能因为旧 v1 一直使用 stun 就对未来 codeHash 写全局常量。

历史 Counterfactual 若需要技能身份但 provenance 不足，返回 `INCOMPLETE_INPUT`；不得使用同对手未来施法记录静默补齐严格结果。

## 4. 终局与故障 provenance

Ledger 同时保存平台原始 reason 和规范 TerminalClass：

```text
crashed + one crash                  SINGLE_CRASH
star + mutual crash                  MUTUAL_CRASH_STAR
runTime + mutual crash               MUTUAL_CRASH_RUNTIME
star + complete frame limit          FRAME_LIMIT_STAR
runTime + complete frame limit       FRAME_LIMIT_RUNTIME
timeout                              RUNTIME_TIMEOUT
runtime + no tiebreak terminal shape  RUNTIME_TIMEOUT
error                                SCRIPT_ERROR
```

分类必须保留`resultReasonRaw`的原始大小写并读取raw crash events、record count、stars、runtime和winner，不能只看字符串：`runTime`只有在mutual-crash/frame-limit同星形状下才是tiebreak；`runtime`/`timeout`且没有该形状时是可靠性失败；冲突则`TERMINAL_INCOMPLETE`。缺失 runtime 不自动写0；例如`mat_ANGK6T283KC1fRBvV`的非出错方runtime缺失是合法SCRIPT_ERROR fixture。

脚本错误、平台错误和下载错误不进入技能物理胜负率。timeout 可以进入 matchup compute-cost 报告，但必须与技能击杀/星数结果分列。

## 5. Append-only ingestion 状态机

```text
DISCOVERED
  -> DOWNLOADING
  -> ARTIFACT_COMPLETE
  -> SCHEMA_VALIDATED
  -> DEDUP_VALIDATED
  -> ANALYZED
  -> LEDGER_COMMITTED
  -> PENDING_SESSION
  -> COHORT_CLOSED
```

任何中间失败保留失败 manifest 和已下载临时文件，但不得推进水位。写入顺序必须是同目录临时文件、fsync/close、hash、原子 rename、最后提交 ledger entry。

去重：

1. `urlId` 主键；
2. `replayHash` 次键；
3. 两键一致而 artifact 不同为硬冲突；
4. 复制目录只登记 provenance，不增加 match count；
5. error、timeout、runTime、star、crashed 全保留。

## 6. 追加稳定的相关组

`DD9_CORRELATION_DSU_HASH_V1` 仅适用于已冻结的 244 snapshot。它用全组 match id 生成 groupId，新增成员会改变旧 groupId，因此禁止用于 rolling head。

DD10 使用 `APPEND_STABLE_SESSION_V1`；参数不写死在导入器，必须先冻结符合schema的CorpusPolicy并由每个Head/Snapshot引用其fingerprint：

```text
session key = subjectCodeHash + opponentTankId + opponentCodeHash
session start = 该 key 尚未关闭的第一局 createdAt
session closes = 最后一局后超过 lateness window 且 ingestion watermark 越过
sessionId = SHA256(salt + key + normalized session start)
```

同 session 内精确重复 map 仍在同组。技能只有 `PUBLIC_INPUT_CAPTURE/OBSERVED_CAST` 时可作为报告维度，但不作为防泄漏主键；未知技能不能把连续挑战拆开。

关闭规则：

- `PENDING_SESSION` 可接受迟到 match；
- `COHORT_CLOSED` 后 groupId、role 和 match membership 不变；
- 后来的 match 即使时间上可能桥接旧组，也建立新 session，并在 `relatedClosedSessionIds` 中登记关系；
- related 标记可让报告保守合并误差，但不能移动旧 frozen/calibration match。

`sessionGapMs`初始候选沿用DD9的1,800,000ms；`allowedLatenessMs >= sessionGapMs`，具体值在首次完整导入/迟到样本扫描后冻结为CorpusPolicy，不由实现者临时决定。session按`(createdAt, matchUrlId)`稳定排序；只有一次完整matches sync已到服务器当前头、watermark越过`lastCreatedAt + allowedLatenessMs`且显式执行`close-cohorts`时才可关闭。迟到match到达已关闭session后建立新session并登记related关系。

## 7. Discovery、Calibration、Frozen 与 Forward

### 7.1 Discovery append

所有已经看过结果、产生于 candidate forward 注册前或用于修复失败的新增 match 都进入 `DISCOVERY`。DD9 所称 8 个 `PREBUILD_QUARANTINE` 从本合同生效后按 `DISCOVERY_APPEND` 使用；它们仍然 `forwardEligible=false`。

### 7.2 Calibration/Frozen

只有在 cohort 关闭且用途预注册后才能进入 Calibration/Frozen。角色分配使用稳定 `sessionId` 或显式 cohort manifest，不重新散列旧成员列表。看过结果后移动角色为 `DATA_LEAKAGE_FAILURE`。

### 7.3 Forward

ForwardBatch 必须先冻结：

```text
tankProfileId/tankId + candidate source/minified/published code hash
Ruleset/Feature/Weight/Search/Runtime/Memory profiles
start watermark/time
opponent/map/seat plan
target count or stopping rule
maximum duration
failure policy
```

只有注册后的新平台 match 可以进入该 batch。修改任一候选语义字段后关闭当前 batch，新 candidate 使用新 batch；已查看失败自动成为下一 candidate 的 Discovery。

## 8. 增量规则验证

每条 RuleEvidence 保存：

```text
ruleId
lastValidatedHeadId
supportingMatchIds / fixtureIds
contradictionMatchIds
analyzerVersion
status
```

新 head 到达时只分析增量 match，并对受影响 rule 重跑定位 fixture。旧 Snapshot 的“当时无冲突”保持可复现，新证据可以升级当前 RuleRegistry，但不能改写旧报告。

Poison 当前拆分为：

- 4帧 `ACT-HOLD-ACT-HOLD` 执行 cadence：252 snapshot 的 30 个完整 applied→expired 样本一致，升级为平台 replay confirmed；
- 空队列是否在被抑制帧重新 poll：仍 UNKNOWN；
- cooldown 20：官方/Guide confirmed。

## 9. 存储位置

新规范目录：

```text
battle-records/
  tanks/<tankProfileId>/
    runs/<runId>/...               该tank的一次平台运行原始证据
    baselines/...                  该tank/branch的发布与回滚基线
  corpus/ledger/<epoch>.jsonl      append-only ledger segment
  corpus/heads/<headId>.json       派生 head
  corpus/snapshots/<snapshotId>/   不可变清单与roots
  cohorts/<cohortId>.json          关闭用途分配
  forward/<forwardBatchId>/        预注册与关闭报告
```

现有散布目录作为 `LEGACY_IMPORT` 保留，不要求移动；导入器必须通过 urlId/replayHash 去重并记录原路径。

全局Ledger可以同时包含v1、v2及未来tank，但每个entry必须通过`subjectTankProfileId + subjectTankId`核对非密钥TankRegistry。Candidate、Frozen和Forward用途的Snapshot默认只允许一个subject profile；跨profile研究快照必须显式标注，且不能直接作为任何单一profile的发布分母。

JSON Schema只验证结构。实现还必须运行semantic validator，至少验证：profile/tank一致、Ledger sequence与urlId/replayHash唯一、match id稳定排序、artifact/fingerprint重算、`allowedLatenessMs >= sessionGapMs`、Snapshot成员不超过watermark、closed cohort不可变，以及Candidate/Frozen/Forward snapshot为单profile。

## 10. 验收门

- 总对局数只从 Ledger 派生；源码、文档规则和目录名无固定总数依赖；
- 244 snapshot 的 artifact roots 不变；
- 任意追加 match 不改变已关闭 cohort 的 groupId/role；
- 同一match不能因不同key/profile被重复计数，tankId不匹配不能进入Ledger；
- v1、v2及未来profile的Candidate/Frozen/Forward分母互不继承；
- schema与semantic validator均通过后才能提交Head/Snapshot/Cohort；
- 未施放技能保持 UNKNOWN，不变成 none；
- error/runtime/timeout 不进入技能物理胜率；
- 同一 urlId 的冲突 artifact 阻塞 head；
- Counterfactual 在缺技能/public input 时返回 incomplete；
- ForwardBatch 的每局 createdAt/watermark/codeHash 均满足预注册；
- production bundle 不含 ledger、match id、报告或对手名字。
