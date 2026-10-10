# BP138：结构事件消除假优势，但固定深度叶仍看不到未来开火

BP138没有改变production。它在35个完整depth-3根上增加两条共同续写Shadow lane，并从两条lane的
基础叶值中删除旧`ATTACK`标量：

- `OUTCOME_FRONTIER`在depth-3叶观察真实弹丸、可开火射线和反击暴露；
- `PROJECTILE_SETTLEMENT`对叶上已经存在的弹丸复用规范timeline与ReverseViability，一直结算到弹丸
  失效或目标逃生deadline。

两条lane都在三个有限移动规则世界中运行。35根、70个root×lane关系全部完成且世界间数值一致；
restore失败、热分配和行为变化均为0。production SHA保持
`0a8f09c3bf54e7ecd708346b08ff1133a716aa62634484b10e549968a0cbc23e`。

## 结果

去掉通用ATTACK标量后，两个历史退化都不再得到候选优势：两条lane的共同关系全部为相等；真实敌方
下一动作上的候选优势也为0。这确认BP135–BP137定位正确——原来的退化信号确实由标量攻击叶制造。

但两个历史改善也没有获得正向证据。两条lane均把其中一个判为相等、另一个判为候选更差；真实敌方
下一动作和当前名义分布下，两者也都是相等。因此BP138不能作为owner，也不能作为否决器，否则会把
一个已知真实改善过滤掉。

## 真正的边界

BP138仍然是“在固定depth-3叶观察事件”，而不是“搜索到事件发生”：

- 如果弹丸在叶上已经产生，settlement可以把它结算到规范失效；
- 如果攻击策略要在depth-3之后才首次FIRE，两条lane都看不到该事件；
- 到达固定深度但没有事件，不等于攻击无效，只能算证据未完成。

因此下一步BP139必须改变horizon语义，而不是再改leaf权重：每条共同策略继续到首次FIRE、terminal、
committed危险deadline、支持丢失或严格work cap；仅到帧数上限而没有事件时返回`UNKNOWN`。历史敌方
动作仍只作离线标签。

机器证据见`config/engine-v3/base-policy-kernel-bp138-event-deadline-evidence.json`。
