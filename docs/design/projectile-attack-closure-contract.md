# ProjectileAttackClosure 合同（PAC1）

状态：**IMPLEMENTED / STRUCTURAL PASS / BEHAVIOR NEUTRAL SAMPLE**，2026-07-23。

关联：

- [V2 战略层重构合同](v2-strategy-layer-contract.md)
- [风险递归合同](risk-backup-contract.md)
- [矩阵策略合同](matrix-policy-contract.md)
- [搜索语义合同](search-semantics-contract.md)
- [物理与 Hard 合同](hard-gate-contract.md)

## 1. 问题与结论

当前 `possibleHit` 已能回答：

```text
是否存在一个位置路径，使可见敌方在子弹到达某个射线格前进入该格？
```

它适合作为 soft FIRE 资格，但仍有两个缺口：

1. 根资格只使用格子最短路，没有完整朝向、转向和逐帧弹丸时序；
2. FIRE 执行后，普通 Physical value search 常使用 depth 2，不能稳定看到
   七格外约第 4 帧发生的命中，也没有把敌方首动作之后的全部逃生路径压缩成
   可复用证书。

PAC1 新增一个有严格边界的攻击闭包：

```text
Candidate FIRE
× EnemyAction
× EnemyChance
→ committed projectile timeline
→ enemy orientation-aware reverse viability
→ first-action survival relation
```

它不是第二套 Minimax，不提高通用 decision depth，也不修改平台物理。

## 2. 量词与状态

每个根矩阵单元使用：

```text
our row = FIRE
enemy column = 一个根 EnemyAction
chance = 该动作全部规范 chance 结果
continuation = 敌方之后每帧合法的 HOLD / GO / TURN_LEFT / TURN_RIGHT
```

状态只取本闭包需要的物理维度：

```text
EnemyPose = cell × direction
ProjectileTimeline = tick × member × cell
TerrainTopology
EnemyCadence / survival-skill capability
```

判定：

- `PROVEN_DOOMED`：该首动作的所有 chance 后继，在允许更宽松基础移动的前提下，
  仍没有任何状态能活到全部新弹丸规范失效。
- `SURVIVES`：至少一个后继存在完整逃生 witness。
- `UNKNOWN`：规则支持、技能、容量或轨迹证据不完整。
- `TERMINAL_HIT`：FastKernel 已在本帧确认敌方单方被新弹丸击毁。

`PROVEN_DOOMED` 是“敌方无法逃过该 committed projectile”的局部证书，
不是“我方最终获胜”的全局 Proof。敌方可能在被命中前反击、制造同归于尽或改变
终局星数，因此 PAC1 永远不能直接写 Hard 或 ForcedWin。

## 3. 剪枝语义

PAC1 剪枝的是一个敌方首动作之后的移动 continuation，而不是无条件删除根列：

```text
根 EnemyAction 列必须保留
→ 该 FIRE 行中，PROVEN_DOOMED 单元不再展开普通移动树
→ 用闭包的 committed attack cell pressure 表示
→ Minimax 仍可选择其他 SURVIVES/UNKNOWN 敌方列
```

只有现有 ForcedWin 在完整 EnemyAction、Chance、HiddenWorld 和我方生存量词上
全部证明后，才能返回严格胜利。PAC1 可以为 ForcedWin 排序或提供证据缓存，但
不能独立升级 Proof。

严格 Minimax 还具有一个容易误解的性质：若同一敌方决策点同时存在死亡动作和
生存动作，删除死亡动作只减少计算量，不会自动提高我方的 worst-case 值；理性敌方本来就会
选择生存动作。只有以下证据之一出现时，FIRE 值才应提高：

- 所有完整敌方应对都被证明必死；
- 生存应对集合被迫进入更差的 endpoint/position value；
- 生存应对为攻击、抢星或逃生制造了可验证的机会成本。

PAC1 当前证明第一类局部关系并输出有限 soft pressure；它没有实现完整
survivor-frontier endpoint value，因此不能把“存在某个敌方死亡路径”当成开火收益。

## 4. 轨迹和动作时序

时序必须与 `FastKernel.applyFrame` 一致：

```text
双方执行动作
→ 星星
→ projectile substep 0
→ projectile substep 1
→ bomb
→ terminal
```

闭包用 projectile tick 表示两个 substep。根敌方动作在 tick 0 执行：

- `GO` 先移动，再检查 tick 1/2 弹丸；
- `TURN_LEFT/RIGHT` 先改变方向，再检查弹丸；
- `NONE/FIRE/BOMB/非位移技能` 是 HOLD pose；
- stun 的 normal/reversed 分支全部检查；
- 冻结/中毒节奏采用允许额外行动的生存上界：如果该上界仍无逃生，才可
  `PROVEN_DOOMED`；
- active/ready shield、teleport 或 boost 可能扩大生存集合，证据不能覆盖时返回
  `UNKNOWN`。

普通 FIRE 创建一个 member；overload 创建同 group 的两个独立 member。每个 member
从自己的 source 开始逐 tick 前进，遇墙、土或边界规范失效。子弹互撞不抵消。

