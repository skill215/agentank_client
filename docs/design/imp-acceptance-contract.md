# IMP0–IMP10 实施阶段验收合同

状态：`ACTIVE / ACCEPTANCE_OWNER`，2026-07-16。本文是每个IMP阶段能否从“实现完成”转为“验收通过”的唯一判定合同。实施Overview、测试输出或开发者声明都不能自我批准。

## 1. 统一验收语义

每个阶段只有四种验收状态：

```text
NOT_RUN    尚未运行验收，或不存在完整证据。
BLOCKED    实现未被判错，但缺少合同要求的外部事实、授权或前置阶段验收。
REJECTED   任一必需标准失败、证据冲突、证据被篡改或阶段越界。
ACCEPTED   前一阶段已ACCEPTED，且本阶段全部必需标准逐项PASS。
```

禁止`PARTIAL_PASS`、加权平均、以胜率抵消硬失败，或把`BLOCKED`写成`ACCEPTED_WITH_WARNING`。阶段内部可以有`NOT_APPLICABLE`，但必须由本文预先允许；运行时不能为了过门临时改成N/A。

每次验收必须：

1. 由版本化脚本重跑当前阶段实现门，而不是读取人工口头结论；
2. 从内容寻址、不可变artifact读取证据，重算文件SHA-256和manifest fingerprint；
3. 验证测试分母大于0；零样本只能是本文明确允许的`NOT_RUN`；
4. 验证至少一个负向控制确实失败，防止测试/门本身失效；
5. 检查阶段没有提前实现或调用被禁止的外部mutation；
6. 生成机器可读`ImpAcceptanceReport`及人工Overview更新；
7. 任何证据缺失、hash不一致、schema错误或previous stage非ACCEPTED时拒绝/阻塞；
8. 验收报告自身按fingerprint内容寻址，不覆盖旧验收。

统一入口为：

```text
./tools/implementation-toolchain.sh accept --stage IMP<N>
```

尚未实现验收adapter的阶段必须返回`STAGE_ACCEPTANCE_NOT_IMPLEMENTED`，不能输出模拟的NOT_RUN报告。

## 2. 验收报告最低字段

```text
schemaVersion / acceptanceContractVersion
acceptanceContractSha256
stageId / status
previousStageAcceptanceFingerprint
sourceGate(relativePath/sha256/fingerprint)
criteria[criterionId/status/evidence]
evidenceArtifacts[relativePath/sha256]
blockers[]
fingerprint
```

最终状态是非加权AND：任一criterion FAIL即`REJECTED`；任一criterion BLOCKED且无FAIL即`BLOCKED`；否则才`ACCEPTED`。

## 3. IMP0 验收：工程骨架与性能护栏

前置：无。允许六个真实性能层为`NOT_RUN/ZERO_SAMPLES`，因为IMP0只验收runner和零样本语义；测试自身不得为零。

| ID | 必须验收的事实 | PASS条件 |
|---|---|---|
| A0-01 | 可复现工具链 | WSL Linux Node、npm、Ajv、ajv-formats、Terser和lockfile精确匹配；统一wrapper可执行 |
| A0-02 | 目录与历史兼容 | 全部owner目录存在；legacy记录只标迁移输入；新代码无固定历史局数；未移动/改写v1数据 |
| A0-03 | Artifact基础 | canonical/hash/atomic/revision/schema测试通过；同bytes幂等；不同bytes不能覆盖immutable evidence |
| A0-04 | Harness基础 | 固定seed、fixture raw/semantic hash、整数clock、allocation和high-water计数通过 |
| A0-05 | 六层入口 | 六层ID和顺序精确；每层零样本为NOT_RUN/ZERO_SAMPLES，不得PASS |
| A0-06 | 差分与恢复 | TypedArray semantic fingerprint、Reference/Fast报告schema、root mismatch负向控制通过 |
| A0-07 | 负向门有效 | 故意破坏schema、root、allocation、strip、import、零测试和immutable写入全部被拒绝 |
| A0-08 | Production边界 | allow/deny policy PASS；engine-v2/src尚无物理JS；productionSourceStatus=NOT_RUN |
| A0-09 | 无平台越界 | IMP0依赖图不能到达platform/profile网络模块；运行外部请求和mutation均为0 |
| A0-10 | 证据完整 | 实现门PASS且blocker=0；全部artifact位于history内容寻址路径并通过SHA/fingerprint复算 |

