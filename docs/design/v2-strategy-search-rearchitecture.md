# V2 STRAT3：战略—搜索反向接入架构

状态：`IMPLEMENTED / DISCOVERY_NOT_QUALIFIED`  
决策：`DEC-0096`  
修订对象：`DEC-0095`、`v2-strategy-layer-contract.md` 第9、11、12、14、20节。

## 1. 问题与目标

STRAT2 的模块边界表面上是 `Risk → StrategyBand → StageMatrix`，但 production
在 Risk 之前已经让 StrategySelector 选择 evaluator 语义、动作路径偏好和转向目标。
固定样本中，动态 STRAT2 只有约 6% 得分，而同一版本强制 STAR 约 23%；全量固定
266场景约11%。这说明战略不是在安全搜索结果上作选择，而是在搜索前改变了“局面值是什么”。

STRAT3 的目标不是降低 Minimax 正确性，而是把它从全局战略控制器降为**战术验证器**：

```text
规则/确定性危险/严格证明
→ 战略中立的长期基础估值
→ 有战术接触时运行一次 Physical/Information Minimax
→ Risk / committed EO / Pareto / robust safe floor
→ 各战略从合格动作中提出代表
→ 一次 StageMatrix
→ 最终动作确定后提交 StrategyState / PersistentPlan
```

## 2. 从 V1 继承的结构原则

V1 不作为源码模板，只提供已经由真实对战验证的控制结构：

- 子弹、炸弹和确定性必胜攻击在通用搜索前短路；
- 只有 `tacticalContact` 才运行有界 Minimax；
- 没有接触时使用稳定路径/位置控制，不要求浅搜索看见128帧终局；
- intent 只给已搜索动作很小的持续性边际，最终仍经过独立安全守卫；
- runtime fallback 降低搜索工作，不删除确定性危险守卫。

STRAT3 不复制 V1 的对象、浮点 rollout 或局部规则补丁，只采用其“确定性控制器包围
有界战术搜索”的层级。

## 3. 权威调用顺序

```text
L0  FinalActionGate / strict Proof / committed physical closure
L1  Canonical Baseline Evaluator（不读取 strategyId）
L2  单次战术搜索（仅 tacticalContact；无接触时为空）
L3  Risk acceptable set
    → committed EscapeObligation
    → Pareto
    → maximum robustLower safe floor
L4  StrategySelector.prepare(qualified evidence)      // 观察，不提交
L5  StrategyPortfolio.buildPortfolio(...)
    = neutral base anchor
      + 每个 eligible strategy 最多2个代表动作
L6  单次 StageMatrix / expected / tactical / stable row
L7  FinalActionGate
L8  StrategySelector.commitSelected(ownerOf(final row))
```

禁止顺序：

- strategy 在 L3 前改变 evaluator、RiskProfile、Hard、EO 或 search cell；
- rejected/dominated/低于 safe floor 的攻击使 `KILL_PRESSURE` eligible；
- 先提交 strategy，再按该 strategy 删除动作；
- 为五个 strategy 分别运行 Minimax；
- 通过 FIRE/STAR 固定 bonus 制造战略差异。

## 4. 接口与所有权

### 4.1 `PolicyLayer`

```text
prepareNeutralSearch(featureInput, action, planKind)
  固定 BASELINE_OUTCOME evaluator、baseRisk 和 opponent snapshot。

prepareStrategyPortfolio(strategyInput, globalMode)
  只构造 StrategyDecisionSlab；不改变 current/generation/dwell。

commitSelectedStrategy(strategyId, globalMode)
  只在最终动作通过 FinalActionGate 后更新跨root状态。
```

旧 `prepareSearch` 只作为兼容入口；production 禁止调用。

### 4.2 `StrategySelector`

`prepare()` 的证据只来自 L3 后的合格动作。`KILL_PRESSURE` 必须同时满足：

```text
verified attack opportunity >= 2500
purpose completeness >= 4500
存在 Risk/EO/Pareto/safe-floor 合格攻击行
```

星存在且有合格收集/拒绝行时，`STAR_CONTROL` 保持 eligible；不能要求我方已经在星路上
领先五格才承认星目标。

