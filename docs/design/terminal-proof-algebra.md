# DD1 Terminal、Hard 与 Proof 代数

状态：DD1 规范合同，DD10 平台终局修订。统一 TerminalResolution、HardGate、ForcedWin/Nonloss/Loss 和证书；数值 ABI 见 [action-result-abi.md](action-result-abi.md)，搜索实现留给 DD6。

关联：`DEC-0003` 至 `DEC-0008`、`DEC-0021`、`DEC-0025`、`DEC-0028`、`DEC-0029`、`DEC-0033`；`OI-R0-008`、`OI-ARCH-003`、`OI-ARCH-004`、`OI-ARCH-005`。

## 1. Terminal 类型

### 1.1 TerminalOutcome

```text
WIN
LOSS
DRAW
NON_TERMINAL
```

Outcome 永远从调用方 perspective 返回。交换我方 seat 后 WIN/LOSS 对换，DRAW/NON_TERMINAL 不变。

### 1.2 TerminalResolutionStatus

```text
RESOLVED
UNKNOWN_RULE
INCOMPLETE_STATE
```

`UNKNOWN_RULE` 与 `DRAW` 完全不同；未知不能取 0 分或当作非终局。`INCOMPLETE_STATE` 表示字段/容量不足，也不能由 RuleVariant 猜测填充。

### 1.3 TerminalCause

```text
SINGLE_CRASH
MUTUAL_CRASH_STAR
MUTUAL_CRASH_RUNTIME
FRAME_LIMIT_STAR
FRAME_LIMIT_RUNTIME
RUNTIME_TIMEOUT
SCRIPT_ERROR
EXACT_DRAW
```

平台历史 `resultReason=runTime` 在冻结244快照中表示同星tiebreak，不是3秒超时；历史`timeout`与当前Guide所述可靠性失败`runtime`表示代码耗时失败。Adapter必须先保留原始拼写，再结合是否完成mutual-crash/frame-limit、winner和runtime/error events分类；禁止先统一小写后只按字符串映射。形状不足时返回`INCOMPLETE_STATE`。动态新增对局通过MatchLedger提供附加证据，但不能改写冻结快照计数。

## 2. 平台终局证据

`LEGACY-244-20260715.1` 唯一 replay 的结果结构：

- 211 局：最终 frame 只有一方 crash，reason=`crashed`，存活方获胜；
- 13 局：同一最终 frame 双方 crash，星数不同，reason=`star`；
- 1 局：同一最终 frame 双方 crash，星数相同，reason=`runTime`；
- 11 局：128 条 record、无人 crash，星数决定，reason=`star`；
- 1 局：128 条 record、无人 crash，同星由 runtime 决定，reason=`runTime`；
- 7 局：65–122 条 record，一方 replay runtime 为 3002–3084ms，reason=`timeout`，另一方获胜。

未观察到“达到固定星数立即结束”的独立规则。星数在当前规则中只用于 frame limit 或 mutual crash tiebreak；不得实现未经证据支持的 5-star early win。

### 2.1 SCRIPT_ERROR 校准样本

动态历史样本 `mat_ANGK6T283KC1fRBvV` 提供了独立于物理伤害的真实错误终局：只有一条 setup record，失败方在 frame 1、累计 13ms 报 `Object has no member 'imul'`，平台 `reason=error` 并直接判另一方获胜；获胜方 runtime 缺失。该样本冻结以下 Adapter 行为：

- `error` 规范化为 `SCRIPT_ERROR`，优先于 crash/star/runtime 物理结算；
- error side 的 runtime 可保留观测值，非 error side 的缺失 runtime 是 `MISSING_NOT_APPLICABLE`，不得填成 0；
- 这类局进入平台能力与错误回归，不进入技能胜负归因，也不得声称对手策略导致死亡；
- 错误文本只保存在离线 artifact，生产 TerminalState 只保留紧凑 cause/side code。

## 3. TerminalPolicy

T90 按以下优先级执行：

```text
1. 已发生 runtime timeout / script error
2. 单方 crash
3. 双方 crash：stars -> runtime -> exact draw/unknown
4. frame limit：stars -> runtime -> exact draw/unknown
5. NON_TERMINAL
```

### 3.1 单方 crash

仅一个 tank 的 `crashed=true` 时，存活方获胜，不比较星数/runtime。TerminalCause=`SINGLE_CRASH`。

### 3.2 双方 crash

必须等当前 projectile/bomb damage batch 完整结束：

1. 星数不同：高者胜；
2. 星数相同：低 runtime 者胜；
3. runtime 完全相同：active candidate 为 DRAW；若平台存在额外 tie key，则该 fixture 使用 UNKNOWN_RULE。

禁止在第一个 crash event 后短路，也禁止把“双方物理死亡”直接映射成 DRAW。

### 3.3 Frame limit

active candidate 是在进入 `platformFrame=128` 的 action 前结算，即最后完成 frame 127 的全部 phase 后比较：

1. 星数；
2. runtime；
3. 完全相同则 DRAW/UNKNOWN_RULE。

