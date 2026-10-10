# 攻击、资源与长期 Option 所有权因果研究

状态：`ROOT_COMBAT_UTILITY_CONFIRMED / SINGLE_FRAME_OWNER_REFUTED / OPTION_POLICY_SEARCH_REQUIRED`。
Production 默认语义未修改，独立 Holdout 未读取，也未执行官方平台写操作。

## 结论

V2 当前问题不是“不能生成 FIRE”，也不能靠提高 FIRE 数量解决。固定32场景、每实现64局中，
V2有5,926个FIRE候选，5,856个通过Hard；真正缺少的是跨目标机会成本。短期攻击姿态接管让得分
从16.41%降至12.50%，而完全移除炸弹和poison虽然让FIRE增加32次，却把得分降至3.13%。

因此下一层决策对象必须是事件边界的长期 Option：攻击、资源、星和终局分别保留目标身份、
deadline与响应集合。Minimax继续负责Option内部的战术响应，不能把短期局面值冒充跨Option终局值。

## 精确响应条件Policy：Discovery恢复、Holdout拒绝

新增的`ResponseConditionedOptionPolicyShadow`先在99个稳定冲突root枚举敌方第一响应，再让ATTACK和
STAR分别执行状态条件策略。72个root完整、24个因possible projectile跳过、3个rollout不完整；
共467个敌方世界、3,798次Fast transition。risk=0时63个STAR支配、9个tradeoff；risk≥25时
45个STAR支配、27个tradeoff；ATTACK严格支配始终为0。这说明风险偏好确实改变Option tradeoff，
但稳定冲突root不能替代真正造成终局翻转的提案root。

随后评估器直接接到`RiskConditionedCombatProposal`的`selectedRow/proposalRow`。9个已知翻转场景中：

- 3个正向样本里，2个在同root得到安全战斗tradeoff；另1个在下一帧才出现合格tradeoff；
- 6个负向样本里，4个由STAR支配、1个possible projectile不完整、1个同时恶化terminal和敌方击毁；
- 窄资格门在这9场只覆盖3次，得到3个`LOSS→WIN`、0个反向转换，47.22%→63.89%。

固定32场景继续得到16.41%→21.09%：9次覆盖、3个`LOSS→WIN`、0个反向转换，自撞19→17、
敌方撞毁8→10。由于门的定义使用了其中9场，这只能作为Discovery结果。

首次读取冻结64场景Holdout后，结论反转：

| 实现 | W/L/D | 得分 | 星 | 自撞 | 敌方撞毁 | FIRE |
|---|---:|---:|---:|---:|---:|---:|
| CURRENT | 12/108/8 | 12.50% | 27 | 43 | 9 | 625 |
| response-policy owner | 12/110/6 | 11.72% | 28 | 39 | 9 | 647 |

25次覆盖只有3局改变：1个`DRAW→WIN`、1个`DRAW→LOSS`、1个`WIN→LOSS`。因此“局部安全且有某个
战斗维改善”仍不是跨Option所有权证书。两个退化root都在我方星数领先时牺牲了星路径进度；唯一正向
Holdout root同时改善了星路径。这给出新的架构边界：战略比分状态先决定允许哪类机会成本，Risk再决定
战术风险；领先时的软攻击不能消费已验证的星路径优势。该观察来自已读Holdout，不允许在相同集合重调，
必须另建未见历史集合验证。当前ACTIVE owner拒绝，精确多响应代码只保留为稀疏证据服务。

## 风险条件战斗效用与单帧Active反例

`CombatUtilityEnvelopeShadow`不把攻击压成一个分数，而是分别保留击毁、pressure、机动压缩、
endpoint reduction、反击延迟、自逃、资源与星路径机会成本；敌方动作按OpponentModel名义概率和
递归ε-contamination备份，risk=100仍保留1%最坏情况。固定32场景99个事件根得到：

- risk=65有33个风险/安全合格攻击，29个攻击deadline不晚于星deadline；
- 90个攻击deadline更早，但97个延误缓存星路径；
- 53个由当前动作支配，46个是多维tradeoff，攻击严格支配为0；
- OpponentModel只改变2个根的名义死亡质量，说明本批主要缺口不是概率校准。

随后只让上述合格FIRE在四帧名义生存且不立即少拿星时替代STAR。30次覆盖令FIRE增加54次，得分却
从16.41%降至12.50%：3个`LOSS→WIN`对5个`WIN→LOSS`，另有1个`DRAW→LOSS`。这直接否定
“命中deadline早于星deadline即可开火”。

新增的`AttackStarPolicyFrontierShadow`复用同一批2,446个既有Fast transition，不增加一次状态转移。
它按生存、星获得/路径、机动、资源和战斗进展逐维比较四帧ATTACK与STAR延续，得到41个STAR支配、
47个tradeoff、0个ATTACK支配；严格Pareto若用于owner会把已知3个正向转换也全部删除，因此它只能
删真正被支配Option，不能替代战略风险偏好。

