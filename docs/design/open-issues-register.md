# 详细设计未决问题登记

状态：DD10 同步版，2026-07-16。详细设计冲突均已关闭或显式参数化；这里的OPEN/DECIDED实施项仍会阻塞相应发布门。

## 1. 分类与状态

- `R0`：改变状态转换拓扑，阻塞 DD1–DD5 或生产 FastKernel。
- `R1`：改变实体/技能状态机，最迟 DD4 冻结 support。
- `R2`：support 已知后的概率问题；Proof 覆盖 support，Value 使用区间。
- `R3`：策略、容量、性能参数，由 Benchmark 校准。
- `ARCH`：不是平台规则未知，而是现有设计合同冲突或未完成。
- `PLAT`：平台API、能力和离线运行流水线。
- 状态：`OPEN`、`EVIDENCE_FOUND`、`VARIANT_DEFINED`、`PARTIALLY_CLOSED`、`DECIDED`、`CLOSED`。`VARIANT_DEFINED` 表示已有限枚举但平台事实仍待校准；`PARTIALLY_CLOSED` 表示主规则已有平台证据、剩余边界已拆成显式variant；`DECIDED` 表示语义/架构方案已选，仍等待目标 prototype/benchmark 验证。只有规则、合同和 fixture/benchmark 同步后才可 CLOSED。

## 2. R0：结构规则

| ID | 状态 | 问题 | 已有证据/冲突 | 目标与未解决行为 |
|---|---|---|---|---|
| OI-R0-001 | CLOSED | `onIdle`、command queue、action slot、`go(n)` 与复合动作的精确调度 | Guide + replay；[action-scheduler-contract.md](action-scheduler-contract.md) 分离 program/queue/executed action，并定义 boost 复合执行 | DD2 只冻结整数 ABI；语义已关闭 |
| OI-R0-002 | CLOSED | seat/initiative 与双方 action 的顺序/同时性 | 9,642 个双 seat action frame 全为 seat0→seat1；freeze 提供即时后手效应证据 | 主 phase 唯一；joint strategy 节点仍按 simultaneous 信息结构求解 |
| OI-R0-003 | CLOSED | bullet 创建帧、每帧两 substep、逐 substep 碰撞和事件顺序 | 3,103 条 `0,1` 轨迹；1,078 个创建同帧先 create 再 move | 基本 projectile phase 已关闭；共享资源争用归 OI-R0-009 |
| OI-R0-004 | VARIANT_DEFINED | 同时移动、同格、交换位置、迎面碰撞和阻挡 | 主 seat action 顺序已知；占格、swap 和 crash 仍缺定向平台证据 | DD1 定义 `SEQUENTIAL_BLOCK`、`INTENT_BLOCK`、`COLLISION_CRASH` 三个有限 variant；DD4 校准 |
| OI-R0-005 | CLOSED | effect expiry、bomb、双方 action、bullet、terrain、star、observation、terminal 的 FrameTimeline | 平台 replay 冻结 expiry→star spawn→poll→seat0→seat1→star collect→projectile→bomb→terminal；外部模拟器 bomb-before-action 被否定 | [frame-timeline-contract.md](frame-timeline-contract.md) 为规范；边缘冲突拆到独立 issue |
| OI-R0-006 | VARIANT_DEFINED | bomb 的创建、引信 deadline、爆炸批处理和同帧 damage/map 顺序 | 38 个 placed→exploded 样本均相隔 10 record frames；爆炸在动作和 projectile 后，且移动可进出 blast | 主时序关闭；多 bomb 同 phase 的 hit/map 批处理保留有限 variant，DD4 校准 |
| OI-R0-007 | VARIANT_DEFINED | star 收集、重生、同帧双方到达和终局先后 | 345 次收集均在 action 后、projectile 前；228 个 respawn 样本均相隔 10 record frames | 主时序关闭；同格争夺和生成位置/chance 保留有限 variant，未来星不进 Hard/Proof |
| OI-R0-008 | VARIANT_DEFINED | 128-record、星差、同星 runtime、timeout/runtime、同时击毁的终局顺序 | 主优先级与 recordIndex127 完整执行后 terminal 已确认；未出现固定星数提前胜利 | 只剩 runtime exact tie 与 3 秒 comparator variants；命中精确边界时 UNKNOWN_RULE |
| OI-R0-009 | VARIANT_DEFINED | bullet crossing、同时命中同一土堆/盾/坦克的顺序 | 用户确认 bullets 穿过；329 个多 projectile frame 未足以唯一恢复共享资源顺序 | crossing 固定穿过；共享资源保留 `SEQUENTIAL_PLATFORM_ORDER` / `SUBSTEP_BATCH` 两个有限 variant，DD4 再校准内部实体顺序 |
| OI-R0-010 | VARIANT_DEFINED | observation 生成时点和 runtime 数据完整形状 | Guide 暴露单数 `enemy.bullet`、数组 `game.bombs`；内部必须多实体；callback frame 与 recordIndex 已分离 | DD2 已冻结 set-valued reconciliation、字段语义和 incomplete；多 visible bullet 的平台选择 relation 仍由 DD4 校准 |
| OI-R0-011 | CLOSED | 每条 UNKNOWN/RuleVariant 在正式构建中的行为 | [rule-corpus-schema.md](rule-corpus-schema.md) 已给出 Reference/Value/Proof/Fast/emitter 行为矩阵 | DD4 manifest 必须逐规则实例化；缺声明直接阻塞构建 |