`RV-LIMIT-AFTER-ACTION-128` 仅用于校准。任何依赖第 128 帧 action、bullet 或 bomb 的严格结论在该规则关闭前为 UNKNOWN。

### 3.4 Runtime

Terminal state 只需要 runtime 的比较关系：

```text
RUNTIME_LESS
RUNTIME_EQUAL
RUNTIME_GREATER
RUNTIME_ORDER_UNKNOWN
```

真实 onIdle API 不公开敌方累计 runtime。相同星数而 runtime order 未知时：

- TerminalResolutionStatus=`INCOMPLETE_STATE`，不得生成 ForcedWin；
- 用户确认的默认策略按我方 runtime 更高，产生 `HARD_REJECT_POLICY`；
- 该 policy gate 不写入 ProofCache，不标 PLATFORM_REPLAY_CONFIRMED。

3 秒 timeout 的精确 `>=`/`>` 边界不用于生产踩线；RuntimeController 必须在 DD8 预留 EmergencyReserve。

## 4. HardGate 与风险边界

### 4.1 InevitableLoss

对当前 action `a`，只有满足下式才能 `HARD_REJECT_PROVEN`：

```text
for every HiddenWorld w consistent with I
for every legal future our policy pi after a
for every legal enemy policy sigma
for every ChanceOutcome c in confirmed support
the frozen RulesKernel reaches TerminalOutcome LOSS
before the certificate deadline
```

这正是“敌方即使什么都不做也无法避免我方输”的强条件，通常来自已提交 bullet/bomb、不可逆 collision 或已确定 terminal tiebreak。

敌方尚未开火但可以开火只提供一个 loss witness，不满足对所有 enemy policy 的量词，必须进入 Risk，不得 Hard reject。

### 4.2 Policy hard gate

`HARD_REJECT_POLICY` 适用于明确、不允许风险参数覆盖的保守选择，例如：

- terminal 同星且 runtimeOrder 未知，按我方更慢；
- 所有严格信息不足但用户要求禁止进入的 terminal trade。

它与 proven hard 共用动作过滤优先级，但必须保存 `policyId`、assumptionMask 和 reason，不能生成 ProofStatus。

### 4.3 Hard pipeline

```text
SubmissionLegality
  -> ExecutionStatus / Rule support
  -> Immediate TerminalResolution
  -> InevitableLoss proof
  -> explicit Policy gate
  -> Risk / Expected / ordering / score
```

`HARD_INCOMPLETE` 不可解释为 HARD_ALLOW。正常模式继续搜索补全；fallback 只能选择下界最安全且不依赖未知交互的 action，并保留 incomplete 标记。

## 5. ProofStatus

```text
FORCED_WIN_PROVEN
FORCED_NONLOSS_PROVEN
FORCED_LOSS_PROVEN
ACTION_REFUTED
UNKNOWN
```

### 5.1 ForcedWin

存在一个遵守我方 information set 的 policy，使所有 HiddenWorld、所有敌方合法 policy、所有 chance support 都以 WIN 终局：

```text
exists pi_ours
  forall w
  forall sigma_enemy
  forall c
    Outcome(I, pi_ours, sigma_enemy, w, c) = WIN
```

同一 observation history 下必须使用同一个 decision；若不同 world 使用不同 action，即 strategy fusion，Proof=UNKNOWN。

### 5.2 ForcedNonloss

存在 observation-consistent 我方 policy，使所有覆盖分支都在完整 game horizon 内终局为 WIN 或 DRAW。有限深度只证明“在 deadline 前不输”时，结果是 `SafetyCertificate`，不是 FORCED_NONLOSS_PROVEN。

### 5.3 ForcedLoss

FORCED_LOSS_PROVEN 表示对手有战略强制路线，不等于 InevitableLoss：

- OUR_DECISION：所有我方 action 都是 ForcedLoss；
- ENEMY_DECISION：存在一个敌方 action 是 ForcedLoss；
- HiddenWorld/Chance：严格 certainty 要求全部 world/outcome 支持 ForcedLoss；
- 敌方 policy 也必须遵守它自己的 information partition。

因此对手必须主动选择某一开火动作才能击杀时，可以形成战略 ForcedLoss，但不能仅凭此将一个 root action 标成 HARD_REJECT_PROVEN。

### 5.4 ActionRefuted

一个合法 branch/witness 使 action 导向 LOSS 即可 `ACTION_REFUTED`。它用于排序、风险、历史反例和 Double Oracle 扩列，不能缓存为“状态 ForcedLoss”或“动作 Hard invalid”。

## 6. 递归组合表

| NodeKind | ForcedWin | ForcedNonloss | ForcedLoss | InevitableLoss |
|---|---|---|---|---|
| TERMINAL | WIN | WIN/DRAW | LOSS | LOSS |
| OUR_DECISION | OR | OR | AND | AND |
| ENEMY_DECISION | AND | AND | OR | AND |
| CHANCE_RESOLUTION | AND all support | AND all support | AND all support | AND all support |
| HIDDEN_WORLD | AND + strategy consistency | AND + strategy consistency | AND + enemy strategy consistency | AND |
| AUTOMATIC_FRAME | child | child | child | child |
| OBSERVATION_SPLIT | 每个 observation branch 可用各自后续 policy，但分裂前 action 必须一致 | 同左 | 同左 | AND |

