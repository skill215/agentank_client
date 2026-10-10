# HP26：Physical TT跨帧容量实验

## 结论

Physical value TT保持32项。把它扩大到64、128或256项不能让固定16个实际后继帧中的任何一个
获得更深的P3 selective proof；即使256项额外占用10,528字节，节点也只是从“比冷缓存多64”
改善到持平。因此容量扩展被拒绝，不进入整局arena。

这个结论与HP25的同根warm结果并不冲突。同根重复搜索时，128项能把P3完成率从8/9提高到
9/9；但真实回合会把搜索horizon向前移动一帧，缓存key中的remaining depth也随之变化。同根
warm收益不能直接等同于下一帧收益。

## 实验方法

新工具`tools/physical-tt-successor-benchmark.sh`对每个场景执行：

1. 用32项参考搜索冻结父帧best row和一个已完整记录的敌方响应；
2. 各容量重新搜索同一个父帧，用固定联合动作推进到实际Physical successor；
3. 一路保留父帧全部cache，另一路用新engine直接推进到哈希完全相同的successor；
4. 两路都以depth 3、512节点搜索子帧；
5. 只在完整representative owner相同时比较Minimax语义，截断attempt的临时`bestValue`不冒充
   已发布值。

16个场景的物理后继哈希全部一致，完整owner语义差异、root restore failure均为0。

| Physical TT | 额外字节 | 保留父cache节点 | 冷子帧节点 | 节点节省 | work节省 | 深度提升 |
|---:|---:|---:|---:|---:|---:|---:|
| 32 | 0 | 4,562 | 4,498 | -64 | 6,878 | 0 |
| 64 | 1,504 | 4,482 | 4,461 | -21 | 7,113 | 0 |
| 128 | 4,512 | 4,473 | 4,461 | -12 | 7,203 | 0 |
| 256 | 10,528 | 4,461 | 4,461 | 0 | 7,326 | 0 |

保留整个父cache确实减少约11–12%的work，但32→256只额外贡献448 work，而且没有节点或深度
收益。该收益主要属于其他跨帧cache和已有事实复用，不能归功于Physical TT扩容。

## 指纹修复

HP25标定的`SOURCE_FILES`漏掉了`production-cache.js`和`cache-runtime-codes.js`，导致缓存实现
变化可能仍显示旧source fingerprint。HP26把两者纳入标定身份并增加UT。旧报告不删除，标记为
“测量有效、源码身份覆盖不完整”。

修复身份后重新运行24 profiles、每profile 80次的标准标定，所有完成深度、selective depth和
平均节点相对HP25零差异；新基线是
`config/engine-v2/minimax-depth-baselines/after-hp26.json`，状态`CURRENT`。由于标定脚本本身
进入harness fingerprint，旧新报告按合同不能做正式compare；上述语义/节点零差异为字段级独立
对账，不伪装为工具compare PASS。

下一步不再调TT容量，而是统计P3 ply-2的精确唯一状态、同深重复、跨深重复和碰撞替换比例。
若状态主要唯一，应优化分支顺序、剪枝或单transition成本；若跨深重复显著，只能把浅层结果用作
排序/界，而不能跨depth复用最终值。

机器证据见`config/engine-v2/hp26-physical-tt-successor-evidence.json`。