最后仅重放9个终局翻转场景，保存13个实际提案根。13次全部为`GO→FIRE`，FIRE的`robustLower`
全部低于GO约600–860；四帧后没有一次新增持续弹丸威胁或稳定射线。高pressure主要出现在若干反向
样本，正反样本在星距离、endpoint reduction和frame上重叠。这证明PAC pressure描述的是当前敌方
响应压缩，不是攻击Option的持久进展，不能再通过调一个阈值取得动作所有权。

下一实现必须搜索两个多帧策略对象，而不是两个首动作：ATTACK policy允许`FIRE→追击/封路/自逃`，
STAR policy允许沿generation-bound路径推进并在安全时机会开火；两者在观察或目标事件后才允许分支。
Hard和committed closure逐节点执行，EnemyAction由OpponentModel+ε污染备份，Incomplete保持UNKNOWN。

## 攻击漏斗

6,974个决策根中：

- FIRE候选5,926个，Hard只拒绝70个；
- Risk可接受4,630个，Risk/Pareto前沿4,091个；
- purpose完整660个，PAC完整626个，有敌方响应压缩396个；
- qualified attack evidence 293个，当前已选择其中164个；
- strict kill certificate只有2个。

最大断点是3,593个缺少明确攻击purpose，而不是Hard或弹丸生成。把Soft verified attack限制为
无committed EscapeObligation后，只剩4次覆盖；没有负向转换，但整局W/L/D也没有提升，故只保留
为证据服务。

## 攻击姿态场反例

诊断场使用固定TypedArray反向BFS计算`cell × direction`到有利射击姿态的最短步数。修复后的缓存键
包含敌方格、地图拓扑、敌方朝向、规范化开火锁延迟、行动相位、双方星数和双方盾值；热路径分配
为0，最大访问832个pose。

Shadow得到82个与当前动作不同、且Risk/robust不退化的根。Active轨迹中发生106次覆盖：

| 实现 | W/L/D | 得分 | 星 | 自撞 | FIRE | BOMB | skill |
|---|---:|---:|---:|---:|---:|---:|---:|
| CURRENT | 9/52/3 | 16.41% | 19 | 19 | 327 | 82 | 251 |
| attack-pose owner | 6/54/4 | 12.50% | 17 | 20 | 334 | 97 | 259 |

增加开火没有抵消长期损失。逐局有7个改善、9个退化，净值为−5个半胜负单位。

## 精确前缀反事实

对全部32个Discovery场景做精确前缀重放，当前动作的终局复现误差为0。68个提案根、136个分支中：

- 7个改善、15个退化、46个终局不变，净值−13；
- 59个提案只是`TURN_LEFT → TURN_RIGHT`；
- 1/4/8帧的星数和死亡状态差异均为0；
- 16帧只有10个根出现可见差异，但终局已有22个根改变。

这说明短Minimax、局部Risk和攻击距离场在真正价值出现前就必须做选择。继续添加射线、距离或固定
FIRE bonus只能改变对称性打破方式，不能提供缺失的终局信息。

## 资源动作反例

全关炸弹和poison得到：

| 实现 | W/L/D | 得分 | 星 | 自撞 | FIRE |
|---|---:|---:|---:|---:|---:|
| CURRENT | 9/52/3 | 16.41% | 19 | 19 | 327 |
| no-resource | 1/61/2 | 3.13% | 10 | 24 | 359 |

Typed Option影子审计又表明333个已执行资源动作中，267个具有当前定义下的完整目的，66个未验证。
所以资源不是应被全局删除的噪音；它与攻击、星控制一样，是必须计算机会成本的长期Option。

## 事件边界 Option 审计

行为中性的 `EventDrivenOptionShadow` 在同一批6,974个决策上把外部事件和局部选择抖动拆开：

- 1,918帧发生星目标、星数、可见性、接触模式、资源、committed危险或终局/effect事件；
- 5,056帧没有上述事件，其中1,107次仍切换Option类别，即21.89%；
- 2,202次总切换中，1,137个Option run只持续一帧，331个只持续两帧；
- 749次动作没有完整长期Option，905次所选目的不完整；
- 当前Plan signature在6,910个跨帧边界中变化6,891次；无事件的5,056帧中变化5,042次。

最后一项不是偶然噪声：FIRE、BOMB和aim-setup的signature都混入当前frame，普通导航又混入第一动作和
successor pose。它们无法作为跨帧目标身份，因此PersistentPlan即使保存下来也无法表达“仍在追同一攻击目标”。

Risk可进入的攻击根有4,096个，但目的和支持完整的只有574个；其中219次当前没有选攻击，191次
（87.2%）由STAR_CONTROL取得所有权。这给出了一个非常窄的Active反事实，但也暴露了下一层限制。

## 合格攻击优先于星的反例

Active POC只在normal mode、无committed EO、无Proof/exact value所有权时，把已选完整STAR替换成
Hard允许、Risk/Pareto前沿、purpose完整且自逃完整的FIRE。固定16场景的前半样本一度从7.81%升到
10.94%，但完整32场景结果反转：

