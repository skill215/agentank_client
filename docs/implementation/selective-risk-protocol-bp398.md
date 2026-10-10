# BP398 R101–R110：限制风险优先范围

沿用 BP397 的生产身份、校准器、确定性 V1 时钟、原始 seed、双方 stun、128 帧、四个本地对局 worker、双对照分层门槛。不改生产／旧产物、不提交发布、不使用子 agent。Hard、Risk 准入、finalGate、路径系数不变。

## 冻结的十轮

BP397 的全局风险支配优先降低部分单死，却把到时星数落后负局从24/20推到61/57。strictlyDominates 除死亡质量外还含危险时间、逃生余量及已形成威胁的后继逃生指标。本批仍要求原 strictlyDominates 成立，但增加以下单一适用条件；未命中时完整沿用父候选比较。

| 轮次 | 额外条件 | 父候选 |
|---|---|---|
| R101 / R102 | 支配方 immediateFatalMass 严格更小 | R15 / R29 |
| R103 / R104 | 支配方 committedChanceFatalMass 严格更小 | R15 / R29 |
| R105 / R106 | 支配方 horizonFatalMass 严格更小 | R15 / R29 |
| R107 / R108 | immediate / committedChance / horizon / unknown 中至少一个质量严格更小 | R15 / R29 |
| R109 / R110 | 当前根自身星数严格领先 | R15 / R29 |

无最佳行时保持原初始化。只在已准入的动作行间比较，不将被阻止的动作加入候选。质量字段是内部模型量，不称已校准死亡概率；条件不读取地图 ID、种子、未来终局或离线最优动作。

## 附加机制复查及身份

在十轮候选之前重放 BP397 next-investigation.json 全部54个事件，使用原 R91／R92 全局风险排序，要求整局动作、参数、分析终局、搜索量与 BP397 一致。记录第一次父候选／全局排序动作分歧帧的比较顺序、两侧分数、死亡质量、危险时间、逃生字段与星数。只作观察性机制证据，不称单步因果试验，不据其结果临时改变本批十轮规则。

生产、R15、R29 各128局预检也需与原归档等价。预检与54局审计不占十轮名额，独立记实际成本。代码、协议、测试、54个事件及 BP397 输入哈希在执行前冻结。

## 样本及门槛

严格沿用 BP397/BP396 的64地图开发128局、128地图验证256局；地形隔离并排除 BP394 的192张证据地图。历史总体结果已见过，不叫全新盲测。

每轮开发须同时相对生产与父候选净局分至少+2，单死、换位双负均不增加，节点比≤2，mechanismChanges>0。失败即停；通过后验证两个对照均须正收益且非退化，然后全量2486局同门槛，可复用本轮相同 job 的开发／验证行。全量通过仅为 QUALIFIED_DIAGNOSTIC_PENDING_PORTABILITY_AND_MULTISEED，不自动采用生产。

无触发／无变化也如实结案；运行错误不能算完成轮次。源码与输入 SHA256、逐行检查点身份／哈希、双方 error/timeout、rootRestoreFailures、hotAllocations 必须通过。逐个搜索根核对 proposal 属于原 allowedRow 且 Hard=0，实际选择仍满足 finalGate。

使用 Node v24.16.0 循环执行 selective-risk-campaign.js <新目录> 到 rounds.json，再运行 selective-risk-report.js <目录> 独立重建统计和晋级门，保存源码、日志、报告、完整性清单。
