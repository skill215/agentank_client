# BP397 R91–R100：动作排序与风险标签

沿用高效调优协议和 BP396 双对照分层门槛。生产、Hard、Risk 准入、搜索域、finalGate、候选系数不变；只修改通过原有准入后的动作排序。固定 bomb-phase 校准模拟器、确定性 V1 时钟、双方 stun、128 帧、原始 seed。禁止修改旧产物、提交发布或启用子 agent。

## 五个机制 × 两个父候选

当前 owner 先以搜索分数加 intent bonus 排序，再以 nominal 分数、intent tie、风险支配和动作优先级打破平局。Risk 接受之外，已有 intent-known 路径允许立即死亡质量与未知质量均为零、非 dominated 且有 intent 的动作参与；本批保持这一准入条件。

| 轮次 | 机制 | 父候选 |
|---|---|---|
| R91 / R92 | 比较两个已准入动作时，strictlyDominates 优先于搜索分数；互不支配则原排序 | R15 / R29 |
| R93 / R94 | 已准入动作中，risk.acceptable 优先于 intent-known 软准入；同标签则原排序 | R15 / R29 |
| R95 / R96 | 仅移除 intentAdjustment 加分，保留 intent 成员资格与提交行为 | R15 / R29 |
| R97 / R98 | 仅移除 nominal 平局排序，主分数与其余平局规则保留 | R15 / R29 |
| R99 / R100 | 主分数相同且比较双方包含原 incumbent 行时优先 incumbent，其余原排序 | R15 / R29 |

只在 owner.better / intentAdjustment 注入诊断变体，仍由原 owner 枚举准入行并提交意图，再由原 finalGate 发出动作。incumbent 是当帧进入 owner 的 selected 行；不把历史 baseline 动作插入。记录排序比较次数、改变偏好的次数、intent bonus 调用／改值次数，未实际影响机制或无收益不得晋级。诊断比较统计不是最终动作变化率。

## 数据和早停

完全沿用 BP396 冻结的64地图开发集（128局）和128地图验证集（256局），不根据新结果换样本。验证地形排除开发及 BP394 的192张证据地图。验证集上一批未运行；历史总体结果早已见过，不称新盲测。manifest 绑定 BP396 manifest SHA256 和全部开发输入、预注册代码。

先重跑生产、R15、R29 各128局，确保排序测量包装与原归档逐动作、参数、分析终局和搜索量一致。十个候选全部开发筛选：同时相对生产和相应父候选净局分至少 +2，单方死亡负局、换位双负均不增加，节点比 ≤2，mechanismChanges >0。通过后才运行验证：两个对照均净局分 >0，其他约束相同；再通过才执行原始全量2486局。全量复用相同候选已跑开发／验证行，绝不混用其他候选结果。

全量通过仅记 QUALIFIED_DIAGNOSTIC_PENDING_PORTABILITY_AND_MULTISEED，仍需生产形态等价与多种子，不能直接采用。失败轮也记完成，执行错误不记完成，不用修改阈值补正结果。不得把本批“严格风险优先”当作模型已校准或安全证明。

## 审计与复现

源码、父候选参考、输入、协议、测试在启动前哈希冻结；检查点完整行逐条 SHA256 和 job 身份验证，仅未换行尾片段可记账截除。双方 error/timeout、rootRestoreFailures、hotAllocations 均需为0。每次推进一个 stage，4 个本地对局 worker；拒绝后停止扩样。

Node v24.16.0 循环执行 owner-ranking-campaign.js <新目录> 到 rounds.json，然后 owner-ranking-report.js <目录> 独立重建分组、对照统计和晋级门。保留源码档案、逐局记录及成本，报告正负结果。
