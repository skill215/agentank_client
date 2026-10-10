# V2 分层控制器恢复计划（RST2–RST6）

状态：`PROPOSED / REVIEW_REQUIRED / NO_EXECUTION`  
基线：当前 STRAT3/RST1 工作树  
目标：保留严格安全、InformationState 和 Minimax 正确性，同时把 Minimax 从最终战略控制器
降为接触战战术顾问；先把固定对照得分恢复到约 50%，再进入最终 60% 资格。

## 1. 当前事实与根因判断

当前 RST1 已修复“strategy 在 Risk 前污染 evaluator/search”的顺序错误，但还没有解决最终
动作所有权：

```text
Risk → maximum robustLower safe floor → portfolio → StageMatrix → final action
```

这里的 `robustLower` 同时混合了严格安全压力、短程战术价值和浅层位置启发，StageMatrix仍然
是全局最终选择器。固定32场景中 CURRENT、FORCE_STAR、BAND_OFF逐动作完全一致，证明战略
portfolio没有实际控制力。继续提高FIRE分数、改变selector阈值或增加Minimax深度，只会在同一
错误所有权上调参。

V1提供的有效结构不是某个具体分数，而是互斥控制模式：确定性危险先处理；只有战术接触才
搜索；无接触时由稳定目标/路径控制。V2下一阶段采用该层级，但不复制V1对象实现、浮点逻辑或
局部特例。

## 2. 目标架构

```text
Root facts / physical closure
        │
        ├─ strict Proof / direct terminal          → STRICT_PROOF
        ├─ committed escape obligation             → COMMITTED_ESCAPE
        ├─ immediate tactical contact              → TACTICAL_CONTACT
        ├─ no immediate contact                     → STRATEGIC_NAVIGATION
        └─ budget/capacity emergency                → EMERGENCY

所有模式共同经过：candidate transition → Hard → Safety/Risk → FinalActionGate

TACTICAL_CONTACT：
    shared Minimax/StageMatrix → TacticalEnvelope
    → 只反驳战术上不可接受的动作或提供战术向量

STRATEGIC_NAVIGATION：
    不运行Minimax/StageMatrix
    → PersistentPlan/StrategyPlan选择长期动作

最终选择：
    strict safety tuple
    → mode-owned quality vector
    → stable action row
```

核心规则：

- Hard、strict Proof 和 committed ReverseViability 保持全局权威；
- possible projectile、future FIRE、hidden world和UNKNOWN仍归Information/Risk，不能升级成Hard；
- Minimax只能在`TACTICAL_CONTACT`影响最终选择；没有战术接触时不得用浅层value否决长期Plan；
- StageMatrix返回`TacticalEnvelope`，不再作为所有root的全局动作所有者；
- strategy差异来自不同Plan及其可验证进度，不来自切换evaluator或固定动作bonus；
- 每个Plan的第一动作仍必须逐动作通过相同Fast transition、Hard、Risk和FinalActionGate；
- RiskProfile 0–100继续控制软风险可接受度，不改变严格失败边界。

## 3. 新接口

### 3.1 `RootControlContext`

固定整数slab，不分配对象：

```text
mode
modeReason
committedEntityCount
escapeDeadline/rootSlack
tacticalContactMask
visibleEnemyDistance
qualifiedAttackCount
starDeadline
scoreMargin
remainingFrames
runtimeMode
supportStatus
```

`ControlModeRouter.classify(context)`只分类，不选动作。优先级固定为：

```text
STRICT_PROOF
> COMMITTED_ESCAPE
> TACTICAL_CONTACT
> STRATEGIC_NAVIGATION
> EMERGENCY（只替换同模式的工作预算）
```

Emergency不得跳过Hard、committed closure或已建立的Escape obligation。

### 3.2 `TacticalEnvelopeSlab`

Minimax/StageMatrix对每个动作只输出：

```text
supportStatus
terminalLower/terminalUpper
immediateFatalMass/horizonFatalMass/unknownMass
robustTacticalLower/expectedTactical
enemySafeSuccessorCount
escapeSlack
refuted
completedDepth
```

只有完整terminal/committed证书可以设置`refuted`。普通heuristic lower不能冒充严格安全floor。

### 3.3 `StrategyPlanPool`

Plan候选在Risk前生成第一primitive action，但在Risk后才参与选择。使用现有scratch/PlanSketch
容量，不新增长期root TypedArray：

```text
planKind/strategyId
purposeKind/purposeCompleteness
targetCell/targetEntity
firstActionRow
deadline
progressBefore/progressAfter
terminalSwingLower/Upper
combatConversion
starSwing
resourceCost
commitmentHorizon
abortMask
generationSignature
```

