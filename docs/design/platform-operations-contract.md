# DD10 平台运行、发布、战斗与分析合同

状态：DD10 规范合同，2026-07-16。本文规定候选代码从本地验证到平台 simulate、发布、真实对局、下载、分析和语料入库的唯一受控流程。平台 API 事实以 [../agent-guide.md](../agent-guide.md) 和当前官方 Updates 为权威。

关联：`DEC-0080` 至 `DEC-0089`；`OI-PLAT-001` 至 `OI-PLAT-005`、`OI-ARCH-017`、`OI-ARCH-018`；[artifact-lineage-contract.md](artifact-lineage-contract.md)、[dd10-platform-capability.schema.json](dd10-platform-capability.schema.json)、[dd10-tank-registry.schema.json](dd10-tank-registry.schema.json)。

## 1. 范围与原则

平台流程是发布正确性的一部分，不是实现后的手工附录。所有外部操作必须由脚本生成 manifest、可重跑读取步骤、可对账写入步骤，并保存请求/响应证据。

硬原则：

- 每个坦克使用独立TankProfile；Tank Key只从该profile的secret reference解析，禁止把key值写入命令行参数、registry、源码、manifest、日志或replay；
- tank 生产脚本本身禁止网络/API 调用；平台操作只在离线 runner 中执行；
- 未通过同一TankProfile、Candidate和publish artifact精确字节的服务器simulation attestation，禁止发布新hash；
- 发布和 challenge 是有外部影响的操作；网络结果不确定时先对账，禁止盲目重试；
- 每个阶段以 hash/版本为身份，不以文件名或“最新版”推断；
- 所有平台结果先做可靠性分类，再做战术分析，禁止把 SCRIPT_ERROR 归因给敌方技能。

## 2. 唯一操作状态机

```text
DRAFT
  -> LOCAL_VALIDATED
  -> SIMULATION_QUALIFIED
  -> PUBLISH_AUTHORIZED
  -> PUBLISHED_VERIFIED
  -> CHALLENGE_AUTHORIZED
  -> MATCH_RECORDED
  -> ARTIFACTS_VERIFIED
  -> ANALYZED
  -> LEDGER_INGESTED
  -> RUN_CLOSED
```

任一前进状态都可转入typed `FAILED`；simulation因429/平台不可用但候选本身未判错时可停在`SIMULATION_BLOCKED`。恢复只能回到最近一个已原子提交的前进状态，不能跳过中间attestation或授权。

任何状态只能读取上一步的不可变输出。人工复制代码、网页手工发布或散落 curl 可以用于紧急诊断，但不能生成发布/forward证据，除非随后完整导入请求、响应、平台版本和 hash 并通过一致性检查。

## 3. 统一 CLI 与函数边界

实施必须提供一个统一 orchestration CLI。仓库内唯一受支持的物理入口是
`./tools/platform-toolchain.sh`；它负责解析WSL原生Node并调用可测试的JavaScript函数。
文档、人工操作和自动化不得绕过该入口重新拼装相同步骤。重复两次以上或属于发布门的
流程必须固化为子命令或聚合子命令，并具备幂等性、typed result和回归测试。规范入口：

```text
./tools/platform-toolchain.sh context --tank-profile v2
./tools/platform-toolchain.sh register-tank --tank-profile v2 --expected-tank-id <id>
./tools/platform-toolchain.sh validate --tank-profile v2 --candidate <file>
./tools/platform-toolchain.sh simulate --tank-profile v2 --run <runId> --plan <plan.json>
./tools/platform-toolchain.sh publish --tank-profile v2 --run <runId> --authorize-publish
./tools/platform-toolchain.sh challenge --tank-profile v2 --run <runId> --plan <plan.json> --authorize-ranked
./tools/platform-toolchain.sh download --tank-profile v2 --run <runId> --match <urlId>
./tools/platform-toolchain.sh sync --tank-profile v2 --run <runId> --since-watermark <watermark>
./tools/platform-toolchain.sh analyze --tank-profile v2 --run <runId>
./tools/platform-toolchain.sh ingest --tank-profile v2 --run <runId>
./tools/platform-toolchain.sh pipeline --tank-profile v2 --run <runId> --stop-before publish
```

名称可以变化，但必须保留以下可测试函数边界：

