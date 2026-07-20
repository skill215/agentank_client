# v2 高性能 Minimax 坦克实施计划

状态：经[final-implementation-readiness-audit.md](final-implementation-readiness-audit.md)批准的实施顺序，2026-07-16。本文安排代码、工具、测试、benchmark和平台证据的落地；不预先把任何未运行门标为PASS。

## 1. 实施目标

交付两个相互隔离、通过manifest连接的系统：

1. `engine-v2`：单文件、同步、单线程、整数/TypedArray、3秒总时限内运行的高性能Minimax坦克；
2. `agentank-ops`：支持v1、v2及未来TankProfile的离线构建、simulate、发布、挑战、下载、分析、语料和证据控制面。

成功不以“能运行”或单一胜率定义。最终必须满足G0–G11、零Hard/Proof假阳性、零root restore/stale read、零timeout/script error，并取得同一目标TankProfile和精确发布字节的服务器证据。

## 2. 目录与依赖边界

实施时建立以下逻辑布局；具体文件名可细化，但模块边界不得合并成一个大脚本：

```text
engine-v2/
  src/
    abi/                 integer enums、handles、layouts
    state/               map/static/dynamic、observation、information state
    rules/               generated timeline与skill descriptors
    reference/           可读Oracle，永不进入production
    fast/                SoA、apply/undo、hazard、terminal/hard
    search/              value/matrix/proof/risk
    policy/              eval/strategy/opponent/plan
    cache/               11 canonical cache实现
    runtime/             clock、normal/fallback/emergency、emitter
    generated/           只由生成器写入
  test/
    unit/fixture/property/differential/replay/fault/integration/
  bench/
    micro/composite/pipeline/terminal/full-game/platform/

test/                              离线工具自身测试，不进入engine或production
  imp0/                            工程骨架、性能护栏和故障注入
  platform/                        多TankProfile与平台控制面

tools/agentank/
  core/                  canonical JSON、hash、schema、atomic artifact
  profiles/              TankRegistry、secretRef、context identity
  platform/              simulate/publish/challenge/download/reconcile
  corpus/                Ledger/Head/Snapshot/Cohort/Forward
  analyze/               L0–L4、window、counterfactual、report
  build/                 generate/strip/minify/manifest/candidate freezer
  cli/                   薄命令入口，不复制业务规则

config/agentank/
  tanks.example.json     无真实key的示例
battle-records/
  control/               本地非密钥registry与capability profiles
  tanks/<tankProfileId>/ runs、baselines与standing
  corpus/                global ledger、heads、snapshots、cohorts、forward
artifacts/
  builds/ candidates/ reports/
docs/implementation/
  imp<N>-overview.md
```

离线工具统一使用CommonJS，延续现有脚本边界；generator输出无模块加载的普通平台脚本。根工具链必须定位或安装一个可调用的Node运行时，随后固定其精确版本、package manager、lockfile、`node:test`和minifier版本。当前已确认WSL2原生Linux Node v24.16.0与npm 11.13.0；非交互shell不加载NVM，因此所有重复入口必须经版本化WSL wrapper解析`.nvmrc`，不得依赖直接`node`恰好可见。Schema validator/minifier只在离线工具中使用；production bundle无运行时依赖。热路径用JSDoc/机器schema表达边界，不为类型便利引入运行时包装对象。

现存`battle-records/<legacy-directory>`和根目录v1分析脚本是只读迁移输入，其历史结构不满足新TankProfile血缘合同。IMP0不得搬迁、重命名或猜测其profile；从新控制面产生的写入才进入`battle-records/tanks/<tankProfileId>`。旧数据归属、去重和Ledger迁移留给IMP7，数量必须动态扫描，不能写死244或本次审计数值。

## 3. 每阶段共同完成定义

阶段实现完成后还必须按[imp-acceptance-contract.md](imp-acceptance-contract.md)运行独立验收。Overview只能声明实现门结果；只有机器`ImpAcceptanceReport.status=ACCEPTED`才能进入下一IMP。缺外部事实/授权为BLOCKED，任何必需标准失败为REJECTED，二者都不能用“基本通过”替代。

