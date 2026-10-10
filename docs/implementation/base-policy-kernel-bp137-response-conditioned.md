# BP137：一步敌方响应无法判向，结构化攻击进展只有高精度低召回

BP137没有重跑Minimax，也没有改变production。它复用BP135的FULL与NO_ATTACK depth-3根单元格，
按相同敌方动作列记录两套值，并读取可观察的OpponentModel名义策略。历史战斗中敌方真实下一动作只在
离线报告阶段作为标签连接，运行时Shadow从未读取该信息，也没有取得动作所有权。35根在三个移动规则
世界中全部完成且逐根一致；热分配、restore失败和行为变化均为0。production SHA保持
`0a8f09c3bf54e7ecd708346b08ff1133a716aa62634484b10e549968a0cbc23e`。

## 一步响应结果

35个历史动作都能唯一映射到搜索列，没有歧义或缺失。然而两个历史改善和两个历史退化在各自真实敌方
下一动作上都表现为FULL候选更高；切换到NO_ATTACK后四者全部相等。也就是说，这四个方向都来自
ATTACK叶贡献，而不是一步敌方响应真正区分了候选优劣。

名义对手策略也没有提供额外信息：35/35根的动作概率在一个整数概率单位内均匀，真实历史动作所在列的
质量只在1428至1667之间。因此当前OpponentModel在这批根上不是“错误预测了某个动作”，而是根本没有
形成可用于判向的root-conditioned分布。继续调StageMatrix、风险污染或ATTACK权重都不能修复这个缺口。

## 结构化攻击进展

BP137把通用路线`PROGRESS`从攻击证书中删除。候选只有在Objective Pareto不退化，且额外改善枪口覆盖、
敌方响应后可活性、自逃分支或反击暴露时，才标记为`verifiedStructuralProgress`。这个更严格的证书在四个
有历史方向的根中得到：

- 历史改善：1/2命中；
- 历史退化：0/2误报；
- directional precision为100%，improvement recall为50%。

它适合作为后续搜索的高精度Shadow过滤条件，但覆盖不足，不能单独成为动作owner。另一个真实改善仍需
更长的事件链才能解释。

## 决策

保留同列FULL/NO_ATTACK分解、可观察名义策略快照和严格结构进展证书；拒绝一步真实响应值、当前近均匀
OpponentModel以及通用路线进展取得动作所有权。下一步BP138沿共同续写展开到“下一攻击事件或已提交
deadline”，分别记录terminal/nonloss、弹丸创建、命中/击毁、反击暴露和逃生可活性。历史动作仍只能
用于离线标注，不能进入运行时决策。

机器证据见
`config/engine-v3/base-policy-kernel-bp137-response-conditioned-evidence.json`。