## 3. R1：技能与实体状态机

| ID | 状态 | 问题 | 已有证据/冲突 | 目标与未解决行为 |
|---|---|---|---|---|
| OI-R1-001 | CLOSED | shield 两次 bullet hit、bomb 消耗、持续/到期和同帧多 hit | Update/Guide + 平台单 hit 后 shield 保留 fixture；2 charges 与 bomb 全消费已冻结 | 同 substep 多 hit 顺序归 OI-R0-009 variant，不再是 skill support 缺口 |
| OI-R1-002 | CLOSED | overload 两弹的起点、方向、ID、可见性与独立失效 | 五个 replay 确认 member0 同 cell、member1 固定正轴垂直偏移、同向、独立 ID/失效 | singular observation 由 set-valued relation 处理；几何可用于 strict fixture |
| OI-R1-003 | VARIANT_DEFINED | freeze 施放帧、持续、后手影响、queue 保留和 ready frame | seat 时序与 2 帧/queue hold 已确认 | empty queue poll 与 ready 精确边界显式 variant；依赖时 unsupported，DD5 可实现 common path |
| OI-R1-004 | CLOSED | stun 对 turn/go/其他 command 的 outcome support | Guide 限定 turn/movement controls；GO/TURN normal/reversed，FIRE/BOMB/SKILL 无 inverse 因而 normal | 概率独立归 OI-R2-001；universal support 可用于 Proof |
| OI-R1-005 | PARTIALLY_CLOSED | poison cadence、queue 行为和 ready frame | duration4/cooldown20及30个完整样本的相对`ACT-HOLD-ACT-HOLD`已确认；HOLD不出队 | 仅empty queue same-frame repoll/ready边界保留variant；依赖时Value interval、Proof/Fast incomplete |
| OI-R1-006 | VARIANT_DEFINED | teleport 合法目标、到星邻格、拿星锁、近敌 fire lock、草中显形的精确 deadline | action/landing support 与两类 lock confirmed；landing probability/reveal deadline 未定 | universal landing Proof 可用；reveal deadline 相关 branch incomplete |
| OI-R1-007 | VARIANT_DEFINED | cloak/grass 下 tank、bullet、bomb 的隐藏、再观察和关联 | DD2 relation + Guide/Updates visibility 已落 corpus | teleport reveal deadline 影响后续可见性时返回 incomplete；实体保留到物理失效 |
| OI-R1-008 | VARIANT_DEFINED | boost 两格移动、首次免费 turn、复合 `turnGo/turnFire` 和过期队列 | queued suffix 同帧继续已确认 | queue 变空后的 same-frame repoll 仍为 variant；common compound 可进 DD5 |
| OI-R1-009 | VARIANT_DEFINED | fire/bomb/teleport 的失败动作是否消耗 slot/cooldown及观测 | invalid teleport 消耗 cooldown confirmed；其他 family 没有逐项证据 | family-specific variant；未确认 family 依赖时 unsupported |