| 实现 | W/L/D | 得分 | 星 | 自撞 | 敌方撞毁 | FIRE |
|---|---:|---:|---:|---:|---:|---:|
| CURRENT | 9/52/3 | 16.41% | 19 | 19 | 8 | 327 |
| qualified attack > star | 4/57/3 | 8.59% | 13 | 20 | 5 | 422 |

73次覆盖全部发射FIRE，最终FIRE净增95；但只得到2个`LOSS→WIN`和1个`LOSS→DRAW`，同时产生
7个`WIN→LOSS`和1个`DRAW→LOSS`。后16场景从25.00%跌至6.25%，说明前16场景的+3.13pp
是抽样偶然，不具备可推广性。

关键结论是：单动作证书只能证明“这一枪当前安全且压缩某些敌方响应”，不能证明“这一枪比继续星/位置
Option更接近最终击毁”。在后16场景中，基线7次击毁对手，Active只剩2次；提前开火破坏了之后的
位置、节奏和连续攻击链。这个POC已拒绝，不能通过收紧一个固定分数继续修补。

## 稳定 Option 身份与事件化 interval

新增的 `StableOptionLedgerShadow` 不再使用 primitive、pose、当前帧或 Plan signature 作为身份，而以
`Option kind + semantic target generation` 建立24槽固定账本。固定32场景仍为9/52/3，64组换位对的
动作流、参数、帧数、终局与资源计数逐项一致。6,974次决策只创建906个Option并复用7,531次；
5,532次可追踪选择中，5,021次（90.76%）沿用已有generation。

稳定身份没有掩盖动作变化：同一generation内部primitive变化1,480次，Plan signature变化3,683次。
原Plan总共变化6,891次，证明现有frame/action绑定签名描述的是“这一帧怎么做”，不是“跨帧追求什么”。
账本最大同时活跃6个、可用3个，容量失败和热路径分配均为0。

在账本之上，`StableOptionIntervalShadow` 只在外部事件、冲突首次出现或ATTACK/当前Option generation
改变时评估；稳定冲突跳过。99个四帧评估只需要2,446个transition，0次root restore失败。结果是：

- 平衡目标下ATTACK优于当前STAR/POSITION只有38次，劣于当前动作61次；
- combat-first排序会选ATTACK 42次，但这不是终局证书；
- 现有Risk band中，`attackLower > incumbentUpper`为0，当前动作严格占优36次，其余63次重叠；
- 99个ATTACK名义路径都没有新增自毁，但只有1次多击毁敌人，并有5次丢失星进度；
- 7次双方名义路径都到达终局，仍保持严格全区间，因为敌方后续不是universal/common-policy证明；
- strict ownership始终为0。

因此“Hard/Risk允许 + purpose完整 + 开火后能逃 + 压缩一个敌方响应”只够形成合法第一步，不能形成
完整攻击Option。下一阶段必须验证同一稳定generation上的continuation progress、敌方共同策略响应和
终止/失效条件；在此之前不能再做`attack > star`动作覆盖。

## 攻击 continuation progress 证据

新增行为中性的 `AttackContinuationProgressShadow`，直接复用上述99次四帧rollout，不重复执行
Fast transition。证据按层分开：首步完整、敌方响应压缩、自身存活、可逆姿态改善、持久进展、
不可逆进展和Risk区间开放。固定32场景的结果为：

- 99/99首步完整，52次压缩敌方响应，97次名义存活完整；
- 42次姿态改善中40次只是可逆姿态，没有留下弹丸约束、debuff或击毁；
- 只有2次持久进展、1次不可逆进展，且两局最终都是V2失败；
- 36个ATTACK generation中有63次同generation复验，44次维持、8次增强、11次退化；
- 没有任何generation连续两次保持持久进展，最大连续值为1；
- 只有2个软challenger、1个strong witness，不足以形成Active所有权；
- 64组CURRENT/Shadow动作流完全相同，root restore与热路径分配均为0。

这否定了“把现有合格FIRE再收紧一点即可”的路线。现有候选生成器主要产生合法第一步，而不是带
后续动作、deadline和终止条件的攻击序列。下一步必须显式生成小规模、共享前缀的攻击continuation，
再由共同敌方响应验证其进展；不能激活这2个稀疏样本，也不能放宽证书来增加分母。

## 固定两步序列反例

复用已有 `TwoStageAttackSetupShadow` 后先发现一个接口缺陷：当前 `OptionPortfolio` 的99个
`ATTACK_SETUP`别名全部仍指向FIRE，没有任何GO/TURN攻击setup。因此新的事件触发generator不信任
旧标签，而扫描Hard/Risk前沿的真实移动行；99个事件根共产生296个候选（GO 99、TURN_LEFT 99、
TURN_RIGHT 98）。

