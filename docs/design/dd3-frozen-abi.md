# DD3 冻结物理 ABI

状态：DD3 规范合同，2026-07-15。冻结底层表示类别、所有权、线性池边界和失败语义；DD8已冻结容量/cache选择合同，具体生产值和平台字节门仍待v2 benchmark。

关联：`DEC-0039` 至 `DEC-0042`；`OI-ARCH-001`、`OI-ARCH-002`、`OI-R3-005`。逻辑字段仍分别由 [information-state-storage-contract.md](information-state-storage-contract.md)、[action-result-abi.md](action-result-abi.md) 和 [memory-capacity-manifest-schema.md](memory-capacity-manifest-schema.md) 拥有。

## 1. 版本与适用范围

```text
DD3_PHYSICAL_ABI_REVISION = 1
WORLD_STORAGE_ABI         = IMMUTABLE_DELTA_V1
HOT_POOL_LAYOUT_ABI       = TYPED_SOA_V1
SEARCH_DRIVER_ABI         = EXPLICIT_STACK_V1
SUPPORT_ITERATOR_ABI      = EXACT_PREFIX_LOSSLESS_RESIDUAL_V1
BRANCH_MARK_ABI           = GENERATED_USED_COUNTS_V1
```

这些标识必须进入 build fingerprint、prototype/fixture fingerprint 和所有读取物理 offset/stride 的 cache version。逻辑 ABI 版本与物理 revision 分开递增：只改 stride 不改变 Command/Result 的语义编号，但必须清空依赖物理 offset 的构建产物。

本文件不把 32×32、128 world 或任何 DD3 数字宣称为平台上限。缺少平台确认的容量继续标记 `BUILD_CONFIGURED`；生产构建在 DD8 前不得将其升级为 `PLATFORM_CONFIRMED`。

## 2. InformationState 与 world storage

### 2.1 规范形状

```text
InformationStateRecord
  -> CommonPhysicalBase              // immutable while the node is live
  -> ExactWorldRecord[exactCount]    // immutable, canonical order
       -> WorldDelta[fieldStart, fieldCount]
  -> optional LosslessResidualRecord
  -> ProbabilityBelief
  -> EnemyInformationPartition

materializeWorld(worldId, scratchId)
  = copy CommonPhysicalBase scalars to branch-local PhysicalScratch
  + apply sorted WorldDelta entries
```

- 多 world 默认使用 common base + immutable sorted delta；不得保存可被全局 make/unmake 覆盖的 live world。
- exactCount=1、无 residual 且 horizon 内不存在 information split 时，允许 `singletonPhysicalOffset` 直达快路径；它与 multi-world 路径调用同一 transition/terminal kernel，不形成第二套规则实现。
- `WorldDelta` 只表示相对 common base 的字段差异；branch transition 的反向修改写入独立 `TransitionDeltaBuffer`，二者禁止共用 usedCount 或生命周期。
- 每次切换 world 都从 canonical common base materialize；不得在前一个 world 的 scratch 上增量切换。

### 2.2 WorldDelta 记录

物理记录使用 TypedArray SoA：

```text
worldDeltaStart[]        Uint32
worldDeltaCount[]        CountT
worldSignatureLo/Hi[]    Uint32
worldPossibilityFlags[]  Uint8/Uint16 selected by manifest
worldProbabilityMass[]   Uint16, scale 10000

deltaFieldCode[]         Uint16
deltaValueLo[]           Uint32
deltaValueHi[]           Uint32 only for fields whose descriptor requires it
```

`deltaFieldCode` 的 canonical 排序、字段宽度和 owner 来自生成表。重复 field code、未排序 delta、越界 value 或与 common base 相同的冗余项使输入返回 `INCOMPLETE_INTERNAL_CONSISTENCY`；不得在搜索热路径排序或修复。

## 3. support 表示

- exact world 数量不超过配置 prefix 时使用直接 SoA 列表；这是小集合的默认路径。
- 超过 prefix 的 possibility 只能转入可执行、可复现、无损的 residual iterator。iterator 必须恢复完整联合 support、互斥/因果约束和 enemy information partition；不得改为独立边缘分布。
- top-K 只属于 ProbabilityBelief，不得删除 Possibility。
- residual/prefix/partition 容量不足分别返回明确 `IncompleteReason`；搜索质量缩减不能伪装成完整 support。

因此 explicit 与 residual 不是运行时二选一的策略开关，而是同一 ABI 的两个容量区段：`exact prefix first, lossless residual on overflow`。

## 4. 热池与数组布局

### 4.1 选择

以下池统一采用预分配 TypedArray SoA，并由 manifest 生成 offset、length 和 stride：

```text
World / Residual / Partition
PhysicalScratch / Entity / Terrain
TransitionDelta / Event
Action / Command
SearchFrame / Matrix
Result / Policy / Coverage
TrajectoryCache
```

禁止在热路径使用对象记录、`Map`、`Set`、`slice`、`subarray` 或可增长 Array。允许非热构建工具使用对象，但生成的 production 表必须是整数数组。

### 4.2 小标量与位宽

