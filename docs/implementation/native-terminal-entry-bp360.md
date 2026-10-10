# BP360 — FIRE 根入口条件（Shadow）

## 结果

7 个冻结历史根全部得到 `CONDITIONAL_ENTRY_SUPPORTED`。55 个 FIRE 响应分支仍为 54 WIN、1 LOSS、0 unresolved；该 LOSS 是同星同归于尽的生产耗时悲观语义，未改写为获胜。6 个领先根的全部响应仍为 WIN。

双方完整动作流、参数、事件计数与 BP349 相同；错误、超时、root restore failure 均为 0。Minimax core UT：411/411。

证据目录：`artifacts/native-causal-audit/bp360-terminal-entry-shadow/`。manifest 绑定诊断源码与 production tree；production SHA-256 保持 `285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。

## 本轮新增

`terminal-entry-premises.js` 是只读、窄域入口检查：可见双方、双方 stun、仅允许 possible enemy projectile 信息缺口、活局面、有效 pose、FIRE 生成且 Hard 允许、无我方开火锁、无我方已有弹丸、无活动炸弹、无本域外活动技能效果。允许 stun，因为 FIRE 不受转向反转影响。

新增 6 个 UT，其中直接调用 FastKernel 验证：

- 敌方已有弹丸仅阻止敌方再次 FIRE，不阻止我方 FIRE。
- stun 两种 chance 下 FIRE 方向不变；冻结时不产生弹丸。
- 物理入口可行不代表固定池有容量；满池仍必须显式返回 INCOMPLETE_ENTITY_CAPACITY。

其余 UT 覆盖检查器拒绝条件、过期效果、输入未修改与不完整信息失败关闭。

## 不能推出的结论

入口通过不等于严格胜利证明。所有 7 个根的最终证据仍为 INCOMPLETE，未知弹丸支持未被枚举或规则证明覆盖；无 ACTIVE、无 Risk 改写、无 production 修改。特别不能用空 tracker 或本轮检查通过清除 gap 8192。

## 下一步

将入口条件、BP359 开火后几何命中见证与阶段结算规则组合成有明确适用域的独立规则推导：额外敌弹只可阻止敌方 FIRE（须映射到已覆盖 NONE 响应），不能撤回已发出的我方子弹；同时审查先于射击的碰撞和炸弹、土堆变化及星数结算。推导未闭合前不新增动作所有权，也不以更多有限压力样本替代证明。
