# BasePolicyKernel BP1：原生动作域等价

## 结论

BP1 已把 V1 的 `tacticalActions` 从 ProductionRoot 候选中分离为独立、固定数组的
原生动作域服务。在固定前16场景、双方换位、`stun`、oracle 持有最终动作的64局中，
它不安装技能发射桥、不改变最终动作所有权，只比较同一物理状态上的动作集合和顺序。

最终共有1,549个根状态与7,400个二层状态可比较：

| 动作域 | 集合与顺序一致 | 一致率 |
| --- | ---: | ---: |
| 原生我方根 | 1,538 / 1,549 | 99.29% |
| 原生敌方根 | 1,546 / 1,549 | 99.81% |
| 原生我方二层 | 7,364 / 7,400 | 99.51% |
| 原生敌方二层 | 7,394 / 7,400 | 99.92% |

BP0 的完整原生战术动作一致由1,127/2,024（55.68%）提高到
1,249/2,024（61.71%），增加122个一致根。最终对局结果仍是3胜、28负、1平；
这说明本轮改变的是诊断搜索所见的动作域，而不是用技能桥或最终动作覆盖制造收益。

## 找到并修复的结构问题

初始差分不是普通参数误差：ProductionRoot 的候选行与 V1 搜索域属于不同集合。

- 我方根每次都多出 `NONE`，却完全缺少观察到的 `STUN`；
- 敌方根把 `NONE/BOMB` 当普通响应；
- 深层 FIRE 没有应用 V1 的对手移动倾向折扣，产生大量无价值预射；
- 敌方技能被插在转向之前，改变相同 value 时的稳定 tie-break；
- BOMB 使用简化距离/地形分数，未检查真实十字爆炸、逃生、现存炸弹、弹丸、星路期限和枪口压力。

修复后：

1. 独立根域直接读取 `ownCanAct/enemyCanAct`，`NONE` 只表示确实不能行动；
2. 观察到的技能进入诊断动作域，但不修改 ProductionRoot，不安装 ACTION_EMIT 桥；
3. FIRE 先验证发射锁和已有弹丸，并按 V1 的整数化移动倾向缩放预射收益；
4. 我方技能位于转向前，敌方技能位于转向后；
5. BOMB 使用预分配 BFS/pose slab 验证十字爆炸、最短星路和自逃，热路径不创建临时对象。

## 剩余边界

动作域还不是逐状态100%等价。最终剩余：

- 我方根：FIRE 4次、BOMB 4次、STUN 3次；
- 敌方根：FIRE 3次；
- 我方二层：FIRE 19次、STUN 17次；
- 敌方二层：FIRE 6次。

这些差异已经从“动作域架构不一致”收敛为状态帧边界：重复 FIRE 抑制、效果倒计时、
枪口/远射次级分数以及 Fast transition 的状态更新。下一阶段应和 transition/value 一起
逐项闭合，不能再通过放宽或收紧全局动作阈值处理。

context epoch 仍为1,544/1,549。5个差异全部落在 V1 的持续敌弹跟踪与 V2 committed
ProjectileTrackPool 的事实差异。不能为了计数一致把 possible projectile 写入 PhysicalState；
该问题归入 Projectile fact/InformationState 边界，保留为显式未闭合项。

## 固定证据

最终运行目录：`/tmp/agentank-base-policy-bp1-bomb-domain`

- physical matches：64；候选/oracle-owner matches：32；
- proposed/committed/mapping：均为1,549/1,549；
- context epoch：1,544/1,549；
- Hard、Risk domination、root restore、timeout/error：全部为0；
- 动作域声明热路径分配：0；
- manifest SHA-256：`91a20b00be2555613473db112d6ef5de8fdf135e6c86507a852d0a7d155dbb5e`；
- overview SHA-256：`d21917a3e26c042799bab8ab8d2b38da3d5f18b004c9b163493b692355557a71`；
- ProductionRoot SHA-256 保持 `c4443ddbd2a7a651d77f1582e5b68ce3715dfc87af7cf40ac7432396def39c48`。

验证结果：diagnostics 485/485、V3 60/60、Minimax core 220/220。

## 下一阶段

BP2 不再调整动作域大方向，而是在已达到99%以上等价的共同动作域上比较：

1. Fast joint transition 与 V1 `applyJointActions` 的效果倒计时和弹丸事实；
2. simultaneous maximin 每个 cell 的值；
3. opponent expectation 混合；
4. node budget 中断点与最后完整深度；
5. repetition/path utility，最后才处理 Monte Carlo 叶扩展。

任何 value 差分只有在对应 transition 与动作集合一致时才计入 value 缺陷。