### 6.1 Simultaneous node

不能使用“∀我方 row ∃敌方 column”假装敌方看见我方已选 row。

- ForcedWin：至少一个我方 row 对所有敌方 column、world、chance 都 WIN；
- ForcedNonloss：至少一个我方 row 对所有 column 都 WIN/DRAW；
- ForcedLoss：至少一个单一敌方 column 对所有我方 row 都 LOSS；
- InevitableLoss：矩阵所有合法 cell 都 LOSS。

若需要 mixed policy 才能改善 value，但没有概率 1 的终局保证，只返回 Value/Policy，不产生上述严格 Proof。

## 7. Horizon 与闭合条件

严格终局 Proof 只允许：

```text
HORIZON_TO_TERMINAL
HORIZON_TO_FRAME_LIMIT
HORIZON_TO_COMMITTED_DEADLINE   // 仅 InevitableLoss/Safety
```

- 非终局 depth leaf 使 ForcedWin/Nonloss/Loss 为 UNKNOWN；
- evaluator、概率剪枝、top-K 截断、cache collision 未核验、RuleVariant 分歧都会使 Proof UNKNOWN；
- committed bullet/bomb closure 必须推进到实体失效或 terminal，不受 decision depth 限制；
- repetition/draw 只有平台规则确认后才可闭合，当前不能自行添加。

## 8. CoverageCertificate

Proof/Hard 证书至少包含语义字段：

```text
certificateKind
rootInformationSignature
rulesetVersion
phaseOrderId
terminalPolicyId
ruleAssumptionMask          // strict proof 必须为 0
worldSupportVersion
enemyActionSupportVersion
ourActionSupportVersion
chanceSupportVersion
observationPartitionVersion
horizonKind
horizonEndFrame
capacityComplete
searchComplete
strategyConsistent
canonicalTraceRoot
```

DD2 已冻结 Coverage 的逻辑字段与统一 Result handle；DD3 已冻结 TypedArray SoA 与整数 handle 的物理边界，具体容量由 manifest 生成。ProofCache 命中必须核验 compact canonical signature；单独 hash 命中不能恢复 strict certificate。

## 9. 全动作被拒绝

ForcedLossRecovery 不再把拒绝动作伪装成安全：

1. 若存在 HARD_ALLOW：只比较允许动作；
2. 只有 HARD_INCOMPLETE：优先补全，否则选择最保守下界并返回 incomplete；
3. 全部 HARD_REJECT_POLICY：按 policy 明确的 terminal preference 排序；
4. 全部 HARD_REJECT_PROVEN：状态可生成 InevitableLossCertificate，选择延迟失败/改善 terminal tiebreak 的动作；
5. 返回结果必须携带 `recovery=true` 与原 HardGateStatus。

## 10. 必须性质测试

- WIN/LOSS perspective swap；
- DRAW 与 UNKNOWN_RULE 不相等；
- single crash 忽略星数；
- mutual crash stars/runtime；
- frame limit stars/runtime；
- exact runtime equality candidate；
- opponent-can-fire 只产生 ACTION_REFUTED/Risk，不产生 InevitableLoss；
- committed bullet 无逃生时产生 HARD_REJECT_PROVEN；
- RPS/Matching Pennies 不被序列化成错误 ForcedLoss；
- hidden worlds 禁止 strategy fusion；
- chance probability 未知但 support 完整时仍可做 universal Proof；
- 任一 RuleVariant 分歧使 strict Proof UNKNOWN；
- ForcedLossRecovery 保留拒绝原因。

## 11. 性能合同

- TerminalResolver 每次只读取固定数量 tank、stars、frame-limit 和 runtime relation，复杂度 O(1)，不扫描 event history。
- crash/damage batch 是否完成由 FrameTimeline 标志给出，TerminalResolver 不回扫 projectile/bomb。
- action HardGate 先复用 committed-hazard/deadline 结果；需要倒推时按 certificate deadline 闭合，预算耗尽返回 `HARD_INCOMPLETE`。
- enemy information partition 的策略一致性使用前缀 DFS/反例短路，禁止 materialize 完整策略笛卡尔积。
- 热路径证书只保存 compact handle/signature；完整 trace 和 source refs 只存在离线 RuleCorpus/Reference。
- Terminal、Hard 和 Proof 代码不得读取 opponent probability、RiskProfile、Evaluator 或 wall clock；时间中断由外层 SearchController 注入。

## 12. DD1 结论

Terminal、Hard 和 Proof 已拆成独立代数，`DRAW`、`UNKNOWN_RULE`、`NON_TERMINAL` 不再混用；战略 ForcedLoss 与无条件 InevitableLoss 不再混用。`OI-ARCH-003`、`OI-ARCH-004`、`OI-ARCH-005` 的设计冲突关闭，DD6 只负责实现和性质测试，不再重新定义量词。
