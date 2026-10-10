# V2高性能Proposal--Verify--Arbitrate架构

## 1. 目标

修复Strategy、Risk和Search的动作所有权冲突，同时保持现有高性能状态、缓存和搜索实现。
本架构不新增第二套WorldState，不复制ActionOutcome，不在决策热路径创建对象。

## 2. 固定所有权

```text
Primitive action + PlanSketch proposal
  -> Hard / Safety
  -> Risk acceptable set
  -> committed EO intersection
  -> Risk Pareto
  -> Proposal classification（只标注目标，不删除动作）
  -> Verification（复用Safety/Search/EO证据）
  -> PVA Arbiter（在合法Plan间选择）
  -> FinalActionGate
  -> materialize一个PersistentPlan
```

- Proof只在完整必胜证书成立时直接接管；
- Hard只否决完整PhysicalState上的必死或政策失败；
- Strategy只产生攻击、星、保全和位置Plan标签，不拥有动作成员资格；
- Risk只建立绝对可接受集合与风险Pareto，不比较目标价值，也不恢复空集合；
- committed EO只和真实炸弹、已提交敌弹的可活首动作取交集；
- Search只在Tactical Contact运行，输出反驳、robust/expected区间和矩阵证据；
- PVA Arbiter拥有最终软选择，但不能恢复前面任何拒绝；
- FinalActionGate只做最终合法性检查。

## 3. 高性能数据布局

复用：

- `StrategyBandSlab.selected`：Risk/EO/Pareto之后的完整动作集合；
- `StrategyBandSlab.purpose/proposalMask`：每动作的多目标提案标签；
- `PlanSketchArena`：目标、deadline、progress、dependency和combat字段；
- `ActionOutcomeSlab`：Hard、Safety、Risk、Search和Combat证据；
- `TacticalEnvelopeView`：Search的严格反驳视图；
- `PersistentPlanArena`：只materialize最终动作。

新增一次构造的固定数组：

```text
verification[MAX_OUR_ACTIONS] : Uint8Array
goal[MAX_OUR_ACTIONS]         : Uint8Array
```

在当前`MAX_OUR_ACTIONS=12`下净增24字节。无Map、Set、临时数组、闭包或按根对象。

每根工作：

- proposal/verification线性扫描`O(A)`；
- 复用现有Neutral Pareto选择`O(A²)`，`A<=12`；
- verification override再次线性扫描；
- 不增加Minimax节点，不改变cache key，不修改FastState。

## 4. Verification语义

每个Risk/Pareto动作被分类为：

```text
REFUTED    Search或完整Safety证明失败
UNKNOWN    支持不完整，不能宣称可活
VIABLE     无committed死亡质量，且存在基本逃生余量/开火后逃生证据
CERTIFIED  Safety覆盖10000、零死亡/未知质量且PROVEN_SAFE
```

Verification不是新的Hard：`UNKNOWN`不能被写成死亡，`VIABLE/CERTIFIED`也不能产生Proof。
Search只允许把动作降为`REFUTED`，不能直接选择动作。

## 5. 仲裁

第一基线是上一轮已验证的`BAND_OFF Neutral`选择，即全部Risk/Pareto动作进入比较。

### Verify-only

若基线动作的verification较低，只在以下条件同时满足时换成更高verification动作：

- expected损失不超过固定整数窗口；
- robust损失不超过固定整数窗口；
- 新动作仍在Risk/Pareto集合内且未被Search反驳。

这把Safety作为计划验证器，而不是重新建立策略门禁。

### Full PVA

在Verify-only结果上，只有目标证据完整的Plan可以进行目标覆盖：

- Tactical Contact：direct kill、intercept、shield break或有自逃证据的攻击Plan；
- Strategic Navigation：有明确deadline/progress的攻击、星或持续Plan；
- Terminal模式：preserve/comeback证据优先。

覆盖同样受expected/robust保留窗口约束。Strategy不能用purpose标签击败明显更好的Search区间。

## 6. 降级

- PVA关闭：完全保持CURRENT；
- PVA开启但无合法Plan：退回完整Risk/Pareto Neutral；
- committed escape：直接复用`selectEscape`，不进入目标覆盖；
- Risk空集合：保持现有显式最小风险fallback，不恢复动作；
- runtime Emergency：不改变所有权，只继承现有搜索预算缩减；
- 任意证据不完整：verification为UNKNOWN，不猜测CERTIFIED。

## 7. 验证安排

第一轮固定32场景、四variants、每种128局：

