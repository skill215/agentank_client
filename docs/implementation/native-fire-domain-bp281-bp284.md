# BP281–BP284：两个FIRE被删样本的因果检查

## 结论

仅放行根FIRE不能恢复这两个样本。生产策略不变，不降低开火阈值，不提高深度。

## 拒绝原因

两个样本均canFire=true、敌方未隐身，Hard允许且Risk acceptable=1。
`rootV1ShapedAllowed`委托`qualifiedFireForSeat`；该函数没有找到符合时序/路线条件的拦截点，best保持-2147483648，而非收益略低于2500阈值。

- `mat_LpYDwCCol1LH2ujZw` seat1 frame30：我方(9,10)朝右，敌方(3,9)；射线前方第4格是土堆，敌人在身后。
- `mat_H0ocE5Rk3JWEeS2p8` seat1 frame32：我方(13,5)朝左，敌方(12,3)；横向射线至边墙，当前不共线。

因此不能把它们描述为“明确命中机会被物理模型漏掉”。实际续局获胜可能包含地形、压制、对手反应与后续状态变化，本轮未证明具体弹丸直接造成最终击毁。

## 对照结果

| 样本 | 原动作 | 强制NONE一帧 | 强制FIRE一帧 | 仅允许搜索评估FIRE |
| --- | --- | --- | --- | --- |
| LpYD，frame30 | 左转，平 | 平，128帧 | 胜，101帧 | 仍左转，平 |
| H0oc，frame32 | 右转，平 | 负，40帧 | 胜，75帧 | 仍右转，平 |

单步强制后由原V2拥有续局；双方前缀及参数检查均通过。NONE对照表明收益不能仅用“保持一帧不动”解释，但没有隔离实体、内部intent状态与对手反应，不能宣称已完成机制证明。

局部放行只替换开发进程中根域函数，在目标帧允许已有物理开火能力的FIRE，不改变深层动作域、Risk、Hard、深度或参数。所有补丁在finally中撤销。

| 样本 | 原节点数 | 放行节点数 | 深度 | 放行后转向值 | 放行后FIRE值 |
| --- | ---: | ---: | ---: | ---: | ---: |
| LpYD | 189 | 168 | 2 | -636 | -837 |
| H0oc | 172 | 203 | 3 | -15 | -1809 |

FIRE在放行后membership=ALLOWED，但没有胜出。节点数变化不等于性能benchmark；row-shared预算和根动作数影响搜索工作分配。不能用这两根证明整体性能好坏。

## UT及可复现性

- 两个小型fixture独立保存在 `test/minimax-core/fixtures/fire-domain-bp282.json`；不依赖历史大报告运行UT。
- `native-fire-domain-evidence.test.js`确认canFire、根域拒绝、无预测拦截点，以及直接射击正例。
- 原资格函数隔离插桩只读出best/threshold，唯一锚点变化立即报错；其返回值与未插桩版本核对。
- 本轮相关14项UT通过，生产文件未改。
- 复用命令：`node tools/agentank/diagnostics/native-fire-domain-audit.js <bp280报告> <新输出路径>`。

## 下一步

优先检查这两根和BP280另外三个“已纳入搜索但估值更低”样本的搜索备份值：分开记录对手分支、worst/nominal、预算叶与常规深度叶、终局值。先判断是有限预算、对手分布还是叶评估/时域差异，不能凭单个V1续局胜负断言minimax数学错误。

暂不进行全局FIRE放行、Risk放宽或分数补丁；两个局部放行实验没有显示收益。

## 证据

- `artifacts/native-causal-audit/bp281-fire-domain-audit.json`
- `artifacts/native-causal-audit/bp282-fire-threshold-audit.json`
- `artifacts/native-causal-audit/bp283-fire-wait-controls.json`
- `artifacts/native-causal-audit/bp284-search-admit-fire.json`

生产树SHA-256仍为`4a5056ae736d5d4cc1bd3f397837c4cc2660ba516dc6e580e17760c2fbbdadba`。