只有最终选中Plan进入`PersistentPlan`；未选候选在root结束时全部失效。

### 3.4 `StrategicArbiter`

不先做加权总分。对通过Hard/Risk的Plan按多维顺序选择：

```text
strict safety class
→ terminal/nonloss interval
→ mode-specific objective progress
→ plan deadline
→ combat/star conversion
→ resource cost
→ continuity
→ stable row
```

Risk维度保持独立，不允许在战略分数中重复扣风险。可调战略参数只改变
`objective progress/combat/star conversion`之间的顺序或整数权重，不能越过前两层。

## 4. 分阶段修改

### RST2：控制模式显式化（行为影子阶段）

实施：

- 新增`ControlModeRouter`和`RootControlContext`；
- 对当前每个root做shadow分类，但不改变生产动作；
- 记录旧路径实际调用Minimax/StageMatrix的模式和动作所有者；
- 建立V1行为参考分类：bomb escape、projectile escape、direct attack、tactical search、navigation；
- 不调整Risk、search depth、score、FIRE、STAR或Plan。

UT/性质：

- 每个root恰好一个mode；同输入确定性一致；
- committed危险不能分类为战略导航；
- possible/future threat不能分类为committed escape；
- callback gap/incomplete support不会获得假exact；
- shadow包装前后动作指纹完全一致；
- source/minified、cache on/off、root restore一致。

验收：结构门全部通过；生产动作变化数必须为0。失败则停止，不进入RST3。

### RST3：Minimax降级为战术包络

实施：

- 只在`TACTICAL_CONTACT`调用Minimax和StageMatrix；
- 将其结果写入`TacticalEnvelopeSlab`；
- 拆开“严格安全/terminal bound”和“普通战术heuristic value”；
- maximum robust safe floor只允许使用死亡质量、terminal/nonloss bound和committed slack；
- 普通位置、星路、射击机会、unknown惩罚不再通过safe floor删除长期动作；
- `STRATEGIC_NAVIGATION`直接使用中立长期controller，Minimax输出为空；
- 保留RST1 neutral anchor作为回滚动作。

需要新增决策：`DEC-0097`替代DEC-0057中“所有robust value都是最终主目标”的过宽解释。
递归epsilon-contamination公式不变；修改的是root最终所有权，不是风险计算。

UT/Oracle：

- 终局/必死动作仍被拒绝；纯heuristic lower不能设置`refuted`；
- 非接触root的Minimax节点数和StageMatrix调用数必须为0；
- 接触root与当前Minimax oracle的interval/matrix结果一致；
- search中断只发布最后完整包络；
- Risk/EO/Hard/root restore全部保持0缺陷。

快速验证：只运行固定32场景CURRENT，不做多模式调参。最低门：得分不得低于RST1的28.51%，
单方击毁负不得增加，128帧星差不得下降。未通过就回滚RST3，不修改阈值补救。

### RST4：真正的多帧战略Plan

按生成器逐个接入，每个子阶段只能新增一种Plan，禁止一次组合调试：

1. `NAVIGATE/STABILITY`：复现稳定巡航、路径进度和避免无意义转向，作为无接触基线；
2. `KILL/DIRECT`：当前射击能直接击毁或严格压缩敌方逃生；
3. `ATTACK_SETUP`：转向后射击、抢占射线、intercept、escape denial、shield break；
4. `STAR_CONTROL`：收集、拒绝、终局星差和到达deadline；
5. `PRESERVE/COMEBACK`：领先保全和落后逆转Plan，只使用现有规则，不修改领先保护语义。

每个Plan必须有目的、deadline、progress、abort条件和第一动作后的自逃证据。不能把“有可能命中”
直接当收益；其价值来自敌方安全后继减少、命中deadline或获得更优射击位置。

每接一个生成器执行：

- Plan正反fixture和确定性oracle；
- 32场景一次CURRENT/GENERATOR_OFF因果A/B；
- 只有`LOSS→WIN + DRAW改善 > WIN→LOSS + DRAW退化`才保留；
- 星差、击毁转换、FIRE purpose、动作分歧和模式分布必须对账；
- 无正向整局结果的生成器保留为实验artifact但不接production默认。

RST4整体进入下一阶段的最低门：固定32场景两次repetition得分至少45%，四种variant至少两种
改善，任一种不得下降超过3个百分点；全部硬不变量为0。

### RST5：战略可调与恢复到约50%

只在RST4候选固定后调整战略，不调整底层战术/物理：

