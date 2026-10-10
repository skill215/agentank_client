# BP112–BP114：持久ObjectiveEpoch成立，primitive动作所有权被拒绝

## 结论

V2确实缺少跨callback稳定存在的战略目标，但“保留目标四帧并直接纠正GO/TURN”不是正确实现。
Shadow证明目标连续性覆盖面很大；ACTIVE则证明，只凭一步几何进度生成primitive会把局部方向感冒充成
完整Option证书，在独立切片上抵消全部收益并扩大星差。

因此保留`ObjectiveEpoch`作为目标身份、事件生命周期和Minimax效用条件；拒绝它直接拥有动作。
Production、Hard、Proof、Risk、EO、搜索预算及上传bundle均未改变。

## BP112：目标连续性与执行域普查

固定16场景、32个候选对局共3,030个决策：

- 2,955帧存在有效目标epoch，占97.52%；共189个epoch，最长114帧。
- 现有严格Option执行域覆盖1,662帧，占epoch帧56.24%；存在1,293个执行gap。
- 在严格域存在时，当前动作仍有316/1,662帧位于域外，占19.01%。
- 一步生成GO/TURN进度候选后覆盖升至1,976/2,623个非中断帧，即75.33%；恢复320个gap。
- 剩余647个gap中182个没有可观察目标，465个没有Hard/Risk允许的一步进度。
- 当前动作位于扩展域的比例为1,781/1,976，即90.13%。
- 所有Shadow热路径分配为0，动作和production结果零变化。

这证明目标抖动和执行gap是真问题，但“能生成一个接近目标的动作”只证明动作域可表达，不证明该动作
在对手响应、终局和后续控制策略下更优。

## BP113：固定时长ACTIVE与所有权缺陷

初版H2/H4/H8只在目标仍受支持、当前动作离开扩展域时覆盖，并逐帧重验Hard、Risk和FinalGate。
H4/H8一度出现弱正向，但敏感局暴露出错误顺序：`POSITION`目标用GO覆盖了一个支持完整的FIRE，
把战略进度放在已验证攻击之前。

修复后固定所有权顺序为：

```text
Hard / committed rescue / strict proof
→ support-complete DIRECT_KILL or ATTACK_SETUP
→ ObjectiveEpoch strategic progress
```

4个敏感场景、8个候选对局中，6次已验证攻击正确让行；原负转换消失，只保留1个
`LOSS→WIN`，得分由18.75%到31.25%。这证明所有权顺序修复正确，但不证明战略owner本身合格。

## BP114：固定16与独立16因果否决

相同代码、未调参数的固定16结果：

| 模式 | 基线 W/L/D | 候选 W/L/D | 得分变化 | 星差变化 | 转换 |
|---|---:|---:|---:|---:|---:|
| H4 | 2/28/2 | 3/27/2 | +3.12pp | -7 | 1正/0负 |
| H8 | 2/28/2 | 2/28/2 | 0 | -5 | 1正/1负 |

H8的额外承诺把一个原胜局改成负局，说明固定8帧过长。H4随后在公共Discovery中未读取的下一组16
场景复核：

| 模式 | 基线 W/L/D | 候选 W/L/D | 得分变化 | 星差变化 | 转换 |
|---|---:|---:|---:|---:|---:|
| H4 independent | 2/29/1 | 1/30/1 | -3.12pp | -11 | 1正/2负 |

两个H4切片合并64个候选对局后，双方均为4/57/3，净得分0；候选星差恶化18，53次覆盖没有形成
可复现收益。独立切片所有改变终局的覆盖样本均为`strictMask=0`：proposal不属于支持完整的既有Option，
仅因一步距离或朝向更好而被执行。硬不变量全部为0，所以退化不是Hard、Risk、restore或性能错误，
而是动作证书语义错误。

## 架构决策

保留：

- Observable `ObjectiveEpoch`及target generation；
- 目标只在明确事件、deadline、generation或证书失效时重规划；
- 现有严格Option域、执行gap和Minimax域内/域外的零分配审计；
- 已验证攻击高于普通战略进度。

拒绝：

- 用固定2/4/8帧本身作为承诺正确性的证明；
- 用一步`distance/facing`改善直接取得primitive所有权；
- 把生成但不在strict Option域中的GO/TURN交给FinalActionGate后直接执行。

下一结构固定为：

```text
ObjectiveEpoch（目标身份与效用条件，不选动作）
→ support-complete Option集合
→ Hard / committed rescue / strict proof / verified attack
→ Minimax或完整Option interval反驳
→ Strategy只在未被反驳的Option中仲裁
→ primitive由当帧Option executor产生并再次过Hard/Risk
```

生成GO/TURN仍可扩充搜索候选，但在得到完整Option级证书以前只能Shadow，不能ACTIVE。旧的两行动
Option局部Minimax已经在固定与盲Discovery中得到5次请求、0次严格支配，也支持这个边界；下一步不再
重复加深同一几何续航。

机器证据：
`config/engine-v3/base-policy-kernel-bp112-bp114-objective-epoch-evidence.json`。