## 4. R2：概率规则

| ID | 状态 | 问题 | 已有证据 | 目标与未解决行为 |
|---|---|---|---|---|
| OI-R2-001 | OPEN | stun 正常/反向概率 | 模拟器 50/50，仅为 EXTERNAL_SIM_MATCH | DD4 平台样本；Proof 穷举 support，Value 用概率区间 |
| OI-R2-002 | OPEN | teleport 到星相邻合法格的分布 | 模拟器均匀；平台未确认 | DD4；Proof 覆盖全部合法格，Value 不返回 exact Expected |
| OI-R2-003 | OPEN | future star 位置/时间分布 | 本地随机生成器明确不匹配平台分布 | 只进 DD7 StarSpawnModel；永不进入 Hard/ForcedWin，除非规则确认 |

## 5. R3：策略与性能参数

| ID | 状态 | 问题 | 已有证据 | 目标 |
|---|---|---|---|---|
| OI-R3-001 | DECIDED | 0–100 risk 到 epsilon/feature 的定点曲线 | DD6冻结chance/hidden/enemy三维0–9900表、risk=0/100端点与单调性；具体state class数值未校准 | v2实现后以Discovery/Calibration选择；Frozen/Forward禁止调参，G8前需CLOSED |
| OI-R3-002 | DECIDED | 对手风险喜好、开火/移动/技能概率和 confidence 更新 | DD7冻结opportunity/choice、fast/slow、confidence、多维risk与整数action policy；framework profiler仍不作真值 | v2离线runner以Calibration选择alpha/阈值；只影响软层，G8前需CLOSED |
| OI-R3-003 | DECIDED | 搜索深度、候选、matrix/DFPN预算和fallback深度 | DD8冻结normal/fallback语义与benchmark选择协议；fallback不固定2且仍Minimax | composite/full-game/platform profile写BENCHMARK_SELECTED数值；G7/G8前需CLOSED |
| OI-R3-004 | DECIDED | 累计预算、1.5/2.5/约3秒目标、检查批次和EmergencyReserve | 当前无已确认安全墙钟；以build/hash绑定的整数work counter校准1500/2500ms等价门，单callback另有官方1500ms watchdog；v1硬节点上限作为证据 | charge/batch/reserve由source/minified平台P99验证；任何timeout或缺失匹配CalibrationProfile阻塞G7/发布 |
| OI-R3-005 | DECIDED | TypedArray/packed Array、WorldSnapshot/WorldDelta、递归/显式栈、容量 | DD3 两档真实垂直切片选择 immutable delta + TypedArray SoA + explicit stack；容量档仍非平台上限 | production source/minified与平台引擎复核；G4/G9前需CLOSED |
| OI-R3-006 | DECIDED | evaluator feature、整数范围、dependency mask 与快速调分 | DD7冻结FeatureRegistry、64-bit mask、cost tier、raw/weight分离与Table/Generated同语义 | 实现A/B选Table/Generated，Calibration选weights；G6/G8前需CLOSED |
| OI-R3-007 | DECIDED | cache容量、替换、碰撞核验和生命周期 | DD8冻结11 canonical cache、keys/cutoff/collision/lifecycle/off语义；数值容量未猜 | 实现benchmark写BENCHMARK_SELECTED manifest；G4/G7前需CLOSED |
| OI-R3-008 | OPEN | 平台 JavaScript 剩余能力、冷启动、脚本字节上限与 source/minified 性能 | 真实SCRIPT_ERROR确认`Math.imul`缺失；Uint16Array/Uint32Array可用；官方probe确认`performance/setTimeout`缺失、公开root无累计runtime、单callback watchdog约1500ms；`Date.now`正式状态仍为UNKNOWN | versioned capability/calibration profile + platform upload/profile；未知字节/语法/整局精确比较与source/minified性能仍阻塞G7/G9/发布 |