### 4.3 `StrategyPortfolioSlab`

固定 TypedArray：

```text
selected[A]
baseAnchor[A]
proposalMask[A]          // 每bit一个strategy
ownerStrategy[A]
ownerBand[A]
proposalCountByStrategy[5]
```

基础锚点是 L3 集合中按 `expected → tactical → stable row` 选出的中立动作，始终保留。
每个 eligible strategy 从同一集合中提出最多两个 `PRIMARY/SUPPORT` 代表；没有时可以提出
一个 fallback。Proposal 不改变 action value、risk tuple 或 matrix cell。

最终 action 若属于多个 strategy，先保持 current owner；否则按 band、verified opportunity、
stable strategy id 选择 owner。owner 只影响下一 root 的候选顺序/Plan 连续性。

## 5. 基础估值

`CANONICAL_OUTCOME` 重新绑定到已验证的 profile 0（`BASELINE_OUTCOME`）。这不是宣布
“星永远优先”，而是恢复浅搜索看不见的长期位置/星路 shaping；攻击价值仍通过
CombatVector、search cell 和 StageMatrix竞争。

同一 state/action 下切换任意 strategyId 必须满足：

```text
feature raw identical
baseRisk identical
tactical score identical
search key/value identical
Hard/Proof/Safety/EO identical
```

## 6. Minimax 的新职责

Minimax 只回答短程对抗问题：开火后敌方应对、转向/移动接触、技能chance、隐藏world
和已提交弹道 continuation。它不负责凭2–3层搜索决定长期抢星、巡航和128帧目标。

当前 production 已有 `tacticalContact` 门。本阶段不修改 contact 阈值、depth、budget 或
Information semantics；只有在独立 benchmark/回归证明后才能收紧接触定义。

## 7. 性能合同

- 单 root：一次共享证据、一次可选 Minimax、一次 Risk、一次 portfolio、一次 matrix；
- `S=5`、`A<=MAX_OUR_ACTIONS`，portfolio 为固定 `O(S*A)`；
- 无 object/Array/Map/Set/closure 热分配，无 float TypedArray、随机数或时钟；
- strategyId 不进入 Physical/Information value cache key；
- portfolio 失败必须保留中立锚点，不能扩大 Risk 集合；
- source/minified、cache on/off、root restore 保持一致。

## 8. 验收阶梯

### RST1：无损反向接入（本阶段）

- 完整 Minimax core 与 GR0 UT；
- strategy 不得先于 Risk prepare；
- rejected FIRE 不能激活 KILL；
- base anchor 永不丢失；
- 32场景样本绝对得分至少恢复到旧 SS current 的26.67%附近；
- 不运行全量 arena。

### RST2：committed membership + soft value

在不改变 Hard 的前提下，以 committed-only 作为 acceptable membership 开发基线；
possible projectile、future FIRE、unknown 逐项作为 robust/value 恢复。目标先达到固定小样本
45%–50%，再进入独立验证。

### RST3：真正可调的战略候选

战略差异必须来自不同的多步候选/Plan：攻击瞄准链、击杀链、星收集/拒绝链、保领先链和
逆转链。不得通过换 evaluator 或加固定 action bonus制造。每次只能改变一个生成器，并保留
中立锚点作 no-loss 对照。

### RST4+：资格

96场景 Discovery → 独立170验证 → 固定266 → 最新动态全量。只有固定验证达到约50%后才
运行全量；最终 enable 门仍为击毁胜提升至少10%且总得分严格超过60%。

## 9. 当前结论

本阶段32场景、128局 CURRENT 为29胜/84负/15平，得分28.51%，星差-72；旧动态
STRAT2同样本约6.25%。全部硬不变量为0。强制STAR和关闭portfolio与CURRENT逐局一致，
证明已完成止损，但当前 atomic proposal 尚未提供可观察战略控制力。

因此 RST1 接受为“架构反向接入完成”，不接受为玩法资格或50%恢复。下一步是 RST2，
而不是调 selector threshold、FIRE bonus 或再次跑6,608局。