绝对拒绝：零测试PASS、任一immutable artifact hash不符、出现tank物理实现、任何真实平台请求、任一负向控制未出现或未通过。

## 4. IMP1 验收：多TankProfile与只读平台基线

前置：IMP0 ACCEPTED。真实context读取属于只读外部证据；缺少可用轮换key或平台不可用时为BLOCKED，不得跳过。

| ID | 必须验收的事实 | PASS条件 |
|---|---|---|
| A1-01 | Registry与目录 | v1/v2及未来profile schema/semantic有效；run/baseline/standing/import物理隔离 |
| A1-02 | Secret边界 | key只从secretRef解析；registry、参数、日志、response、artifact和replay扫描0泄漏 |
| A1-03 | 强制身份 | 每个活动profile真实GET context核对tankId/tankUrlId/skill/branch；首次绑定有expected tankId二次确认 |
| A1-04 | 错key与轮换 | wrong-key、cross-profile、key换绑另一tank、stale generation全部硬失败 |
| A1-05 | 共享限流 | 同ownerScope不同key共享2秒scheduler；服务器nextSimulationAt只能延长 |
| A1-06 | Baseline与能力 | 每profile/branch保存脱敏context、main baseline和CapabilityProfile；UNKNOWN不被猜值替代 |
| A1-07 | 只读边界 | fake transport/dry-run通过；真实publish/challenge命令不可达，平台mutation=0 |
| A1-08 | 故障与恢复 | registry并发/原子写/损坏/中断、context不一致和secret fault tests通过 |

绝对拒绝：任一key持久化、profile串用、按key绕过owner限流、未核对context就绑定或任何平台mutation。

## 5. IMP2 验收：规则输入、状态模型与ReferenceKernel

前置：IMP1 ACCEPTED。

| ID | 必须验收的事实 | PASS条件 |
|---|---|---|
| A2-01 | 输入与状态可表达 | ObservedRoot、TrackedState、Physical/InformationState和多实体ID可表示全部reachable输入 |
| A2-02 | 唯一Reference语义 | Observation、Entity association、Scheduler、Timeline、Terminal和八技能由独立Reference实现 |
| A2-03 | RuleCorpus闭合 | confirmed/common/variant/unsupported逐条有provenance；UNKNOWN不升级strict |
| A2-04 | Canonical trace | 128帧、同星对枪、runtime、互毁、bomb/projectile/skill复合可重放且hash稳定 |
| A2-05 | 技能事实 | Guide/Update/平台replay优先级正确；shield两次、overload多弹等历史冲突有明确仲裁 |
| A2-06 | 外部模拟器边界 | framework/simulator只生成候选；冲突不覆盖平台事实；commit固定 |
| A2-07 | 官方规则probe | reachable R0/R1未知有最小官方simulate证据，或阶段明确BLOCKED而非猜测 |
| A2-08 | G1实现门 | 所有G1 fixture、schema、replay和negative rule tests通过，分母明确 |

绝对拒绝：Reference/Fast共享转换实现、规则UNKNOWN被默认值填充、模拟器结果冒充平台真值。

## 6. IMP3 验收：FastKernel、Hazard与硬失败层

前置：IMP2 ACCEPTED。

