# DD0–DD10 最终实施就绪审计

状态：`IMPLEMENTATION_READY / RELEASE_NOT_READY`，2026-07-16。本审计是进入v2实施前的最终设计检查；它不把“设计可实施”误写成“代码已通过”或“可以发布”。

权威：设计域服从[design-authority.md](design-authority.md)，当前发布门服从[release-gate-report.md](release-gate-report.md)，实施顺序服从[implementation-plan.md](implementation-plan.md)。

## 1. 结论

DD0–DD10已经具备开始实施所需的结构、接口、算法、性能边界、错误语义、数据血缘和验证门。最终复核没有发现以下级别的剩余问题：

- 状态无法表达；
- 同一概念存在两个活动owner；
- Hard、Proof、Risk或Eval量词互相覆盖；
- Reference与Fast无法共享规则语义；
- fallback改变硬失败/终局语义；
- 多tank/key无法安全区分；
- build、simulate、publish和forward无法绑定同一代码字节；
- 历史对局增长会改变已冻结分母。

因此可以进入实施。当前仍不能发布，因为v2代码、平台能力实测、benchmark-selected数值、Frozen执行、服务器simulation和Forward证据尚不存在。

## 2. 本次最终审计范围

检查了：

1. DD0–DD10 owner、术语、DEC/OI和阶段依赖；
2. PhysicalState/InformationState、Observation、Entity、Action/Event/Result ABI；
3. Terminal、Hard、Forced Proof、Value bounds、Matrix和Risk量词；
4. 地图、projectile、bomb、技能、计划与缓存生命周期；
5. 单线程整数TypedArray、显式栈、make/undo、fallback和3秒总时限；
6. v1、滚动历史、反事实、External Simulator与官方平台证据边界；
7. source/minified构建、manifest血缘和发布字节同一性；
8. v1、v2及未来TankProfile的key、identity、限流、目录、分母和回滚隔离；
9. JSON解析、Draft 2020-12 schema本身及DD10最小合法实例。

## 3. 最终发现与修正

| ID | 发现 | 风险 | 已修正的规范 |
|---|---|---|---|
| FA-01 | 平台脚本隐含单key/单tank | v2或未来tank误发布、误下载、误回滚 | 非密钥TankProfile Registry；mutation强制显式profile；每次调用核对GET context |
| FA-02 | Build/Candidate/Run字段重复但缺唯一血缘 | 测试结果引用错误候选 | Build→Candidate→Run→Evidence唯一owner、canonical hash与revision链 |
| FA-03 | source通过simulation后可能上传minified | 服务器验证的不是实际字节 | SimulationAttestation和publish同时绑定`publishArtifactSha256` |
| FA-04 | rolling corpus主要依赖文字格式 | 多导入器可产生不兼容Head/Snapshot | 六类语料对象机器schema与semantic validator职责冻结 |
| FA-05 | 平台run目录按profile，rolling合同仍为全局run目录 | v1/v2 artifact路径冲突 | 统一为`tanks/<tankProfileId>/runs/<runId>`；全局Ledger逐entry带profile |
| FA-06 | “必须有rollback”与全新tank可能无旧代码冲突 | 合法首次发布无法进入门，或被随意豁免 | 优先归档main；确无基线才允许独立授权的`FIRST_PUBLISH_NO_ROLLBACK` |
| FA-07 | 多key可能被当作独立限流主体 | 绕过用户级2秒限制 | 以`ownerScopeId`共享调度；未知关系进入保守共享scope |
| FA-08 | Frozen和历史数字易被实现写死 | 新对局加入后门限漂移或失真 | 分母从Snapshot/Cohort派生；244/63只属于不可变历史快照 |
| FA-09 | schema无法表达所有跨对象等式 | profile、hash、watermark虽结构合法但语义冲突 | 明确schema之后必须执行fingerprint、identity、排序、唯一性和watermark semantic validation |
| FA-10 | Build own skill可能来自命令行猜测 | 为新tank生成错误专门化bundle | TankProfile先以平台context确认skill；Candidate验证target skill等于Build own skill |
| FA-11 | Build/Candidate派生ID被表述为参与自身fingerprint | 形成不可计算的hash自引用循环 | fingerprint payload排除纯派生buildId/candidateId，再由fingerprint生成ID；DEC-0090 |
| FA-12 | 重复的平台流程若依赖手工重拼命令 | WSL运行时、步骤顺序、错误处理和证据格式会逐次漂移 | 唯一版本化入口、幂等子命令、聚合verify门和入口回归测试；DEC-0091 |
| FA-13 | 六层Benchmark的第六层在文档间分别指replay与platform | 报告分母和退出门不可比较 | 固定六个性能层，replay独立；DEC-0092 |
| FA-14 | 旧battle-records根布局没有TankProfile字段 | 自动迁移会把未知归属伪装成v1证据 | 原地只读，动态盘点，IMP7显式迁移；DEC-0093 |

