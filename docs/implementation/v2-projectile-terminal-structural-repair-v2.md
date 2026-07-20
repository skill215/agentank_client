# V2 弹道、同帧开火与终局结构修复

状态：`STRUCTURAL_REPAIR_PASS / PERFORMANCE_TARGET_MET / LOCAL_ARENA_COMPLETE / NEW_CANDIDATE_NOT_FROZEN`，2026-07-17。

本轮分析对象是前一版 2,128 场 V1/V2 对战结果，并按“已提交敌弹、同帧新开火、坦克碰撞、128 帧结算”重新拆分。修复后使用相同历史地图、星星序列、出生位、座位交换和技能交换重新运行 2,128 场，再以严格重放核对所有失败。本文是 [v2-performance-tuning-v1.md](v2-performance-tuning-v1.md) 的后续结论；旧报告及其参数选择保留为历史证据，不再代表当前 working source 的选择。

## 1. 结论

四类现象并不具有相同的规则地位：

| 类别 | 是否真实存在 | 根决策中的量词 | 本轮判断 |
|---|---|---|---|
| 已提交敌弹 | 是，事后弹丸事件可证明 | 已观察且持续跟踪时是 `PhysicalState` Hard；未观察时仍是 `InformationState` | 同时存在规则表达缺陷和搜索缺口，已结构修复 |
| 同帧新开火 | 是，平台证据确认弹丸生成后同帧移动两格 | 开火前只能作为 `EnemyAction/HiddenWorld` 风险，不能作为 Hard | 搜索支持集与 horizon 闭包不足，已结构修复 |
| 坦克碰撞 | 本轮证据为 0，平台细节仍未闭合 | 未有平台证据前不得进入新 Hard 规则 | 不修改物理规则 |
| 128 帧结算 | 是，record 127 后结算已确认 | 星数是确定状态；同星平台累计耗时在 bot 输入中未知 | 比较顺序代码无误，当前失败是星图策略问题 |

本轮确认的核心规则表达问题不是“所有可能射击都应该硬拒绝”，而是观察适配器曾把 `enemy.bullet === null` 近似成“没有敌弹”，并可能在当前地图已反映土堆销毁后才推进上一帧弹丸。前者错误地把 InformationState 提升为 PhysicalState，后者会让弹丸穿过实际阻挡它的旧土堆。两处均已修正。

搜索算法还缺少两个结构：隐藏敌方在关键朝向同帧开火的支持，以及浅层叶节点形成瞄准后下一帧开火的死亡闭包。两者已加入有界、定点整数、固定数组实现。它们只改变 Value/风险排序；预算耗尽或支持不完整返回近似/未知，不能授权 Hard 或 ForcedWin。

## 2. 修复内容

### 2.1 观察与跨帧弹丸

[production-root.js](../../engine-v2/src/runtime/production-root.js) 现在先用上一根状态的地形推进已跟踪实体，再复制当前观察地图；弹丸撞墙、撞土堆、越界、必然穿过当前仍存活坦克或在直接可观察射线上缺失时失效。敌方 bullet 字段在首根之后为 `null` 且没有精确跟踪实体时，根状态强制标记为 `INCOMPLETE`，不再进入严格 PhysicalState/Proof。

这条规则只把“已经观察并可持续确定”的弹丸交给 Hard。失败分类中的“已提交敌弹”是事后物理原因，不自动等价为决策时已知事实：最终 173 个该类失败的死亡窗口全部是 `INCOMPLETE`，只有 3 个窗口直接观察到敌弹。因此剩余大部分必须继续由隐藏世界风险处理，不能用事后全知把它们硬编码成禁入。

### 2.2 隐藏弹丸与同帧开火风险

[possible-projectiles.js](../../engine-v2/src/runtime/possible-projectiles.js) 使用固定 `TypedArray` 槽保存可能弹丸的位置、方向、发射帧和 0..10000 整数质量；跨帧推进到物理失效，不在热路径分配临时对象。[production-information-search.js](../../engine-v2/src/search/production-information-search.js) 将可能已发射弹丸和隐藏枪口同帧开火分别放入递归的 ε-contamination backup。

