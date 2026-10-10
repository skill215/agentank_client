# HP17：稀疏几何搜索调度

## 结论

HP17没有继续增加Information深度，而是为HP16的三行单层几何搜索建立零搜索触发器和跨帧
冷却。最终冻结的Shadow调度为：

```text
Risk/Pareto候选恰好三行
AND 最强challenger的旧expectedValue仍低于当前动作
AND 距上次几何搜索至少4帧
→ 才运行三行完整敌方响应矩阵
```

该规则编码为`mask=97, value=1, cooldown=4`。Production默认仍关闭；它只是下一阶段ACTIVE
Proposal A/B的固定调度候选。

## 零搜索特征

每个合格根只读取已经存在的整数状态：候选宽度、selected/attack类别、tactical和expected相对
关系、敌我距离桶、清晰射线、selected是否FIRE以及前后半局。特征编码不调用Fast transition、
Hard、Minimax或矩阵，也不产生逐帧对象。

诊断启用时使用三个4096项`Uint32Array`累计completed、positive和node直方图；production默认不
构造这些数组。规则只允许对语义字段做完整类别约束，禁止用category bit的半截模式过拟合。

## Discovery / Validation

固定16场景按`SHA-256(HP17_SELECTIVE_GEOMETRY_TRIGGER_V1 + fingerprint)`拆成互斥8/8场，
同一场景的两个座位始终在同一lane。

Discovery选中：`candidateWidth=3 && expectedRelation=LESS`。

| lane | 全部机会 | 规则保留 | 机会召回 | 节点保留 | precision |
|---|---:|---:|---:|---:|---:|
| Discovery | 35 | 26 | 74.28% | 44.66% | 20.31% |
| Validation | 61 | 39 | 63.93% | 49.94% | 21.31% |

Validation节点保留没有通过预设45%门，因此根级规则单独被标为`REJECTED`，没有事后放宽门槛。
它只作为冻结输入继续进行runtime冷却消融。

## Runtime冷却矩阵

固定16场景、32局，同一进程同时比较CURRENT与2/4/8帧冷却：

| profile | Info节点 | strict机会 | 机会保留 | 总work | 相对CURRENT | Physical节点 | 完整owner |
|---|---:|---:|---:|---:|---:|---:|---:|
| CURRENT | 0 | 0 | — | 4,383,247 | — | 24,366 | 70 |
| C2 | 5,040 | 58 | 60.42% | 4,593,339 | +4.79% | 23,211 | 70 |
| C4 | 3,612 | 50 | 52.08% | 4,535,387 | +3.47% | 23,754 | 70 |
| C8 | 2,442 | 36 | 37.50% | 4,488,913 | +2.41% | 23,910 | 70 |

三个候选的W/L/D都与CURRENT相同，为3/28/1；动作流、参数流、终局、星数全部零差异，所有
Hard、Risk domination、restore和热分配不变量为0。

选择C4不是按胜率调参，而是预先固定的性能折中：先要求保留至少HP16一半的96个机会，再在
合格版本中选择最低work。C8更省，但只保留37.5%机会；C2保留更多，却额外消耗约58k work。

## 边界与下一步

C4把常驻13,422个Information节点降至3,612，减少73.1%，并恢复完整Physical owner；但总work
仍比CURRENT高3.47%，Physical节点仍低2.51%。所以它不能仅凭Shadow结果进入production默认。

下一步HP18必须让这50个完整几何分离形成受限Proposal，再做同源码ACTIVE/SHADOW A/B：

- Proposal只允许在完整一层几何矩阵中严格优于当前动作；
- 仍不得成为Hard、ForcedWin或Terminal Proof；
- FinalActionGate必须重新检查；
- 若整局转换收益不能覆盖3.47% work和Physical节点损失，整个几何ACTIVE路径拒绝。

验证结果：Minimax core 146/146、Diagnostics 105/105、GR0 280/280、IMP5 14/14；
24-profile深度标定全部不变量为0。冻结证据：

- report fingerprint：`8860c4d71ca66a7aa90072c7124ec7a3b3ed7406efe18239cb89d66da1ab640e`；
- source fingerprint：`0e6db704e8b32e33489e639c61c3c1a09d84bbb25994ae4de1debcce4436e6c8`；
- baseline：`config/engine-v2/minimax-depth-baselines/after-hp17.json`；
- baseline fingerprint：`21c0c338c88395c4d0840958cfb4a274441e3b9cb5e4e0fa967ac8f8c60e0f89`。