```text
loadTankContext
registerTankProfile
verifyTankProfileIdentity
validateCandidate
runSimulationCase
qualifySimulationSuite
publishCandidate
verifyPublishedCandidate
launchChallenge
reconcileAmbiguousMutation
listTankMatches
downloadMatchArtifacts
verifyArtifactSet
analyzeMatch
ingestMatchLedger
closeRun
```

离线runner允许普通对象和异步HTTP，但函数边界统一返回typed envelope，不把异常文本当控制流：

```text
OperationResult {
  ok
  nextState
  errorCode / retryClass
  attempt
  evidenceArtifactIds[]
  remoteRequestId
  mutationDisposition   NOT_SENT | CONFIRMED | RESPONSE_LOST_CONFIRMED | UNKNOWN | CONFLICT
}
```

mutating函数还必须接收已落盘intent hash和显式authorization；未捕获异常由orchestrator转为typed failure并保留stack到离线错误artifact。函数不得直接把未提交的内存结果推进Run状态。

现有 `sync-missing-matches.js`、`build-match-corpus.js`、`batch-download-matches.js`、`batch-analyze-matches.js` 是迁移输入，不自动满足本合同。统一 runner 可以调用其经过修正的库函数，但禁止用 shell 输出猜测阶段成功。

### 3.1 多TankProfile与Key隔离

非密钥注册表遵守[dd10-tank-registry.schema.json](dd10-tank-registry.schema.json)。`tankProfileId`是本地稳定身份，例如`v1`、`v2`，不是平台tankId、key或代码版本。

```text
TankProfile
  tankProfileId/alias/status
  tankId/tankUrlId
  ownerScopeId
  secretRef(provider/name/keyGenerationId)
  skillId + PLATFORM_CONTEXT provenance
  branch baselines
```

- BOOTSTRAP profile先用`context`读取并展示脱敏identity，但不绑定；`register-tank`必须再次GET并要求显式`--expected-tank-id`与context一致后，才写非密钥profile；BOOTSTRAP在tankId/skill验证前不能mutation；
- bootstrap可以保存用户确认的`expectedSkillId`作为onboarding mismatch guard；它只能拒绝不一致context，不能把registry的skill provenance从`UNKNOWN`升级为`PLATFORM_CONTEXT`；
- registry只保存环境变量名或secret-provider引用，绝不保存key值；`--key`和位置参数key一律拒绝；
- 每次API调用先用该profile解析key，再以GET context核对返回tankId/tankUrlId；不一致为`TANK_IDENTITY_MISMATCH`；
- mutation命令必须显式`--tank-profile`，禁止默认“最近使用的坦克”；
- key轮换只更新secretRef/keyGenerationId，不创建新profile；若新key解析为不同tankId则拒绝轮换并要求新profile；
- CandidateManifest绑定`targetTankProfileId + targetTankId + targetSkillId + branch`；构建own-skill专门化必须使用该profile从平台context确认的skill；
- v1、v2和未来tank的run目录、发布基线、standing与分析默认隔离；跨tank对比只由显式多snapshot报告执行；
- 平台限流按`ownerScopeId`加锁而不是按key。无法确认不同key是否属于不同用户时，全部放入保守的`unknown-shared-owner` scope，禁止用多个key绕过2秒限制。

## 4. Run 与 Candidate 身份

每次迭代先创建 `runId` 和 CandidateManifest：

```text
candidateId
candidateFingerprint / buildManifestSha256
targetTankProfileId / targetTankId / targetSkillId / branch
sourcePath / sourceSha256
minifiedPath / minifiedSha256
publishArtifactKind / publishArtifactSha256
basePublishedVersion / basePublishedCodeHash
ownSkillId + evidence
rulesetVersion
physicalAbiVersion
feature/weight/opponent/strategy versions
search/runtime/memory/cache profiles
platformCapabilityProfileId/hash
tool/analyzer/ledger/schema versions
corpusSnapshotId/fingerprint or null
forwardBatchId or null
createdAt / author / notes
```

`ReleaseCandidateManifest`旧称废弃，唯一名称为`CandidateManifest`。字段owner、canonical hash和Build→Candidate→Run血缘以[artifact-lineage-contract.md](artifact-lineage-contract.md)为准。后续simulation、publish和challenge必须同时引用`targetTankProfileId`、`candidateId`与`publishArtifactSha256`。Run profile、Candidate target和GET context三方identity任一不一致即失败。读取只读candidate副本后到发送请求前若hash改变，操作失败；不得自动接受新内容。

## 5. 本地发布前验证

`LOCAL_VALIDATED` 至少要求：

