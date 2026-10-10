# BP342：无搜索导航的绕障碍评分反例

## 结论

找到可复现的行为缺陷：原incumbent使用单步Manhattan距离变化表示目标进度，无法表达“先离目标直线更远、才能绕开障碍”。推进动作没有缺失，也不是被Hard/Risk拒绝；其分数先输给原地转向，再被战略候选集合排除。

该缺陷解释了本批部分原地旋转，不证明全部整局退化都来自这一项。生产默认未修改，也未降低安全要求。

## 证据范围

重建BP340的9条CURRENT_GEOMETRIC冻结轨迹，采集首次分歧至后8帧，共81根。双方动作流、参数、事件计数、结果完全一致。没有新策略对战。

6个案例的8帧同时满足：

- 生成了能真实移动的GO。
- 静态绕障碍路径距离缩短1格，但Manhattan距离增加1格。
- GO的Hard=ALLOW、Risk acceptable=1、dominated=0；immediate/horizon/unknown均0。
- GO分数比最终LEFT低510或760；bandSelected=0。
- 最终执行LEFT，不是最终安全门把已选GO改掉。

其中5根属于STRATEGIC_NAVIGATION，3根仍为TACTICAL_CONTACT。问题不仅发生在“敌方眩晕”的条件内；后续恢复非接触模式后仍会持续。

| 场景/座位 | 帧 | GO原分 | LEFT原分 | 静态路径变化 | Manhattan变化 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 4Qjz / 1 | 4 | -228 | 532 | -1 | +1 |
| 4Qjz / 1 | 11 | -433 | 327 | -1 | +1 |
| EOCS / 0 | 8 | -202 | 558 | -1 | +1 |
| 6RDW / 0 | 7 | -208 | 552 | -1 | +1 |
| DpQa / 0 | 8 | -202 | 308 | -1 | +1 |
| 8d1a / 0 | 4 | -228 | 282 | -1 | +1 |
| 8d1a / 0 | 10 | -189 | 321 | -1 | +1 |
| 0so8 / 0 | 10 | -189 | 321 | -1 | +1 |

## 具体链路

`NativeBasePolicyEngine.actionScore`对GO的Manhattan进度同时计入两项：基础星进度系数折算450分/格，GO附加1200分/格。必要绕路使其合计被扣1650分。新位置增加1–2个可走邻居，只补250–500分。

连续转向虽然扣700分，但重复同一个动作有60分相对连续性奖励；LEFT/RIGHT没有目标朝向进度时，LEFT可因该60分或稳定行号继续胜出。这样允许GO绕路的朝向出现后，GO仍输掉，坦克又转走。

战略层也没有补回路线语义：`prepareStrategyEvidence`只在projectedCell直接等于星所在格时标记starPurpose，普通远距离绕行不产生星目标证据。策略portfolio取更高分的中立anchor，8根中均未选择GO。这里不能把bandSelected=0误判为新的物理拒绝；它是前述评分/目标表达问题传递到候选筛选的结果。

因此“有一套导航fallback”不等于它承接了Minimax附带的路线选择能力。BP341只刷新目标但不改变这个选人链路，动作不变是合理结果。

## UT与限制

新增最小5×5绕障碍反例，调用真实`actionScore`：GO令静态路径4→3、Manhattan2→3，LEFT仍高760分；重复LEFT比RIGHT高60分。测试明确记录现有缺陷，不要求未来修复后继续维持错误行为。

Minimax UT371/371通过。9条重建timeout/error/root restore为0。静态路径指标不包含动态危险、敌方占位、转向时间和土堆破坏，不可拿它替代Hard或逃生证明。

## 下一步修复方向

优先建立统一的目标路线进度：至少考虑可达距离和朝向/到达动作数，让合法绕障碍步骤能被识别为推进，转向则以是否减少后续到达动作数评价。评分与策略purpose必须消费同一进度证据，不能一个使用路径距离、另一个仍只识别“下一步踩星”。

复用现有预分配路径工作区，按目标与地形版本重用距离场；不为每动作各跑一遍寻路，不增加Minimax深度，不引入第二套世界状态。路线只提供软目标收益，Hard/Risk保持最终安全约束。

先完成正反UT：必要绕路、死胡同、不可达目标、正确转向、重复整圈、危险最短路不得越过Hard。再作为诊断候选验证；不通过简单降低转向分或全局提高GO分解决，也不恢复已拒绝的几何入口限制。

## 文件

- 工具：`tools/agentank/diagnostics/navigation-selection-audit.js`。
- 证据：`artifacts/native-causal-audit/bp342-navigation-selection/`，仅manifest与81个紧凑候选根，无完整replay。
- UT：`test/minimax-core/navigation-score-counterexample.test.js`。
- Production tree保持`285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。
- 未修改生产默认、提交、推送或调用官方平台。
