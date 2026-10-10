# BP132：Depth-3剩余支持出口归因

BP132在BP131已经饱和的`D3 / W4 / B4096`诊断lane上，为Fast transition和Hard分类安装一次构造、
固定TypedArray的行为中性遥测。它记录失败发生在incumbent还是candidate、联合动作、chance、搜索ply、
Fast状态/原因/移动细节，以及Hard内部ReverseViability是否不完整。production没有读取这些字段，也没有
执行候选动作。

## 36个不完整根已全部闭合

| 原因 | 根数 | 分支 | 动作 | 深度 | 结论 |
|---|---:|---:|---|---:|---|
| `JOINT_RELOCATION / OCCUPIED_AFTER_EARLIER_MOVE` | 35 | baseline 21、candidate 14 | `GO/GO` | ply 2 | Fast物理规则支持缺口 |
| `HARD_NARROW_PROOF_INCOMPLETE` | 1 | baseline 1 | `GO/FIRE` | ply 2 | 敌弹到达土堆后的保守未知 |

35根全部返回`FAST_STATUS.UNSUPPORTED_RULE`，`failureReason=JOINT_TANK_RELOCATION`，
`failureDetail=OCCUPIED_AFTER_EARLIER_MOVE`。没有容量不足、执行异常、Hard内部Fast失败、预算中断或
root restore失败。它们不是“搜索没看够远”，而是第3个联合帧遇到平台移动/碰撞语义尚未被FastKernel
证明支持。

最后1根中Fast完全成功，Hard在`GO/FIRE`后返回`INCOMPLETE`：hazard构建完整、horizon为2 tick、
ReverseViability为`-1`，原因是敌方弹丸命中土堆使`narrowProofComplete=0`；shield、boost和teleport
特殊逃生均未触发。这是正确的保守结果，不能改写为死亡或安全。

## 对Minimax架构的影响

这一步否决继续提高depth、width或node budget来解决剩余36根：三者都无法补齐物理转移的量词支持。
也不能把unsupported分支固定打成极低分；那会把“模型不知道”伪装成“该世界必差”，污染maximin。

35个联合移动根的历史结果为31个胜负相同、2个candidate更好、2个incumbent更好，说明在平台规则
被精确确认前没有安全的单向启发式。下一步BP133应直接对模拟平台建立联合移动oracle，覆盖`GO/GO`
顺序、同目标、跟随已离开位置、先移动者占位和direct swap；只有oracle通过的整数物理规则才能接入
FastKernel。土堆后的Hard未知单独保留，未来若增强弹丸—土堆截止期证明再重新验收。

机器证据见
`config/engine-v3/base-policy-kernel-bp132-depth3-transition-support-evidence.json`。