1. source/minified 可解析，且都导出同步 `onIdle(me,enemy,game)`；
2. Reference/Fast、Hard/Terminal、source/minified semantic differential 和 frozen gates 达到 CandidatePlan 要求；
3. 使用平台 capability sandbox 运行 cold first callback 与代表场景；
4. 在不提供平台缺失API的sandbox中仍正常运行；可选能力缺失时才走规范fallback，尤其生产不得访问`Math.imul`；
5. 检查禁止项：Worker、SharedArrayBuffer、Atomics、async/Promise、网络、文件系统、动态 import、`eval/new Function`、`Math.random`；
6. TypedArray 类型、初始化 bytes、最大 arena、stack、cache 和 emergency reserve 写入 manifest；
7. 日志/Reference/replay/simulator/v1/对手名字已从 production bundle 剥离；
8. 本地异常、容量溢出、clock异常均产生规范 fallback/incomplete，而不是未捕获异常。

平台 capability 事实与性能分开，并按[dd10-platform-capability.schema.json](dd10-platform-capability.schema.json)保存：

- `Math.imul = absent` 已由真实 v25 SCRIPT_ERROR 确认，生产禁止依赖；
- `Uint16Array/Uint32Array` 至少已由精确 v20 源码的真实对局确认可执行；
- `mutationRateLimitMs = 2000` 当前按Guide确认，并由同一`ownerScopeId`共享调度；
- 当前v2官方probe确认`performance/setTimeout`缺失、公开root无累计runtime，并确认单callback约1500ms watchdog；`Date.now`未取得可调用且单调的完整证据，正式状态为`UNKNOWN`，所以当前构建使用校准work counter；
- source/publish字节上限、published code换行/文本规范化和其余API幂等性当前仍为`UNKNOWN`；
- TypedArray SoA 是否比 packed Array 快、脚本字节上限等仍由平台 benchmark 决定。

CapabilityProfile可以汇总多个TankProfile的相同平台事实，但必须列出`evidenceTankProfileIds`；任何只在一个tank/key上观察到的权限、skill、代码版本或冷启动结果不得擅自推广为全局事实。Candidate若要求`ABSENT/UNKNOWN`能力，local validation直接失败；只有合同定义了等价fallback的可选能力可以继续。

## 6. 强制 Simulation 门

在进入本节前，V2 Candidate 必须先通过
[v2-candidate-release-qualification-contract.md](v2-candidate-release-qualification-contract.md)：
完成结构修复前基线、预注册 fallback 性能矩阵、固定输入 V1/V2 benchmark、调优后完整
V1/V2 四格对战及逐帧 action trace，并生成绑定精确 Candidate publish bytes 的本地资格
attestation。缺失、hash 不一致、严格门失败或待 review 的玩法退化都必须在 IMP9 preflight
阻塞，不能先调用官方 simulate 再补本地证据。

发布新candidate前必须调用`POST /api/agent/tank/simulate`，请求必须显式携带将要上传的publish artifact精确字节，不能省略后测试旧发布版。若最终上传minified，则source simulation只能作诊断，不能替代minified attestation。

默认最小 suite：

```text
nova-scout / classic             cold smoke + basic API
azure-hunter / arena             aiming/pressure/runtime
crimson-bastion / random         map/terminal/skill robustness
```

实际 bot/map 必须先由 `GET /api/agent/tank` 确认存在；CandidatePlan 可以增加场景，不能无记录删掉 cold smoke。每个 case 保存 request hash、sanitized request、完整 response、raw replay、解析结果和 runtime。

SimulationQualified 的硬条件：

- 响应明确使用 candidate code（如平台返回 `usedCandidateCode=true`）；
- request code字节hash与`publishArtifactSha256`相等；
- HTTP/JSON/schema 完整；
- replay 至少包含 setup 和可解析 meta/result；
- 没有 `error`、未捕获异常、平台兼容错误；
- 没有平台 runtime/timeout 型可靠性失败；同星 `runTime` tiebreak 必须由 TerminalClassifier 区分；
- source/minified 需要分别证明时，两者使用同一 suite 或预注册等价抽样；
- 胜负不是可靠性门：正常战术失败可以进入分析，但不能掩盖异常。

遇到 `429` 不允许跳过 simulation 发布。runner 读取 `nextSimulationAt`，在界限内等待/重试；无法获得 attestation 时状态保持 `SIMULATION_BLOCKED`。