- 暴露单一`StrategicProfile`：KILL、SETUP、STAR、PRESERVE、COMEBACK的整数偏好；
- RiskProfile仍独立为0–100；战略参数不能修改Risk阈值；
- 动态切换只依据score margin、remaining frames、当前Plan进度、攻击质量和对手模型；
- hysteresis只决定同质量Plan的持续性，不能保留已被Hard/Risk反驳的Plan；
- 参数搜索只允许预注册的少量profile，不做连续权重扫面或全量arena调参。

验证阶梯：

1. 固定32开发集：1 repetition筛结构，候选最多3个；
2. 固定32确认：2 repetitions，候选必须≥45%；
3. 固定96 Discovery：四variants、1 repetition，得分必须≥50%；
4. 冻结唯一profile和代码hash后，才允许读取170场景Holdout；
5. Holdout四variants、2 repetitions：得分≥50%，`LOSS→WIN`严格大于`WIN→LOSS`，任一
   variant下降不超过3个百分点；
6. 固定266合并报告必须≥50%，否则不得运行最新动态全量。

攻击目标不是FIRE数量。主要指标改为：

```text
单方击毁胜 / 有目的攻击Plan
直接或intercept命中 / FIRE
敌方安全后继压缩 / 攻击Plan
开火后自存活率
无目的FIRE率
```

恢复门允许暂时不满足最终击毁+10%，但固定266必须达到约50%；最终资格仍要求击毁胜相对冻结
基线提升至少10%且总得分严格超过60%。

### RST6：性能、体积和全量资格

只有固定266达到50%后执行：

- 最新历史场景动态冻结；不写死826；
- 运行完整V1/V2 compact arena；
- 只保存manifest、overview、matches.ndjson.gz和最多64个诊断样本；
- 与V1同输入比较function/composite/root/search/full-game性能；
- 语义保持地合并扫描、复用mask/slab、裁掉production不可达兼容入口；
- 两次独立build必须同hash，source/minified动作指纹一致；
- minified必须≤204,800 bytes，TypedArray必须先释放至少50KiB余量，不能在998,836-byte
  基线上继续堆数组。

最终门：

- 全量完成且timeout/error为0；
- avoidable Hard、false Proof、risk domination、root restore failure为0；
- 固定266得分严格>60%；
- 单方击毁胜较冻结基线至少+10%；
- 同输入V2总耗时和P95均优于V1；
- production minified≤204,800 bytes。

不满足就标记`REJECTED`，不自动调参重跑。官方simulate、publish、challenge不属于本计划自动
权限，仍需独立明确授权。

## 5. 性能与容量约束

- RST2–RST5不得新增长期实体池或第二套World/Search状态；
- Plan候选复用既有scratch容量，最终选中后才进入PersistentPlan；
- 单root至多一次Minimax和一次StageMatrix；非接触root两者均为0；
- 每阶段热路径分配必须为0；阶段P95不得超过RST1的110%；
- RST5结束前完整root/search pipeline必须至少恢复到旧STRAT2水平；
- 若需要新字段，先列出可删除/复用字段和字节账本；没有容量来源不得实施；
- 兼容诊断接口不进入production emitter。

## 6. 快速测试与证据保留

调试不再反复运行全量：

- UT/小型oracle：结构和量词正确性；
- `DecisionRootSuite`：从现有compact结果确定性选取最多512个根，进程启动时一次载入内存；
- 固定32场景：整局因果A/B；
- 固定96：唯一Discovery；
- 固定170：锁定Holdout，达到门之前禁止读取；
- 固定266：恢复资格；
- 动态全量：只在固定266通过后运行一次。

每次只保存紧凑结果和最多32个第一动作分歧根，不保存完整逐帧replay。所有报告绑定代码、配置、
场景和V1精确字节hash，确保状态可追溯。

## 7. 明确禁止

- 提高全局FIRE固定分、降低STAR固定分或用单一权重补丁恢复胜率；
- 通过提高Minimax depth寻找炸弹/长期星路；
- 为每个strategy分别运行Minimax；
- 让future FIRE、possible projectile或UNKNOWN创建committed Escape obligation；
- 放宽Hard、strict Proof、root restore或风险支配约束；
- 通过修改fixture预期迁就production；
- 在32/96未达门时运行266或动态全量；
- 为体积直接删除规则、技能、Hard或Information语义；
- 在本计划获得批准前修改代码、配置、测试、参数或运行任何验证/对战。

## 8. 审批边界

本文件批准后，默认授权范围仅为RST2→RST5的串行实现和对应已列出的UT/抽样验证。任一阶段
失败立即停止并提交报告，不自动进入下一阶段。RST6动态全量、官方simulate、publish和challenge
分别需要再次明确授权。

