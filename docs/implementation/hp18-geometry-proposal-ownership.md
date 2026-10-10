# HP18：单层几何Proposal所有权验证

## 结论

HP18把HP17冻结的三行动作、单层完整敌方矩阵从Shadow提升为受限Proposal。实现满足预定
所有权顺序：严格ForcedWin和committed rescue优先，几何Proposal其次，普通verified attack
再次；任何Proposal仍需通过FinalActionGate。

该所有权被独立验证明确拒绝。几何搜索保留为Shadow证据与调度探针，production默认不启用
`SELECTIVE_GEOMETRY_ACTIVE_C4`。

## 因果实验

实验固定使用`mask=97/value=1/cooldown=4/maximumRows=3/depth=1`，CURRENT、Shadow和Active
在同一场景、同一座位上配对。Shadow只计算，不改变动作；Active只在完整矩阵中challenger
的严格root value高于当前动作时发布Proposal。

固定16场景Discovery中，Active相对Shadow出现5个正向、2个反向转换，得分从10.94%升到
17.19%，单方被击毁从14降到9。但星差从-42降到-48，因此只将它作为进入独立集的信号。

独立32场景Tactical Holdout给出相反且更强的结果：

| 指标 | Shadow | Active | 变化 |
|---|---:|---:|---:|
| W/L/D | 10/49/5 | 6/56/2 | 2正向、9反向 |
| 分析得分 | 19.53% | 10.94% | -8.59pp |
| 星差 | -75 | -80 | -5 |
| V2单方被击毁 | 16 | 29 | +13 |
| 击毁对手 | 8 | 8 | 0 |
| work units | 9,412,263 | 8,333,126 | -11.47% |

Active少用work不是算法提速：它更早死亡、缩短轨迹，连带减少后续Physical搜索。该数值不能
作为性能收益。86个严格分离Proposal全部穿过最终门，说明失败不是接线或fallback造成，而是
“单层几何值足以拥有动作”这个假设本身错误。

## 架构含义

单层max-min只回答下一次敌方响应下的局部值，不包含动作后的多帧可恢复性、Plan连续性与
Information后续观察策略。它可以证明两个动作在这一层不同，却不能证明替换长期控制动作会
提高整局结果。因此：

- 完整几何分离继续作为搜索价值证据、候选排序特征和预算调度统计；
- 它不能独立生成动作所有权；
- 后续若再次尝试ACTIVE，必须增加跨帧可恢复证书或更深的完整值区间，不能放宽margin、触发器
  或Risk阈值来复活本次候选；
- C4 Shadow仍是当前可接受的稀疏调度候选，production默认语义不变。

机器证据见`config/engine-v2/hp18-geometry-proposal-evidence.json`。两个原始报告保存在本地
临时证据中，其SHA-256已写入机器记录；不把大逐局报告纳入仓库。

## 验证

- Minimax：146/146；
- Diagnostics：107/107；
- GR0：280/280；
- IMP5：14/14；
- Hard、Risk domination、root restore和热分配不变量全部为0；
- HP18深度标定：24 profiles通过，source fingerprint为
  `4058bbb8d2357d58469230842ac38fe07ca8b44801edb60eed0a01da6f025cb5`；
- 冻结基线：`config/engine-v2/minimax-depth-baselines/after-hp18.json`。