相同精确`candidateId + publishArtifactSha256`的既有attestation可以复用，但必须满足CandidatePlan的Guide/capability/ruleset时效和suite版本。任何发布字节、minifier、capability profile、规则或强制suite变化使其失效。

## 7. 发布事务

发布前：

1. 使用Run绑定的TankProfile再次`GET /api/agent/tank`并核对tankId/skill/branch；
2. 校验 branch、base version/codeHash、skill、Guide URL 和 simulation cooldown；
3. 校验 CandidateManifest、SimulationAttestation 和人工/自动授权；
4. 从candidate只读副本取得code并重新计算UTF-8 hash，必须等于`publishArtifactSha256`；
5. 保存 sanitized publish request：`code` 单独以 hash/文件保存，request JSON 不复制 secret；
6. `notes` 简洁说明行为、规则、性能和回滚点；`submittedBy` 必填；
7. 建立 `publish-intent.json` 后才发送 `POST /api/agent/tank/code`。

发布后不得只信 POST 响应。必须再次 `GET /api/agent/tank` 并核对：

```text
branch
new version
published code/content hash
submittedBy
notes or response id
base version advanced exactly once
```

只有核对成功才进入 `PUBLISHED_VERIFIED`。网络断开/5xx 发生在 POST 后时，先用 context 对账目标 hash：

- 已发布同 hash：记录 `MUTATION_SUCCEEDED_RESPONSE_LOST`，不重试；
- 仍是 base hash：允许在重试预算内重发；
- 其他 hash/version：`PUBLISH_CONFLICT`，停止并请求人工决策。

回滚也必须发布同一TankProfile下已有SimulationAttestation的精确hash。禁止把v1候选回滚到v2 tank，或在事故中临时编辑一个“差不多的旧版本”并跳过simulate。

新tank首次登记时先归档GET context返回的main代码/version/hash作为`VERIFIED_BASELINE`。若平台确实没有可回滚代码，CandidateManifest标`FIRST_PUBLISH_NO_ROLLBACK`；这需要额外`--authorize-first-publish-no-rollback`、扩大强制simulation suite并保存原因，不能由普通`--authorize-publish`替代。raid/multiplayer未发布而回退main时必须标`FALLS_BACK_TO_MAIN`，不能伪造独立branch baseline。

## 8. 真实 Challenge

`POST /api/agent/tank/challenge` 会产生永久记录并影响排名。脚本必须要求显式 `--authorize-ranked`，并读取 ChallengePlan：

```text
publishedCodeHash
opponentTankId or randomOpponent
mapId
count / stopping rule
minimum interval
seat/opponent/map coverage purpose
forwardBatchId or discovery purpose
rankingPurpose / expectedScoreEligibility
abort policy
```

挑战前校验Run TankProfile、当前main tankId及published hash等于计划；否则禁止开局。定向与随机 opponent 必须显式二选一，不能因字段缺失意外变成随机挑战。

若`rankingPurpose=RANK_PROGRESS`，runner必须先用ledger/context检查平台计分约束：同一对手+同一固定地图只有首次计分；随机地图虽可重复计分，24小时内对同一对手50连胜后仍会被抑制；Champion击败非Champion不加分。预计不计分时默认阻塞并给出原因。若目的只是规则/回归覆盖，可以显式`expectedScoreEligibility=false`继续，但报告必须把“记录有效”和“排名计分有效”分开。

每局请求前保存 challenge intent。响应后立即保存原始 JSON、matchUrlId、human/agent URL、双方 codeHash、mapHash、result 和 standing snapshot。

POST 结果不确定时，先查询 `GET /api/agent/tank/matches`，按 intent time window、我方 codeHash、opponent/map 进行唯一对账。唯一匹配则恢复；零匹配才允许重试；多匹配进入 `CHALLENGE_RECONCILIATION_CONFLICT`。禁止盲重试制造重复排名赛。

Simulation 与 recorded battle 共享用户级 2 秒限制。runner 使用服务端 `nextSimulationAt` 或最近响应时间，串行调度 mutation；不同 tank key 不能绕过限制。

## 9. 下载与 artifact 完整性

runner通过`GET /api/agent/tank/matches?limit=<n>&offset=<k>`列出结果：offset只按实际返回条数推进，空页/短页结束，重复页、总预算超限或同`urlId`摘要冲突直接失败；若未来API改为游标，必须先更新CapabilityProfile而不是猜参数。每份列表响应保存hash。`sync`只把未知`urlId`加入下载队列，不以列表中的简要字段替代artifact。每个真实 match 按层读取：