## 5. 固定接口

```text
ProjectileAttackClosure.evaluate(
  bundle,
  ourActions,
  ourArguments,
  ourCount,
  enemyActions,
  enemyArguments,
  enemyCount,
  combatVector
)
```

固定输出：

```text
status[row]
completeEnemyColumns[row]
doomedEnemyColumns[row]
survivingEnemyColumns[row]
unknownEnemyColumns[row]
doomedByFrame[row]
cellStatus[row * MAX_ENEMY_POLICIES + column]
cellPressure[row * MAX_ENEMY_POLICIES + column]
```

`CombatVector` 同步保存根级摘要，但不能把 cell relation 提前压成一个 robust 值。

## 6. 与现有层的接线

正式顺序：

```text
Hard / Safety / committed own Escape
→ CombatVector possible-hit
→ ProjectileAttackClosure
→ canonical value / Information search
→ Risk / Pareto / global robust floor
→ StrategyBand
→ StageMatrix(base cell + PAC soft cell pressure)
```

约束：

- PAC 不修改 `hardStatus`、Safety death mass、EO membership 或 Proof。
- `cellPressure` 只能影响已经通过 Risk 和 global safe floor 的 StageMatrix 单元。
- `UNKNOWN` 压力恒为 0。
- 只要存在 `SURVIVES/UNKNOWN` 列，PAC 不能产生 robust kill pressure。
- 即使所有列 `PROVEN_DOOMED`，PAC 仍只提供攻击闭包证据；严格胜利由 ForcedWin
  独立确认。
- 无 evaluated search matrix 时，PAC 只通过有限的 expected tactical 摘要影响选择。

## 7. 性能与缓存

实现必须：

- 使用固定整数 TypedArray；热路径对象分配为 0；
- 每个 FIRE row 只构建一次新弹丸 timeline 和一次 reverse-viability slab；
- 每个 enemy column 只做 O(chance) 的 successor pose 查询；
- 不为每个敌方动作重建全地图距离场；
- query key 至少绑定：
  `source/direction/overload/topology/enemy pose/effect cadence/enemy action support`；
- 缓存失效绑定 terrain topology、弹丸 group/member 语义和技能生存能力；
- budget 不足或 unsupported action 必须返回 `UNKNOWN`，不得猜测 doomed。

微基准门：

- 固定 Node、固定输入、预热后五批；
- PAC warm P95 不超过 PAC-off 的 120%（以 paired median 报告，并列出全部批次）；
- 20×20、普通单弹、overload 双弹、24 enemy columns 均零热分配；
- 相同输入缓存 on/off 的 cell status 完全一致。

## 8. 验收

必须包含：

1. 七格外敌方移动入弹道，soft FIRE 合格；
2. 朝向导致需要额外转向时，PAC deadline 与 FastKernel 穷举一致；
3. 一个敌方首动作必死、另一个能逃：只标前者，不能 ForcedWin；
4. 所有基础首动作必死：全部 cell 标记，但 PAC 不单独写 Proof；
5. shield、teleport、boost、stun、poison/freeze、overload 双弹；
6. 墙、土、边界和子弹穿越；
7. 根状态与 hash 完整恢复；
8. 独立小图 exhaustive oracle 对全部 pose/action/chance 零假阳性；
9. source/minified 语义一致，Hard/Proof/Risk/EO 既有门全绿。

抽样 A/B 必须单独报告：

- PAC opportunity、doomed/surviving/unknown columns；
- FIRE、purposeful FIRE、单方击毁和 W/L/D；
- `LOSS→WIN / WIN→LOSS`；
- 节点数与 callback work；
- 所有硬不变量。

PAC1 通过结构测试不等于 STRAT2 D4、完整 arena、代码体积或发布资格通过。

## 9. PAC1 实测结论

固定 Node `v24.16.0` 的 5 次预热、5 批成对根基准：

- PAC-off P95：1,654,587µs / 128 roots；
- PAC-on P95：1,643,148µs / 128 roots；
- P95 ratio：9,930/10,000，paired median ratio：10,140/10,000；
- 640 次 reverse build，零热分配、零 root restore failure。

固定 32 个 Discovery 场景、4 variants、1 repetition 的 256 局因果 A/B：

- CURRENT 与 PAC-off 均为 `9/118/1`，得分 7.42%，星差 -181；
- 两边均为 FIRE 1,289、单方击毁 8胜/20负；
- CURRENT 执行 1,282 次 reverse build，得到 1,280 个 complete row、
  2 个 incomplete row 和 137 个 doomed cell；
- 全部 128 个成对结果和动作计数不变；硬不变量全为0。

因此 PAC1 的结构、物理量词和性能门通过，但该样本没有证明 gameplay lift。
137 个 doomed cell 多数与短深度已见终局重复；远距离 possible-hit 的敌方根动作通常仍有
生存 continuation。下一次若继续，应单独设计 survivor-frontier endpoint value，
不得继续提高固定 FIRE bonus 或把局部 doomed 升级成 Proof。
