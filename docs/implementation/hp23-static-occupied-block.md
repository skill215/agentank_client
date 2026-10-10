# HP23：静态占位阻挡闭合

## 结论

HP23闭合了官方replay已经证明的公共物理规则：我方`GO`目标格被敌方占据，且敌方本帧动作确定
不会改变位置时，`GO`是no-effect阻挡，不是碰撞死亡，也不再是`UNSUPPORTED_RULE`。

这是正确性和Minimax支持覆盖的正向修改，但不是性能优化。两批共96局的同源码因果A/B中，胜负
转换为0；完整值owner增加11帧，精确P2完成增加6次，剩余unsupported cell全部收敛为尚未
校准的`GO/GO`。同时Physical节点增加8.30%，确定性work增加2.15%。因此production默认启用，
后续必须基于新曲线优化，而不能为了跑得快恢复错误的unsupported早停。

## 规则边界

Fast和Reference现在共享相同保守边界：

- 对方`NONE/FIRE/TURN/BOMB/STUN/POISON`等不搬移坦克的动作：进入其占据格被阻挡，状态正常推进；
- 对方`GO/CAST_TELEPORT/BOOST_*_GO`可能搬移：仍返回unsupported；
- 双方`GO`同目标、swap以及传送/boost腾空后的进入顺序：继续fail closed；
- apply失败、unsupported和完成路径都必须事务式恢复root。

不可变官方`P2-MOVE-CONTEST` raw replay从第12帧起给出22次同类事件：我方明确提交进入敌方
占据格的`GO`，敌方原地`FIRE`，我方位置不变且没有碰撞死亡。旧分析器错误地把同一record内的
speech marker关联到下一帧；修正后离线reconcile为`CONCLUSIVE / STATIC_OCCUPIED_BLOCK`，
raw response及SHA-256未改变。

## 因果A/B

诊断profile `STATIONARY_OCCUPIED_BLOCK_OFF`只关闭这条公共路径，复现HP22旧行为。CURRENT与
`DEPTH_TWO_PREFLIGHT_SHADOW`语义完全相同，后者只负责记录P2 census。

固定16场景Discovery、32局：CURRENT和旧路径均为3胜28负1平、星差-42；4条动作流不同但
胜负转换为0。unsupported cell由29降至14，剩余14个全部为`GO/GO`；完整P1 owner增加4帧。

独立32场景Tactical Holdout、64局：两者均为10胜49负5平；CURRENT星差-74，旧路径-75。
6条动作流不同但胜负转换仍为0。unsupported cell由87降至72，剩余72个全部为`GO/GO`；
精确P2完成116→122，非精确完成7→14，完整P2 owner增加7帧，FIRE 340→354。

合计结果：旧路径116个unsupported cell中30个静态占位单元被消除；新的86个失败单元全部为
`GO/GO`。P2尝试因动作轨迹变化从196增至208，精确完成165→171，非精确完成10→17，完整
值owner增加11帧。两批avoidabe Hard、Risk支配选择、root restore和热分配全部为0。

## 深度和性能标定

HP23的24-profile、每profile 80次冷/热测量已冻结为
`config/engine-v2/minimax-depth-baselines/after-hp23.json`。它与当前源码和harness一致。

纯Physical P2的请求深度完成率仍为56.25%，cold P95节点仍为489；但平均cold节点241→257，
cold P95 1231→1631微秒，warm P95 634→928微秒。更高Information预算档的请求深度完成率下降
6.25–12.5个百分点，因为原先unsupported的分支现在会继续合法计算。这组跨版本墙钟只作为方向
信号；确定性节点/work才是本阶段性能结论的主要依据。

所以HP23的准确分类是：

```text
规则正确性       正向
Minimax完整覆盖  正向
整局结果         中性
当前计算成本     负向且已量化
```

下一步应优化这批新闭合分支的状态推进、分类复用和缓存命中，同时保证动作/值指纹一致；每次修改
Minimax后都必须重新跑同一套depth calibration。

## 验证

- Minimax：158/158；
- Diagnostics：108/108；
- GR0：292/292；
- IMP2：53/53；
- IMP3：28/28；
- IMP5：14/14；
- 24-profile calibration：PASS；restore、cache、热分配不变量全部为0。

机器证据见`config/engine-v2/hp23-static-occupied-block-evidence.json`。