```text
CURRENT
BAND_OFF
PVA_VERIFY_ONLY
PVA_CONTROLLER
```

只有同时满足以下条件的PVA进入第二轮：

- 得分高于CURRENT且不低于BAND_OFF；
- 星差不劣于BAND_OFF超过8；
- 单方击毁负不高于BAND_OFF；
- 四variants至少三种不低于CURRENT；
- 所有硬不变量为0。

第二轮使用上一轮未见的64场景、四variants、每种256局，只比较CURRENT、BAND_OFF和第一轮优胜PVA。
判断以第二轮为准，不合并第一轮做选择。

本轮通过模拟后才决定是否切换production默认。

## 8. 实现落点

实现保持单一World/Search状态，不复制Minimax栈：

- `engine-v2/src/policy/proposal-verification-arbiter.js`：固定数组PVA；
- `engine-v2/src/policy/layer.js`：一次构造并复用PVA；
- `engine-v2/src/runtime/production-root.js`：在Risk/EO/Pareto之后接入PVA；
- `tools/agentank/diagnostics/strategy-priority-runtime.js`：提供`PVA_VERIFY_ONLY`和`PVA_CONTROLLER`消融模式；
- `test/minimax-core/proposal-verification-arbiter.test.js`：所有权、不恢复拒绝动作、Search反驳和EO优先级约束。

PVA新增两个长度为12的`Uint8Array`，固定占用24字节；两轮模拟中`hotAllocationCount=0`。默认配置保持关闭，诊断包装器只开启预构造实例，不修改上传bundle的默认行为。

## 9. 两轮模拟结果

第一轮使用固定前32场景，四variants，各模式128局：

| 模式 | V2胜/负/平 | 综合得分 | 星差 | 单方击毁胜/负 | FIRE | 总耗时(us) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CURRENT | 23/97/8 | 21.09% | -126 | 8/23 | 720 | 24,397,826 |
| BAND_OFF | 31/90/7 | 26.95% | -111 | 9/28 | 1,433 | 26,413,966 |
| PVA_VERIFY_ONLY | 25/97/6 | 21.87% | -105 | 10/36 | 1,685 | 26,980,781 |
| PVA_CONTROLLER | 31/91/6 | 26.56% | -111 | 12/24 | 1,509 | 26,534,435 |

`PVA_VERIFY_ONLY`证明“只按安全等级覆盖基线动作”不成立：它增加开火，但未恢复整局结果且显著增加击毁失败。完整PVA相对CURRENT提升5.47个百分点，并比BAND_OFF少4个击毁失败，但得分比预注册门槛低0.39个百分点。因此第一轮不判定为通过；第二轮只作为独立复核，不追认或修改第一轮门槛。

第二轮使用未见过的后64场景，四variants，各模式256局：

| 模式 | V2胜/负/平 | 综合得分 | 星差 | 单方击毁胜/负 | FIRE | 总耗时(us) | P95回调(us) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| CURRENT | 30/200/26 | 16.79% | -272 | 7/45 | 1,420 | 50,069,845 | 8,379 |
| BAND_OFF | 40/194/22 | 19.92% | -229 | 16/65 | 2,322 | 52,737,958 | 9,685 |
| PVA_CONTROLLER | 41/189/26 | 21.09% | -233 | 20/73 | 2,449 | 50,253,862 | 8,275 |

第二轮PVA相对BAND_OFF：综合得分提升1.17个百分点，击毁胜增加4，击毁负增加8，星差下降4；总耗时降低4.71%，P95回调降低14.6%。成对转移为`V1_WIN→V2_WIN=23`、`V2_WIN→V1_WIN=18`，另有`V1_WIN→DRAW=11`、`DRAW→V1_WIN=11`。

两轮合并只用于稳定性观察，不替代第二轮独立判断：

| 模式 | 局数 | 综合得分 | 星差 | 单方击毁胜/负 | FIRE | P95回调(us) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CURRENT | 384 | 18.22% | -398 | 15/68 | 2,140 | 8,318 |
| BAND_OFF | 384 | 22.26% | -340 | 25/93 | 3,755 | 9,040 |
| PVA_CONTROLLER | 384 | 22.91% | -344 | 32/97 | 3,958 | 8,287 |

## 10. 结论

PVA验证了新的所有权方向：相对CURRENT，96场景综合得分提升4.69个百分点，开火增加1,818次，击毁胜增加17，并保持所有Hard/Risk/root restore/timeout/error不变量为0；运行成本没有随仲裁层增加，P95回调反而基本持平。