## 6. PLAT：平台运行与证据流水线

| ID | 状态 | 问题 | 已有证据/决策 | 关闭条件 |
|---|---|---|---|---|
| OI-PLAT-001 | CLOSED | 生产hash能否依赖`Math.imul` | `mat_ANGK6T283KC1fRBvV`第一帧真实SCRIPT_ERROR；DEC-0080禁止生产依赖 | shift/add实现及“无Math.imul sandbox”已进入强制合同；规则事实关闭，执行测试归G9/G11 |
| OI-PLAT-002 | DECIDED | 对局持续增加时如何去重、冻结分析输入和防止角色泄漏 | DEC-0078；MatchLedger/CorpusHead/CorpusSnapshot/CohortAssignment已冻结 | 实现append-stable ledger、原子ingest、snapshot重建和污染测试后CLOSED |
| OI-PLAT-003 | DECIDED | 触发simulation、发布、挑战、下载和分析缺少统一可恢复入口 | DEC-0082/0083；[platform-operations-contract.md](platform-operations-contract.md)冻结函数/CLI/RunManifest | runner实现、fault injection、resume/reconcile和端到端dry-run通过后CLOSED |
| OI-PLAT-004 | OPEN | API幂等性、精确限流窗口、publish/challenge未知结果的服务器行为 | Guide给出主要endpoint、400/401/429及`nextSimulationAt`，但没有完整幂等保证 | 定向操作校准并写CapabilityProfile；在未知期间使用单写锁、GET核对和reconcile，不自动重复mutation |
| OI-PLAT-005 | DECIDED | v1、v2及未来tank使用不同key时，脚本身份、轮换、限流与回滚边界未定义 | DEC-0086至0089；非密钥TankProfile Registry、显式profile、context核验、ownerScope锁和首次发布例外已冻结 | registry/secret adapter、双profile端到端dry-run、key轮换与first-publish fault test通过后CLOSED |

## 7. ARCH：详细设计阻碍与现有冲突

