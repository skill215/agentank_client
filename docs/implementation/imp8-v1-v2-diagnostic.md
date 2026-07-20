# IMP8 v1历史经验与v2成对Arena诊断

状态：`DIAGNOSTIC_COMPLETE / STRUCTURAL_FIXES_PROPOSED / NO_V2_CORE_FIX_APPLIED`，2026-07-16。

本文是review输入，不是参数选择结果。它使用v1失败分析、DD9冻结分组和固定外部模拟器的Calibration批次定位v2风险；没有修改v2搜索、评分、Runtime或策略参数，也没有消费Frozen 63局。

## 1. 实验设计与证据边界

Calibration共56张历史地图，每张执行四局：v1/stun与v2/poison交换出生位，再交换stun/poison并再次交换出生位，共224局。地图、双方出生位、历史星坐标和最早生成帧一致。模拟器固定在`cyhhao/agentank-simulator@1ef804e…`，已知bomb phase、poison冷却/时长、同帧terminal和平台runtime模型不完全等价，因此结果为`EXTERNAL_SIM_CANDIDATE`，不能升级为平台规则真值。

严格不变量全部通过：avoidable Hard拒绝0、root restore失败0、热路径分配0、native critical error 0。89次选择Hard拒绝均为所有动作已经证明失败，不是HardGate绕过可行逃生。完整报告见[paired-arena-report.json](../../artifacts/imp8/calibration/paired-arena-v1/paired-arena-report.json)。

## 2. 主要结果

原生技能/出生位交叉112局中，v2为24胜88负；80局被击毁，其中projectile/collision 60局、bomb 20局，另8局为非击毁终局。v2执行6,704次决策：完整根4,333、不完整InformationState根2,371、fallback 6,102（91.0%）、ForcedWin 0。动作包括GO 3,375、转向2,560、Poison 294、FIRE 267、BOMB 208。v2累计模拟CPU为9,444,023微秒，低于v1的27,012,376微秒，却长期进入fallback；这证明主要问题是work budget标尺，不是本机JS已经耗尽3秒。

出生位不是主要混杂：v2在seat1为11/56胜，在seat0为13/56胜。技能交叉只用于诊断，不能用于v2/poison发布分母。

## 3. v1失败类别与v2检查

| v1历史问题 | 主要历史证据 | v2当前观察 | 结论 |
|---|---|---|---|
| 3秒timeout与同星runtime负决胜 | `since-20260713-190510-cst/REPORT.md`、v26近2956ms | 本地无timeout且实际CPU较低，但91% fallback | 旧timeout表现未复现；预算映射严重失真，会以策略退化方式间接复发 |
| 在途弹/后方不可见弹追击死亡 | v20五局报告、v22/23 Overload回归 | 60个projectile/collision失利；tracked projectile持久化单测PASS | 跟踪结构存在，但需要逐局区分“真不可避免、观察丢失、fallback动作质量”，不能直接归罪Hard |
| Overload多弹与副弹过早消失 | Bolun v24分析 | 多子弹支持与实体生命周期单测PASS | 结构已覆盖；外部模拟器差异下只算回归保护，不宣称平台完全验证 |
| 紧迫星点错误放10帧炸弹、低价值炸弹 | v20第4局、v26第3局 | 20个bomb死亡，原生批次BOMB 208次 | 风险仍高；应进入统一Plan/Evaluator与爆炸deadline，不加“某坐标禁炸”补丁 |
| cloak/草丛失视后belief过短、候选爆炸 | `mat_I1nyxXinVhs2ot1n2/ANALYSIS.md` | 2,371个InformationState根；隐藏敌人禁止strict proof | 量词边界正确，但belief覆盖和风险价值尚未用对局Oracle校准 |
| LEFT/RIGHT病态震荡、长局无位移 | `since-20260714-130500-cst/REPORT.md` | 原生批次转向2,560次，fallback从早期开始 | 有复发信号；应修复策略/计划稳定性与runtime模式，不写“连续N次就GO”的最终动作例外 |
| 低质量远射、撞墙、弹槽浪费 | v18–v26聚合与真实小批次 | FIRE 267次但v2仅24/112胜 | 需按弹道命中窗口、行动机会成本和风险表校准；当前没有预注册命中质量阈值 |
| 技能可用但施法时机差 | 多版技能/对手分析 | Poison施放294次，ForcedWin 0 | 接口工作不等于技能价值正确；应从Skill descriptor进入同一矩阵/风险/Plan评分 |
| 128帧同星终局与runtime tiebreak | 历史`runTime`、`timeout`分类文档 | 8个非击毁失利；外部terminal存在已知差异 | 必须由平台TerminalClassifier和官方simulation验证，不能用本地胜负冻结参数 |

## 4. 待review的结构性修复方案

以下仅是方案，不在本轮实施：

1. 在RuntimeController建立“work unit到实测微秒”的分层校准表，分别计Observation/Hard/Proof/Value/Policy成本；按累计reserve切换normal/fallback/emergency，避免约第5帧后永久emergency。
2. 将Arena runner扩为候选矩阵执行器。每个depth/cache/risk/weight/Arena候选在同一Calibration场景运行，预注册零安全错误、终局质量、正向击杀保留、fallback占比和runtime reserve阈值后再选参数。
3. 在离线诊断层增加死亡链分类，不改Hard语义：区分根上全动作必死、观察缺失导致UNKNOWN、fallback选择、Plan过期、评分偏差和模拟器规则差异。只有可复现的Reference/Fast差分才能改物理层。
4. 炸弹、射击、转向、追星和Poison统一经Evaluation/Plan/Strategy接口调分。修改feature/weight或Plan失效规则，不在root末尾按某局坐标、帧数或对手名硬覆盖动作。
5. cloak/草丛继续使用InformationState与ε-contamination risk；优化belief压缩、共享射线/危险缓存和候选上限，不把“可能开火”升级为Hard必死。
6. 修复后生成新Candidate，而不是原地修改旧Candidate；再一次性运行Frozen 63局。Frozen结果不得回调该Candidate参数。

## 5. Review门

用户review前禁止执行上述核心修复、参数冻结、G10A、官方Candidate simulation或publish。review应先决定：质量阈值、Runtime fallback目标区间、候选矩阵规模，以及projectile/bomb死亡链需要保存的逐帧诊断字段。