但它还不是可切换的production默认：相对BAND_OFF的合并收益只有0.65个百分点，同时击毁负增加4；独立第二轮也表现为攻击收益和死亡代价同时增加。当前瓶颈已经从“Strategy错误删除动作”缩小为“攻击Plan验证强度不足，VIABLE动作仍会把后续反击暴露转化为死亡”。下一轮应只加强攻击Plan的自逃/反击暴露验证，不恢复Strategy门禁，也不提高Minimax深度。

## 11. V2控制模式直接内战

前两轮以V1为固定对手，只能测量各模式对同一外部基线的表现，不能直接证明模式间的克制关系。新增三边循环：

```text
CURRENT <-> BAND_OFF
BAND_OFF <-> PVA_CONTROLLER
PVA_CONTROLLER <-> CURRENT
```

每条边使用同一地图、星序列、随机种子和双方poison技能，正反换座各一局；胜负忽略本地runtime，只按击毁和星数判定。

首个场景`mat_JnfOlvL961nGGeDQS`的6局结果：

| 模式 | 胜/负/平 | 星 | 被击毁 | FIRE |
| --- | ---: | ---: | ---: | ---: |
| CURRENT | 1/3/0 | 1 | 1 | 9 |
| BAND_OFF | 2/2/0 | 2 | 1 | 31 |
| PVA_CONTROLLER | 3/1/0 | 3 | 0 | 37 |

成对看，CURRENT与BAND_OFF各胜一局，BAND_OFF与PVA各胜一局，且都是seat0获胜，说明这两组在本场景受出生位影响；PVA对CURRENT正反两局全胜，且FIRE为16比4。这个单场循环支持“PVA直接优于CURRENT”，但不能凭一个场景宣称PVA稳定优于BAND_OFF。后续扩样必须继续保留正反换座，并按成对结果而不是把六局当独立样本。

### 11.1 全动态历史池扩样

固定地图与双方策略是确定性的，重复seed没有产生新的胜负结果。因此正式扩样不把重复seed计作独立样本，而使用当前动态历史池的1,243个不同场景；每场执行三条边及正反换位，共7,458局。置信区间按场景聚类。

总体循环排名：

| 模式 | 参赛局 | 胜/负/平 | 综合得分 | 星 | 被击毁 | FIRE |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CURRENT | 4,972 | 1,861/1,993/1,118 | 48.67% | 3,658 | 600 | 11,914 |
| BAND_OFF | 4,972 | 1,936/1,934/1,102 | 50.02% | 4,359 | 773 | 33,378 |
| PVA_CONTROLLER | 4,972 | 2,004/1,874/1,094 | 51.31% | 4,359 | 758 | 48,416 |

直接对抗：

| 对抗 | 左方得分 | 右方得分 | 左减右差值 | 场景聚类95%区间 |
| --- | ---: | ---: | ---: | ---: |
| CURRENT vs BAND_OFF | 48.33% | 51.66% | -3.34pp | [-6.65, -0.03]pp |
| BAND_OFF vs PVA | 48.37% | 51.62% | -3.26pp | [-6.18, -0.34]pp |
| PVA vs CURRENT | 50.98% | 49.01% | +1.97pp | [-1.38, +5.32]pp |

结论发生了重要细化：PVA稳定优于BAND_OFF，BAND_OFF稳定优于CURRENT；但PVA对CURRENT只有小幅且统计上未确认的优势。原因不是星控制不足，而是单方击毁：

- PVA对CURRENT的星数终局为735比606，互毁后星数胜为148比23；
- 但单方击毁胜仅107比312，抵消了大部分攻击收益；
- PVA开火24,499次，CURRENT仅5,966次，PVA被击毁495次，CURRENT为290次；
- PVA对BAND_OFF则同时提高星数终局、略提高单方击毁结果，并将被击毁从270降到263。

因此PVA架构本身是对BAND_OFF的有效升级；剩余问题具有明确对手结构：保守CURRENT会惩罚PVA攻击后的暴露。下一步应针对`PVA vs CURRENT`的419个单方击毁局验证攻击Plan的post-fire escape和反击deadline，而不是降低全局开火率或回退到CURRENT。

性能上，PVA平均每次决策1,187微秒，BAND_OFF为1,227微秒，CURRENT为1,152微秒；PVA的逐局P95回调分布95分位为7,738微秒，优于BAND_OFF的8,058微秒和CURRENT的8,036微秒。所有模式不变量失败均为0。