严格的共同策略`setup → FIRE`证书为0：274个明确拒绝、22个支持不完整。原因可以重叠：262个在
第二步后仍有未约束敌方响应，268个下一步FIRE没有命中进展，22个PAC支持不完整，3个首步已经终局。
每个候选最多只需一个节点就能被反驳，总计296节点，root restore和热分配均为0。

这证明缺口不只是“没有把移动标成攻击”，而是一次setup根本不足。因此下一实验对象升级为2–4帧
观察条件策略，但它仍然先作为严格证书服务验证，不能预设普通攻击一定能满足全称量词。

## 自适应严格攻击策略反例

新增固定栈 `AttackPolicyReachabilitySearch`，复用 ForcedWin 的完整敌方动作与Chance枚举，但叶目标
改为移动根因果相关的敌方击毁或真实护盾受击。下一步可以随完整可见的PhysicalState改变；进入草、
cloak、possible projectile或支持不完整一律UNKNOWN。每个successor仍先经过Hard，姿态、possible-hit、
活跃弹丸和普通搜索分数都不能闭合证明。

初版曾得到39个`PROVEN`，但13个根中的GO/左转/右转同时成功，原因是任意移动后施放全局poison/stun
都会改变debuff。这个进展与根移动无因果关系，因此定义被明确判错：debuff只允许由根技能动作本身
闭合，移动型策略只能由击毁/盾击闭合。错误定义的artifact保留为负测试，不进入结论。

因果修正后，原c992固定32场景的99个事件根产生224个移动候选：深度2、3、4均为
`0 PROVEN / 224 DISPROVEN / 0 UNKNOWN`。搜索访问61,974个节点，单候选最多373；0预算停止、
0 restore失败、0热分配。搜索过程中出现10个局部分支击毁叶，但没有任何移动能让所有完整敌方响应
都到达不可逆进展。

同一实现又在独立的已知c96a回归32场景重复：71个事件根、170个候选仍为
`0/170/0`，出现22个局部分支击毁叶，最大节点同为373。两个cohort必须按指纹分别解释；“fixed32”
不是可省略身份的测试名称。

这否定的是“普通ATTACK必须是小型ForcedWin”，不是深度不足。两批都没有预算或支持中断，继续提高
深度只会改变成本，不会修复错误量词。严格reachability仍可作为高优先级稀疏证书，但不能定义普通
攻击Option的效用。

## 敌方响应集反例

为验证局部击毁叶是否代表有价值的行动压缩，第二个Shadow把敌方首动作逐列固定，列内仍执行完整
AND/OR，然后把可严格淘汰的首动作编码成位集。候选与当前动作只有在双方无UNKNOWN且候选位集为
严格超集时才算非tradeoff改善；交叉集合不产生所有权。

原c992固定32结果：99个事件根中24个possible-projectile根跳过，75个完整根验证75个当前动作和
149个替代移动，共1,448个敌方列。只有2列可被严格淘汰，而且都属于当前动作；149个候选移动的
coverage全部为0。相对当前动作得到0严格超集、0交叉tradeoff、129相等、4严格子集。

该诊断需要394,149节点，本地V2总耗时由4.14秒增至8.26秒，约1.998倍；最大单列689节点，
0 budget stop、0 restore和0热分配。因此“逐列严格证明后按覆盖数选攻击”既没有候选信号，也不是
可接受的production热路径。

结论是普通攻击应使用Risk控制的多维战斗效用：命中/封锁deadline、敌方安全后继压缩、行动空间、
自身反击暴露、自逃和资源占用保持分维；Hard、EO、ForcedWin和严格响应淘汰继续作为更高层稀疏证书。
该向量只能在Risk可接受集内经递归epsilon-contamination形成robust/expected包络，不能再次压成全局
FIRE bonus，也不能把soft维度升级为Proof。

## 下一架构

```text
Observation / entity lifecycle
→ Physical Hard / committed rescue / strict Proof
→ event-triggered OptionGenerator
   ATTACK | RESOURCE | STAR_CONTROL | TERMINAL
→ per-Option target generation + context epoch + deadline interval + abort events
→ option-level response support and Risk/nonloss interval
→ tactical Minimax inside qualified Option only
→ opportunity-cost Pareto across Options
→ stable Option continuation
→ per-frame Hard / EO validation
→ ACTION_EMIT
```

关键边界：

1. attack/star距离场只是Option内部progress，不能拥有跨Option动作；
2. resource readiness不是资源Option证据，必须有目标效果、持续期和放弃移动/开火的机会成本；
3. Option在目标、观察、资源、committed hazard或终局事件变化时重算，不逐帧用局部分数抖动；
4. 有限Minimax只反驳或收紧Option内部的响应区间，不选择全局战略；
5. 只有terminal/nonloss interval或严格证书能跨Option硬覆盖；其余保持多维Pareto。
6. 攻击Option必须使用稳定target generation；只有其多帧lower bound严格超过竞争Option upper bound
   才能取得所有权，单帧`purpose + PAC + self escape`只作为Option内部证据。
