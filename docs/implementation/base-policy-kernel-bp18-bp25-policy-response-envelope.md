# BasePolicyKernel BP18–BP25：策略响应包络与事件边界

## 结论

本轮确认 Minimax 内核本身不是主要错误，错误在于把有限视野的标量比较当成长期策略所有权。
即使根动作与后续 AttackPolicy 已满足 Bellman 一致，固定16场景 ACTIVE 仍从
`16/14/2`、53.13%降到`13/17/2`、43.75%；逐局为3个改善、6个退化，候选碰撞13增至17。

因此，`candidate lower > baseline upper` 只有在它们是同一有限 horizon 的启发式点值时，不能被称为
全局 dominance，更不能直接覆盖根动作。

## PolicyResponseEnvelope

新增的诊断包络让 baseline 和 AttackPolicy 使用相同 FastState、敌方根响应列、Fast transition、Hard、
叶函数和 backup。两者只允许 continuation generator 不同；任何 budget、Fast、Hard、continuation 或
restore缺口都会打开区间。结果固定标为`HORIZON_POLICY_ENVELOPE`，永远不写Physical Hard或Proof。

BP20同时修复了候选根动作与后续重规划策略不是同一个Bellman policy的问题。节点由旧动态版本的
81,905降至54,651，但ACTIVE仍退化9.38个百分点，证明剩余根因是horizon tail语义，而不是接线。

## 攻击事件闭合

BP21不再把“朝攻击位置走了两步”视为攻击策略完成。每个候选叶被分类为已实际FIRE、因真实
committed危险转入救援、未到事件边界或策略中止。

25个标量dominance中只有3个在全部敌方响应列完成事件，22个（88%）被正确拒绝。整批搜索累计
1,070个FIRE叶、7,385个未完成叶、5,384个中止叶和2,496个救援叶。严格事件闭合只改变同一场景
换位后的两个`TURN_LEFT→FIRE`：一局`LOSS→DRAW`，另一局`DRAW→LOSS`，净得分为0。

BP22补上FIRE后的Option交接：攻击事件完成后立即恢复baseline动作域，不再因子弹在飞、fire lock尚未
解除而继续围绕旧射击姿态转向。该修复是正确的策略生命周期合同，但在当前两例中没有额外胜负收益。

## 深度与性能

| 配置 | 完整包络 | 事件闭合dominance | 节点 | 最大P95 |
|---|---:|---:|---:|---:|
| depth2 / budget384 | 489 | 3 | 54,739 | 26,120us |
| depth3 / budget1024 | 262 | 2 | 480,428 | 43,958us |

depth3消耗8.78倍节点，完整覆盖和有效证书反而下降。原因是baseline侧仍展开完整own-action树，而候选
侧是一条有身份的策略；统一加深扩大了错误的规模组合。

BP24尝试复用主搜索已经计算的baseline response cells，只补算候选策略。附加节点降至187，但613次
只有14次baseline行除正常horizon leaf外没有缺口，0个形成事件闭合dominance。该路径可作为稀疏缓存
快路，不能承担主要所有权。

BP25最终把浅层包络只调度到根动作即FIRE的事件根：613次搜索降为7次，606个走位型Option延期到
长程评估；附加节点从54,739降至371，减少99.32%，同时保留全部2个would-override案例。

## 架构决定

1. 根FIRE等即时事件可以用短Minimax响应包络验证。
2. GO/TURN攻击路线必须进入独立、事件有界的Long Option evaluator，不能依赖两三层primitive
   Minimax点值。
3. 共享baseline cells只在支持完整时复用；budget/depth缺口不能通过改名变成证书。

下一阶段针对606个延期提案建立高性能事件前沿：单一own-policy动作、敌方响应展开、Physical state
合并、事件完成/中止/救援/死亡分别备份。它只向Risk/战略仲裁输出多维证据，不恢复有限标量的无条件
根动作所有权。

复现入口为`tools/base-policy-kernel-bp18.sh`、`bp21.sh`、`bp24.sh`和`bp25.sh`；逐局转换由
`base-policy-response-envelope-report.js`统一生成。production root字节未修改。