1. 默认 summary；
2. `view=events`；
3. 需要精确窗口时读取 frames slice；
4. 进入动态语料、规则校准或反事实前必须保存 `view=raw`。

Run 关闭前的规范历史包要求 `summary.json + events.json + raw.json` 全部存在。下载器必须：

- 对 GET 的网络/5xx 使用有界指数退避；
- 校验 JSON、matchUrlId、双方 codeHash、resultReason 和 replay schema；
- 使用临时文件 + hash + 原子 rename；
- 已有文件先验证 hash/schema，不能仅因路径存在就跳过；
- 保存 URL、HTTP metadata、byte length、SHA-256、downloadedAt；
- public replay 尚未就绪时标记 `EVENTUAL_CONSISTENCY_PENDING`，有界轮询后失败，不写空文件；
- 任一 artifact 冲突时停止 ledger ingestion。

## 10. 分层分析流程

分析顺序固定：

### L0 可靠性与基础设施

分类 SCRIPT_ERROR、RUNTIME_TIMEOUT、平台/API错误、artifact/schema错误、未发布 hash、candidate mismatch。L0 失败先产生 blocker；该局不得计入技能物理胜负率。

### L1 Terminal 重建

使用ordered raw events区分单方crash、双方crash、frame limit、stars、runtime、timeout和error。保留reason原始大小写；`runTime`只有在同星mutual-crash/frame-limit形状下才按tiebreak解释，当前Guide的`runtime`或历史`timeout`在无tiebreak形状时按可靠性失败解释。字符串本身不足以确定原因；缺失runtime不能写0。

### L2 事实战术

提取双方实际动作、项目iles、bomb、skill source/target、草/隐身观察边界、星、最后 N 帧死亡/获胜链和 runtime 热点。技能身份携带 provenance；派生 events 的 tank 名称不能替代 raw source/target id。

### L3 反事实

只从 checkpoint 前缀重建。动作首次分叉后真实 replay suffix 立即失效；输出 `ROBUST_AVOIDABLE/STRICT_UNAVOIDABLE/UNKNOWN` 必须满足 DD9 coverage。

### L4 聚合与报告

按 subject codeHash/version、opponent tank/codeHash、map、seat、技能 evidence、terminal class、运行目的和score eligibility分层。脚本错误与技能战败分开；同对手回填技能单独标 `INFERRED`；recorded match、rank-score eligible和实际rank delta不得混成一个“有效战斗”计数。报告正文必须由同一 machine analysis 生成或校验，禁止表格和结论使用不同快照。

## 11. 保存位置与原子产物

```text
battle-records/tanks/<tankProfileId>/runs/<runId>/
  run-manifest.json
  context.json
  capability-profile.json
  candidate/
    source.js
    minified.js
    candidate-manifest.json
    local-validation.json
  simulations/<caseId>/
    request.sanitized.json
    response.json
    raw.json
    verdict.json
  publish/
    intent.json
    response.json
    verify-context.json
  challenges/<sequence>/
    intent.json
    response.json
    reconcile.json
  matches/<matchUrlId>/
    summary.json
    events.json
    raw.json
    artifact-manifest.json
    analysis.json
    findings.md
    windows/
  reports/
    overview.md
    metrics.json
    failures.csv
    skill-evidence.json
  errors/<errorId>.json
```

`run-manifest.json` 遵守 [dd10-platform-run.schema.json](dd10-platform-run.schema.json)。任何阶段只有在其 manifest 原子提交后才算完成。

全局rolling ledger仍可保存多个subject tank，但每个entry必须有`subjectTankProfileId`；Candidate/Frozen/Forward snapshot默认只选择一个profile。报告若合并多个profile，必须按profile分层且不能把v1胜负计入v2发布分母。

## 12. 错误处理矩阵

| 错误 | 行为 |
|---|---|
| 400 | 请求/代码/参数错误；不自动重试，保存 body 并修正 intent |
| 401/403 | secret/权限错误；立即阻塞，禁止把 key 打印到日志 |
| 404 replay | 若 match 已创建则按 eventual consistency 有界轮询；其他 endpoint 直接失败 |
| 409/版本不符 | 查询 context 对账；禁止覆盖别人或另一进程发布的新版本 |
| 429 | 读取 `nextSimulationAt`/Retry-After，串行延迟后有界重试；不得绕过 key |
| 5xx/网络超时 GET | 有界指数退避，可安全重试 |
| 5xx/网络超时 POST | 先对账平台状态，再决定是否重试 |
| 非JSON/schema错 | 保存原始响应和 headers，状态失败，不生成伪默认值 |
| 本地磁盘/hash错 | 不提交 manifest/ledger，保留临时文件供诊断 |
| analyze异常 | 原始 artifact 保留，analyzer version/stack进入失败记录 |

