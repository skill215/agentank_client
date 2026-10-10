# V2控制所有权模拟研究

## 1. 目的

本研究不验证某一帧的局部评分，而是把不同的Strategy、Risk和Search所有权组合接入完整V2，
在相同历史地图、出生点、出星序列和确定性种子下与冻结V1完成整局对战。

研究问题：

1. Strategy是否应该拥有动作集合的成员资格；
2. Risk空集合时是否应该恢复最小违反Pareto前沿；
3. 当前原子PlanSketch是否足以拥有战略/战术选择；
4. 哪一个最小架构改动在未见场景仍稳定优于CURRENT。

## 2. 对战安排

所有场景来自固定266场景的Discovery 96，Holdout 170未读取。每个场景运行四种换位/技能组合：

- `NATIVE_V1_SEAT0`；
- `NATIVE_V2_SEAT0`；
- `SKILL_CROSS_V1_SEAT0`；
- `SKILL_CROSS_V2_SEAT0`。

胜负分析忽略runtime胜负；同星frame limit及同星同归于尽记为平局。每个结构保存紧凑逐局结果，
不保存逐帧replay。

### 第一轮：结构筛选

- 固定32场景；
- 每种结构128局；
- 六种结构共768局；
- 比较`CURRENT`、`BAND_OFF`、`OWNERSHIP_RISK_FRONTIER`、
  `STRATEGIC_RISK_FRONTIER`、`OWNERSHIP_ROUTER_ONLY`和`OWNERSHIP_POC`。

### 第二轮：独立扩大验证

- 使用相同确定性排名中的场景32--95，与第一轮零重叠；
- 64场景，每种结构256局；
- 三种结构共768局；
- 只保留`CURRENT`、`BAND_OFF`和第一轮最高的`STRATEGIC_RISK_FRONTIER`。

两轮合计1,536局；第二轮而非两轮合并结果负责判断第一轮优胜结构是否可复现。

## 3. 第一轮结果

| 结构 | V2胜/负/平 | 分析得分 | 星差 | 单方击毁胜/负 | FIRE |
|---|---:|---:|---:|---:|---:|
| CURRENT | 23/97/8 | 21.09% | -126 | 8/23 | 720 |
| BAND_OFF | 31/90/7 | 26.95% | -111 | 9/28 | 1,433 |
| OWNERSHIP_RISK_FRONTIER | 31/87/10 | 28.12% | -111 | 10/31 | 1,368 |
| STRATEGIC_RISK_FRONTIER | 32/88/8 | 28.12% | -109 | 10/30 | 1,385 |
| OWNERSHIP_ROUTER_ONLY | 25/90/13 | 24.60% | -117 | 11/21 | 855 |
| OWNERSHIP_POC | 25/90/13 | 24.60% | -117 | 13/21 | 846 |

结论：取消Strategy门禁产生最大公共收益。当前原子Plan/Search router比取消门禁低2.35个百分点，
并把FIRE从1,433压回855左右；它不具备接管长期战略的证据。Risk恢复只比`BAND_OFF`
高1.17个百分点，需要独立验证。

## 4. 第二轮结果

| 结构 | V2胜/负/平 | 分析得分 | 星差 | 单方击毁胜/负 | FIRE |
|---|---:|---:|---:|---:|---:|
| CURRENT | 30/200/26 | 16.79% | -272 | 7/45 | 1,420 |
| BAND_OFF | 40/194/22 | **19.92%** | -229 | 16/65 | 2,322 |
| STRATEGIC_RISK_FRONTIER | 39/195/22 | 19.53% | -225 | 14/65 | 2,293 |

`CURRENT -> BAND_OFF`逐局转移：

- 正向：25个`LOSS->WIN`、10个`LOSS->DRAW`、4个`DRAW->WIN`；
- 反向：16个`WIN->LOSS`、3个`WIN->DRAW`、13个`DRAW->LOSS`；
- 净增加16个score units，即8个等价胜局；
- 四个variant中三个提高，一个下降3.91个百分点；
- 星差改善43，FIRE增加902；
- 单方击毁胜增加9，但单方击毁负增加20。

