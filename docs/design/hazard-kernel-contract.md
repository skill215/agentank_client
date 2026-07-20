# DD5 Hazard、Deadline 与 ReverseViability 合同

状态：DD5 规范合同，2026-07-15。冻结已提交危险的完整生命周期、三危险平面、禁入 broad phase、死亡链反推、HardGate 前置核验和证书边界；风险参数与递归 backup 仍由 DD6 冻结。

关联：`DEC-0003`、`DEC-0008`、`DEC-0012` 至 `DEC-0014`、`DEC-0025`、`DEC-0031`、`DEC-0042`；[terminal-proof-algebra.md](terminal-proof-algebra.md)、[fast-kernel-contract.md](fast-kernel-contract.md)、[information-state-storage-contract.md](information-state-storage-contract.md)。

## 1. 最重要的语义边界

危险必须分成三个互不混写的平面：

```text
COMMITTED_HAZARD
  已经在 PhysicalState 中存在的 projectile、bomb、crash/terminal deadline
  -> 可产生严格物理证书和 HardGate 候选

POSSIBLE_HAZARD
  隐藏世界中的可能实体、敌方未来可能行动、未知技能选择
  -> robust/risk、ACTION_REFUTED、排序；不能单独产生 HARD_REJECT_PROVEN

EXPECTED_HAZARD
  对手模型与 chance probability 加权的威胁
  -> ExpectedValue、Risk、评分；不参与物理、Hard 或 Proof
```

`risk=0` 可以在 DD6 对 PossibleHazard 采用最坏情况政策，但这仍是风险目标，不把“敌方可能开火”改写为“已经必死”。`risk=100` 仍保留用户接受的最坏成分，也不能覆盖严格 Hard。

## 2. Committed 的定义和生命周期

一个来源只有满足下列条件才进入当前 PhysicalWorld 的 committed plane：

- projectile 已创建且 active，拥有确定 handle/generation、cell、direction、phase；
- bomb 已放置且 active，拥有确定 cell、explodeFrame 和规则 descriptor；
- 已到达的 crash/terminal trigger、已执行动作造成的不可逆 terrain/entity event；
- 来源的存在和必要字段是 Known，而不是概率推断或仅由敌方“可能选择”产生。

来源从创建 event 当刻进入 committed state，直到 FastKernel 产生规范失效 event：

```text
projectile: boundary / wall / dirt / shield / tank hit / rule-defined stop
bomb: complete explosion batch / rule-defined removal
effect: absolute deadline expiry / explicit consume
```

搜索 depth、fallback depth、当前 Plan、可见性消失和对手概率都不能提前删除来源。已观察并确定存在的敌方 projectile/bomb 暂时不可见时，TrackedState 继续保留；若位置出现多个仍可能值，则各 PhysicalWorld 各自建立 committed timeline，InformationState 不把多个位置平均成一条轨迹。

## 3. 数据布局

### 3.1 SourcePlan

每个 active source 绑定固定记录：

```text
sourceHandle/generation
sourceKind                    PROJECTILE | BOMB | TERMINAL_DEADLINE
ownerSeat
shotGroupHandle/memberOrdinal
createdFrame/startPhase
endFrame/endPhase             已知失效；否则由 plan 扩展到首次失效
terrainDependencyMask
ruleCapabilityMask
planVersion
eventStart/eventCount
certificateRef               仅开发/离线可展开
```

ProjectilePlan 记录 cell-time segment；BombPlan 记录 explode deadline、blast ray 和 damage batch。两个 plan 都是物理实体的派生索引，不拥有实体事实。

### 3.2 CommittedHazardTimeline

时间坐标为 `(absolute platformFrame, phaseOrdinal, projectileSubstep)`。热层使用 ring/slab，不创建二维对象：

```text
slotFrame[]                   FrameT
exposureBitset[]              source 到达 cell-time
lethalBitset[]                在冻结 PhysicalState 微状态下确定致死
blockedBitset[]               movement/occupancy definite block
hitCount[]                    饱和前使用 CountT，不把 overlap XOR 抵消
shieldConsumeCount[]          已冻结顺序下的 charge 消耗
sourceListStart/count[]       只在需要证书/增量撤销时访问
timelineVersion[]             Uint32
```

`exposure` 与 `lethal` 分开：子弹经过一个格不等于 tank 必死，shield、先前命中、同时终局和行动时点都必须计算。多个来源用 count/bitset 加 source contribution，不能只 XOR。