7. 冲突首次出现和Option generation变化也是内部语义事件；稳定冲突不重复搜索。
8. 名义四帧rollout只提供排序/反例，不能将终局叶升级为InformationState Proof。
9. continuation证书不能从首步PAC分数推导；必须由显式攻击序列在同一target generation上产生。
10. 攻击continuation是观察条件策略，不是固定`setup → FIRE`数组；相同观察组必须共享下一动作。
11. 严格自适应reachability和严格响应集只属于Proof证据；两者为空时不能通过加深搜索制造普通攻击效用。
12. 普通攻击价值保留多维CombatVector，在Risk可接受集后做epsilon-contamination robust backup；
    deadline、响应压缩和反击暴露不得先相加成一个FIRE分数。

机器证据见
`config/engine-v2/attack-strategy-ownership-causal-evidence.json`。

## StrategicStateLedger 与 TargetLifecycle Shadow

为了区分“根本没有长期目标”和“目标存在但Plan错误结束”，新增固定TypedArray观察器，直接消费
`StableOptionLedgerShadow`的语义generation。它不修改候选、Risk、Hard、Plan或最终动作，只记录：

- score band：`TIED / LEADING / TRAILING`；
- phase band：`OPENING / MIDGAME / ENDGAME`；
- target generation的run、事件触发/无事件切换和deadline slack；
- Plan提交、激活、完成、失效是否发生在同一target generation；
- Risk/Pareto中ATTACK与STAR同时可用时，当前选择及星路径机会成本。

固定c992 Discovery 32场景得到64局候选对战，CURRENT与Shadow均为9/52/3，所有行为和硬不变量
零差异。核心账本如下：

| 指标 | 数值 |
|---|---:|
| 决策 | 6,974 |
| 可追踪目标选择 | 6,104（87.53%） |
| target run | 1,987，平均3.07帧，最大30帧 |
| generation切换 | 1,622 |
| 无外部事件切换 | 968（占切换59.68%） |
| Plan提交 / 激活 / 完成 | 6,928 / 473 / 6,749 |
| 同target延续时再次提交 | 4,089 |
| 同callback提交并完成 | 6,380 |
| STAR被选且存在合格ATTACK | 191 |
| ATTACK被选且存在合格STAR | 9 |

比分分布进一步说明这是全局战略问题：4,915帧（70.47%）处于落后，领先仅238帧；落后时仍有
119帧选择STAR而放弃完整ATTACK替代。固定32里没有出现“领先攻击破坏星路”，所以独立Holdout中
观察到的领先保护只能作为后续新盲集假设，不能解释该cohort的主要失败。

这里的结论不是“把191个STAR全部换成FIRE”。该操作已有完整反例：73次FIRE覆盖使得分从16.41%
降至8.59%。真正缺失的接口是：`StrategicTargetState`在事件边界之间持续存在，而每帧执行Plan只是
它的可替换实现；Plan完成不能等价于目标完成。下一POC必须在新盲场景中以完整ATTACK/STAR Option
区间比较取得所有权，primitive action仍由每帧Hard/EO验证。

紧凑机器证据：`config/engine-v2/strategic-state-ledger-evidence.json`；运行artifact：
`artifacts/v2-native-initiative/strategic-state-ledger-shadow-discovery/`。

## StrategicConflictArbiter、执行桥与即时FIRE因果结果

在目标账本之后，新增行为中性的`StrategicConflictArbiterShadow`，只比较真实STAR incumbent与完整
ATTACK替代。deadline改为语义deadline：攻击使用`CombatVector.hitDeadline`，星目标使用当前姿态到星
的到达帧；PlanSketch的逐帧deadline不得参与跨目标比较。固定32场景得到97个真实冲突，其中44个
STAR占优、27个支持不完整、20个tradeoff被拒绝，只有6个score-conditioned ATTACK target提案。

`StrategicTargetExecutionShadow`随后验证这6个目标在动作层是否可表达：每个目标都能在同一根找到
Hard允许、Risk可接受且不被Pareto支配的FIRE，6/6与当前GO不同；没有gap、NONE或热分配。它同时证明
原先的583个“攻击帧”是目标所有权统计泄漏，而不是可执行提案：目标只在首次反事实动作边界前拥有。

最后把同一证据接到`selectFinalAction`之前。固定32 ACTIVE由16.41%升至17.97%（+1.56pp），新冻结
96场景盲Discovery由10.16%升至10.68%（+0.52pp）。盲集192局候选侧只有6次覆盖，产生1个
`LOSS→WIN`、0个`WIN→LOSS`；另有2局延长生存/避免撞毁但结果未变、2局局部退化、1局仅增加攻击。
总FIRE 918→918，说明它改变的是少数开火时机，不是战斗压力的结构恢复。

