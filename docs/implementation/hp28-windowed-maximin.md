# HP28：固定栈 Windowed Maximin

## 结论

HP28把父节点已经得到的maximin窗口传入递归Physical child。深层child不再一律计算精确最终值，
而是可以返回`EXACT / LOWER / UPPER`。只有`EXACT`能写入Physical TT和StageMatrix；界只用于本次
选择性深搜的剪枝。多outcome Chance目前保守回退到完整窗口，因此没有把不完整概率备份伪装成
精确结果。

该修改已成为ProductionRoot默认，但只在选择性Physical continuation（实际目标depth至少3）中
激活。普通P1/P2精确owner、InformationSearch、Hard、Proof、Risk和战略选择均未改动。显式诊断
开关仍可关闭HP28，用于同源码A/B。

## 为什么这是结构性优化

HP27证明局部排序、TT扩容和Chance后继合并都没有足够空间。真正浪费发生在递归边界：父max行
已有`alpha`后，只需证明一个child不可能超过它，但旧代码仍求出child的完整精确值。HP28允许
这个child返回上界并立即停止；同理，达到父`beta`时可以返回下界。

这不会用“更浅”换性能。预算、目标depth和动作宽度保持不变，节省的节点被用于完成更多同深度
证明。

## 三层正确性证据

第一层是独立递归oracle。固定16根depth-3从24,843节点降至17,433，下降29.82%；扩展到64根，
risk 0/50/100分别下降33.38%、34.24%和37.51%。四批全部动作、值和root restore零差异。

第二层是production固定栈差分。固定16根、512节点时：

- 冷P3完整选择性证明从2/9增至6/9，节点6,499→6,297；
- 热P3从8/9增至9/9，节点4,096→3,851，work 42,319→39,065；
- 高预算4,096下9个完整固定栈证明逐一匹配独立递归精确oracle；
- 非精确界从不进入exact StageMatrix cell或TT。

第三层是五批24-profile标定，每profile 80次。P3完整选择性证明从10/80增至30/80；冷节点均值
406→393，热节点均值256→240。P1/P2的depth和value support完全相同。P3冷P95墙钟
1,695→1,743微秒，热P95 1,068→1,048微秒；墙钟存在批次噪声，因此接受依据是确定性的节点与
证明率，不宣称本地时间有同等幅度收益。

## 性能和发布边界

Window字段全部在RootEngine构造时预分配，热路径分配为0；清理未使用字段后不保留冗余数组。
当前ProductionRoot TypedArray总量为889,188字节。IMP6的16项构建、sandbox、source/minified
语义差分、cold-init、callback和内存测试全部通过。

当前完整bundle仍为source 631,179字节、minified 609,201字节，超过平台上传限制。这是既有的
production裁剪阻塞，不属于HP28搜索正确性或性能接受条件；在发布前仍必须单独完成瘦身。

本阶段没有运行V1/V2对战，也没有用胜率选择深度。HP28只回答“同预算能否让Minimax执行得更深、
完成更多严格证明”。选择性证明当前不替换已发布的完整P1/P2矩阵，因此HP28本身不是新的动作
所有者。策略、值函数和所有权正确性继续是独立维度。

机器证据见`config/engine-v2/hp28-windowed-maximin-evidence.json`，冻结标定见
`config/engine-v2/minimax-depth-baselines/after-hp28.json`。