### 3.3 三平面物理隔离

Committed、Possible、Expected 使用不同 arena/owner/version：

| 平面 | 值 | 允许消费者 | 禁止消费者 |
|---|---|---|---|
| Committed | exact bit/count + complete/unknown | Fast broad phase、Deadline、Hard、Proof | 对手概率写入 |
| Possible | possibility bit/count、witness | Risk、robust bound、ordering | PhysicsHash、strict Hard |
| Expected | 0–10000 mass/utility | Expected、Evaluator | DecisionHash、Proof |

任何 cache entry 都不能把三个平面合并成一个“危险分数”。

## 4. 轨迹正推

### 4.1 Projectile

```text
buildProjectilePlan(physicalOffset, projectileHandle, outPlanOffset)
  for each future substep in canonical timeline:
    query frozen terrain/entity interaction
    append segment and exposure contribution
    if canonical stop event: append removal and stop
```

- 轨迹推进到规范失效或 terminal，不受 search decision depth 限制；
- 创建帧包含两个 substep；overload 两弹独立 plan；
- projectile 互穿不抵消；严格证书在该平台规则升级前携带 assumption bit；
- terrain、shield、tank 交互依赖真实 phase；不能只用几何直线；
- 未冻结 shared-resource 次序导致输出分歧时，plan completeness=`UNKNOWN_RULE`，不产生 definite lethal。

### 4.2 Bomb

```text
buildBombPlan(physicalOffset, bombHandle, outPlanOffset)
  retain placed entity through explodeFrame:P70
  derive blast from phase-start terrain under active rule
  append exposure/damage/terrain mutation/removal events
```

炸弹在爆炸前始终存在。wall 截止、dirt 包含后截止、shield damage 和多 bomb batch 都从冻结规则读取。炸弹不能因当前 minimax horizon 较浅而消失。

### 4.3 增量和失效

SourcePlan 缓存到物理失效，允许跨 node/frame 复用相同前缀。以下事件只失效受影响后缀：

- terrain dependency 中的 dirt 被毁或 topology 版本改变；
- source handle generation、cell、direction、deadline 或 rule version 改变；
- 先前预计的 shield/tank interaction 被实际事件替换；
- observation reconciliation 使该 PhysicalWorld/source 不再可能。

无影响事件不得重建全部 active projectile/bomb。cache miss 直接由 Fast 规则重算；cache full 不能返回“无危险”。

## 5. 禁入位置只是 broad phase

用户要求的“已有子弹/炸弹时直接把位置标为禁入”实现为 cell-time projection：

```text
definitelyForbidden(cell, frame, phase, capabilitySignature)
  = 该 cell 上所有可达 tank microstate 都没有 HardViable 状态
```

禁入不是简单的 `exposureBitset[cell]=1`：方向、行动 slot、shield charge、effect、boost、teleport 和 terminal tiebreak 会改变结果。实现先维护完整 `HardViableSet[time][microstate]`，再把“该 cell 无任何 viable microstate”投影为 forbidden bit。

动作生成可用 forbidden bit O(1) 剪掉显然失败的位置，但每个 action 仍须经 Fast candidate transition、ReverseViability 和 TerminalResolver。禁入缓存不能创建新的 Hard 事实。

## 6. ReverseViability：死亡链反推

### 6.1 状态节点

反推节点不是单独 cell，而是最小生存微状态：

```text
(frame, phase,
 cell, direction,
 shieldHitsRemaining,
 movementCapabilityCode,
 command/effect capability class,
 terminal-relevant crash flags)
```

如果两个状态在 committed closure 内具有相同合法后继、damage 和 terminal 结果，生成器可将其合并为 capability class。不得合并会改变 FIRE 后闪避、boost 免费 turn、teleport target 或 shield consumption 的状态。

### 6.2 终点集合

对 committed closure 的最后 deadline 建立：

- `SAFE_TERMINAL`：已解析为 WIN/DRAW；
- `SAFE_NON_TERMINAL`：所有 committed source 已失效且 tank 未进入确定 terminal LOSS；
- `LOSS_TERMINAL`：TerminalResolver 明确 LOSS；
- `UNKNOWN`：规则、state、support 或容量不完整。

物理 `crashed=true` 不能直接当 LOSS。双方同帧 crash 可能由 stars/runtime 决胜；必须让完整 damage batch 和 TerminalResolver 解析。