所有重试必须有次数、deadline、首次/最后错误和最终 disposition；禁止无限循环。

CLI退出码固定并写入RunManifest，便于自动化而不解析文字：

```text
0  请求阶段已完成或按--stop-before安全停止
2  本地validation/build失败
3  simulation未取得资格
4  缺显式授权或candidate/base不匹配
5  mutation结果不确定/对账冲突
6  平台HTTP/鉴权/限流在预算内未恢复
7  artifact下载、schema、identity或hash失败
8  analyze/ledger/snapshot失败
9  lock/concurrency/recovery失败
```

人类可读message不能决定自动化分支；自动化只读退出码、阶段state和typed error code。

## 13. 并发、锁与恢复

- 同一TankProfile/branch同时最多一个publish/challenge mutation；
- 同一`ownerScopeId`的simulate/challenge由共享rate-limit scheduler串行化，不因key不同并行；
- 下载 GET 可以有限并发，但单 match artifact commit 串行；
- run 使用文件锁/owner/heartbeat，过期锁只能通过恢复命令接管；
- 恢复从最后一个已提交阶段读取，不重复已确认 mutation；
- `--dry-run` 必须输出将调用的 endpoint、candidate hash、opponent/map 和写入路径，不发送 mutation。

## 14. 两级发布判定

真实 forward battle 只能使用已发布 main code，因此发布门分两级：

```text
CANARY_PUBLISH_ELIGIBLE
  = 本地/差分/frozen/build门通过
  AND SimulationAttestation通过
  AND (
        rollbackMode == VERIFIED_BASELINE 且同TankProfile exact rollback hash可用
        OR rollbackMode == FIRST_PUBLISH_NO_ROLLBACK
           且扩大simulation suite通过
           且取得独立first-publish-no-rollback授权
      )
  AND publish显式授权

RELEASE_ACCEPTED
  = canary publish后同一published hash的ForwardBatch关闭
  AND G0..G11全部通过
```

Canary publish 是受控且会影响真实排名的外部操作，不能伪称最终 release。通常必须可回滚；新tank确无基线时只能走显式`FIRST_PUBLISH_NO_ROLLBACK`例外，不能把“新key”自动解释为无回滚资格。Forward 失败后停止新增挑战，并按预注册 policy 保留或回滚；无基线例外则停止新增mutation并请求人工处置。失败局进入下一 candidate Discovery。

## 15. 验收门

- 新 hash 无 simulation attestation 时 publish 命令硬失败；
- simulate 请求明确携带将要发布的精确artifact字节，不能误测旧发布版或只测source后上传minified；
- 每次操作的TankProfile、Candidate target、GET context与SimulationAttestation的profile/tank/skill/branch完全一致；
- mutation没有显式`--tank-profile`、profile未ACTIVE或key轮换解析到其他tank时硬失败；
- BOOTSTRAP首次绑定没有独立context检查和显式expected tankId确认时硬失败；
- v1、v2及未来tank的run、baseline、candidate、forward分母和回滚artifact不得交叉引用；
- publish 后 context 的 branch/version/hash 必须对上；
- ambiguous POST 恢复测试不会产生第二次 mutation；
- challenge 必须显式 ranked authorization 和 published hash；
- 三类 replay artifact hash/schema/identity 全部通过后才能入 Ledger；
- error/runtime/timeout 与战术/技能分析严格分层；
- registry schema与semantic validator验证profile/alias唯一、branch唯一、secretRef非密钥；secret扫描在registry、所有run artifact、日志和candidate中找不到Tank Key；
- 同ownerScopeId的不同key不能绕过限流；未知owner关系按共享scope串行；
- `FIRST_PUBLISH_NO_ROLLBACK`必须具有独立授权、扩大simulation证据和明确事故停止策略；
- 同一 machine analysis 生成表格与文字摘要，无过期版本/计数；
- run 可从每个阶段故障恢复，并产生确定的最终 manifest；
- production bundle 不包含任何平台 runner、key、HTTP、文件系统或报告代码。
