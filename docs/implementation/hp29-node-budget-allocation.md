# HP29：P3预算阶梯与全局加预算拒绝

## 结论

HP29在HP28之后重新标定P3预算，没有按旧曲线直接提高生产预算。固定16根中，冷P3全部完成的
门槛已经从旧实现的896节点降到620；但把全局预算从512提高到576或620，会把累计work从未来帧
搬到当前帧，而不是提高引擎每单位work的效率。因此production继续使用512节点。

保留了诊断专用的576/620 profile和Root容量入口，便于以后重复A/B；默认RuntimeController、
SEARCH_BUDGET和上传行为没有变化。

加入诊断入口后重新运行24-profile、每profile 80次的五批标定。相对HP28所有depth、value
support和冷/热节点直方图零差异；新源码基线冻结为`after-hp29.json`并处于`CURRENT`。

## 固定根预算曲线

启用HP28后：

| 预算 | 冷P3完成 | 热P3完成 | 冷总节点 | 冷work |
|---:|---:|---:|---:|---:|
| 512 | 6/9 | 9/9 | 6,297 | 92,950 |
| 576 | 8/9 | 9/9 | 6,370 | 94,058 |
| 620 | 9/9 | 9/9 | 6,414 | 94,684 |

三个512长尾的精确完成点为scenario 15=513、scenario 13=520、scenario 4=620。前两个只差1和8
节点，最后一个仍差108节点。因此下一阶段不再优化平均根，而只审计scenario 4的递归分支成本。

## 完整回调Discovery

固定16场景、每profile 32局：

- 576把搜索节点25,801→27,718，累计work增加0.48%；
- 完成选择性根45→46，深度单位150→156；
- degraded/fallback中位帧保持87/103，emergency仍为0；
- 1/32局动作流不同，终局、星和结果全部相同；
- 620进一步把深度单位提高到158，但引入1局3帧emergency，因此直接拒绝。

本地墙钟因profile运行顺序和JIT热身明显偏向第二个profile，只作观察，不用于接受。

## 独立32场景Holdout

576在64局候选路径上保持64/64动作与结果完全一致，选择性深度单位298→304，累计work增加
0.60%，degraded/fallback中位帧保持88/105，emergency保持同一局56帧。

但搜索帧171→170、完整P1/P2 value owner 155→154。也就是说它用更多早期节点换到更深的
选择性证明，同时让一个未来浅层owner因runtime累计阈值消失。这不满足“让Minimax在相同工作量下
更深、更晚fallback”的目标。

## 下一步

生产预算保持512。HP30只针对scenario 4：分离windowed P3的row、column、Chance、Hard、TT和
leaf成本，要求至少减少108节点并在固定16根及独立runtime样本上不增加累计work。不能再用提高
节点cap伪装性能优化。

机器证据见`config/engine-v2/hp29-node-budget-allocation-evidence.json`。

最终验证为Minimax 163、Diagnostics 121、GR0 297、IMP2 53、IMP3 28、IMP5 14、IMP6 16，
合计692项全部通过；source/minified语义差分、root restore和热分配不变量均为0。