### 6.3 反推方程

对我方后续可选择节点：

```text
Viable(s,t) = exists legal observation-consistent our continuation a
                such that every committed automatic outcome
                reaches Viable(child,t+1) or non-loss terminal
```

这里不把敌方尚未提交的未来 action 纳入 committed closure。如果敌方行动可以改变已提交来源并“救”我方，则严格 InevitableLoss 不能假设敌方会救援：完整 Hard 证书仍按 [terminal-proof-algebra.md](terminal-proof-algebra.md) 对所有 enemy policies 核验。只有证明敌方 action 对 closure 不相干时，才能使用 committed-only shortcut。

`ReverseViability` 输出：

```text
VIABLE_PROVEN
NO_VIABLE_CONTINUATION_PROVEN
VIABILITY_UNKNOWN_RULE
VIABILITY_INCOMPLETE_STATE
VIABILITY_INCOMPLETE_CAPACITY
```

### 6.4 开火后仍能闪避

“我方/敌方已经开枪”不自动等于必杀。ProjectilePlan 提供精确 impact substep；ReverseViability 在 impact 前枚举合法 turn/move/HOLD/boost/teleport/skill continuation。只有全部合法闪避路线在每个相关 committed outcome 下都终局 LOSS，才产生无逃生证书。

因此禁止以“距离小于 N”作为严格 kill 规则。距离只可用于 broad phase 或软排序；真正证书由 phase-accurate transition 和 deadline 生成。

## 7. DeadlineKernel

语义接口：

```text
solveCommittedDeadline(physicalOffset,
                       startMicrostateOffset,
                       targetMaskOffset,
                       committedTimelineOffset,
                       deadlineFrame, deadlinePhase,
                       capabilitySignature,
                       outDeadlineOffset) -> DeadlineStatus
```

输出：

```text
earliestArrivalFrame/phase
latestSafeDepartureFrame/phase
slackSubsteps
firstActionMask
reachableSafeMask
proofStatus
completenessCode
```

Deadline graph 只使用 Fast 生成的合法 predecessor/successor 表，必须覆盖 HOLD、turn、move、queue timing 和当前可用技能。未来 cooldown 后可能获得但 closure 内尚不可用的能力不能提前加入。

## 8. InformationState 聚合和严格量词

先在每个 PhysicalWorld 上生成物理证书，再按语义聚合：

```text
WorldLoss(w,a): action a 后，在 w 的 committed/terminal closure 内
                不论未来我方 continuation 都终局 LOSS

HARD_REJECT_PROVEN(I,a) only if
  for every HiddenWorld w in exact + residual support
  for every legal enemy policy sigma that can interact
  for every confirmed ChanceOutcome c
  WorldLoss(w,a,sigma,c) is proven
```

结果分类：

| 覆盖 | 结果 |
|---|---|
| 所有 world/enemy/chance 都 proven loss | `HARD_REJECT_PROVEN` |
| 至少一个 loss witness，但另有 safe/unknown branch | `ACTION_REFUTED` + PossibleHazard/Risk 输入 |
| 全覆盖 proven non-loss/viable | `HARD_ALLOW`（仅针对已检查 hard 原因） |
| 任一必要 branch 未枚举、规则未知或容量不足 | `HARD_INCOMPLETE` |

低概率 world 不能从 strict support 删除；top-K probability 不影响 Hard。Residual iterator 可中断，但中断时只能 incomplete。

若用户以后定义“任一 possible world 有 loss witness 就禁止”的保守政策，它必须是显式 `HARD_REJECT_POLICY`，携带 policyId/assumptionMask，不能冒充平台证明。当前默认不把 RiskProfile 自动转换成 Policy hard gate。

## 9. 每个 action 的前置 HardGate 流水线

```text
1. classifySubmissionLegality
2. generate/validate ActionProgram and relevant execution support
3. save BranchMark
4. apply Fast candidate transition for world/joint/chance branch
5. query/update committed SourcePlans and hazard timeline
6. O(1) forbidden broad-phase check
7. if needed run ReverseViability to last committed deadline
8. complete damage batch and TerminalResolver
9. aggregate world/enemy/chance coverage
10. write HardGateStatus + compact certificate/witness
11. undo candidate to BranchMark and verify root signature
12. only then call Risk/Evaluator/strategy scoring
```

