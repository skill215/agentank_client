# HP12 Consumer-aware Information调度

状态：`PASS_LOCAL_PERFORMANCE / NEUTRAL_GAMEPLAY`。本阶段不修改Minimax值、Risk阈值、战略参数、
Hard或Proof，只停止默认运行没有生产消费者的近似Information值。

## 发现

HP11后固定16场景、双换位32局共有1,282次InformationSearch，消耗209,142节点。诊断探针逐次
记录支持损失，结果为：

| 支持损失 | 次数 |
|---|---:|
| 输入Information支持不完整 | 1,282 |
| 递归策略不具严格ObservationSplit语义 | 1,282 |
| 敌方动作列被裁剪 | 1,215 |
| work中断 | 5 |
| 完整Information值所有者 | 0 |

生产调用只在`exact=false`时进入InformationSearch，却把`hiddenSupportComplete && exact`作为输入
支持，因此默认路径不可能获得完整证书。递归Physical continuation又允许不同HiddenWorld在下一步
分别选动作，不满足同一观察组必须共享动作的InformationState合同，所以也只能是近似估计。

HP10已经禁止不完整搜索写Risk/StageMatrix动作所有权，默认Strategy也不读取`searchEstimate`。
因此这些节点在当前架构中是没有消费者的生产者，只会提前消耗match work并触发fallback。

## 修改

ProductionRoot新增consumer-aware门：只有诊断显式启用Information evidence，或安装了
`incompleteSearchOwnership/softSearchProposalEvidence`消费者时才运行近似InformationSearch。
默认跳过该路径，Hard、Safety、EO、ForcedWin和完整Physical Minimax保持不变。

旧行为由`LEGACY_INFORMATION_EVIDENCE`同源码profile保留；`INFORMATION_DEPTH_ONE`、
`VISIBLE_PHYSICAL_VALUE`和Information Strategy诊断profile显式安装消费者，不会被门意外关闭。
这不是删除Information算法；未来只有在实现严格ObservationSplit区间或明确的受限Proposal消费者
后才重新接入production。

## 同源码因果结果

固定16场景、双换位32局：

| 指标 | 新默认 | 旧Information evidence | 变化 |
|---|---:|---:|---:|
| W/L/D | 3/28/1 | 2/28/2 | 得分10.94% vs 9.38% |
| paired正向/负向 | 1/1 | — | 净转换0 |
| match work | 4,383,247 | 7,295,147 | -39.9% |
| 本地总耗时 | 2,016,308us | 3,517,515us | -42.7% |
| Emergency callback | 0 | 397 | -100% |
| Physical搜索帧 | 73 | 32 | +128.1% |
| 完整值所有者 | 70 | 32 | +118.8% |
| Information节点 | 0 | 209,142 | -100% |

星差由-37变为-42，所以小样本不支持“胜率已经改善”；分类保持`NEUTRAL_GAMEPLAY`。性能结论来自
确定性work和同进程A/B，本地微秒不替代平台3000ms证据。关键收益是预算从无所有权的近似计算
转移到可以发布严格证书的Physical搜索，而不是简单降低Minimax深度。

## 验证与标定

- Minimax core 146、GR0 280、IMP5 14、diagnostics 79全部通过；
- avoidable Hard、Risk domination、root restore、hot allocation全部为0；
- 24-profile节点、深度、值支持与HP11逐项一致；跨时微秒只作观察，不归因；
- 标定报告：
  `artifacts/benchmarks/minimax-depth-calibration/hp12-consumer-aware-schedule.json`；
- 报告指纹：`c6cd6727fa26b1036a0d35b581e91a33bae3df027838173e10abf4b9f030b202`；
- source指纹：`859027b1722d6bd64615c550d86036a7ee07742204630985bb75747362b50995`；
- 冻结基线：`config/engine-v2/minimax-depth-baselines/after-hp12.json`；
- 基线指纹：`c1f42cca34ee8d5d409a639d6402e936c314101fd015cbb3957e5a0cdf87b117`。

## 下一步

下一阶段应先设计可证明sound的Information上下界：缺失世界、方向、敌方列和ObservationSplit分别
传播区间，只允许`candidate.lower > incumbent.upper`的严格支配取得Proposal所有权。不能恢复旧的
近似标量全局所有权，也不能仅因为“搜索更深”就重新消耗这部分预算。