- `CellT/FrameT/CountT` 由 manifest 构建选择 Uint16 或 Uint32；位宽不足时构建失败或递增 ABI，不能饱和。
- value、probability 和 risk 继续使用既有整数尺度；热路径不引入浮点语义。
- packed numeric Array 在本地两档复合 workload 均无容量或整体性能优势，退出生产候选；如平台 DD8 出现反转，必须新增 physical ABI revision，不得运行时混用。

## 5. BranchMark、apply/undo 与事件

`BranchMark` 是 manifest 生成的固定字段记录，不是动态 key/value 容器：

```text
terrainDeltaUsed
entityDeltaUsed
hazardDeltaUsed
transitionDeltaUsed
eventUsed
worldUsed
residualUsed
partitionUsed
actionUsed
resultUsed
policyUsed
coverageUsed
matrixUsed
hashLo/hashHi
entityHashLo/entityHashHi
```

具体池可以由构建 profile 删除，但余下字段顺序由 revision 固定。apply 前保存 mark；任一正常返回、预算中断、UNKNOWN、event/delta overflow 或异常 guard 都必须按 owner 逆序 undo 并核验 usedCount/hash。EventBuffer 与 TransitionDeltaBuffer 分开，前者是 ordered semantic trace，后者只服务恢复。

`EVENT_CAPACITY` 或 `DELTA_CAPACITY` 只允许 `INCOMPLETE_* + fully undone`。不得提交部分事件，也不得留下半变更 scratch。

## 6. 搜索驱动与结果传递

- production 默认使用预分配 `SearchFrame` SoA 的显式栈；递归 driver 只保留在开发期 oracle，不进入正式 bundle。
- frame 只保存整数 cursor、node kind、depth、alpha/lower/upper、arena marks 和 result handle；禁止 frame 对象或闭包。
- Kernel 通过整数 status/result handle 返回；多字段写入唯一 Result/Policy/Coverage arenas。
- deterministic policy 仍是单项 PolicyRecord；mixed policy 的 Uint16 权重和严格为 10000。
- `HARD_REJECT_PROVEN`、ProofStatus、BoundKind 和 incomplete 语义完全沿用逻辑 ABI；物理布局选择不能升级任何证明资格。

## 7. trajectory/cache 边界

DD3 只冻结 direct-address cache 的接口候选，不冻结生产大小：

```text
lookup(key, semanticVersion, topologyVersion, outOffset) -> HIT | MISS
MISS -> direct recompute
capacity full -> replace or MISS
```

cache off/on 必须有相同 semantic checksum。cache entry 不持有 arena-local ActionRef 或 mutable world offset；碰撞必须核验 compact signature。跨帧 projectile/bomb trajectory 的生命周期由实体 handle、generation、terrain/topology version 和规则版本失效。最终 cache inventory、配额、替换和 1.5 秒 fallback 交互归 DD8。

## 8. 容量与内存合同

DD3 两个验证档只冻结公式形状和量级证据：

| 档位 | cells/worlds | normal bytes，不含 world | delta typed world bytes | cache | emergency | 总计，不含 world |
|---|---:|---:|---:|---:|---:|---:|
| corpus lower bound | 440 / 64 | 10,096 | 3,108 | 16,384 | 1,464 | 27,944 |
| conservative build | 1,024 / 128 | 22,832 | 5,764 | 65,536 | 2,928 | 91,296 |

完整 build manifest 仍必须按 [memory-capacity-manifest-schema.md](memory-capacity-manifest-schema.md) 生成。`CORPUS_OBSERVED_LOWER_BOUND` 不可作为安全上限；conservative build 也不是平台上限。生产 sizing 只有在 DD8 获取平台限制、source/minified 测量和字节门后才能冻结。

## 9. 复杂度边界

- `materializeWorld`：`O(commonScalarCount + worldDeltaCount)`，无 heap allocation。
- exact support iteration：`O(exactWorldCount)`；residual iteration：`O(actual lossless support)`，可中断但不可截断后宣称 complete。
- apply/undo：`O(eventsWritten + deltasWritten)`，上限由 manifest 固定。
- search driver push/pop：`O(1)`；frame 数不超过 configured active depth。
- direct cache lookup：`O(1)`；miss 的语义回退是有界重算。

地图静态层是 column-major 固定整数网格，动态实体不写入 terrain cell。拓扑/trajectory 查询使用 versioned derived data；无事件时不得每节点全图重建。具体 Hazard/Topology 增量算法由 DD5 差分验证。

## 10. 验证与变更门

本 revision 的最低验证集：

1. 20 个 DD3 correctness oracle 零失败；
2. source/minified 的 support、semantic、terminal fingerprint 一致；
3. 两档 snapshot/delta、typed/packed、recursive/stack、cache off/on 语义一致；
4. FACT/SUPPORT/SEARCH/CACHE/OUTPUT/EVENT/DELTA 故障全部满足既定失败合同；
5. root signature、所有 usedCount 和 event/delta high-water 在中断后恢复；
6. DD4 ReferenceKernel 可只依赖逻辑字段，不读取 prototype 的 synthetic score 或 workload 常量。

任何新增字段必须先声明 owner、hash、observation、undo 和 capacity class。改变 world 可变性、支持有损 residual、把对象带入热池、改变 BranchMark 语义或将 cache miss 变成默认值，均属于破坏性 ABI 变更，必须退回 decision 审核。
