# BP285–BP287：共享预算造成敌方响应覆盖不均

## 本轮结论

有实证支持的结构问题是搜索覆盖不均，不是单纯FIRE阈值。5个已定位根中，1个仅改变敌方列遍历次序就改变动作并使整局负→胜。其余4个不改善。不能推广为整体胜率提升或认定它是唯一根因。

生产源码、预算和评分未修改；仅开发进程插桩，原函数在finally恢复。不执行平台操作或Holdout。

## 分支证据

5个CURRENT根及2个单根FIRE放行对照，共82个root cell：

- 55个进入时行共享预算已经耗尽；这55个只有top=1的启发式叶。
- 每行先搜索的敌方GO可展开到2–3帧，后置转向等响应则立即截断。
- 各cell的worst、加权expected、整数blend重建与production rootScore一致，没有发现该备份算术错误。
- ownerValue还可能叠加intent bonus；它不等于原始rootScore，不能混为搜索算错。
- 1次fast incomplete、0次hard incomplete；不把这些不完整叶视为严格证书。

示例：`mat_CWKbddZd2Mb1EKL5v` seat1 frame46，GO对敌GO搜索到3帧，cell=693；后续敌左转在预算已耗尽时只评估1帧，cell=-22397，最终GO rootScore=-16923。这里的巨大负值并非完整搜索证明的必死值。

## 单根次序消融

保持候选、深度、预算参数、评分与Hard/Risk不变，仅在目标根反转敌方列顺序；随后恢复原策略。

| 场景简名 | CURRENT动作→反序动作 | CURRENT终局→反序终局 |
| --- | --- | --- |
| Ar56 frame19 | FIRE→右转 | 负→胜 |
| LpYD frame30 | 左转→左转 | 平→平 |
| H0oc frame32 | 右转→右转 | 平→平 |
| DW7M frame28 | 右转→右转 | 负→负 |
| CWKb frame46 | 左转→左转 | 负→负 |

这证明有限预算遍历次序能改变选择与实战结果；不证明固定反序更优，也不证明精确Minimax理论出错。预算参数相同不代表实际节点数严格相同，当前预算是软界限。

CURRENT插桩与原基线双方整局动作编码流一致；全部实验的目标根前缀和参数校验通过。最后报告排除搜索count之外的NONE哨兵行，以免复用数组残值被读为有效行。

## 验证与工具

- 17项相关UT通过，包含用生产policyValue函数复现“预算耗尽、目标深度仍大于0，但当前top=1直接成叶”。
- 新工具：`tools/agentank/diagnostics/native-search-value-audit.js`。
- 最终证据：`artifacts/native-causal-audit/bp287-column-order-final.json`，103926字节，12个根运行、136个cell。
- BP285为首次值分解；BP286含未排除的NONE哨兵展示行，应使用BP287进行行级分析。
- 源码树身份：`4a5056ae736d5d4cc1bd3f397837c4cc2660ba516dc6e580e17760c2fbbdadba`。

## 下一步：覆盖公平性POC，而非评分补丁

1. 保持总工作预算，比较现有row-shared与每cell保障覆盖/完整浅层后再加深的调度。先在相同根验证值、覆盖和顺序敏感性。
2. 不把cell-equal直接当答案：均分也可能降低关键分支深度，应明确完成层、截断类型和实际节点开销。
3. 以列排列不改变完整层结果、root restore、未完成层不冒充exact等UT约束实现；近似预算模式要显式标记覆盖。
4. 根级改善不算资格；候选通过UT和工作量检查后，再在Discovery整局对照，包括原本获胜样本，验证退化与性能。

剩余4个根仍需保留叶估值/时域及对手模型调查，不通过增加固定FIRE分或放松Risk绕过。
