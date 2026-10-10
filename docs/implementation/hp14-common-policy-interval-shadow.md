# HP14：Common-policy Information 区间 Shadow

## 结论

HP14 证明了两个不同问题，不能再混成“把 Information depth 调高或调低”：

1. 深层搜索必须满足非预见性：同一观察组只能选择一个共同后续动作；
2. 单层几何矩阵可与其他不完整观察事实分层，但不能在每个接触帧全宽运行。

本阶段只新增诊断 oracle、探针和 UT；production 默认、bundle 和 HP12 调度均未改变。

## CommonPolicyIntervalOracle

新增固定整数、零热分配的诊断 oracle。每个 branch 表示完整枚举的
`HiddenWorld × EnemyAction × ChanceOutcome`，branch 按 observation id 分组：

```text
同一 observation group：所有 branch 共享一个 continuation action
不同 observation group：ObservationSplit 后允许选择不同 action
每个 branch 内：enemy continuation 仍取 universal min
缺失 support：ordering estimate 可保留，lower/upper 必须为全范围
```

Exhaustive 81 组双世界效用矩阵与独立策略枚举完全一致。核心反例为：

```text
world 0: action A = +100, action B = -100
world 1: action A = -100, action B = +100
```

- 两个世界不可区分时，共同策略值为 `-100`；
- 旧的逐世界独立 continuation 会得到 `+100`；
- strategy fusion gap 为 `200`；
- 两个世界在 ObservationSplit 后可区分时，值才恢复为 `+100`。

这证明旧深层 Physical continuation 不能直接成为 Information lower bound。

## 固定根 Shadow

### 深层旧路径

固定16场景、32局的旧深层 Information 路径：

| 指标 | 数值 |
|---|---:|
| Information attempts | 1,282 |
| 只缺 INPUT + COMMON_POLICY 的 attempts | 67 |
| 上述67次中的点估计分歧 | 22 |
| 仍缺敌方响应列 | 1,215 |
| 总 Information nodes | 209,142 |

因此只补 ObservationSplit 最多覆盖5.2%的旧搜索根，不能证明恢复整套深层搜索合理。

### 单层组合支持

单层搜索没有后续策略融合问题。相同固定样本得到：

| 指标 | CURRENT | INFORMATION_DEPTH_ONE |
|---|---:|---:|
| W/L/D | 3/28/1 | 4/28/0 |
| work units | 4,383,247 | 6,260,067 |
| Physical nodes | 24,366 | 17,166 |
| Information attempts/nodes | 0/0 | 1,894/64,380 |
| geometry-complete attempts | 0 | 1,886 |
| geometry-complete action rows | 0 | 8,874 |
| geometry-complete point disagreements | 0 | 904 |

1,886次只缺整体`informationComplete`，但敌方位置、方向、世界质量、敌方响应列和单层策略
均完整。这说明当前`supportComplete = hiddenSupportComplete && exact`过度耦合：possible
projectile等独立风险事实不应自动抹掉几何矩阵的有限时域支持。

不过，单层全宽运行使work增加42.8%，Physical节点减少29.5%。本地时间也明显增加，但仅作
同次运行参考。整局多1个胜局来自预算/运行模式时序变化，因为Information仍是evidence-only，
不能归因成价值选择收益。

## 架构决定

不采用：

- 恢复旧深层 Information scalar 所有权；
- 所有inexact contact都运行单层全矩阵；
- 将possible projectile忽略后把结果称作完整终局价值；
- 用这次小样本的`DRAW→WIN=1`作为胜率依据。

下一步 HP15 采用选择性单层几何证据：

```text
Hard / Safety / Risk / Strategy先形成候选集合
→ 仅保留当前基准动作 + 最多两个qualified challenger
→ 对这些行运行完整敌方列的一层几何矩阵
→ 结果标记为HORIZON_UTILITY，不冒充terminal proof
→ Risk仍独立处理possible projectile / future FIRE / UNKNOWN
→ 只有完整区间严格分离才允许Proposal
```

HP15 必须先做 Shadow 性能和full-width differential；目标至少回收全宽单层节点的50%，且不能
降低同预算Physical完整迭代数。达不到时继续保持Information production关闭。

## 验收

- Common-policy oracle UT 6/6；
- Information interval/probe UT 全部通过；
- Minimax、Diagnostics、GR0、IMP5全绿；
- 固定样本全部硬不变量为0；
- production Minimax fingerprint未改变，HP12 calibration仍为CURRENT。
