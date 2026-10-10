# BP134：三规则世界闭合物理缺口，但标量方向仍然反向

BP134没有猜官方平台的联合移动规则，也没有修改production。它把BP133的35个未决根分别放入三个
完全隔离的有限规则世界：顺序占位阻挡、意图占位阻挡、碰撞同归。每个世界拥有自己的Fast、Hazard、
Hard和search cache，并在搜索后验证FastState哈希、delta和event完全恢复。

## 物理支持已经真正被执行

| 规则世界 | 节点 | 移动竞争transition | 同目标 | swap | 进入对方起点 |
|---|---:|---:|---:|---:|---:|
| SEQUENTIAL_BLOCK | 21,774 | 182 | 149 | 1 | 32 |
| INTENT_BLOCK | 21,774 | 182 | 149 | 1 | 32 |
| COLLISION_CRASH | 21,773 | 182 | 149 | 1 | 32 |

因此“35根全部完成”不是空接线：三个规则分支确实都进入了搜索，共执行546次规则化移动竞争。35根在
三个世界中全部完整，root restore失败、热路径分配、行为变化均为0。

## 三世界关系一致，却与历史结果反向

三个世界逐根的value与关系完全一致：17个candidate higher、9个equal、9个candidate lower；规则世界
分歧为0，value分歧也为0。但把这35根接回精确历史标签后，方向出现了明确反证：

| Minimax关系 | 根数 | 历史候选改善 | 历史原动作更好 | 历史相同 |
|---|---:|---:|---:|---:|
| candidate higher | 17 | 0 | 2 | 15 |
| equal | 9 | 0 | 0 | 9 |
| candidate lower | 9 | 2 | 0 | 7 |

也就是说，物理不确定性确实阻断了搜索完整性，但不是当前scalar方向错误的原因。三个世界都支持完整搜索
后，所有17个“候选更高”仍没有一例历史改善，反而包含两例退化；两例真实改善都被判成candidate lower。

## 决策

接受三世界envelope作为诊断完整性工具；拒绝它取得动作所有权。production继续对官方未闭合的同目标、
swap和stun移动竞争fail-closed，SHA-256保持
`0a8f09c3bf54e7ecd708346b08ff1133a716aa62634484b10e549968a0cbc23e`。

下一步BP135不再调物理规则、depth、width或budget，而是在这35个“规则不敏感”根上分解leaf和backup：
逐维检查terminal/nonloss、死亡、击毁、星差、位置、资源和攻击进度，是哪一层把真实改善压低、把真实
退化抬高。任何分量修复先作为离线解释/Shadow证据，不能直接接管production动作。

机器证据见
`config/engine-v3/base-policy-kernel-bp134-depth3-move-variant-evidence.json`。
