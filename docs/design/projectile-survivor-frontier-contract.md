# ProjectileSurvivorFrontier 合同（PAC2）

状态：**IMPLEMENTED / STRUCTURAL PASS / GAMEPLAY REJECTED**，2026-07-24。

关联：

- [ProjectileAttackClosure 合同](projectile-attack-closure-contract.md)
- [矩阵策略合同](matrix-policy-contract.md)
- [风险递归合同](risk-backup-contract.md)
- [搜索语义合同](search-semantics-contract.md)

## 1. 问题

PAC1 能证明：

```text
Candidate FIRE × EnemyAction
→ PROVEN_DOOMED / SURVIVES / UNKNOWN
```

但固定32场景因果样本中，1,282次闭包产生137个doomed cell，动作和胜负仍完全不变。
这是严格Minimax的正常结果：只要一个敌方决策点仍有生存应对，死亡应对本来就不会成为其
best response；删除死亡分支只减少计算，不会自动提高我方worst-case。

PAC2 解决的是另一个问题：

```text
敌方虽然能活，但为了活下来，最优生存前沿是否失去反击位置或机动性？
```

## 2. 双前沿量词

对每个已通过PAC1资格的：

```text
FIRE row × EnemyAction column × root Chance union
```

从根敌方动作执行后的pose开始，计算两个相同时间窗、相同行动能力的前沿：

1. `baseline frontier`：忽略候选新弹丸的致命格；
2. `constrained frontier`：每个projectile substep删除被新弹丸命中的pose。

未来动作集合固定为：

```text
HOLD / GO / TURN_LEFT / TURN_RIGHT
```

HOLD代表NONE、FIRE、BOMB及不移动技能的姿态效果。未来攻击、技能伤害和我方未来动作不在
这个局部DP内，它们继续由Physical/Information Minimax处理。

root stun chance使用所有规范后继pose的并集。并集扩大敌方可选前沿，因此不会夸大压制收益。
active/ready shield、teleport、boost或不完整动作支持使frontier value返回0；
PAC1仍可保留其`SURVIVES/UNKNOWN`关系。

## 3. Endpoint value

不能使用死亡路径数量或endpoint数量直接加分。敌方在每个前沿中选择对自己最有利的endpoint。

每次PAC evaluate只构建一次面向我方当前pose的`CounterfireDistanceField`：

```text
goal pose =
  terrain可行
  AND 与我方当前cell有清晰直线
  AND direction朝向我方
```

在`cell × direction`图上反向BFS，边为GO或TURN。对每个前沿计算：

```text
bestCounterfireSetup = min(distance(endpoint))
bestMobility = max(legal GO neighbors(endpoint))
```

soft机会成本：

```text
setupDelay =
  max(0, constrainedBestCounterfire - baselineBestCounterfire)

mobilityLoss =
  max(0, baselineBestMobility - constrainedBestMobility)

frontierPressure =
  min(1600, min(4, setupDelay) * 250 + mobilityLoss * 150)
```

endpoint count reduction只记录审计，不进入分数。

该value是局部survivor-frontier heuristic，不是完整Minimax值或胜利概率。它回答“躲这颗子弹
是否推迟敌方最早反击、降低其最佳机动性”，不回答敌方未来攻击是否最终成功。

## 4. 接线与所有权

正式顺序保持：

```text
Hard / Safety / committed own Escape
→ Combat possible-hit
→ PAC1 committed survival relation
→ PAC2 constrained-vs-baseline frontier
→ canonical Physical/Information search
→ Risk acceptable set / EO / Pareto / robust floor
→ Combat residual pressure
→ StrategyBand
→ StageMatrix(base cell + PAC cell pressure)
```

约束：

- PAC2不修改Hard、Safety、EO、strict Proof或`robustPressure`。
- `frontierPressure`只属于expected/tactical combat residual。
- Risk不接受的FIRE不能被PAC2恢复。
- `UNKNOWN`或技能支持不完整的cell压力为0。
- 候选弹丸在root frame内规范失效时不建立future frontier；该关系已由PAC1和canonical
  search覆盖。
- StageMatrix仍保留全部根EnemyAction列。
- `PROVEN_DOOMED`继续使用PAC1 pressure；PAC2只补充`SURVIVES` cell。
- 所有列的root摘要取有限平均，不能把一个高收益列升级成robust lower bound。

## 5. 固定内存与缓存

固定整数slab的逻辑接口：

```text
frontierA/frontierB bitset[cell × direction]
frontierWordA/frontierWordB[non-empty word]
counterfireDistance[cell × direction]

cellSetupDelay[row × enemyColumn]
cellMobilityLoss[row × enemyColumn]
cellEndpointReduction[row × enemyColumn]
frontierColumns[row]
```

要求：

- 热路径对象分配为0；
- 不保存每tick完整frontier历史；
- baseline和constrained顺序计算，复用同一双buffer，不同时保存四份frontier；
- Counterfire BFS也复用该双buffer，不分配独立queue；
- 相同EnemyAction后继pose使用逐字段精确匹配后复用，禁止仅凭hash命中；
- CounterfireDistanceField每个root最多构建一次；
- exact PAC缓存必须保存全部PAC2 cell/root输出；
- cache on/off关系和动作一致；
- unsupported/capacity必须返回0 pressure，而不是估值。

## 6. 验收

结构UT：

1. 无弹道约束时baseline/constrained完全相同，pressure=0；
2. 敌方有生存路径但反击setup被推迟，pressure>0；
3. 仅endpoint数量减少而最优endpoint不变，pressure=0；
4. mobility最佳值下降产生独立有限pressure；
5. shield/teleport/boost/UNKNOWN pressure=0；
6. stun union、poison/freeze cadence、overload双弹；
7. 小地图forward frontier oracle逐pose一致；
8. cache幂等、root restore、零热分配；
9. PAC2不能改变Hard/Proof/Risk acceptable membership。

性能门：

- 固定Node、5次预热、5批paired root；
- PAC2-on相对PAC2-off P95不超过120%；
- paired median不超过120%；
- root restore和热分配为0。

因果检查：

- 先运行固定32场景、4 variants、1 repetition的PAC2-on/off；
- 所有硬不变量为0；
- 必须报告frontier opportunity、setup delay、mobility loss、FIRE、单方击毁和W/L/D；
- 动作是否变化用于解释PAC2的实际覆盖率，不作为跳过全量的条件。
- 结构、性能和硬不变量通过后，按用户最新授权运行rolling compact全量arena。

实施证据表明PAC2在32场景样本产生847个非零pressure cell但没有改变动作；随后6,608局
全量得分11.20%，因此本合同的结构和性能成立，gameplay资格不成立。详见
[PAC2实施记录](../implementation/pac2-survivor-frontier.md)。

全量arena只提供本地模拟证据，不执行官方simulate、publish或challenge。