| ID | 必须验收的事实 | PASS条件 |
|---|---|---|
| A3-01 | 物理布局 | TypedArray SoA、Arena、handle generation、显式stack符合MemoryCapacityManifest |
| A3-02 | Apply/undo | 每fixture/每fault root全字段恢复；root mismatch=0、stale read=0 |
| A3-03 | Reference差分 | exact/common逐字段mismatch=0；unsupported无部分mutation |
| A3-04 | Hard逐动作 | 每action在评分前完成apply→Terminal/Hard→undo；Hard incomplete不被当safe |
| A3-05 | 持久危险 | projectile/bomb多实例持续到规范失效；Committed closure不受search depth截断 |
| A3-06 | Reverse死亡链 | 禁入格、ReverseViability和Exact Narrow Phase与独立oracle一致 |
| A3-07 | 容量故障 | FACT/SUPPORT/SEARCH/OUTPUT overflow全部fail closed；cache full只MISS/recompute |
| A3-08 | 性能结构 | 声明热循环instrumented allocation=0；循环上界、bytes和high-water有报告 |
| A3-09 | G2/G3/G4核心 | terminal/hard false result=0；对应release gate实现证据通过 |

绝对拒绝：任何Hard假阴性/假阳性、实体静默截断、root恢复失败、危险实体提前消失。

## 7. IMP4 验收：Value、Matrix、Proof与Risk搜索

前置：IMP3 ACCEPTED。

| ID | 必须验收的事实 | PASS条件 |
|---|---|---|
| A4-01 | Value bounds | 每个深层结果含sound lower/upper、complete和原因；incomplete不升级exact |
| A4-02 | 量词分离 | EnemyAction、HiddenWorld、ChanceOutcome在穷举小状态与metamorphic tests中量词正确 |
| A4-03 | Matrix | 根/关键节点full best response无漏行；Double Oracle gap/complete一致 |
| A4-04 | Information Proof | AND/OR/DFPN ForcedWin/Nonloss/Loss有CoverageCertificate；false positive=0 |
| A4-05 | 可躲射击 | 开枪后可躲与近距不可躲由timeline/closure证明，不以“已开火”直接判死 |
| A4-06 | Robust Risk | epsilon-contamination递归backup实现；risk 0–100单调且不能越过Hard/Proof |
| A4-07 | Budget同义 | normal/fallback仅缩减预算；相同完成horizon语义fingerprint一致，不使用MCTS |
| A4-08 | Oracle验证 | 穷举/高精度oracle/property覆盖interval、proof、policy、risk；strategy fusion=0 |

绝对拒绝：Proof假阳性、pure bound伪exact、per-row best response漏洞、risk改变硬结论。

## 8. IMP5 验收：评分、策略、对手、技能与Plan软层

前置：IMP4 ACCEPTED。

| ID | 必须验收的事实 | PASS条件 |
|---|---|---|
| A5-01 | 整数评分 | FeatureRegistry、raw/weight、范围、dependency mask和成本完整；无语义float数组 |
| A5-02 | 可调一致性 | 每动作/plan分数可独立配置；Table/Generated raw与score逐项一致 |
| A5-03 | 动态策略 | 阶段/对手/局面切换与hysteresis fixture通过，无每帧抖动 |
| A5-04 | 对手模型 | 仅本局事件更新开火、移动、转向、拿星、技能和risk preference；归一化且不改我方参数 |
| A5-05 | 技能专门化 | own skill direct emitter与enemy八descriptor lookup成对fixture通过 |
| A5-06 | Plan生命周期 | Shot/Bomb/Skill/Information Plan finalist才持久化；每次继续前重新Hard验证 |
| A5-07 | Hidden风险 | grass/cloak/belief path、盲射/bomb/远离等只进入PossibleHazard/robust risk |
| A5-08 | Strict隔离 | 任意weight/strategy/opponent/risk变化不改变Terminal/Hard/strict Proof指纹 |
| A5-09 | 性能门 | 每个feature/plan/opponent update有bytes、P95/P99和allocation报告 |

绝对拒绝：OpponentModel跨局调我方策略、软分数覆盖Hard、hidden猜测升级必死/必胜。

## 9. IMP6 验收：缓存、Runtime与Production Build

前置：IMP5 ACCEPTED。