节点预算缩减时，物理世界矩阵只展开预算能够完整覆盖的方向；被省略但致命的隐藏朝向仍通过风险包络进入 `FIRE` 列。风险包络把结果标为 approximate/support incomplete，不能产生严格失败证明。

### 2.3 有界死亡链闭包

[production-depth-search.js](../../engine-v2/src/search/production-depth-search.js) 在叶状态出现“敌方已经瞄准且下一帧可开火”时，使用固定动作数组检查完整的我方下一帧应对族。只有所有完整应对都被真实 FastKernel/HardGate 证明为 `REJECT_PROVEN`，该叶才获得接近必败的 Value；任何可行应对、动作族不完整或预算不足都不能形成证明。

该 probe 有独立节点上限并计入搜索节点，InformationState 每个物理世界复用同一实现。它是选择性 horizon extension，不修改根 Hard 状态，也不把普通 Minimax 叶伪装为最终胜负。

### 2.4 终局模式与预算一致性

生产根原先定义了 `FORCED_LOSS_RECOVERY/HARD_SURVIVAL`，但实际始终以 Normal 进入策略选择。现在最后 16 帧中，星数相等或落后进入 recovery，严格领先进入 preserve；基于既定“我方平台累计耗时更高”的策略关系，同星必须主动争胜，不能等待本地耗时估计。FinalActionGate 仍是最终权限边界。

InformationState 搜索现在先计算完整矩阵基础成本，再决定支持的世界/方向数量；不会为了“至少搜一个世界”越过节点预算。选择性死亡链只消费单独保留的剩余预算。

## 3. 四类失败的实证结果

严格分类器：[failure-classification-report.json](../../artifacts/diagnostics/v1-v2-failure-classification/9c0c3f6b246a2e76-2bcdf20e7d27-f424e0f4c2f6/failure-classification-report.json)，fingerprint `553e202c0d98f859170109ff44ff14d8c7f54cc5517dd3b351ade06849a9d0d8`。

| 失败类 | 修复前 | 最终 | 变化 | 解释 |
|---|---:|---:|---:|---|
| 已提交敌弹 | 216 | 173 | -43 | 观察持续性、可能弹丸与死亡链共同改善 |
| 同帧新开火 | 551 | 515 | -36 | 隐藏枪口/FIRE 风险与浅层闭包改善 |
| 坦克碰撞 | 0 | 0 | 0 | 没有授权修改规则的证据 |
| 128 帧结算 | 169 | 200 | +31 | 部分崩毁被延后到终局，但星图控制仍不足 |
| 模拟器炸弹相位 | 27 | 19 | -8 | 已知本地相位差，不能作平台正确性结论 |
| 不可复现 | 0 | 1 | +1 | 同动作、同双毁、同星，因本地 runtime 决胜改变 winner |

物理弹丸崩毁（前两类）从 767 降到 688，共减少 79。修复前失败中有 154 场转为胜利：已提交敌弹 48、同帧新开火 88、128 帧 11、模拟器炸弹 7。与此同时有 99 个旧胜局转败，其中已提交敌弹 25、同帧新开火 63、128 帧 6、炸弹 5；这些保留为回归语料，不能被净胜率隐藏。

最终 200 个 128 帧失败全部是 V2 星数落后：`0:1` 139 场、`1:2` 24 场、`2:3` 2 场、`1:3` 6 场、`0:2` 22 场，其他更大差距 7 场。同星失败为 0，严格领先失败为 0。因此当前没有“终局星数/耗时比较代码写反”的证据；问题属于终局前的抢星、封路、击杀压力和防止对方拿星策略。

本地 simulator 对占用目标格和双方交换位置会阻止移动；分类重放没有产生坦克碰撞死亡。平台碰撞细节仍是未闭合规则，因此本轮不改变 FastKernel、HardGate 或缓存键。

## 4. 最终 V1/V2 对战