`BAND_OFF -> STRATEGIC_RISK_FRONTIER`逐局转移只有一个：

- 1个`V2_WIN->V1_WIN`；
- 无任何正向胜负转移；
- 得分下降0.39个百分点；
- 星差改善4不足以抵消胜负退化。

所有结构的avoidable Hard reject、Risk dominated selection、root restore failure、
V2 timeout及error均为0。

## 5. 因果结论

### 5.1 接受：Strategy不得拥有动作成员资格

该结论在两个不重叠场景窗口都成立：`BAND_OFF`分别提高5.86和3.13个百分点。
当前StrategyBand在Risk之后再次删除动作，把目标偏好错误实现成资格门禁；删除它同时增加开火和星差，
说明问题不是简单的“攻击与抢星权重”，而是候选动作在比较前已经丢失。

### 5.2 拒绝：Risk空集合恢复

Risk应该决定动作是否满足风险合同，而不应在自己返回空集合后恢复软失败动作。
第一轮的1.17个百分点提升未在独立窗口复现，第二轮反而制造一个完整胜转负。
`recoverRiskFrontier`只保留为诊断证据，不进入目标架构。

### 5.3 拒绝：当前原子Plan直接接管选择

当前PlanSketch只是第一动作标签和局部目的，不包含稳定的多步前缀、逐步可活证明及敌方反驳结果。
让它成为owner后虽减少部分单方击毁负场，但压低攻击转换和总体得分，不能替代真正的PersistentPlan。

### 5.4 暴露的新问题：取消门禁提高收益，也扩大死亡

`BAND_OFF`在独立窗口增加9个单方击毁胜，同时增加20个单方击毁负。
这说明Risk/安全证据目前不足以给全部候选提供可靠的战斗边界；不能通过重新加Strategy门禁止血，
而应在安全验证层补齐计划首步及续行的committed viability。

## 6. 新目标架构：Proposal--Verify--Arbitrate

```text
Physical / Information State
  -> Proof owner：完整必胜证书可直接覆盖
  -> Hard owner：仅否决完整PhysicalState上的必死动作
  -> Proposal owner：Strategy与Tactical generator只生成候选Plan，不删除动作
  -> Verify owner：Safety + committed EO验证首步及计划前缀
  -> Risk owner：按RiskProfile建立可接受集；空集保持显式失败，不自行恢复
  -> Search owner：对每个Plan做条件化敌方反驳，输出区间/反例，不跨目标选最终动作
  -> Arbiter owner：只在已验证Plan间按终局、风险、目标deadline、进度及资源排序
  -> FinalActionGate：仅检查最终合法性
  -> materialize一个PersistentPlan
```

所有权约束：

- Strategy拥有“提议什么目标”，不拥有动作资格；
- Risk拥有“风险合同是否满足”，不拥有战术/星价值，也不恢复自己拒绝的动作；
- Search拥有“这个Plan面对敌方回应是否成立”，不拥有跨目标战略；
- Arbiter拥有最终软选择，但不能恢复Hard、Safety或Risk拒绝；
- committed EO只处理真实炸弹和已提交敌弹；possible/future threat继续属于Risk/Search。

## 7. 下一步PoC

生产前先实现最小Plan-conditioned PoC：

1. 每个目标最多两个多帧Plan，字段固定为target、2--4步prefix、deadline、progress、abort和
   committed viability；
2. 非接触局面Search只验证Plan prefix，不进行全动作全局Minimax；
3. 接触局面对每个Plan返回`REFUTED/UNKNOWN/SURVIVES`及robust区间；
4. 继续以`BAND_OFF`作为新诊断基线；
5. 使用本研究相同的32筛选、剩余64独立验证；必须提高得分且不能继续扩大单方击毁负场。

本研究不修改production默认语义，也不构成发布资格。