| ID | 必须验收的事实 | PASS条件 |
|---|---|---|
| A6-01 | 11个缓存 | canonical id/key/version/signature/collision/lifecycle完整；cache-off语义一致 |
| A6-02 | 精确失效 | projectile/bomb/plan缓存到物理失效；terrain/entity/deadline/dependency仅失效所需范围 |
| A6-03 | Runtime | 累计clock；>=1500ms永久FALLBACK；Emergency reserve独立；3秒附近不投机 |
| A6-04 | 缩减Minimax | fallback depth/nodes由benchmark选，Hard/Terminal/closure不可缩减 |
| A6-05 | 可重复构建 | 相同输入source/minified/BuildManifest hash一致；Terser/options精确固定 |
| A6-06 | Production strip | Reference/replay/simulator/v1/log/命名数据和forbidden constructs为0 |
| A6-07 | Source/minified | 全字段semantic differential=0；无Math.imul sandbox parse/init/fixture通过 |
| A6-08 | 六层性能 | 六层均有非零分母或按合同BLOCKED；报告P50/P95/P99/max、allocation/high-water/bytes |
| A6-09 | Reserve/bytes | cold init、callback max、arena和exact UTF-8 bytes满足预注册本地/平台能力门 |
| A6-10 | G4/G7/G9 | release gate对应实现证据全部PASS，未知平台限制保持blocker |

绝对拒绝：cache改变语义、fallback变贪心/蒙特卡洛、source/minified不一致、3秒安全reserve失败。

## 10. IMP7 验收：动态历史、窗口与双向反事实

前置：IMP6 ACCEPTED。

| ID | 必须验收的事实 | PASS条件 |
|---|---|---|
| A7-01 | 动态Ledger | 扫描数量来自artifact，不写死历史局数；追加、重复、迟到和重建稳定 |
| A7-02 | Profile隔离 | 每entry有subjectTankProfileId；跨profile报告分层，不混分母 |
| A7-03 | Legacy保护 | 已冻结legacy roots不变；skill/runtime/terminal缺失保持UNKNOWN而非0/默认 |
| A7-04 | L0–L4 | script/runtime/artifact错误先分类；死亡/获胜窗口和事件指标可复现 |
| A7-05 | Truth/Observed | policy只见ObservedTrack；hidden truth leakage=0；分叉后suffix不再消费 |
| A7-06 | 双向反事实 | 我方和历史敌方分别搜索可避免性，使用同一量词和规则假设 |
| A7-07 | 正向保护 | Kill/Escape/Bomb/Skill/Endgame正向窗口不因安全修改系统性回退 |
| A7-08 | 污染故障 | duplicate/conflict/partial download/schema/provenance fault tests全部fail closed |
| A7-09 | G5/G6 | 语料和分析release gate实现证据完整，所有分母可追溯到Snapshot/Cohort |

绝对拒绝：把历史单局升级Hard/Proof、分叉后使用真实后缀、v1胜负计入v2候选分母。

## 11. IMP8 验收：校准、构建冻结与本地候选

前置：IMP7 ACCEPTED。

| ID | 必须验收的事实 | PASS条件 |
|---|---|---|
| A8-01 | 三段隔离 | Discovery、Calibration、Frozen数据/代码路径隔离；Frozen结果不能回调参数 |
| A8-02 | 参数来源 | risk/weights/depth/cache/Arena/batch/fallback均有benchmark/calibration provenance |
| A8-03 | Profile冻结 | Rule/Feature/Search/Runtime/Memory/Capability指纹闭合，无浮动latest输入 |
| A8-04 | Build可重现 | 重建source/minified/BuildManifest逐byte一致，strip/differential/bytes门PASS |
| A8-05 | Candidate身份 | Candidate绑定真实v2 profile/tank/skill/branch及精确publishArtifactSha256 |
| A8-06 | Snapshot/TestPlan | Frozen Snapshot、Cohort和预注册TestPlan不可变，分母与阈值在运行前冻结 |
| A8-07 | 本地总门 | G0–G9和G10A非加权AND全部PASS；Hard/Proof/root/runtime错误为0 |
| A8-08 | 外部边界 | 仅服务器simulation、rollback/first-publish和用户publish授权保持BLOCKED |