因此即时FIRE owner保留为`NEUTRAL_POSITIVE`证据服务但默认关闭：结果远低于+3pp准入门，只有一个
不一致结果对，且本地总耗时约+2.73%。封存128场景Holdout未读取。下一实验必须持有跨帧
`ATTACK target generation`，让TURN/GO/FIRE成为同一目标的每帧实现，并在每帧重验Hard、committed
EO、Risk、目标generation和deadline；不得通过放宽FIRE阈值增加样本。

紧凑机器证据：`config/engine-v2/strategic-attack-target-evidence.json`；运行artifact：
`artifacts/v2-native-initiative/strategic-attack-over-star-active-discovery/`与
`artifacts/v2-native-initiative/strategic-attack-over-star-blind-discovery/`。

## 持久目标、所有权反例与Option局部Minimax

持久攻击目标能跨callback保存enemy target generation和deadline；每帧仍先让Hard、committed EO、
RESOURCE与TERMINAL拥有动作。这个优先级不是形式要求：盲集唯一改善局在第85帧FIRE后，第86帧必须
使用POISON；旧续航错误地用TURN_RIGHT覆盖资源动作，直接抹掉该改善。修复资源让步后，第87帧又把
当前GO替换为几何上更接近攻击姿态的TURN_RIGHT，仍然抹掉改善。因此target progress只保留为候选
生成信号，跨帧不同primitive必须有当前根值证书。

新增`OptionScopedTargetContinuationSearch`，根域固定为incumbent与一个攻击目标候选，保留全部敌方
动作列，深度2、预算768；搜索完整且candidate maximin严格大于incumbent才可提案。搜索仅在目标活跃、
候选Hard/Risk允许、HiddenWorld为单一物理世界时触发，possible projectile的不劣关系仍由Risk负责。

固定c992 32场景只有1个补证根：完整、10节点、0严格支配。盲96场景有5个补证请求，3个处于fallback
而跳过，另外2个全部完整，总38节点、最大29，仍为0严格支配；最后完整比较为当前22350、攻击3800。
Shadow与基线结果、动作、星、crash、FIRE完全相同，Hard/Risk/restore/timeout/热分配均为0。

这一步排除了“只要给续航多跑一点Minimax就能恢复攻击”的假设：计算量极小，但值证据明确反对该
续航。后续不进入ACTIVE、不加深、不读取Holdout。现有276个事件评估中，65个真正的支持缺口由42个
possible-projectile和23个rollout incomplete组成；其余181个Combat阻断是完整评估未发现durable
combat收益。下一实验只扩展前65个Information响应支持，不降低Combat门。

## Singleton possible-projectile响应覆盖

新的响应闭包只处理一个完整、敌方所有的possible projectile。为了遵守InformationState的共同策略
量词，它不会让缺弹/有弹两个不可区分世界各自挑我方续行动作：先在缺弹世界生成固定四帧序列，再在
有弹世界逐动作重放；敌方续行仍可依照其物理状态变化。两个世界的11维结果逐维取最小值，再进行既有
enemy-action epsilon-contamination。poison cadence mismatch只在可撤销世界里重建，multi-track不合并。

固定c992 32场景的19个possible根为12个单弹、6个双弹、1个三弹。单弹闭合10/12，response
incomplete从24降至14；存在世界没有降低任何结果维度，ACTIVE和原即时FIRE owner同为10/51/3、
17.97%，全部动作指标零差异。开放96场景中单弹闭合32/35，3个需要poison节拍重建；存在世界共
保守降低19个维度，完整提案7增至13，但Shadow动作保持零差异。所有运行均为0 restore、0热分配、
0硬不变量失败。

这说明possible-projectile确实造成了事实覆盖缺口，但闭合后没有为固定集增加一个可执行动作，不能
解释V2整体攻击不足。实现保留为默认关闭的严格支持层，不进入Holdout；8个多弹根继续UNKNOWN。
下一步优先给剩余22个普通rollout-incomplete根增加失败原因账本，而不是立刻做2^n多弹世界或继续
降低Combat资格门。

紧凑artifact：
`artifacts/v2-native-initiative/strategic-attack-possible-response-fixed32-shadow/`、
`artifacts/v2-native-initiative/strategic-attack-possible-response-blind96-shadow/`和
`artifacts/v2-native-initiative/strategic-attack-possible-response-fixed32-active/`。

## Rollout incomplete原因普查

四帧Option比较现已为每个失败记录固定数组账本：原因、phase、Option、步数、敌方根动作、失败当步
双方动作以及FastKernel返回点。调用点分类只在异常路径捕获栈，并单独计数；production kernel、
上传bundle和正常热路径没有变化。

固定32场景有7个不完整根、24次失败；开放96 Discovery有25个不完整根、67次失败。两批结果完全
同源：100%为`APPLY_UNSUPPORTED_RULE → FastKernel.move → GO/GO`。开放集按phase为
`PHYSICAL=60 / POSSIBLE_ABSENCE=6 / POSSIBLE_PRESENCE=1`，按Option为`STAR=55 / ATTACK=12`，
按步数为`step1=1 / step2=42 / step3=24`。Hard incomplete、容量、执行错误和root restore均为0。
Shadow的动作、胜负、星、crash、FIRE和资源使用仍全部零差异。