每个IMP阶段只有同时满足以下条件才能标记完成：

1. 产物与对应DD owner逐项映射；
2. 单元、fixture、性质、差分、故障测试按适用范围通过；
3. 新增热函数报告循环上界、堆分配、bytes和耗时；
4. schema、fingerprint、链接和production deny-list检查通过；
5. 不修改已冻结语义；必要偏差先登记DEC/OI并回到owner文档；
6. 生成`docs/implementation/imp<N>-overview.md`，包含输入hash、实现范围、测试分母、benchmark、已知限制、冲突审计和下一阶段资格；
7. 当前阶段的失败可回退到上一个已通过build，不覆盖不可变artifact。

任何Overview不得只写“tests passed”；必须列出命令、版本、分母、原始报告路径/hash和未执行项。

## 4. IMP0：工程骨架与性能护栏

实施状态：`PASS`，证据见[../implementation/imp0-overview.md](../implementation/imp0-overview.md)。本状态不改变任何后续G0–G11、production或release的`NOT_RUN/BLOCKED`判定。

验收标准：`A0-01`至`A0-10`，见[IMP验收合同](imp-acceptance-contract.md#3-imp0-验收工程骨架与性能护栏)。

验收状态：`ACCEPTED`；Acceptance fingerprint `42f7c4651006276d833140802126a3cac1ee38db46d651b70cb353386c335555`。因此只允许进入IMP1，不授权任何后续阶段或平台mutation。

目标：在写游戏逻辑前先建立能阻止低性能或不可复现实现进入主线的基础。

实施：

- 定位并验证可用Node运行时；固定Node/package manager/minifier/schema工具版本和lockfile；
- 建立上述模块目录、production import allow-list和Reference/dev deny-list；
- 实现canonical JSON、SHA-256、manifest revision、原子写和schema runner；
- 建立固定seed、fixture loader、assert、allocation counter、arena high-water和clock adapter；
- 建立六层性能benchmark入口：函数、复合、全景pipeline、终局、完整对局、source/minified平台；历史回放是独立验证/吞吐轨，不占用第六性能层；
- 建立Reference/Fast差分报告格式、semantic fingerprint和root snapshot比较器；
- 建立CI/本地统一命令；零样本必须返回NOT_RUN而非PASS。

退出门：可重复工具链；相同fixture/manifest得到相同hash；故意破坏schema、root、allocation或strip时测试确实失败。不得出现tank物理实现或平台mutation。

## 5. IMP1：多TankProfile控制面与只读平台基线

验收标准：`A1-01`至`A1-08`，见[IMP验收合同](imp-acceptance-contract.md#4-imp1-验收多tankprofile与只读平台基线)。

实施状态：`ACCEPTED`；v1/v2真实GET、身份、main baseline、CapabilityProfile与全部故障门均PASS，Acceptance fingerprint为`21b8020ab1671af94b857f33397b025e09a624fe8675f80cee382806dcc6f994`，详见[IMP1 Overview](../implementation/imp1-overview.md)。因此只允许进入IMP2。

目标：先解决用户将创建v2新tank、不同key和未来扩展的问题，并取得真实own skill/branch身份。

实施：

- 实现非密钥TankRegistry、ENV secret adapter和强制`--tank-profile`；
- 实现`register-tank/context/verify-profile/rotate-key`，每次请求核对tankId/tankUrlId/skill/branch；BOOTSTRAP先context检查，再以显式expected tankId二次GET确认绑定；
- registry保存secretRef名称和keyGenerationId，不保存key值；
- 实现按TankProfile/branch的run与baseline目录、按ownerScopeId的共享2秒调度器；
- 实现sanitized request/response、secret scanner和wrong-key/cross-profile/rotation fault tests；
- 归档v1当前context与main baseline；用户创建v2后登记`v2`，读取平台确认的skill和main状态；
- 生成初始CapabilityProfile；未知能力保持UNKNOWN；
- 实现`--dry-run`和fake transport，真实publish/challenge保持禁用。

用户检查点：用户在平台创建新tank后，只在本机配置例如`AGENTANK_KEY_V2`；不要把key写进仓库、命令行值或聊天。随后注册profile并由脚本展示已脱敏tankId/skill/branch供确认。

退出门：v1/v2 profile隔离、不同key不能串用、同ownerScope共享限流、key轮换到不同tank被拒绝、registry/run日志secret扫描为零。v2尚未创建时本阶段可以先完成实现，但profile登记子门保持BLOCKED，不能猜skill。

## 6. IMP2：规则输入、状态模型与ReferenceKernel

验收标准：`A2-01`至`A2-08`，见[IMP验收合同](imp-acceptance-contract.md#5-imp2-验收规则输入状态模型与referencekernel)。

实施状态：`ACCEPTED`。Reference Oracle、RuleCorpus闭合、四条canonical trace及G1均已实现，最终125/125测试通过；12项预注册official simulate probe均有脱敏官方证据，其中未触发目标交互的项目明确保留`INCONCLUSIVE`且不升级RuleCorpus。poison cooldown failed cast已由同局baseline/experiment确认不重置ready frame；runtime probe另确认单callback约1500ms watchdog和当前无已确认安全墙钟。Acceptance fingerprint为`bb3e36daed3858749474f9407486cdd4b466145778231889f207630e1c465475`，IMP3已获准入，详见[IMP2 Overview](../implementation/imp2-overview.md)。

目标：建立唯一可读Oracle，先追求规则可解释和证据闭合。

实施：

- 实现平台input adapter、ObservedRoot整数化、TrackedState和`SearchState = PhysicalState | InformationState`；
- 实现固定地图静态层、动态entity pools的Reference表示，以及多projectile/multi-bomb/overload独立ID；
- 实现Observation reconciliation、Entity association、ActionScheduler、FrameTimeline、TerminalClassifier和八技能Reference状态机；
- RuleCorpus逐条加载confirmed/common/variant/unsupported，不在代码中散落默认规则；
- 导入Guide、官方Update、v1 replay、simulator/framework fixture；后两者只生成候选和差分，不作平台真值；
- 用官方simulate进行最小定向规则probe，优先收敛reachable R0/R1与平台能力；
- 为128帧、同星对枪、runtime、互毁、bomb/projectile/skill复合建立canonical trace。

退出门：G1实施通过；每个reachable未知都有variant或规范incomplete；Reference trace可重放；规则冲突不会被胜率或模拟器默认值覆盖。

## 7. IMP3：FastKernel、Hazard与硬失败层

验收标准：`A3-01`至`A3-09`，见[IMP验收合同](imp-acceptance-contract.md#6-imp3-验收fastkernelhazard与硬失败层)。

实施状态：`ACCEPTED`。TypedArray SoA、generation entity slot、Delta/Event Arena、Fast apply/undo、Committed SourcePlan、phase-accurate ReverseViability和逐动作Hard已实现；20个exact/common Reference差分为0 mismatch，1个依赖未决variant的复合轨迹按预期unsupported且零部分mutation；最终142/142测试通过。Acceptance fingerprint为`6c148c570f66d9f136ce9178001e1cdeeb90d312800b5466eb0b077a17692688`，IMP4已获准入，详见[IMP3 Overview](../implementation/imp3-overview.md)。

目标：把物理层转成生产可用的零临时对象高性能实现，同时保持Reference完全一致。

实施：

- 按MemoryCapacityManifest实现TypedArray SoA、fixed arena、EntityHandle generation和显式stack；
- 实现静态地图预计算、动态占用bitset、projectile/bomb trajectory与失效前持久状态；
- 实现prepare/commit/undo、BranchMark、EventBuffer、Terminal和HardGate；
- projectile/bomb出现后建立持续到命中墙/土/边界/目标/expiry的SourcePlan与hazard缓存；
- 对每个action执行`apply -> Terminal/Hard -> aggregate -> undo`，禁入格和reverse death chain在生成/评分前生效；
- 实现Committed Hazard Closure和ReverseViability；PossibleHazard只进入风险层；
- 全字段Reference/Fast differential、root restore、overflow/collision/generation/terrain invalidation fault injection。

性能门：热循环无对象分配；map/entity/projectile/bomb上界可测；每个cache关闭时只损失性能。退出门为G2、G3硬层和G4核心项通过，任一terminal/hard mismatch或root restore failure为零容忍。

## 8. IMP4：Value、Matrix、Proof与Risk搜索

验收标准：`A4-01`至`A4-08`，见[IMP验收合同](imp-acceptance-contract.md#7-imp4-验收valuematrixproof与risk搜索)。

实施状态：`ACCEPTED`。sound Value interval、三量词InformationGraph、受限Double Oracle、整数mixed Policy、AND/OR/DFPN Proof、CoverageCertificate、递归epsilon-contamination与显式栈Fast物理树已实现；81个矩阵和243个Proof小状态Oracle零错误，最终166/166测试通过。Acceptance fingerprint为`bddc370eb154b52d3aafdf0a8506ac140e718d8a81f11872738674444b4229e8`；容量和risk table仍为`BUILD_CONFIGURED`，IMP5已获准入，详见[IMP4 Overview](../implementation/imp4-overview.md)。

目标：实现新的Minimax核心，而不是把旧深层pure Minimax搬过来。

实施：

- 深层Value返回sound lower/upper、完成度和incomplete原因；
- 根和关键节点实现受限矩阵、full best-response与Double Oracle；
- InformationState上实现AND/OR/DFPN ForcedWin/Nonloss/Loss与CoverageCertificate；
- EnemyAction、HiddenWorld、ChanceOutcome分别使用正确量词；
- 实现chance/hidden/enemy三维递归epsilon-contamination robust backup；
- risk 0–100只改变软不确定backup，不能改变Hard或Proof；
- normal/fallback使用同一搜索语义，只由SearchBudgetProfile缩减depth/nodes/matrix/proof预算；
- 用穷举小状态、离线高精度oracle和metamorphic property验证interval、policy、proof与risk单调性。

退出门：Proof false positive、per-row best response漏洞、incomplete升级strict和risk越过Hard均为零；G3/G8算法项通过。此阶段先以cache-off正确实现为基线，缓存优化不得成为正确性前提。

## 9. IMP5：评分、策略、对手、技能与Plan软层

验收标准：`A5-01`至`A5-09`，见[IMP验收合同](imp-acceptance-contract.md#8-imp5-验收评分策略对手技能与plan软层)。

实施状态：`ACCEPTED`。21-feature整数Registry、Table/Generated双 evaluator、action/Plan 独立权重、5策略滞回、本局10类OpponentModel、v2 Poison专用emitter、enemy八技能descriptor、四类Plan与HiddenRiskField已实现；684项 evaluator 对比零差异，strict fingerprint mismatch为0，最终179/179测试通过。Acceptance fingerprint为`b9aa78079de732097961418479e79e69e64629d3f4e3c6b8fa172ed5ce7698dc`；weights/alpha/capacity仍为`BUILD_CONFIGURED`，IMP6已获准入，详见[IMP5 Overview](../implementation/imp5-overview.md)。

目标：在硬约束内形成可调、高性能、动态策略选择。

实施：

- 实现整数FeatureRegistry、raw/weight分离、dependency mask和Table/Generated evaluator A/B；
- 实现阶段/对手/局面驱动的StrategySelector和hysteresis；
- OpponentModel只使用本局事件更新开火、移动、转向、拿星、技能和风险偏好；
- 实现own-skill专门化与enemy八descriptor direct lookup；
- 实现Shot/Bomb/Skill/InformationControl PlanSketch，只有finalist建立PersistentPlan；
- 草、cloak、不可见路径生成PossibleShot/BeliefSweep；压草射击、bomb、远离隐身区只由robust risk控制；
- 每个软分数可独立调节且有整数范围、依赖和成本；任何plan继续前都重新验证Hard。

退出门：策略/评分改变不能改变strict结论；对手模型不跨局调我方参数；技能/hidden正负机制fixture成对通过；Table/Generated语义一致后才允许按性能选择。

## 10. IMP6：缓存、RuntimeController与Production Build

验收标准：`A6-01`至`A6-10`，见[IMP验收合同](imp-acceptance-contract.md#9-imp6-验收缓存runtime与production-build)。

实施状态：`ACCEPTED / LOCAL_GATE_PASS / RELEASE_NOT_READY`。11个canonical cache、精确失效、cache-off、累计work counter、1500/2500等价门、独立Emergency reserve、benchmark-selected depth-3 fallback Minimax、Poison/Generated production专门化、可重复source/minified build及六层benchmark已实现；production cache诊断counter已剥离，source/minified 24字段差分为0，最终194/194测试通过。Gate fingerprint为`cd67825a09391066c7a76fd16e8c5612f6768ad210600deaf9ee2ca0b9cb8a1f`，Acceptance fingerprint为`f7a3edefa7f7676de8e29abbe98b932921f09b844548a57945f1b387f0ea8253`。平台引擎、脚本字节上限及runtime校准仍是release blocker，当前参数只能作为本地profile；IMP7已获准入，详见[IMP6 Overview](../implementation/imp6-overview.md)。

目标：把正确实现压入平台时间/内存/字节限制，并使所有优化可关闭、可比较、可回退。

实施：

- 实现11个canonical cache、key/version/signature/collision/lifecycle与cache-off模式；
- projectile/bomb/plan缓存持续到物理失效，terrain、entity generation、deadline和score dependency触发精确失效；
- 实现Capability选择的wall-clock/校准work counter；当前以1500/2500ms等价work limit触发永久FALLBACK/EMERGENCY，并保留独立500ms reserve与单callback watchdog安全界；
- 每个时钟检查批次、节点预算和fallback深度由benchmark选择，不写死“2层”；
- 实现own-skill generator、strip、deterministic assembly、source/minified和BuildManifest；
- production deny Worker/async/network/fs/eval/Math.random/float semantic arrays/hot Map/Set/Reference/v1/log；
- 无`Math.imul`sandbox运行cold init和全fixture；
- 运行函数、复合、全景、终局、完整对局、source/minified平台六层benchmark，记录P50/P95/P99/max、nodes/ms、allocation、high-water和bytes。

选择顺序固定：正确性和reserve先通过，再比较深度/质量/胜率。退出门：G4/G7/G9通过；source/minified semantic fingerprint全等；任何cache-off只影响速度；平台3秒附近不继续投机搜索。

## 11. IMP7：动态历史、失败窗口与双向反事实

验收标准：`A7-01`至`A7-09`，见[IMP验收合同](imp-acceptance-contract.md#10-imp7-验收动态历史窗口与双向反事实)。

实施状态：`ACCEPTED / G5_G6_PASS / RELEASE_NOT_READY`。动态MatchLedger、profile隔离Snapshot、append-stable session/cohort、LEGACY-244 root复核、skill/terminal provenance、L0–L4窗口、整数TypedArray Truth/Observed双轨、分叉后suffix失效和双方反事实均已实现；本次动态Snapshot观测到266局v1、12,587帧、748个窗口和1,496个双方视角结果，历史缺少完整public input时全部严格标签保持UNKNOWN。最终203/203测试通过，Gate fingerprint为`e4aac566feccfa64e4cc7df7d6d8f7e1a805a916cb6ef8ec8517c4f0cda624f8`，Acceptance fingerprint为`06d20f83ae3b00a05c49e66bd5c9b972fd9fc7ad98cd1f44b74a8bbccbe7ddf3`；IMP8已获准入，详见[IMP7 Overview](../implementation/imp7-overview.md)。

目标：把持续增长的v1/v2历史真正变成可复现验证系统。

实施：

- 实现MatchLedger、CorpusPolicy/Head/Snapshot/Cohort/Forward及semantic validator；
- 动态扫描历史，不写死244或当前总局数；保留`LEGACY-244`不可变roots；
- 迁移skill/terminal provenance，未施法保持UNKNOWN，missing runtime不写0；
- 实现L0–L4 analyzer、最后N帧死亡/获胜链、事件驱动指标和runtime热点；
- 实现Truth/Observed双轨、checkpoint、首次分叉后suffix失效和双方反事实；
- 对每个死亡窗口回放我方替代动作，也以对方视角测试其可避免性；
- 用v1代码、v1失败分析和滚动Discovery生成fixture、弱点类别和正向保护，不把它们变成v2物理真值。

退出门：Ledger追加稳定、跨profile分母隔离、244 roots不变、污染/迟到/重复/部分下载fault tests通过；G5/G6的实现证据完整。

## 12. IMP8：参数校准、构建冻结与本地候选资格

验收标准：`A8-01`至`A8-08`，见[IMP验收合同](imp-acceptance-contract.md#11-imp8-验收校准构建冻结与本地候选)。

实施状态：`ACCEPTED / CANDIDATE_FROZEN / G10A_PASS`。V5 完整比较按预注册门返回 `NO_SELECTION`；V6 在 56 张 Calibration 地图、两次重复、四种座位/技能变体上选择 `PATH_BALANCED_D3_V6`，原生胜率 41.07%，相对无路径基线提升 21.88 个百分点，fallback 10.62%，严格错误均为 0。最终 Candidate `imp8-v2-a5ce6f8ef59abb61` 绑定精确 minified hash `45a96d1c…2eea4`。63 张 Frozen 地图共 252 场 G10A 和 40 场 Discovery-only 技能回归全部 PASS；全量 259/259 测试通过。Gate fingerprint 为 `5171665c46fbeda15d14347b9f9cad90968a0140417855430451e2cbc7bb2eeb`，Acceptance fingerprint 为 `32bcaa77113083c907ad2ba51c1ef24f724a75825ae3d15724dc5c682d572dd1`。首个含诊断计数器的冻结 Candidate 已保留为不可变 `REJECTED`，未原地覆盖。详见 [IMP8 Overview](../implementation/imp8-overview.md)。

目标：从正确实现中选择生产参数，并冻结第一个真正Candidate。

顺序：

1. Discovery只发现规则、失败机制、性能热点和参数候选；
2. Calibration选择risk表、weights、depth、matrix/DFPN、cache/Arena、batch和fallback预算；
3. 写入Rule/Feature/Search/Runtime/Memory/Capability profiles；
4. 生成可重复BuildManifest；
5. 用目标v2 TankProfile确认skill并冻结CandidateManifest、publish artifact、Snapshot和TestPlan；
6. Candidate冻结后一次性运行全部G0–G9与G10A Frozen；结果不能回调该Candidate参数。

退出门：`CANARY_PUBLISH_ELIGIBLE`除服务器simulation、rollback/first-publish授权和外部publish授权外的本地条件全部PASS。任一失败产生新Discovery输入和新candidate，不原地修改旧manifest。

## 13. IMP9：官方Simulation与受控Canary

验收标准：`A9-01`至`A9-08`，见[IMP验收合同](imp-acceptance-contract.md#12-imp9-验收官方simulation与受控canary)。

实施状态：`OFFICIAL_SIMULATION_FAILED / ACCEPTANCE_REJECTED / NO_PUBLISH / NO_CHALLENGE`。IMP8 前置、实时 context/suite 清单、同 profile rollback、精确 Candidate hash 和隔离门均闭合；官方 cold-smoke 实际使用冻结字节，但在 3012ms 返回 timeout，零容忍 runner 立即停止，未生成 attestation。官方请求总数 2（GET context + POST simulate），publish/challenge 均为 0。`reconcile-simulation` 已把失败与两例未执行 case 固化为可重复报告。全量 271/271 测试通过，但 Exact Simulation 门 FAIL；最终 Gate fingerprint 为 `9fb49d4bc0cb37386b871e2714ed2bb40bd3bd99e000a111ea9b0f570ff5788d`，Acceptance 为 `REJECTED`，fingerprint `caa17fbcf392f2b2fbc140c8669c09b534c1b669289ac04954043219ad96f4a4`。该 Candidate 不具备发布资格。详见 [IMP9 Overview](../implementation/imp9-overview.md)。

失败后 Discovery 已完成冻结 V1/V2 的 244 场景、2 repetitions、4 variants 精确脚本成对诊断，共 1,952 局，并对 24 个分层失败保存可观测镜像。结果确认生产 PersistentPlan、InformationState 深搜、递归 ForcedWin 与平台 runtime fallback 仍有接线缺口；这些属于新 Candidate 的结构性输入，不改变 IMP9 `REJECTED`，也不能复用已观察集合为新 Frozen。详见 [V1/V2 精确脚本成对失败诊断](../implementation/v1-v2-exact-paired-failure-diagnostic.md)。

目标：使用用户新建v2 tank的独立key验证并仅在全部硬门通过后受控上传。

实施：

- 对Candidate的精确publish artifact字节运行强制服务器suite并生成SimulationAttestation；
- 核对TankProfile、Candidate、attestation和GET context的tank/skill/branch；
- 归档当前main作为`VERIFIED_BASELINE`；确无代码时只允许独立`FIRST_PUBLISH_NO_ROLLBACK`授权和扩大suite；
- publish前写intent并重算hash，POST结果后GET核对version/hash；网络歧义先reconcile；
- 只在用户显式授权后publish；本阶段不把canary称为release accepted；
- 预注册ForwardBatch与ChallengePlan，尚不根据中间结果调参数。

退出门：同一profile、同一精确hash达到`CANARY_PUBLISH_ELIGIBLE`并`PUBLISHED_VERIFIED`；错误key、错误tank、旧attestation、source/minified错配、跨profile rollback测试全部硬失败。

## 14. IMP10：Forward、最终验收与持续迭代

验收标准：`A10-01`至`A10-09`，见[IMP验收合同](imp-acceptance-contract.md#13-imp10-验收forward最终验收与持续迭代)。

目标：用已发布的同一hash取得真正未见平台证据，并形成可重复的后续版本流程。

实施：

- 按预注册plan触发挑战，遵守ownerScope限流和排名计分规则；
- ambiguous challenge先list/reconcile，不盲重试；
- 原子下载summary/events/raw，验证hash/schema/identity后提交Ledger；
- 关闭ForwardBatch，按profile、seat、map、skill、terminal和runtime分层评估；
- G10B/G11与G0–G9证据组成ReleaseEvidenceReport；
- PASS才标`RELEASE_ACCEPTED`；FAIL则停止新挑战，按预注册策略回滚或保留诊断，并把失败局加入下一Candidate Discovery；
- 后续v3/v4 tank只新增TankProfile，不复制或分叉平台脚本。

退出门：G0–G11非加权AND全部PASS；forward样本数与覆盖符合预注册门；无script error、timeout、identity/hash/artifact/ledger冲突；回滚演练或明确无基线事故流程已验证。

## 15. 首个实施批次

第一次代码工作只执行IMP0，不同时开始完整Minimax。建议提交顺序：

1. 工具链与目录；
2. canonical JSON/hash/schema/atomic artifact；
3. fixture与semantic/root比较器；
4. allocation/high-water/clock instrumentation；
5. 六层benchmark空骨架和零样本NOT_RUN；
6. IMP0 Overview与一致性审计。

IMP0通过后进入IMP1。用户创建v2 tank不是IMP0前置条件；但IMP1的v2 profile登记和IMP8 Candidate own-skill冻结必须等待真实context。
