# BP345：路线软评分消费者及真实根影子验证

## 已实现与尚未实现

新增诊断`RouteNavigationConsumer`，评分与软目标进度共用同一组known/progress数组。81个真实根只读计算，未把分数回写Risk，也未改变旧StrategyBand或最终动作。

这是评分消费者的实施与验证，不是已完成production策略接线或胜率修复。普通接近目标不能冒充STAR_COLLECT、STAR_DENY或TERMINAL_REVERSAL；本轮使用独立`contributes(row)`软证据，旧策略标记仍保持原义。

## 候选合同

仅有已知星目标、敌方可见且距离>9、无清晰射线、无committed escape实体、我方无活动stun/freeze/boost/poison时使用静态正常移动模型。此条件只约束新导航估值适用范围，不关闭原Minimax入口。

只对Hard ALLOW的GO/LEFT/RIGHT输出软进度；FIRE、BOMB、技能原分不变。不可达、模型不适用或Hard不允许时保留原分。消费者没有选择动作、修改Hard/Risk或提交Plan的接口。

固定公式：

```text
new = original
      - 原GO的Manhattan进度 × 1650
      + poseProgress × 1650
```

1650直接复用原基础450与GO附加1200之和，不扫描权重。对转向，原Manhattan进度为0，新进度按朝向到目标动作数计算。此为明确的行为变化，不能声称语义中性；它对有效转向和错误转向都会改变分数。

正进度只产生`contributes=1`，不是强制动作或安全证书。正式接线时仍须由原Hard/Risk筛选，再让策略消费者解释进度，不能用这份证据恢复已被安全门拒绝的动作。

## 真实根结果

重建原BP342的9条冻结轨迹、81根，与原候选数据逐项一致。8个绕路反例均在模型范围内：GO进度+1，原选LEFT进度-1；替换后GO分数2867–3111，LEFT为-1368至-1092。所有8个GO均输出软目标进度证据。

原动作没有改变，因此这些差值只是候选评分验证，不证明整局获胜。没有新增策略对战、参数扫描或生产变更。

## 测试与性能约束

- 全量Minimax UT377/377通过。
- 新增UT覆盖评分/软目标证据一致、Hard拒绝不可恢复、模型不适用回退、不可达回退、状态数组不变和容量检查。
- 81根原始候选分数、Hard/Risk标记及整局动作/事件/结果全部零漂移。
- 与BP343相同的固定路线工作区，另有每候选3字节的progress/known。新消费者未做整条pipeline性能资格；影子审计同时运行参考距离场，不把其耗时作为生产性能。
- 生产tree保持`285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。

## 下一步

可在诊断宿主建立ACTIVE候选，只替换软导航进度，原入口、Minimax预算、战斗分数和Hard/Risk规则保持不变。先保证策略消费者能表达“目标推进”而不伪造“拿星/终局反转”，并验证被拒绝动作不能因路线进度重新入选。

ACTIVE必须同时检查旧胜局退化和攻击指标；不能只跑这8个已知反例，也不能因为导航模块面向星目标就将全局战略改为抢星优先。未通过之前继续保留CURRENT生产默认。

## 文件

- `tools/agentank/diagnostics/route-navigation-consumer.js`
- `test/minimax-core/route-navigation-consumer.test.js`
- `artifacts/native-causal-audit/bp345-route-consumer-shadow/`
- 重复命令：`node tools/agentank/diagnostics/navigation-selection-audit.js <新目录> --pose-shadow --consumer-shadow`

未提交、推送或调用官方平台。