上述问题已写回活动合同、schema、Decision Register和Open Issues Register，不再是未登记口头约定。

## 4. 实施就绪矩阵

| 领域 | 设计状态 | 是否可开始实现 | 进入下一门前仍需完成 |
|---|---|---|---|
| 平台规则与Timeline | READY_WITH_VARIANTS | 是 | reachable R0/R1 variant按RuleCorpus校准或保持规范unsupported |
| State/Observation/Entity/ABI | READY | 是 | Reference fixture和容量实测 |
| 地图/Fast/Hazard/Hard | READY | 是 | Reference/Fast全字段差分、undo与fault injection |
| Value/Matrix/Proof/Risk | READY | 是 | small-state oracle、interval soundness和零Proof假阳性 |
| Eval/Strategy/Opponent/Skill/Plan | READY | 是 | Discovery/Calibration选整数参数，Frozen后禁止回调 |
| Cache/Runtime/Fallback | READY_FOR_BENCHMARK | 是 | 11 cache实测、平台P99、reserve和容量选择 |
| Production build | READY | 是 | 可重复source/minified、strip、bytes和capability sandbox |
| 历史/反事实 | READY | 是 | 动态导入、provenance迁移、双向counterfactual运行 |
| 多TankProfile平台控制面 | READY | 是 | registry/secret adapter、双profile和轮换fault tests |
| 发布证据 | CONTRACT_COMPLETE | 否，仅可实现 | G0–G11真实证据、授权与平台Forward |

## 5. 未关闭项为什么不阻止开始实施

以下未决项是显式校准或发布门，不是架构缺口：

- R0/R1有限RuleVariant：Reference可表达，Fast在未确认依赖处返回unsupported/incomplete，不能生成严格Proof；
- R2概率：support已知时Proof穷举，Value保持概率区间，不伪造exact expected；
- risk曲线、weights、depth、cache/Arena容量：只由实现后的Discovery、Calibration和六层benchmark选择；
- 平台字节上限、冷启动、hash规范化与幂等性：进入CapabilityProfile，未知时阻止相关mutation或发布；
- 新v2 tank的tankId和own skill：由用户创建后用其TankProfile的GET context确认，不由文档猜测。
- WSL2原生Linux Node v24.16.0、npm 11.13.0、package/lockfile和版本化wrapper已经建立；非交互shell不加载NVM的差异由wrapper吸收，不允许文档或自动化绕过wrapper假定`node`可见。

实现可以从这些边界开始；任何模块若绕过unknown/incomplete而写入默认真值，属于实现失败，不属于设计许可。

## 6. 实施期间不可回退的约束

- v2不得导入v1搜索或物理实现；v1只作离线fixture、行为基线、回归对手和Discovery证据；
- 热路径不创建临时对象，不使用浮点语义数组、递归调用栈、Map/Set、Promise、Worker或平台不存在的API；
- Fast性能优化只能在Reference差分与root restore保持全等时启用；
- 每个action在评分前完成apply→Terminal/Hard→aggregate→undo；
- fallback只减少预算，不删除Hard、Terminal、committed hazard closure或root一致性；
- Build可以按相同skill复用，Candidate、Simulation、Forward和rollback不得跨TankProfile复用；
- key值不得进入源码、参数、registry、manifest、日志、replay或聊天记录；
- 每个实施阶段完成后必须生成Overview和一致性复核，未登记偏差不得进入下一阶段。

## 7. 最终判定

```text
DETAILED_DESIGN = COMPLETE
DESIGN_CONFLICTS_BLOCKING_IMPLEMENTATION = 0
IMPLEMENTATION_HANDOFF = APPROVED
IMPLEMENTATION = NOT_STARTED
PLATFORM_RELEASE = NOT_ELIGIBLE
```

下一步按[implementation-plan.md](implementation-plan.md)从IMP0开始，不直接从完整Minimax或平台publish开始。
