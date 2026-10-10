# BP149–BP151：生产严格攻击证明、所有权反证与剪枝成本

日期：2026-09-01。

## 结论

BP149把三规则世界的`SAFE_THREAT_FIRE`证明压缩为共享arena与64项TT。100个真实调度根仍为
100/100分类一致，总节点981、均值9、P95 21、最大27；共享arena拥有24,890字节TypedArray，
预算、TT容量、restore、支持和热分配失败均为0。

BP150将同一证明移入production源码树。100根与冻结诊断oracle的status、support、逐世界节点和总结果
全部一致，最大拥有内存24,869字节。默认ProductionRoot不构造arena；显式Shadow使用独立work ledger，
不能改变fallback或动作。固定16的CURRENT/Shadow 32个配对中，动作流、参数、结果和终局类别差异均为0。

全局`informationComplete`对这个证书过严。固定16的273个清晰射线root中，264个最初被信息缺口挡住：
257个只有possible-projectile位，7个同时有bomb-track位。完整tracker显示188个候选数为0、73个为1、
2个为2、1个为3。沿用BP15合同后，只有`gap==POSSIBLE_ENEMY_PROJECTILE && tracker.complete &&
count==0`恢复Physical支持；真实possible world仍保持InformationState。

证明器还修复了一个合同bug：根FIRE必须有Hard允许的真实动作行，并且Fast transition必须产生
`PROJECTILE_CREATED`事件；根FIRE no-op不再允许递归到未来FIRE后返回PROVEN。固定64中290个无合法FIRE
的root被直接挡住，false certificate不再进入动作层。

## ACTIVE因果反证

固定64、双方换位共128个arm/实现。Shadow有62个PROVEN，其中48个原动作不是FIRE；62个全部是
`threat-only`，`doomedProven=0`。旧safe-threat ACTIVE实际覆盖40次：

- W/L/D：`11/113/4 → 10/113/5`；
- 得分：`10.16% → 9.77%`，下降0.39个百分点；
- 转换：3个`V2_WIN→V1_WIN`、2个`V1_WIN→V2_WIN`、1个`V1_WIN→DRAW`；
- FIRE：653→675；击毁：8→7；我方crash：42→41；
- Hard、Risk支配、restore、timeout/error均为0。

所以“安全且迫使敌人响应”不是最终动作所有权证书。敌人仍可存活时，FIRE的机会成本必须由战略与
Minimax比较；不能因为证明完成就覆盖当前动作。`doomed-only`拥有严格语义，但固定64证书数为0，
不运行无意义的ACTIVE arena。

## 剪枝成本反证

将threat证书降级为敌方响应剪枝也不经济。62个证书均有完整PAC关系，但只有22个root同时含
`PROVEN_DOOMED`和`SURVIVES`列；总共只能删25个root transition。得到证书自身需要18,279个proof node，
成本约为可省根节点的731倍，尚未计入possible-projectile双世界扩展。因此BP151拒绝把该证明常驻接入
Minimax剪枝，也不继续扩展73个singleton possible world。

保留内容只有：生产树中的默认关闭证明核、root FIRE真实性UT、Shadow诊断与离线证据。safe-threat
ACTIVE、doomed ACTIVE和PAC剪枝均保持默认关闭。下一阶段回到全局动作质量，先测搜索实际参与率、
搜索对当前动作的因果翻转，以及叶评价/动作代表的系统偏差。

## 证据

- `artifacts/v2-native-initiative/bp149-semantic-attack-preallocated-proof-arena`；
- `artifacts/v2-native-initiative/bp150-semantic-attack-production-proof-differential-v3`；
- `artifacts/v2-native-initiative/bp150-semantic-attack-strict-fire-active-discovery64`；
- `artifacts/v2-native-initiative/bp151-semantic-attack-pac-pruning-census-discovery64`；
- `artifacts/v2-native-initiative/bp151-semantic-attack-default-shadow-identity-fixed16`；
- 机器证据：`config/engine-v3/base-policy-kernel-bp149-bp151-production-proof-evidence.json`。

当前ProductionRoot SHA-256为
`a2ad1572f6e8831b486da4106c21396d896d277e4fa22632d4468f3b6eada58b`。源码发生了默认关闭的诊断接线，
但固定16默认动作指纹零差异；这不是production默认行为批准。