这也解释了旧的敌方根动作边缘分布为何看似包含`NONE/FIRE/BOMB`：失败发生在第2–4步，此时敌方
状态条件策略已经转成GO；直接记录失败当步后，固定32的24/24和开放96的67/67都是`GO/GO`。

平台官方replay目前只闭合了静态占位阻挡；双方GO的同目标、swap和进入将腾空格仍没有官方真值。
因此不得跳过失败列，也不得直接采信外部模拟器的intent-block候选。下一POC应把
`SEQUENTIAL_BLOCK / INTENT_BLOCK / COLLISION_CRASH`作为有限InformationState RuleVariant，三个世界
执行同一我方策略并逐维取最坏；只有变体不变的关系才能补充普通响应证据，仍不能直接升级成Hard或
Proof。

机器证据：`config/engine-v2/strategic-attack-target-evidence.json`；紧凑artifact：
`artifacts/v2-native-initiative/strategic-attack-rollout-pair-fixed32-shadow/`和
`artifacts/v2-native-initiative/strategic-attack-rollout-pair-blind96-shadow/`。

## GO/GO有限规则变体包络

在不声称知道平台真实GO/GO规则的前提下，新增三个诊断世界：seat0先执行的
`SEQUENTIAL_BLOCK`、初始intent批次阻挡的`INTENT_BLOCK`以及冲突双方撞毁的
`COLLISION_CRASH`。Production FastKernel继续fail-closed。每个失败根先在sequential世界生成
ATTACK与STAR各自的四帧己方动作序列，再把同一序列逐动作重放到另外两个世界；敌方仍可按每个物理
世界的状态续行。11维结果逐维取三世界最小值后，才进入既有enemy-action概率与
epsilon-contamination备份。任何变体不完整时，父评估仍保持incomplete。

固定32场景的7个GO/GO根全部在三世界完成，公开96 Discovery的25个根也全部完成；三个变体分别为
`7/7/7`和`25/25/25`，root restore均为0。固定集有3个根关系一致、4个分歧；公开集为21个一致、
4个分歧，说明直接挑选某一种规则会改变判断，不能作为平台事实。逐维最坏值共收紧283和1,024个
维度。

更重要的是，risk=65下固定集包络为`STAR=3 / TRADEOFF=4 / ATTACK=0`，公开集为
`STAR=7 / TRADEOFF=18 / ATTACK=0`。Shadow动作、胜负、星、crash、FIRE和资源全部零差异，Hard、
Risk domination、restore及timeout也全部为0。因此这一步分类为“事实支持正向、动作所有权负向”：
它证明GO/GO规则不确定性可以被有限InformationState保守闭合，却不能解释V2攻击不足，也不能进入
ACTIVE或读取封存Holdout。

下一步不再扩充移动规则、不跳过未知列，也不降低Combat门。应直接分解已经完整的响应根为何落入
durable-combat block：逐维区分“攻击确实没有产生持续战斗收益”和“现有四帧价值维度没有表达目标
收益”，再决定修正CombatVector、时间跨度还是攻击Option生成。

紧凑artifact：
`artifacts/v2-native-initiative/strategic-attack-move-variant-envelope-fixed32-shadow/`和
`artifacts/v2-native-initiative/strategic-attack-move-variant-envelope-blind96-shadow/`。

## Durable Combat端点、时序值与开火转化漏斗

完整响应根中的`durable combat`阻断先按六个端点维度拆开。固定32场景有67个阻断根，其中51个没有
任何正向端点维度；开放96 Discovery有202个阻断根，115个没有正向端点维度。两批的这些根全部仍有
`possible hit / aim / endpoint reduction`等物理攻击提示，所以继续追查“四帧终点丢失了中途收益”。

Rollout新增五个只读时序slab：弹丸威胁帧数、敌方最小机动、敌方机动积分、我方射线帧数和敌方射线
帧数。它们在每次成功transition后累计，并按相同enemy-action、possible-world及RuleVariant量词进行
逐维robust backup。结果并不支持端点丢失假设：固定集只恢复1/51，公开集只恢复4/115；公开集202个
阻断根仍为`ATTACK=0 / STAR=110 / TRADEOFF=91 / EQUAL=1`。STAR policy自身会在后续机会开火，理性
对手也会避开弱弹道；root上的`possible hit`不能等同于持续战斗收益。

随后直接从本地模拟事件流建立弹丸转化漏斗。只有同一帧严格出现
`bullet go → tank crashed → same bullet crashed`才归因击毁；每颗弹独立记录创建、地形命中、最终存活、
寿命以及发射后四帧内owner是否撞毁。该归因只用于同一模拟器内V1/V2比较，不声称是平台规则证明；
盾牌的第一次吸收在replay不可见，只有最终shield expiry可识别。

