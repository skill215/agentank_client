# DD6 Overview 与一致性审计

状态：DD6 COMPLETE（详细设计），2026-07-15。DD7 READY。

## 1. 阶段结论

DD6 已把搜索核心从“深层 Minimax 给一个最终分数”改成分层、可中断的四条合同：

```text
ValueSearch
  深层 serialized pure -> 快速 sound lower/upper

MatrixPolicy
  根/关键节点 -> restricted matrix + Double Oracle + mixed policy

ProofSearch
  InformationState -> observation-consistent AND/OR/DFPN Proof

RiskBackup
  Chance -> HiddenWorld -> EnemyAction 的递归 ε-contamination
```

四条路径共享 Fast/Terminal/Hard/Result ABI，但不混用结论：point estimate不是bound，bound不是Proof，ActionRefuted不是ForcedLoss，risk不是Hard。

## 2. 产物

| 文档 | 冻结内容 |
|---|---|
| [value-search-contract.md](value-search-contract.md) | terminal/horizon interval、leaf、pure bounds、serialized search、anytime |
| [matrix-policy-contract.md](matrix-policy-contract.md) | critical-node条件、Double Oracle上下界、整数regret、public-belief、Policy |
| [proof-search-contract.md](proof-search-contract.md) | ForcedWin/Nonloss/Loss量词、strategy consistency、AND/OR、DFPN、coverage |
| [risk-backup-contract.md](risk-backup-contract.md) | 三维rho、动态risk class、对手nominal、safe-floor唯一关系 |
| 本文 | 退出门、冲突审计与DD7准入 |

## 3. 退出门

| DD6 退出条件 | 设计结果 | 说明 |
|---|---|---|
| pure deep search不冒充最终值 | PASS | 同时行动使用`max-min L / min-max U`包络 |
|关键节点矩阵可收紧且不裁support | PASS | restricted sets + full best-response scans |
| mixed policy稳定整数输出 | PASS | average strategy、0–10000、最大余数、根PRNG一次 |
| InformationState Proof量词完整 | PASS | 双方观察一致，world/chance全覆盖，分裂后才可分叉 |
| ForcedWin/Nonloss/Loss对称 | PASS | goal-specific AND/OR图与simultaneous row/column规则 |
| risk递归且动态一致 | PASS | chance→hidden→enemy rectangular contamination |
| root利用不重复风险 | PASS | robust primary + `allowedExploitLoss=0` safe-floor tie-break |
|任意中断保持区间 | PASS |未访问child用wide bound，batch发布last complete state |
| UNKNOWN不升级 | PASS | rule/support/capacity/time/assumption逐层传播 |

这是详细设计通过。RPS、Matching Pennies、strategy fusion、risk recursion等实现测试矩阵已冻结，但不能在JavaScript solver尚未实现时宣称execution PASS。

## 4. 搜索值语义审计

- terminal WIN/LOSS/DRAW分别为`+10000/-10000/0`；
-普通evaluator只有ordering point，不能收紧terminal-game interval；
- horizon evaluator可以对指定horizon exact，但带`HORIZON_UTILITY`，不写ProofCache；
-纯同时行动上下界只在dependency complete且相等时成为exact；
- incomplete child始终保留wide bound，预算只影响宽度；
-`INTERVAL_COMPLETE`可传播，不能作为scalar cutoff；
-stage matrix下界由受限我方policy对完整敌方BR给出，上界由受限敌方policy对完整我方BR给出。

这关闭了“pureLower或pureUpper任选一个作为最终Minimax值”的歧义。

## 5. Proof 一致性审计

| 结论 | 量词核心 | 不允许的替代 |
|---|---|---|
| ForcedWin | 存在我方共同policy，覆盖所有敌方policy/world/chance | expected=10000、单条kill line |
| ForcedNonloss | 同上，终局WIN/DRAW且完整game horizon | committed deadline前存活 |
| ForcedLoss | 存在一个敌方观察一致policy，击败所有我方policy/world/chance | 每个row各找不同column |
| InevitableLoss | 所有敌方policy下仍LOSS | 战略ForcedLoss |
| ActionRefuted | 一个合法loss witness反驳ActionKey | state无ForcedWin/ForcedLoss |

Residual support、unknown rule、USER_CONFIRMED assumption、capacity/time中断任何一个未闭合都使strict Proof UNKNOWN。DFPN只改变frontier选择，不改变上述量词。