| ID | 状态 | 冲突/缺口 | 影响 | 关闭条件 |
|---|---|---|---|---|
| OI-ARCH-001 | CLOSED | InformationState 的 hidden tank × projectile × bomb × command 联合存储尚不可实现；全局 make/unmake 会覆盖并存 world | DD2/DD3 | DD3 以 immutable exact delta worlds + lossless residual + branch scratch 通过两档复合 oracle；见 DEC-0039/0041 |
| OI-ARCH-002 | CLOSED | 地图静态/动态层、cell layout、拓扑版本与增量缓存未冻结 | DD2/DD3/DD5 | DD3 冻结 column-major static terrain + dynamic entity pools + versioned derived cache；平台最大规格另由 OI-R3-008 跟踪 |
| OI-ARCH-003 | CLOSED | kernel 有 `TERMINAL_DRAW`，search resolver 枚举缺 DRAW，`UNKNOWN` 又与 `UNKNOWN_RULE` 混合 | DD1 | [terminal-proof-algebra.md](terminal-proof-algebra.md) 统一 Outcome 与 Resolution；旧草案名已明确废弃 |
| OI-ARCH-004 | CLOSED | `HARD_INVALID` 同时被用于非法、确定失败和 recovery 候选 | DD1 | [action-scheduler-contract.md](action-scheduler-contract.md) 分离 Submission/Execution/HardGate/Terminal |
| OI-ARCH-005 | CLOSED | ForcedWin、ForcedNonloss、ForcedLoss、ActionRefuted 缺少完全对称量词和 coverage | DD1/DD6 | [terminal-proof-algebra.md](terminal-proof-algebra.md) 冻结量词和 CoverageCertificate；DD6 实现性质测试 |
| OI-ARCH-006 | CLOSED | Kernel Result 的 `resultWorst/resultBestAction` 与 hybrid Result 的 `completedDepth`/policy 字段不一致 | DD2/DD3 | [action-result-abi.md](action-result-abi.md) 已统一 Result/Policy/Coverage；DD3 只选择 stride/SoA |
| OI-ARCH-007 | CLOSED | `PhysicsTT/InformationTT/ValueTT/ChanceCache/RegretCache/TransitionCache`在文档中的清单、别名和owner不一致 | DD8 | cache inventory JSON冻结11 canonical ids、alias、owner和完整key matrix；旧文档已同步 |
| OI-ARCH-008 | CLOSED | ShotPlan/BombPlan 与实体缓存、分数缓存、terrain/deadline 失效缺少字段级合同 | DD7/DD8 | PlanSketch/PersistentPlan、SourcePlan owner、generation、physical/score dependencies、dirty suffix与Hard revalidation已冻结；容量归DD8 |
| OI-ARCH-009 | CLOSED | RiskMatrix backup 与 root safe-exploitation 约束可能重复或矛盾 | DD6 | DEC-0056/0057：三维递归robust是唯一主目标；根只做`allowedExploitLoss=0` safe-floor内expected tie-break |
| OI-ARCH-010 | CLOSED | mixed policy 概率量化、归一化误差、PRNG 和可复现取样未定义 | DD2/DD6 | 0–10000 最大余数量化、PolicyArena、XORSHIFT32_V1 与 multiply-high 取样已冻结；DD6 实现性质测试 |
| OI-ARCH-011 | CLOSED | state 绝对 frame/deadline、rule/profile/version/hash 字段 owner 未逐项列出 | DD2 | DD2 五份合同已逐类定义 owner、单位、生命周期、hash、undo 和 overflow |
| OI-ARCH-012 | CLOSED | v1 23 个 codeHash 并非都有可执行源码映射；当前工作副本也不是发布基线 | DD9 | DD9支持矩阵冻结：仅v20 `EXACT_SOURCE`，其余replay/label用途显式降级 |
| OI-ARCH-013 | CLOSED | 244 局 discovery/calibration/frozen/forward split 与相关对局分组尚未生成 immutable manifest | DD9 | 162相关组稳定分配，assignment fingerprint冻结；forward保留post-build |
| OI-ARCH-014 | DECIDED | framework 工具可解析死亡窗口/日志，但 v2 正式版无日志，离线事件 schema/生产隔离需统一 | DD7/DD9 | CounterfactualResult/Event schema与strip deny list已统一；等待harness和production strip实测后CLOSED |
| OI-ARCH-015 | DECIDED | 固定244/252目录语义不能表示持续增长的历史语料 | DD9/DD10 | Rolling corpus ledger/head/snapshot实现、旧快照迁移与重复/部分下载fault test通过 |
| OI-ARCH-016 | DECIDED | 历史分析器把未观察技能当none、把缺失runtime当0，会污染skill与terminal统计 | DD4/DD9/DD10 | analyzer迁移skill/terminal provenance，旧schema显式标legacy，跨版本golden report通过 |
| OI-ARCH-017 | DECIDED | build gate、服务器simulate、发布、挑战和下载没有单一事务状态机 | DD8–DD10 | agentank-ops函数边界、RunManifest schema、锁、原子artifact和两级发布门执行通过 |
| OI-ARCH-018 | DECIDED | 多tank共享构建工具和全局历史语料时可能交叉污染Candidate、Snapshot、Forward与rollback证据 | DD9/DD10 | profile/tank/skill/branch血缘、单profile发布快照和跨profile拒绝测试通过后CLOSED |

## 8. DD1 退出结论

DD1 于 2026-07-15 完成：

- OI-R0-001 至 OI-R0-011 均已获得唯一主规则或有界 RuleVariant；
- [rule-corpus-schema.md](rule-corpus-schema.md) 已规定 Reference、Value、Proof、Fast 和生产 emitter 的 UNKNOWN 行为；
- OI-ARCH-003 至 OI-ARCH-005 已关闭；
- 给定状态、命令、chance 和一个冻结 RuleVariant，可以唯一产生 ordered events、有限 observation relation 与 TerminalResolution。

