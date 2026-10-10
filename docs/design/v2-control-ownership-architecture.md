# V2 控制权重构：Ownership Architecture

状态：诊断 PoC；不改变 production 默认语义。

## 1. 要解决的问题

当前链路同时让 Soft Risk、StrategyBand 和浅层搜索拥有动作删除或最终决策权：

```text
Risk 可能删空动作
→ StrategyBand 再把集合缩成 1–4 个原子动作
→ Minimax / StageMatrix 只能评价残余动作
→ 无动作时按单一最小风险 fallback
```

这使长期目标、战术对抗和风险控制互相覆盖。策略根据当前原子动作生成标签，再用标签删除同一批
动作，本质上没有形成长期策略。

## 2. 新所有权链

```text
Strict Proof                  可证明获胜时直接拥有最终动作
Hard                          只否决完整 PhysicalState 上的确定失败
Risk                          只形成风险可接受集或最小违规Pareto前沿
Committed EO                  只与真实已提交炸弹/敌弹的可活第一步取交集
Root Mode                     选择 Plan Owner 或 Tactical Owner
  Strategic Navigation       Plan按目标/deadline/progress选择
  Tactical Contact           Minimax/StageMatrix按robust/expected选择
FinalActionGate               只复核物理合法性，不改战略偏好
Plan Commit                   最终动作成功发出后才提交目标状态
```

所有权硬规则：

- Strategy/Plan不能恢复Hard或Risk拒绝动作；
- Strategy不能用band删除Risk/Pareto动作；
- Risk不能比较星、攻击、搜索分或Plan进度；
- Minimax不能拥有非接触局面的长期导航；
- Plan不能覆盖完整terminal、Strict Proof或committed死亡证书；
- StageMatrix概率只在接触战术值相同后作稳定tie-break；
- possible projectile、future FIRE和UNKNOWN保持Soft，不创建EO。

## 3. Risk空集合

绝对风险阈值正常工作时不改变语义。只有全部Hard合法动作都超过Soft阈值时，计算四维阈值违规：

```text
immediateFatalMass - immediateLimit
horizonFatalMass   - horizonLimit
unknownMass        - unknownLimit
minimumSlack       - escapeSlack
```

保留在上述违规向量及最早致命帧上不被支配的动作。该集合仍保留`NO_ACCEPTABLE`审计标记，
但不会退化为单一风险动作。随后：

- committed危险仍由EO取交集；
- 接触局面由robust搜索值选择；
- 非接触局面由Plan目标选择。

这不是放宽Hard，也不是把UNKNOWN当安全；它只修复“Soft阈值全部失败后目标信息被清空”的控制权
错误。

## 4. 战略与战术的比较语义

### Strategic Navigation

```text
terminal/nonloss
→ 已验证且可自逃的直接击毁
→ 根据kill/star deadline确定根目标
→ Plan purpose匹配
→ progress
→ deadline
→ robust / expected / tactical
→ stable row
```

### Tactical Contact

```text
Risk/EO后的动作集
→ robustLower
→ expectedValue
→ tacticalValue
→ purpose completeness
→ Plan progress
→ StageMatrix probability
→ stable row
```

## 5. 当前 PoC 边界

诊断模式`OWNERSHIP_POC`只复用已有PlanSketch，尚未实现真正的多帧导航Plan，因此它验证的是
“所有权组合是否优于当前组合”，不是最终战略算法。它不修改`engine-v2/src`，production bundle
hash保持不变。

固定32场景运行三条配对lane：

- `CURRENT`：当前窄portfolio；
- `BAND_OFF`：只取消Strategy动作裁剪；
- `OWNERSHIP_POC`：取消裁剪、Risk空集合Pareto恢复、按RootMode分配Plan/Search所有权。

PoC进入正式设计的最低判断：

- 相对CURRENT综合得分至少提升5个百分点；
- 星差不下降；
- `LOSS→WIN`收益大于`WIN→LOSS`损失；
- Hard、Risk domination、root restore、timeout/error全部为0；
- 若不能同时超过BAND_OFF，则说明收益只来自删除坏mask，新所有权排序没有独立价值。

固定32只用于发现，不构成资格。即使PoC通过，下一步也必须实现真正的PersistentPlan，再使用96场景
Discovery和独立Holdout确认。

## 6. PoC结果与架构决策

同一32场景、四variants、每模式128局：

| 模式 | V2/V1/平 | 得分 | 星差 | 单方击毁胜/负 | FIRE |
|---|---:|---:|---:|---:|---:|
| CURRENT | 23/97/8 | 21.09% | -126 | 8/23 | 720 |
| BAND_OFF | 31/90/7 | 26.95% | -111 | 9/28 | 1,433 |
| OWNERSHIP_POC（Risk+原子Plan路由） | 25/90/13 | 24.60% | -117 | 13/21 | 846 |
| OWNERSHIP_RISK_FRONTIER | 31/87/10 | 28.12% | -111 | 10/31 | 1,368 |
| OWNERSHIP_ROUTER_ONLY | 25/90/13 | 24.60% | -117 | 11/21 | 855 |
| STRATEGIC_RISK_FRONTIER | 32/88/8 | **28.12%** | **-109** | 10/30 | 1,385 |

`STRATEGIC_RISK_FRONTIER`相对CURRENT提升703基点（相对得分约+33.3%）。逐局转移中：

- 16场`V1_WIN→V2_WIN`、6场`V1_WIN→DRAW`、2场`DRAW→V2_WIN`；
- 8场`V2_WIN→V1_WIN`、1场`V2_WIN→DRAW`、5场`DRAW→V1_WIN`；
- 净增加18个score units，即9个胜场等价；
- avoidable Hard、risk domination、root restore、timeout/error全部为0。

结论拆分：

1. **ACCEPTED FOR ARCHITECTURE**：StrategyBand不得拥有动作membership；取消裁剪单独提升
   5.86个百分点。
2. **ACCEPTED FOR ARCHITECTURE**：只在无committed危险的Strategic Navigation根使用最小违规
   Risk Pareto前沿；相对BAND_OFF再提升1.17个百分点，星差再改善2。
3. **REJECTED**：现有原子PlanSketch直接拥有Strategic/Tactical排序。它把得分从28.12%降到
   24.60%；原子purpose/deadline不是长期Plan证据。
4. **UNCHANGED**：Tactical Contact继续使用现有Risk门和搜索/中立比较器，直到真正的多帧Plan
   oracle存在。

推荐的新基线架构为：

```text
Proof → Hard → Risk absolute gate
                   └─仅Strategic且无committed危险时：empty-set Pareto recovery
→ committed EO → risk Pareto
→ 全动作（无Strategy membership）
→ 当前中立Search/expected选择
→ FinalActionGate
```

它已经显著优于当前架构，但仍不是最终资格版本：单方击毁负从23增至30。下一阶段必须在不恢复
Strategy动作裁剪的前提下实现真正的多帧Plan候选，并用战术Minimax反驳Plan；不能把本次被否决的
原子Plan排序接入production。

证据目录：

- `artifacts/diagnostics/strategy-priority-sample/strat2-5903b8d69dac0020/`；
- `artifacts/diagnostics/strategy-priority-sample/strat2-e92ee4ea6202cbc0/`；
- `artifacts/diagnostics/strategy-priority-sample/strat2-dfa044668f889af7/`。
