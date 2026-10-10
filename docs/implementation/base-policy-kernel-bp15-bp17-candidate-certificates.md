# BasePolicyKernel BP15–BP17：候选级证书与Discovery64

## 结论

候选级证书解决了“整根exact过强”的结构问题，但没有改善整局结果。Discovery64、双方换位共128个
候选对局中：

- 严格ForcedWin证明5个不同于真实V3动作的候选；
- V1-shaped有限策略域内，候选与V3 incumbent同时exact且逐响应严格支配2个；
- ForcedWin ACTIVE改变5局，policy-exact ACTIVE改变2局；
- 7个变化全部发生在frame 125–127，且全部为`V2_WIN→V2_WIN`；
- 三种模式均为69胜、53负、6平，得分56.25%，击毁和死亡数完全相同。

所以这两个证书可以作为正确的终局保险/诊断证据，但不应作为当前提升中盘操作质量的默认owner。
production默认保持关闭。

## 信息支持修复

最初固定16扫描把1,633个候选全部挡在`informationComplete=0`。BP15没有删除这个安全门，而是给
ObservationAdapter增加原因位。结果显示其中1,371个根唯一缺口是“可能敌弹字段存在”，而完整
PossibleProjectileTracker已经严格反证当前可能弹丸数为0；这些根可以恢复为Physical支持。仍有262个
根含真实possible projectile world，继续保持InformationState，不能启动Physical Proof。

修复实际incumbent接线后，固定16有396个候选进入ForcedWin，但`PROVEN=0`。这也修复了旧诊断中
“相对V2 production动作证明，最终却与V3动作相同”的虚假override计数。

## 候选级两种证书

ForcedWin使用现有`ProductionForcedWinSearch`，单候选、完整敌方动作和chance量词，深度4、预算512；
`UNKNOWN/DISPROVEN`永不拥有动作。Discovery64共检查1,407个候选：5个PROVEN、1,379个DISPROVEN、
23个UNKNOWN，restore failure为0。

policy-exact逐动作记录预算/Fast/Hard/depth等阻塞。19,825个搜索行中153行exact；只有2对候选和真实
V3动作同时exact并逐敌方响应严格支配。该证书只表示明确V1-shaped有限策略Bellman对象内的精确
支配，不冒充Physical Hard或全游戏ForcedWin。

## ACTIVE因果结果

| 模式 | W/L/D | 得分 | 动作变化局 | 转换 | FIRE | 星差 |
|---|---:|---:|---:|---:|---:|---:|
| Shadow | 69/53/6 | 56.25% | 0 | — | 667 | +40 |
| ForcedWin ACTIVE | 69/53/6 | 56.25% | 5 | 5×胜→胜 | 666 | +41 |
| policy-exact ACTIVE | 69/53/6 | 56.25% | 2 | 2×胜→胜 | 668 | +40 |

ForcedWin的首次分歧帧为125、125、127、126、125；policy-exact为126、127。这说明当前闭合能力主要
覆盖128帧结算前的已领先局面，而不是中盘进攻、逃生或抢位决策。

## 下一架构边界

不继续通过加大ForcedWin预算、放宽exact或提高搜索margin扩大根动作所有权。下一阶段把Minimax改成
长期提案的响应包络服务：Plan/Attack/Navigation policy先提供有身份的多帧候选，Minimax在同一策略
身份下计算敌方响应、nonloss区间和反驳证据；普通不完整值只能约束或排序该提案，不能单独创造根动作。

复现入口为`tools/base-policy-kernel-bp17.sh`；三次运行用
`base-policy-certificate-ownership-report.js`统一对账。结构化证据见
`config/engine-v3/base-policy-kernel-bp17-evidence.json`。未读取Holdout，未运行官方simulate、publish或
challenge。
