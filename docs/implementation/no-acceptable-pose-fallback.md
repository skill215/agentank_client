# NO_ACCEPTABLE projected-pose fallback

本阶段修复的是一个经过精确反事实验证的紧急回退所有权错误，不是调整普通 Risk
阈值。在 `mat_KlF8S4gI3ryC6gSoB` 的 V2 seat 0 第 58 帧，四个合法动作的
`immediateFatalMass / horizonFatalMass / unknownMass / earliestFatalFrame` 完全相同，
旧排序却先比较软 `escapeSlack`，因此选择向敌方枪口前进一步的 `GO`，并在第 60 帧被撞毁。

精确 replay 反事实证明：`GO` 和 `THROW_BOMB` 都在第 60 帧失败，`TURN_LEFT` 在第 85 帧
击毁对手，`TURN_RIGHT` 能活到 128 帧但以 0:2 星失败。这排除了 AttackSetup、Hard 和搜索深度
作为该根的直接原因，根因是所有正常动作均被 Risk 排除后的排序缺少 projected pose 分辨率。

修复后的紧急顺序为：

```text
fatal masses / unknown / earliest deadline
→ projected fallback pose risk
→ soft escape slack
→ robust value
→ stable row
```

现有 `possibleRisk` 在近距直射线上会饱和为 10000。新逻辑复用已有
`Uint16 unknownFallbackRisk`，编码为 `possibleRisk * 5 + contactClass`；基础风险仍是主键，
只有基础值相同时才按清晰射线上的敌我距离 0–4 分级。最大值 50004，不增加 TypedArray。
该几何只在 `acceptableCount === 0` 后计算，因此普通可接受根零新增射线和距离工作。

目标根由 `GO(50003, slack +1)` 改为 `TURN_LEFT(50002, slack -1)`，终局由
`V1_WIN / crash frame 60` 转为 `V2_WIN / enemy crash frame 85`。最终固定16场景相对冻结证据
从 4胜27负1平提升为5胜26负1平：一个 `LOSS→WIN`，没有 `WIN→LOSS` 或 `DRAW→LOSS`；
FIRE 由167增至169。另有一局只在倒数第二个动作从BOMB变为GO，终局、帧数和失败原因不变。

SR3 28项、Minimax core 212项、GR0 356项、IMP5 14项全部通过；timeout/error、
avoidable Hard reject、Risk dominated selection 和 root restore failure 均为0。

随后增加只读旧语义开关，用同一份源码进行A/B。固定16场景中旧语义为3胜28负1平，
新语义为4胜27负1平，仍是一个净胜转换。

一次性读取的96场景 Tactical Holdout 共192局/语义。旧语义22胜162负8平，新语义
23胜161负8平：逐局只有一个 `LOSS→WIN`，没有任何反向终局转换；得分提升0.52个百分点，
自身被毁减少1局，FIRE减少2次。192局中8局动作流变化，共172个后续动作字节发生变化。
唯一正转换是 `mat_Bhg8Kbt7YnS6goIih` seat 0：第20帧fatal前缀完全相同，旧语义因软slack
选择停留原位的BOMB并在128帧失败；新语义发现GO离开敌方清晰射线，pose risk由21252降为0，
最终在第31帧击毁对手。

这批独立结果方向为正但不具统计显著性：只有一个discordant终局，精确符号检验双侧p=1、
单侧p=0.5。因此结论仅为保留有两条独立因果链且无观测退化的局部安全修复，不能声称整体
胜率已显著提高，也不能声称攻击能力提高。

独立运行还暴露出更大的结构面：新语义19,953次决策中有1,922次`NO_ACCEPTABLE`，约9.63%。
下一阶段应冻结本排序，分类这些根为何被Risk全部排除；不能继续调整contact class或slack顺序。

机器证据：`config/engine-v2/no-acceptable-pose-fallback-evidence.json`。
