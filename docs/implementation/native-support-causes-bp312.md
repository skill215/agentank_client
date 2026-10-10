# BP312：整局支持不足根因归类

## 核心发现

当前完整层覆盖率的主要障碍不是性能：FastKernel对联合移动结果保守返回UNSUPPORTED，导致完整矩阵不能提交。该行为在规则未闭合时是有意的安全边界，不能直接当作实现错误改为ALLOW。

复跑BP311的16场景双座位32局、2,328根，支持诊断不改变所有深度、停止次数、评分向量分歧次数及原始最高分行分歧次数；双方动作流与胜负仍与来源一致。

## 原因分母

| 原因 | 支持不足根中出现 | depth0根中出现 |
| --- | ---: | ---: |
| 联合移动：OCCUPIED_AFTER_EARLIER_MOVE | 979 | 128 |
| 联合移动：VACATE_NOT_STRICTLY_SUPPORTED | 23 | 2 |
| 联合移动：OTHER | 90 | 1 |
| Hard：viable=-1、hazard complete=1、narrow=0 | 64 | 2 |
| 无法归类 | 0 | 0 |

总支持不足根1,058；depth0总数133。不同原因可能出现在同一根，**不能将行相加当成独立失败数**。depth0里128/133（96.24%）涉及先移动占位，优先级远高于继续调整搜索预算。

没有观察到entity/event/delta等容量失败；没有未能由Fast/Hard原因解释的支持不足根，因此此批没有证据支持“动作生成器缺口是主因”。这不等于全局排除其它bug。

## 代码解释

`FastKernel.move` 在检测target被另一坦克占据时，只有确认的无效果腾位入口或静止占位规则能继续。若对方动作可能改变位置，且不能证明属于已支持情况，则JOINT_TANK_RELOCATION失败；目标与该坦克帧初格不同即标为OCCUPIED_AFTER_EARLIER_MOVE。

这通常对应双方移动后发生占位冲突，但现有见证尚不足以把全部979根都归为某一个几何子类型或平台事件顺序。不能将它们一律处理成“碰撞”“阻挡”或“死亡”。

Hard的64根属于 `finalizeReverseResult` 中的窄证明不完整：敌方committed弹丸路径撞土时，当前静态危险模型不能为负可活度提供完整死亡证明，所以返回UNKNOWN。不是hazard timeline容量溢出，也不能把-1改为0。

## 下一步

优先闭合联合移动的规则证据：将占位分为同目标、后行动进入先行动落点、互换、带stun/boost及技能位移，读取平台/模拟器事件顺序，并用官方历史可观察事件区分支持事实与模拟器假设。先为每种子类建立正反fixture和独立oracle，只有证据支持后才扩FastKernel范围。

若官方证据仍不足，保留UNKNOWN，并研究不完整cell的有界搜索表达；不能为了提交完整矩阵而虚构物理规则。敌弹撞土的动态地形证明单独处理，不与移动规则一起打补丁。

## 证据与范围

`artifacts/native-causal-audit/bp312-support-audit/`：manifest、overview、roots.ndjson.gz。压缩根摘要75,289字节，每根最多2个短见证，没有整局replay。

`SearchSupportAudit` 仅开发侧包装apply/classify，及时记录原因，退出后恢复方法。新增统计UT通过，防止跨层事件重复计根。诊断计时包含额外采集开销，不用于新的性能结论。

```sh
node tools/agentank/diagnostics/thin-whole-game-shadow.js artifacts/native-causal-audit/<新唯一目录> --support-audit
node --test --test-isolation=none test/minimax-core/search-support-audit.test.js
```

production tree保持 `019352b765a19385e2c86b34096944af6f60e799d885abe92f50e5267e82b7eb`，未放宽Hard或物理支持规则，未调用平台写接口。