绝对拒绝：冻结后调参、Candidate跨profile、source测试后选择另一minified、任何本地门被胜率抵消。

## 12. IMP9 验收：官方Simulation与受控Canary

前置：IMP8 ACCEPTED；真实外部操作必须具备用户授权。缺授权为BLOCKED，不得伪造通过。

| ID | 必须验收的事实 | PASS条件 |
|---|---|---|
| A9-01 | Exact simulation | 强制suite显式携带Candidate精确publish bytes；attestation hash/profile/skill/branch一致 |
| A9-02 | Suite资格 | bot/map/capability来自实时context；cold smoke不能无记录删除；429不能跳过 |
| A9-03 | Rollback | 当前main归档为VERIFIED_BASELINE；无基线走独立first-publish授权和扩大suite |
| A9-04 | Publish授权 | intent已落盘、candidate hash重算、显式用户authorization存在后才允许POST |
| A9-05 | 发布对账 | POST后GET context核对version/hash；response lost/409先reconcile不盲重试 |
| A9-06 | Profile隔离 | wrong key/tank/stale attestation/source-minified错配/cross-profile rollback全部硬失败 |
| A9-07 | Canary状态 | 同一精确hash达到CANARY_PUBLISH_ELIGIBLE和PUBLISHED_VERIFIED；尚不称release accepted |
| A9-08 | 无意外挑战 | 本阶段未授权challenge为0；Forward/ChallengePlan已经预注册且不可回调参数 |

绝对拒绝：未simulate精确上传字节、无授权发布、POST歧义时盲重试、发布到错误tank。

## 13. IMP10 验收：Forward、最终验收与持续迭代

前置：IMP9 ACCEPTED。

| ID | 必须验收的事实 | PASS条件 |
|---|---|---|
| A10-01 | 预注册Forward | opponent/map/seat/skill/样本数/停止规则在首局前冻结；中途不调参 |
| A10-02 | Challenge安全 | 每次显式ranked授权；published hash一致；计分约束检查；歧义先list/reconcile |
| A10-03 | Artifact完整 | summary/events/raw/frames、双方codeHash、mapHash和context原子下载并验证 |
| A10-04 | Ledger闭合 | match唯一、profile正确、watermark/Head/Snapshot可重建，无污染或重复计数 |
| A10-05 | Forward质量 | G10B分母/覆盖达到预注册门；script error、timeout、identity/hash冲突为0 |
| A10-06 | 全局总门 | G0–G11全部PASS，非加权AND；没有NOT_RUN/BLOCKED被误算通过 |
| A10-07 | 事故/回滚 | 失败停止新挑战并按预注册策略回滚/保留；回滚同样绑定合格attestation精确hash |
| A10-08 | Release证据 | ReleaseEvidenceReport引用全部不可变证据，最终状态唯一为RELEASE_ACCEPTED或REJECTED |
| A10-09 | 后续版本 | v3/v4只新增TankProfile和新Candidate/Run，不复制/分叉控制面脚本 |

绝对拒绝：中途看结果调参、重复排名赛、未发布hash参战、任一G门缺证据仍宣称release。

## 14. 阶段验收顺序

```text
IMP0 ACCEPTED
  -> IMP1 ACCEPTED
  -> IMP2 ACCEPTED
  -> IMP3 ACCEPTED
  -> IMP4 ACCEPTED
  -> IMP5 ACCEPTED
  -> IMP6 ACCEPTED
  -> IMP7 ACCEPTED
  -> IMP8 ACCEPTED
  -> IMP9 ACCEPTED
  -> IMP10 ACCEPTED == RELEASE_ACCEPTED
```

如果后续发现已验收阶段的不可变证据损坏或语义合同被推翻，所有依赖该fingerprint的后续验收自动失效，必须从最早受影响阶段重新验收；不得只重跑最终阶段。