完整报告：[working-arena-overview.json](../../artifacts/diagnostics/v1-v2-working/9c0c3f6b246a2e76-r2-discovery-calibration-frozen-pd71e5ee1339e-rolling-3c663bc6/working-arena-overview.json)，fingerprint `f424e0f4c2f6968712fb856c9ee0ec17e073b43a91d732f31eb08bf4d089557a`。

266 个动态历史场景、两个 repetitions、四个座位/技能变体，共 2,128 场：

| 分组 | 对局 | 修复前 V2 胜 | 最终 V2 胜 | 净变化 |
|---|---:|---:|---:|---:|
| Discovery | 1,000 | 562 | 588 | +26 |
| Calibration | 448 | 246 | 259 | +13 |
| Frozen Regression | 504 | 260 | 267 | +7 |
| Rolling Discovery | 176 | 97 | 106 | +9 |
| 合计 | 2,128 | 1,165 | 1,220 | +55 |

最终原生技能为 562/1,064，技能交叉为 658/1,064。相对修复前的同局迁移为 `WIN→WIN 1066`、`LOSS→LOSS 809`、`LOSS→WIN 154`、`WIN→LOSS 99`。四条证据槽净变化均为正，Frozen Regression 不再出现上一轮旧参数下的净回退。

严格不变量为：avoidable Hard reject 0、root restore failure 0、hot allocation 0、V2 timeout 0、V2 error 0。共有 221 次所有根动作均被证明拒绝的 unavoidable 状态；没有可避免的被拒动作被输出。

## 5. 性能选择

结构改动后重新执行固定输入矩阵：[runtime-matrix-report.json](../../artifacts/benchmarks/v1-v2-runtime/9c0c3f6b246a2e76-29ad6448ed66/runtime-matrix-report.json)，fingerprint `347f393a292d3011a273691851ef20def5b45b5c3c8ccfcb7d610adcf8bb1c9b`。

| Profile | 固定输入总耗时/V1 | P95/V1 | 原生样本胜局 | 结论 |
|---|---:|---:|---:|---|
| `CURRENT_24K_D2` | 96.50% | 109.53% | 17 | P95 不合格 |
| `BALANCED_18K_FRAME104` | 84.00% | 90.91% | 18 | 选中 |
| `V1_STYLE_12K_FRAME96` | 64.73% | 73.21% | 14 | 玩法退化 |
| `FRAME_FLOOR_24K_D1` | 86.00% | 92.64% | 17 | 合格但玩法排序较低 |

选择规则仍是“原生胜局、总耗时、P95”，不是单纯选择最快值。最终完整互动对战中，V2 本地总决策耗时 470,256,502µs，V1 为 641,983,108µs；每局 P95 分别为 340,840µs 和 472,910µs。两组结果都只证明同机相对性能，不等于官方平台整局 3 秒预算，官方 simulate 仍是发布前硬门。

## 6. 验证与剩余边界

Hard/Kernel、InformationState、策略、技能、生产根、配对对战、诊断和运行时证据共 14 个测试套件全部通过。旧 Frozen Candidate 的 preflight 会继续 fail closed：working source 已改变，但尚未生成并绑定新 Candidate、minified publish hash 和官方 simulation 证据；不得覆盖旧 manifest 或旧发布物消除该失败。

本轮没有闭合的事项：

1. 688 个弹丸失败仍需继续改善，但其中未观察的弹丸只能进入风险模型，不能硬化。
2. 200 个 128 帧失败全部是落后星数，应作为下一轮星图控制/终局策略专题，而不是修改终局比较器。
3. 19 个炸弹失败受已知 simulator phase 偏差影响，只能作为候选场景。
4. 1 个不可复现场景动作与双毁事件一致，仅本地累计 runtime 改变 winner；不属于 V2 物理规则回归。
5. 本地性能达标不替代官方平台 3 秒验证，也不授权发布。

因此当前结论是：四类问题已经完成真实性审计，确认的规则表达和算法结构缺口已修复，并在完整 V1/V2 对战中取得净改善；working source 可以进入下一轮星图/残余弹道策略设计，但还不能冻结或发布。