`VARIANT_DEFINED` 不等于平台事实已确认。DD2 可以继续状态/ABI 设计；DD4 必须校准这些 variant，生产 FastKernel 不得携带未决 variant 分支。

## 9. DD2 退出结论

DD2 于 2026-07-15 完成：

- OI-ARCH-006、OI-ARCH-010、OI-ARCH-011 已关闭；
- OI-ARCH-001/002 已有可实现的逻辑方案，状态为 DECIDED，等待 DD3 真实负载证明后关闭；
- OI-R0-010 的 set-valued observation/reconciliation 和 incomplete 行为已冻结，平台多 bullet 选择 relation 留给 DD4；
- OI-R1-002/007 已有多实体、隐藏、再出现和歧义关联的 ABI，不再阻塞 DD3；
- 所有事实、support、搜索质量、cache 和输出容量都有不同 overflow 语义。

DD3 可以开始，但只能在正确性 oracle 全通过后选择 WorldSnapshot/WorldDelta、TypedArray/packed Array、递归/显式栈和实际容量；DD2 COMPLETE 不授予这些实现候选冻结资格。

## 10. DD3 退出结论

DD3 于 2026-07-15 完成：

- 两个 capacity profile 的 20 个 correctness oracle 均为零失败；
- OI-ARCH-001/002 已关闭，联合 world storage 和地图物理层已有可实现的冻结 ABI；
- OI-R3-005 已选择本地默认候选，状态转为 DECIDED；平台引擎复核仍由 DD8 关闭；
- 生产最大容量、cache inventory 和平台字节门未被 DD3 synthetic profile 越权冻结；
- DD4 可基于统一 state/event/result 边界实现 ReferenceKernel 与 RuleCorpus 校准。

## 11. DD4 退出结论

DD4 于 2026-07-15 完成详细设计：

- overload 几何和 128-record 最后一帧结算已由平台 replay 收敛；
- OI-R1-001/002/004 关闭，其他 R1 均转为显式 finite variant/unknown-domain/production blocker；
- 20 条 RuleDefinition、12 个 variant group、21 个 fixture、handler/adapter binding 已进入 executable corpus；
- R0 shared-resource、move/star contest、exact runtime/timeout boundary 仍未确认，但没有隐式默认；
- DD5 可实现 confirmed/common Fast path，并对 variant-dependent 分支返回 unsupported/incomplete。

## 12. DD5 退出结论

DD5 于 2026-07-15 完成详细设计：

- FastKernel 冻结为 generated integer RuleTable + prepare/commit/undo；任何失败 fully undo；
- committed projectile/bomb 生命周期与 search depth 分离，直到 canonical stop/terminal；
- Committed/Possible/Expected hazard 三平面隔离，敌方未来可能开火不产生 proven Hard；
- ReverseViability 使用 cell/direction/shield/capability/phase 微状态，开火距离只可 broad phase；
- 每个 action 在评分前实际 apply、Hard/Terminal 核验、聚合并 undo；
- DD4 的 21 fixture 已有 exact/common/unsupported 差分 disposition 和 fault matrix；
- 剩余 R0/R1 variants 在 Fast 触发时 unsupported，不阻塞 DD6 对完整/不完整 branch 传播区间；
- SourcePlan 只冻结语义生命周期和 miss=recompute，cache inventory/容量仍由 OI-ARCH-007/OI-R3-007 在 DD8 关闭。

## 13. DD6 退出结论

DD6 于 2026-07-15 完成详细设计：

- deep pure simultaneous search冻结为sound lower/upper，point/horizon/terminal语义分离；
-根/关键节点使用restricted matrix + full best-response Double Oracle，mixed policy唯一经PolicyArena；
-ForcedWin/Nonloss/Loss在InformationState上遵守双方observation partition，DFPN不改变量词；
-risk拆为chance/hidden/enemy三维递归ε-contamination，0–9900整数表和动态stateRiskClass；
-OI-ARCH-009关闭：root expected仅在同一robust safeFloor内零损失tie-break；
-OI-R3-001转DECIDED，具体曲线/分类数值由DD7校准、DD8 benchmark关闭；
-OI-R3-003继续OPEN，depth/matrix/DFPN/fallback额度由DD8实际时间控制冻结；
-所有rule/support/capacity/time incomplete均传播区间/UNKNOWN，不产生Proof false positive。