## 6. Risk 冲突关闭

原草案存在两个潜在冲突：

1. HiddenWorld和Chance被合成一个`nature`权重；
2. matrix已做一次risk后，根又允许`safeLowerBound-allowedExploitLoss`做第二次风险交易。

DD6 统一为：

```text
rhoChance -> rhoHidden -> risk-transformed Enemy matrix
-> recursive robust value/policy
-> same robust safeFloor内expected零损失tie-break
```

三维lambda分别存在，范围0–9900；risk=0三维worst，risk=100每维仍有至少1% contamination。`allowedExploitLoss=0`，因此同一个risk参数只解释一次。`OI-ARCH-009`关闭。

技能风险不新增第四量词：技能选择是EnemyAction，技能随机结果是ChanceOutcome，隐藏技能状态是HiddenWorld；资源承诺和信息暴露进入DD7 feature/stateRiskClass。

## 7. 跨文档冲突审计

| 主题 | 潜在冲突 | DD6处置 | 当前权威 |
|---|---|---|---|
| pure search与matrix | 深层纯值被当equilibrium | pure只给包络；关键节点matrix | Value + Matrix contracts |
| matrix与risk | solver可能重复混合opponent model | cell先nature rho，matrix只求一次enemy变换 | Risk + Matrix |
| root safe exploitation |第二风险预算 | V1零损失safeFloor tie-break | Risk contract |
| proof与value | exact depth value冒充ForcedWin | Proof只认coverage/terminal量词 | Proof contract |
| hidden strategy fusion | 每world分别选动作 | observation分裂前common action | Proof/Value |
| enemy knowledge |所有world共用动作或逐world作弊 | enemyInformationPartition response policy | Matrix/Proof |
| risk与Hard |risk=100覆盖必死 | Hard先执行且risk不可读取/修改 | DD5 + Risk |
|概率未知 |用50/50/均匀默认 | support可Proof；Value interval | Risk/Value |
| mixed输出 |bestAction与policy双ABI | deterministic/mixed都经PolicyArena | Action Result ABI |
| fallback |缩深改变值语义 |只变SearchProfile，已完成interval仍有相同语义 | Value；DD8时间owner |

现行`hybrid-solver-contracts.md`与`search-semantics.md`已同步三维风险和零损失safe-floor；未保留活动的旧`allowedExploitLoss来自risk`公式。

## 8. 性能约束

- deep默认serialized pure，不建regret matrix；
-只有根/关键gap节点建立restricted matrix；
-Double Oracle只materialize受限cells与BR所需cells；
-public-belief response policy用prefix惰性枚举；
-singleton信息态强制降级Physical fast path；
-Search/Proof/Matrix/Regret scratch预分配TypedArray SoA；
-固定batch检查中断flag，solver不读wall clock；
-所有概率/value/risk使用整数与向外取整；
-capacity不足发布interval/UNKNOWN，不裁world/action后标complete。

## 9. 未关闭但不阻塞DD7

-具体0–100 risk表、stateRiskClass阈值：`OI-R3-001`进入DD7/Benchmark校准，端点/单调/三维ABI已定；
-depth、critical-node额度、matrix/DFPN iterations：`OI-R3-003`由DD8真实预算冻结；
-opponent nominal概率、confidence和风险喜好：DD7；
-evaluator feature envelope和weights：DD7；
-continuation basis具体成员/容量：DD7提出、DD8 benchmark；
-Cache容量与warm-start：DD8；
-未确认平台RuleVariant：对应branch继续unsupported/UNKNOWN，不由搜索关闭。

## 10. DD7准入

DD7可以开始，因为：

1. 软feature明确只能提供point/envelope，不能生成Hard/Proof；
2. StrategySelector可以选择EvalProfile/RiskProfile，但不能改搜索量词；
3. OpponentModel只有nominal q和confidence入口，无法污染physics/possibility；
4.技能descriptor的action/chance/hidden归属已固定；
5. ShotPlan/BombPlan可以绑定ActionKey/entity/deadline，但每次继续仍先过DD5 Hard；
6. mixed/deterministic输出和根取样已有唯一ABI；
7.参数可以按feature dependency和cache version快速调分，而不重做物理。

DD7必须依次定义 Evaluation、StrategySelector、OpponentModel、Skill descriptor/state machine、Plan；每份都要声明固定成本、版本、失效和“不得进入Hard/Proof”的边界。