| Discovery | V2弹丸 | V2击毁 | V2转化 | V1弹丸 | V1击毁 | V1转化 | V2/V1转化 | 开火后4帧自毁率 V2/V1 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 固定32 / 64局 | 327 | 7 | 2.14% | 354 | 15 | 4.24% | 50.5% | 3.98% / 0.56% |
| 开放96 / 192局 | 918 | 14 | 1.53% | 932 | 65 | 6.97% | 21.9% | 2.61% / 0.32% |

开放集里V2和V1的开火量只差14颗，已经排除“V2主要因为不开火而输”。真正差异是同等开火量下，V2
击毁转化仅为V1的约21.9%，而发射后四帧内owner撞毁率约为V1的8.1倍；V2总crash为71，V1仅15。
V2弹丸平均寿命还更长（4.172帧对3.389帧），说明问题也不是弹丸过早自然消失，而是射击时机、射线
质量、敌方可逃分支和发射后的自逃组合错误。

因此下一阶段不增加FIRE、不放宽Combat或Risk门、不读取Holdout。应做行为中性的
`SHOT_QUALITY_COUNTEREXPOSURE_CAUSAL_CENSUS`：对每次真实FIRE分别记录命中deadline、敌方可逃首动作、
弹道有效跨度、发射后我方ReverseViability/slack、敌方反击射线与最终转化，先区分“弱射击”和“好射击
但未续写逃生”两个缺陷，再建立可验证攻击提案。

紧凑artifact：
`artifacts/v2-native-initiative/temporal-combat-value-census-fixed32-shadow/`、
`artifacts/v2-native-initiative/temporal-combat-value-census-blind96-shadow/`、
`artifacts/v2-native-initiative/projectile-funnel-census-fixed32/`和
`artifacts/v2-native-initiative/projectile-funnel-census-blind96/`。

## 射击几何与反击暴露因果普查

为避免把“开火后很快撞毁”全部误判为敌方反击，第二代普查把FIRE命令、真实弹丸和后续事件严格
关联：同帧生成优先；毒技能导致的延迟允许绑定两帧内最新未匹配FIRE；overload每个member独立记录；
只有owner弹丸发射后四帧内，敌方弹丸按严格事件链击毁owner，才计入`counterKilled`。固定32与开放96
Discovery均为0未配对弹丸，诊断热路径使用固定TypedArray，分配为0。

| 开放96 / 192局 | V2 | V1 |
|---|---:|---:|
| FIRE / 弹丸 | 918 | 932 |
| 击毁 | 14 | 65 |
| 清晰直射 | 42（4.6%） | 372（39.9%） |
| 清晰直射击毁 | 2 | 63 |
| 离轴射击 | 675 | 539 |
| 0–2格射击 / 击毁 | 89 / 1 | 164 / 43 |
| 开火后4帧崩溃 | 24 | 3 |
| 其中敌弹精确击毁 | 21 | 3 |

V2内部攻击信号进一步解释了浪费位置。596次`possible-hit`仅转化10次击毁；224次
`NO_COMBAT_SIGNAL`为0击毁，却造成11次四帧内崩溃和10次精确敌弹击毁。PAC给出的敌方第一动作仍有
两个以上存活分支的射击有664次，真正压缩到单分支只有28次、零分支只有1次。因此当前possible-hit
主要描述“弹道可能碰到”，没有描述“敌方合理响应后仍受压”。

更严重的是射后安全信号在结构上失真。现有`postFireEscape`把901/918次判成两条以上逃路，但其中
包含20/21次精确反击击毁；静态`ownCounterExposure=0`覆盖821次，也包含16/21次。V2射后第一动作
GO、TURN、再次FIRE分别有7、8、2次被敌弹击毁；V1的GO和TURN合计764次则为0。可见单帧“邻接位置
可走”或“当前没有反击射线”不能证明开火后安全，必须验证观察一致的多帧共同策略。

这把缺陷拆成两个互相配合、但不能再压回一个FIRE分数的模块：

1. `AimSetupClosure`负责产生转向、占位和接近提案。只有其可验证射线deadline、敌方存活分支或直击
   质量严格改善时，才能替换零信号FIRE；possible-hit只保留为软证据。
2. `PostFireContinuationClosure`从FIRE后的物理状态展开完整敌方第一响应，并要求每个同观察组使用同一
   我方续写。它输出动态可活度、最早反击帧和共同策略，不再复用静态邻接escape计数。

两者先以Shadow方式组合：已有合格射击保持不变，零信号射击不得直接拥有动作；支持不完整时回退
当前行为。下一阶段只验证射线改善覆盖率、预测反击与实际反击的校准、热路径成本和动作反事实，不读
Holdout，也不加入全局FIRE bonus或降低Risk门。

新紧凑artifact：
`artifacts/v2-native-initiative/shot-quality-counterexposure-fixed32-v2/`与
`artifacts/v2-native-initiative/shot-quality-counterexposure-blind96-v2/`。
