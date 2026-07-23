# Escape Quality 度量分层（Discovery ≠ Oracle）

状态：2026-07-21（Phase 4）。Escape Membership/Quality 落地后的验收记账规则。

## 分层

| 层 | 用途 | 可否记为回归真值 |
|---|---|---|
| fixed-continuation mismatch | Discovery 候选（历史后缀复放） | **否**（已知假退化） |
| policy-consistent continuation | 当前 V2 策略自洽续写 | **是**（主回归真值） |
| effective opponent / best-response | 对抗强度 | 能力不足时标 AMBIGUOUS |
| AMBIGUOUS | 证据不足 | **不计** S2D |

工具入口：`./tools/fast-regression-toolchain.sh analyze-policy-continuations`（见
[policy-continuation-analysis.js](../../tools/agentank/fast-regression/policy-continuation-analysis.js)）。

## 与 Escape Quality 的关系

- **Membership**：谁进逃生集合（Hard / `postViable` 三值 / Deadline first-action）。
- **Quality**：`SUCCESSOR_PROOF` + `stillExposedAtDeadline` 字典序前缀（在 Soft fatal mass 之前）；
  domination / safeFloor 同步尊重该前缀。
- **TemporaryMembershipPatch（仍保留）**：
  - unfaced clearing `contactStep`（826c；朝向属 Information）
  - `corridorClearing`（64c3；清出 GO 在 committed 上更优但续写死亡）
  - `axisClearing`、`contactPrep`、walled-turn demote
- **已退役**：clear-GO + `enemyFacesGo` 降爆圈 TURN（Phase 3.1；由 Quality `stillExposed` 覆盖）

## 验收包（退役 demote 时）

1. 对应 UT  
2. CONTINUATION 8/8  
3. policy-consistent（fixed-continuation 仅 Discovery）  
4. Capsule-all 不变量 0  
5. focused 主池/控制相对上一稳定报告 S2D=0  
6. source 语义一致；minified 对照留待 Production 冻结流水线  

## Phase 4 抽样（DOMINATED_RESCUE）

报告：`escape-quality-policy-continuation-p3`

| 项 | 值 |
|---|---:|
| targetCases | 21 |
| selectedPolicySurvivors | 16 |
| strategyConsistentCounterexamples | 5 |
| informationStateDominatingDefects | 1 |
| epistemicAmbiguities | 4 |

Focused vs R21 / R22c：`NET_IMPROVEMENT_NO_REGRESSION`（S2D=0）。