这保证 Hard 不是评分后的补救。对于动作集合，shared committed timeline、predecessor graph 和 reverse frontier按 `(PhysicalSignature, capabilitySignature, ruleVersion)` 共享；每个 action 只增加首步 transition和必要局部 delta。

## 10. 性能架构

设地图 cell 数 `C`、committed closure substep 数 `H`、active source 数 `S`、capability class 数 `K`：

- SourcePlan 构建：`O(actual trajectory segments)`，每 source 一次，后续增量失效；
- timeline 合并：`O(changed contributions)`，不按 action 重建；
- bitset frontier：`O(H * K * ceil(C/wordBits))` worst case；同 signature 在全部 action/world 间共享；
- action broad phase：O(1) bit query；
- action first-step核验：`O(actual Fast events/deltas)`；
-证书 materialization：只在严格结论/诊断需要时展开 source handles，热路径保存 compact handle/signature。

生成器必须为 `H` 设 capacity，不是搜索 depth。projectile 理论上行进到边界/碰撞，bomb 到 explode deadline；超过 build capacity 返回 hard incomplete，不截断后宣布安全。

ReverseViability 使用双 frontier bitset、预生成 predecessor masks、dirty time range 和 capability signature。禁止为每个 action 分配二维数组，禁止为每个 world 重建相同 terrain ray，禁止在无事件时扫描全部历史 timeline。

## 11. 证书

Hard/viability compact certificate 至少包含：

```text
certificateKind
rootDecisionSignature
actionKeyLo/Hi
rulesetVersion/phaseOrderId/terminalPolicyId
committedSourceSetSignature
terrain/topology version
capabilitySignature
worldSupportVersion
enemyActionSupportVersion
chanceSupportVersion
horizonKind = HORIZON_TO_COMMITTED_DEADLINE
horizonEndFrame/phase
sourcePlanComplete
reverseCoverageComplete
terminalResolutionComplete
capacityComplete
assumptionMask
traceRoot
```

严格 `HARD_REJECT_PROVEN` 要求所有 complete flag 为 true 且 assumptionMask=0。projectile crossing 等 USER_CONFIRMED 规则只能生成 policy/assumption 证书，直到证据升级。

## 12. 故障与降级

- RuleVariant 分歧：`HARD_INCOMPLETE`；
- source/state 不完整：`HARD_INCOMPLETE`；
- trajectory/timeline/reverse arena 容量不足：`HARD_INCOMPLETE`；
- cache miss/full：直接重算，仍可完整；
-时间控制器中断：保留已完成 action 的证书，当前 action incomplete；
- hash/undo/owner mismatch：丢弃整代 search result，进入 DD8 Emergency 路径；
-全动作 proven reject：按 ForcedLossRecovery 延迟失败/改善 terminal tiebreak，不伪装安全。

fallback 可以减少 Minimax 深度，但不能缩短 committed closure、删除 active source、跳过 TerminalResolver 或把 incomplete 当 allow。

## 13. 必须测试的性质

1. 已提交 bullet 无逃生，所有 action 在评分前 proven reject；
2. 已提交 bullet 有转向/移动/boost/teleport 闪避，不产生假必死；
3. bomb 下一帧爆炸，逃生格与 blast/terrain phase 一致；
4. shield 第一颗 bullet 后仍有一 charge，第二颗后耗尽；bomb 单次完全消费；
5. overload 两 projectile 独立 id/轨迹/失效；
6. projectile crossing 不互相删除，并携带 assumption qualification；
7. 物理双 crash 由 star/runtime 解析，不直接 DRAW/LOSS；
8. enemy 只是可能 FIRE 时只产生 risk/witness，不 hard reject；
9. 多 world 中只有一个 loss witness 时不产生 proven hard；
10. residual/support/variant/capacity不完整时严格结论为 incomplete；
11. cache-off/on、source/minified 相同 forbidden/viability/terminal fingerprint；
12. terrain mutation 只失效依赖后缀；source 从创建到规范失效始终存在；
13. 每个 action 后 root state、timeline contribution、hash 和 usedCount 完整恢复。

## 14. DD5 冻结结论

“已有危险必须规避”落实为：共享的 committed timeline 先正推到物理失效，再用 phase-accurate ReverseViability 反推所有生存路线，每个 action 在评分前实际 apply、核验 terminal并 undo。敌方未来可能开火、草中可能存在坦克、隐身和猜测路径仍进入 Possible/Expected 风险层，不会污染严格物理证明。