## 14. DD7 退出结论

DD7 于 2026-07-16 完成详细设计：

-FeatureRegistry冻结raw/weight、cost tier、dependency和Table/Generated同语义A/B；
-StrategySelector冻结五primary、modifier、OutcomeChangeCapacity、margin/dwell/hysteresis和forced override；
-OpponentModel冻结confirmed opportunity/choice、fast/slow/confidence、多维risk preference和整数nominal policy；
-八技能以public id/generated descriptor连接Fast，own specialization与enemy direct lookup不扩大节点分支；
-每个FIRE/BOMB有PlanSketch，PersistentPlan只为finalist；SourcePlan物理与意图Plan分离；
-草/cloak/不可见威胁进入PossibleShot/BeliefSweep/InformationControl和robust risk，不进入committed Hard；
-OI-ARCH-008关闭；OI-R3-002/006转DECIDED，DD9已冻结split/门禁，具体参数仍待v2 Calibration/benchmark；
-OI-ARCH-014仍DECIDED；DD9已冻结离线schema，等待harness和production strip实测。

## 15. DD8 退出结论

DD8 于2026-07-16完成详细设计：

-11个canonical cache及机器JSON key matrix冻结，OI-ARCH-007关闭；
-SearchSemanticProfile与SearchBudgetProfile/runtime mode分离，cache共享不再混义；
-1500/2500ms等价work门、永久fallback和500ms独立reserve冻结；callback watchdog独立；
-fallback保留缩减Minimax、committed lifecycle、每action Hard、Terminal和root一致性，depth不固定2；
-build generator/薄CLI、own skill专门化、Table/Generated选择、production strip和source/minified全语义差分冻结；
-OI-R3-003/004/007转DECIDED，DD9已定义release gate，具体数值仍需v2实现/平台benchmark后关闭；
-OI-R3-008仍OPEN：平台engine/byte limit未知，明确阻塞最终release而不阻塞DD9合同设计。

## 16. DD9 退出结论

DD9 于2026-07-16完成详细设计：

- `LEGACY-244-20260715.1`、732 artifact roots、162相关组与split fingerprint冻结；
- OI-ARCH-012关闭：23个历史codeHash只有v20具备hash-exact本地源码，其余用途明确降级；
- OI-ARCH-013关闭：244局Discovery/Calibration/Frozen恰好分配一次，真正Forward仅限post-build；
- OI-ARCH-014的schema/隔离设计已完成，仍等待runner与production strip实测，保持DECIDED；
- OI-R3-001至007的算法/架构语义已决定，但数值与平台表现不能由设计关闭，转为G4/G6/G7/G8/G9实施门；
- OI-R3-008继续OPEN，平台engine/byte/runtime证据阻塞发布；
- 无v2实现或forward样本时，release report明确`NOT_RELEASE_ELIGIBLE`。

## 17. DD10 退出结论

DD10 于2026-07-16完成平台运行与滚动证据详细设计：

- 固定244只保留为不可变历史快照，活动总数由append-only MatchLedger/CorpusHead管理；
- 每次分析、校准和发布引用不可变CorpusSnapshot，post-244已查看对局统一为`DISCOVERY_APPEND`；
- skill与terminal字段增加provenance，旧`null -> none`和missing runtime→0语义被禁止；
- Poison相对cadence已由平台回放收敛，`Math.imul`缺失进入平台CapabilityProfile；
- 统一平台runner、强制发布前simulation、原子下载、错误分类、分析目录和恢复状态机已冻结；
- 发布拆为canary准入与最终release验收，消除首次上传与forward证据循环；
- OI-PLAT-002/003/005、OI-ARCH-015/016/017/018仍等待实现，因此当前仍`NOT_RELEASE_ELIGIBLE`。
