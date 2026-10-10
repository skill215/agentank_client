# BP352：终局收益与死亡风险的语义核对

## 结论

已确认接口层存在表达缺口：Safety记录自身死亡质量，Risk的`binaryFatalBackup`无条件把这些质量映射到VALUE_MIN；而终局搜索能把领先时同归于尽识别为正收益。Risk没有携带“该死亡分支同时是胜局”的联合结果，无法区分必输死亡与获胜死亡。

7个真实对枪根的有限响应矩阵进一步支持这一问题：FIRE共52个敌方行动×支持chance分支，51胜、1平、0负、0未完成。原来选择的转向共70个分支，61个尚未终局、9个负局。不能把这些分支频数当作概率，也不能把有限矩阵直接升级成严格Proof。

本轮仅增加诊断工具和现状测试，没有修改生产、风险阈值、开火权重或搜索深度。

## 检查方式

从BP351固定选出7个“末帧FIRE同归于尽可恢复结果”的根。每局重建一次冻结NAVIGATION_FAMILY轨迹。在目标根复制FastState，使用当前生产专用搜索同型的物理kernel，在副本上枚举：

- 我方原选动作和FIRE；
- 现有enemyActions生成域，并补NONE（若原本缺失）；
- `chanceAlternatives`支持的双方stun分支，保留每一项，不假设等概率；
- 一次联合帧；每格完成后逐数组检查undo恢复。

敌方行动域各根包含NONE、GO、LEFT、RIGHT、FIRE、BOMB，部分根包含STUN。这个域来自当前生成器，不是独立合法动作oracle；物理kernel也是生产搜索的同型实现，不是独立平台真值。

共122格：52个FIRE格、70个原选转向格。7次自然重建的双方动作/参数、结果与事件计数保持一致，未改变决策。

## FIRE响应结果

| 场景 | FIRE响应格数 | 胜 | 平 | 负 |
| --- | ---: | ---: | ---: | ---: |
| mat_4EIuA7AsxHTEjI60e | 7 | 7 | 0 | 0 |
| mat_JuEUnL6J23K6wEiV3 | 9 | 9 | 0 | 0 |
| mat_IQk3EW1Ww3x2cUqPJ | 9 | 8 | 1 | 0 |
| mat_2jj27iM4EJ42l06t2 | 6 | 6 | 0 | 0 |
| mat_AEteC4LDVUJBo90Sa | 7 | 7 | 0 | 0 |
| mat_L2PhNahYZ5DA7jscD | 7 | 7 | 0 | 0 |
| mat_LmbOK9Kf1DT4pile2 | 7 | 7 | 0 | 0 |

对方FIRE的7格全部双方死亡：6格我方领先、1格同星。它们与BP351真实模拟器实际响应的结果方向相符，但其余响应尚未逐格与独立模拟器做差分。

同星格的物理terminal code为WIN1（保守runtime规则），本文按既定runtime-independent分析合同记DRAW。搜索给它-60000是现有悲观同星交易偏好，并不能直接判为平台规则bug；生产runtime目标与离线分析目标必须显式区分。

## 三层如何冲突

### Safety：死亡质量不是联合终局结果

`information-safety-closure.js`的future FIRE威胁推导围绕我方投影位置、敌方射线、可闪避性及deadline计算死亡质量。`multi-frame-risk-bounds.js`继续传播这类威胁。它们没有将“我方这次开火同时杀死对手、星数领先导致胜利”作为同一事件的效用输入。

死亡统计本身并不错误；错误风险出现在把它无条件当作失败效用的消费者处。

### Risk：所有fatal mass统一污染到最低效用

`risk-acceptance-controller.js:206`的`binaryFatalBackup`将mass对应的效用固定为VALUE_MIN，随后再做最坏污染。`applySafetyRobustBackup`对committed、possible projectile、future FIRE依次应用这一处理，并把相关worstValue写为VALUE_MIN。阈值和Pareto也消费fatal mass。

因此，即使一个行动的死亡分支全部是获胜终局，接口仍只能输入“有死亡质量”，无法表达“有死亡、无输局质量”。这不是加大tactical分数就能可靠修复的：当前7个FIRE已有高tactical/expected值，却仍被风险拒绝。

### Search：领先同归于尽已能给正值

`base-policy-specialized/policy-search.js:491`的`terminalUtility`：双方死亡时，领先+100000、落后-100000、同星-60000。6个领先FIRE/FIRE格确实返回+100000。因此不能归因为Minimax完全不理解对枪；至少该终局估值函数已理解领先互毁收益。

这些根的实际选择没有搜索提案取得所有权。有限矩阵的正值不能直接证明生产搜索已完成覆盖，也不能证明任何完整证书可绕过Risk。要查的是证据完成度及各层交接，而非继续增加全局深度。

## 推荐的修复边界

下一步应先建立独立联合终局证据，再接线，而不是删Safety：

1. 保留自身死亡质量用于生命/逃生诊断，新增或复用独立的终局胜、平、负、未决证据；每项绑定响应支持完整度。
2. 只有联合动作、chance、隐藏状态支持完整，且物理规则已核对时，才允许终局结果替代对应分支的“未知死亡=最低值”估计。必须避免同一分支同时贡献终局收益和重复死亡惩罚。
3. 非终局、支持不完整、可能弹丸仍保持原保守路径；不能按星数领先直接清零death mass，不能把possible FIRE升为Hard事实。
4. 保持同星runtime悲观值与离线DRAW统计的区分，不借此次修复改掉原有runtime假设。
5. 优先证明6个领先互毁根的完整域和独立物理一致性，再以诊断模式接入；需要落后互毁、同星互毁、对方盾、可闪避、技能和未完成支持的反例。不能仅为这7个样本添加“FIRE优先”。

## 验证与证据

- 387/387 Minimax UT通过。
- 新增3项为现状刻画测试：自身死亡与输局分离、fatal backup的最低值污染、搜索互毁效用。它们不是要求未来永久保留缺陷；修复时应转换为新的合同断言。
- 7次重建动作/参数/事件计数一致；122格副本恢复检查通过；error、timeout、root restore均0。
- 证据6016字节，无完整replay；`strictProof=false`。
- runner：`tools/agentank/diagnostics/terminal-risk-semantics-audit.js`。
- UT：`test/minimax-core/terminal-risk-semantics-audit.test.js`。
- artifacts：`artifacts/native-causal-audit/bp352-terminal-risk-semantics/`。
- 生产tree仍为`285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。
- 未提交、推送、simulate、publish或challenge。
