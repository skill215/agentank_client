# BP152–BP155：Minimax参与率、支持恢复与动作所有权边界

日期：2026-09-02。

## 结论

当前V2的Physical Minimax不是“完全没运行”，但参与率极低。Discovery64的8,322个接触根中只有312个
观测exact；原默认Physical搜索完成约3.6%接触根。关闭这部分搜索后，128局得分由8.20%降至7.42%，
少1胜，并节省约11.4%候选本地计算。因此现有exact Physical搜索净正，不应删除，但它也无法解释V2的
整体低胜率。

全接触启用Information value不是解法。固定16中Information搜索完成1,182根，但全部是
`incompleteValueEvidenceOnly`，完整owner为0；候选本地计算增加60.8%，得分9.38%降至7.81%。即使
搜索结果没有动作所有权，其work仍推进runtime ledger并提前触发fallback，所以这种“Shadow”并不行为
中性。

## BP154：Physical支持可恢复，不等于搜索应全开

接触支持普查发现，8,010个inexact根中6,487个（80.98%）只有
`POSSIBLE_ENEMY_PROJECTILE`缺口，且完整possible-projectile pool证明当前候选数为0。这个合同已经由
BP150严格证明器采用：

```text
gap == POSSIBLE_ENEMY_PROJECTILE
&& possiblePool.complete
&& possibleCount == 0
```

它可以把当前状态恢复为PhysicalState；future enemy FIRE仍是Minimax里的EnemyAction，不会被删除。

但在全部此类根上运行Physical搜索失败。固定16完成1,028个新增根后：

- 得分9.38%→6.25%；
- candidate runtime 2.06s→3.68s；
- 493个接触根进入emergency，820个根失去value budget；
- FIRE增加56次，但少2个平局、没有净胜局。

第一版`purposeCompleteness>=4500`攻击门把1,562个可恢复根全部挡住，证明该字段不是搜索前的有效调度
信号。改成“存在Hard允许、post-fire escape完整、清晰射线或possible-hit的FIRE挑战行”后，固定16得到
1个`LOSS→DRAW`且零负转换；扩到Discovery64后反转为2个`WIN→LOSS`、1个`DRAW→LOSS`、仅1个
`LOSS→DRAW`，得分8.20%→6.64%，我方crash增加5。

翻转根证明了两个不同问题：

1. 同样的`GO→FIRE`在一局改善、另一局把胜局改成负局，finite-depth FIRE偏好不是证书；
2. 另一个负局由FIRE机会触发搜索，但StageMatrix实际把`TURN_RIGHT→GO`，说明调度理由与最终动作所有权
   错位；
3. 平转负局首次分歧时没有搜索，只是此前work令runtime mode更早降级，随后`TURN→BOMB`。

## BP155：逐响应支配过严，且无消费者的搜索仍有成本

BP155先让普通控制器产生incumbent，再禁止Physical StageMatrix全局接管。只有FIRE在每个完整敌方响应
列都不差于incumbent，并至少一列严格更好，才允许形成提案。

固定16中231个完整搜索根得到：

- verifier checks 231；
- strict proposals 0；
- overrides 0；
- W/L/D完全不变；
- 但额外work仍令12个根进入emergency，7局动作流发生变化。

所以当前depth-2点值处在尴尬区间：作为全局owner太不可靠，作为严格逐列证书又没有召回；没有消费者
时运行仍会污染后续fallback。下一结构不能继续调margin、risk或depth来补救。

## 架构决定

后续根组合固定为：

```text
Physical Hard / committed EO / strict Proof
→ native BasePolicyKernel long-horizon incumbent
→ 仅对明确challenger运行有消费者的战术搜索
→ terminal / strict event / complete policy interval才可反驳incumbent
→ FinalActionGate
```

这与BP68的独立证据一致：原生BasePolicy组合在Discovery64达到57.81%，Strategy Holdout达到45.05%，
显著优于当前约8%的V2根；它虽未通过旧50%资格门，却是正确的迁移基线。下一步应把BP68的原生动作域、
intent、有限同时maximin和软风险授权从诊断宿主迁入V2，而不是让当前primitive StageMatrix继续充当
长期控制器。

所有BP154/BP155开关保持默认关闭。四份固定16 CURRENT动作流指纹完全一致，Hard误拒、restore、
timeout/error均为0。

## 证据与复现

- 全局参与率：`config/engine-v3/base-policy-kernel-bp152-bp153-minimax-participation-evidence.json`；
- 支持恢复：`config/engine-v3/base-policy-kernel-bp154-bp155-support-restoration-evidence.json`；
- 复现：`tools/minimax-global-participation-audit.sh`、`tools/minimax-support-restoration-audit.sh`；
- BP154/BP155证据fingerprint：
  `198361010beb1b81bd7dcd3ba93c2206ec6e36699302f9b82050234bd63b2797`。

