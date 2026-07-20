# DD3 Architecture Validation Prototype Plan

状态：DD3 执行计划，2026-07-15。本文冻结 workload、候选变量、正确性 oracle 和测量方法；不冻结测试结果。

关联：`DEC-0010`、`DEC-0022`、`DEC-0032` 至 `DEC-0038`、`DEC-0101`、`DEC-0102`、`DEC-0106`；`OI-ARCH-001`、`OI-ARCH-002`、`OI-R3-005`。

## 1. 目标

DD3 只回答底层架构是否可实现以及哪种物理表示在真实复合负载上更合适：

- InformationState 的多个 immutable PhysicalWorld 能否并存且无 strategy fusion；
- WorldSnapshot 与 Immutable WorldDelta 哪个适合作为默认 world representation；
- TypedArray 与 packed numeric Array 在本地已知引擎上的相对性能；
- recursive DFS 与 explicit stack driver 是否语义一致，哪个更快；
- lossless residual iterator 是否比全量显式 world 更节省空间且保持 support；
- direct-address cache 是否在相同语义下有净收益；
- Arena、Event、Result、Policy 和 Capacity overflow ABI 能否形成端到端垂直切片。

本阶段不实现完整平台 RulesKernel、技能策略、Hard/Proof 搜索或可对战 Tank。规则数值只用于确定性的布局负载，不提升为平台事实。

## 2. 产物

```text
docs/design/architecture-prototype-plan.md
docs/design/dd3-capacity-profiles.json
prototypes/dd3/architecture-prototype.js
docs/design/architecture-prototype-report.md
docs/design/dd3-overview.md
```

原型与 benchmark 永不进入 production bundle。

## 3. 固定环境

- runtime：本地 Node.js 24.16.0；平台 JavaScript 引擎仍为 UNKNOWN；
- clock：`process.hrtime.bigint()`，只在 benchmark iteration 外层读取；
- seed：固定 xorshift32 seed；
- warmup：每个 candidate 独立预热；
- 统计：至少 9 个 sample，报告 median/p95/min/max，不用最快单次选择赢家；
- correctness 在 timing 前执行；任何 oracle 失败立即停止，不产生性能赢家；
- candidate 顺序轮换，减少热机顺序偏差；
- 同一 workload、action order、world order 和 chance order。

本地结果只能冻结默认源码候选；DD8 必须在平台 source/minified 环境复核，平台明显反转时通过 ABI revision 修改。

## 4. Capacity profiles

[dd3-capacity-profiles.json](dd3-capacity-profiles.json) 至少包含：

1. `corpus_max_observed`：22×20、3 projectile、2 bomb、13 observed events；这些都是 lower bound；
2. `conservative_build`：32×32、8 projectile、4 bomb、128 possible worlds、12×12 restricted matrix；全部是 BUILD_CONFIGURED，不伪称平台最大值；
3. `fault_injection`：从 conservative profile 对每类容量减一。

每个 profile 生成 scalar selection、arena bytes、normal/emergency/cache totals 和 manifest fingerprint。平台物理上限未知的参数继续标记 `UNKNOWN_BLOCKING` 或 `BUILD_CONFIGURED`。

## 5. 真实复合 workload

### 5.1 Static/map

- column-major 22×20 或 32×32 terrain；
- wall/dirt/grass/open bitset；
- topologyVersion 和 deterministic terrain mutation；
- neighbor/ray 查询与 topology-dependent cache。

### 5.2 Physical world

每个 world 同时包含：

- 两个 tank 的 cell/direction/stars/skill/shield/effect/deadline/queue prefix；
- 多 projectile，包含 overload shotGroup、member ordinal 和独立位置；
- 多 bomb，包含不同 deadline 与 grass-hidden candidate；
- frame/phase/terminal fields；
- active entity canonical multiset hash。

### 5.3 InformationState

隐藏因子至少覆盖：

```text
enemy pose
projectile association choice
bomb deadline/visibility
enemy queue head
shield hit count
enemy observation history
```

因子之间带 parity/causal constraint，因此 residual 不是独立边缘概率的笛卡尔积。显式 world 与 residual iterator 必须枚举同一 canonical support。

### 5.4 Vertical transition

每个 matrix cell 必须执行：

```text
materialize world
  -> our/enemy ActionProgram
  -> chance outcome
  -> movement/turn/fire/bomb/effect scalar mutations
  -> projectile/bomb/terrain event generation
  -> terminal composite check
  -> observation signature
  -> enemy information partition
  -> value interval/matrix cell
  -> undo to BranchMark
```

受限矩阵产生 deterministic 或 mixed PolicyRecord，概率总和严格为 10000，并输出统一 Result/Coverage fields。

## 6. A/B candidates

### A. World representation

- `CompactWorldSnapshot`：common base + 每 world 固定 scalar snapshot；
- `ImmutableWorldDelta`：common base + sorted field/value delta；
- 两者 materialize 到 branch-local scratch，禁止修改 WorldRecord。

选择标准按顺序：oracle、peak bytes、composite median、p95。性能差小于 5% 时优先更简单且更低 worst-case 的表示；允许 singleton 采用 snapshot fast path、multi-world 采用 delta，前提是没有双重语义实现。

### B. Support representation

- full explicit world list；
- exact prefix + lossless factored residual iterator。

不得因 residual 更慢而改成有损 top-K。赢家只决定 possibility 的物理表示；Probability top-K 仍是独立优化层。

### C. Scalar storage

- TypedArray SoA/AoS candidate；
- packed numeric Array candidate。

禁止对象、Map、Set 或每节点 slice/subarray。若不同结构赢家不同，可按结构分别选择，但必须写入 manifest，禁止运行时动态切换。

### D. Search driver

- RecursiveSearchDriver；
- StackSearchDriver，使用预分配 frame arrays。

必须产生相同 result、trace hash、visited count 和 complete/incomplete status。

### E. Derived work

- trajectory/ray direct recompute；
- fixed direct-address cache + generation/touched validation。

cache off/on 的 semantic checksum 必须相同；cache 满等价 miss。

## 7. Correctness oracle

以下全部为 hard gate：

1. snapshot/delta 对所有 world 的 canonical state 完全相同；
2. typed/packed 对所有 transition/event/result 完全相同；
3. explicit/residual support multiset 与 count 完全相同；
4. recursive/stack 的 value、trace、visited count 相同；
5. cache off/on 结果相同；
6. 每次 apply/undo 后 scratch hash、terrain、entity、eventCount 和 usedCount 恢复；
7. 同一 enemy information set 在一个 response-policy column 中只使用一个动作；
8. observation partition 不读取隐藏 TruthState 选择我方未来动作；
9. EventBuffer 顺序稳定且正常 workload 不 overflow；
10. Policy probability sum=10000，ActionKey/PolicyKey 稳定；
11. lower≤upper，incomplete 不升级 exact/proof；
12. source 两次独立运行 deterministic fingerprint 相同。

任何失败都使 DD3 返回 DD2 修订。

## 8. Fault injection

| 类别 | 注入 | 必须结果 |
|---|---|---|
| FACT_CRITICAL | entity capacity=required-1 | 不截断；EmergencyReserve 或 `INCOMPLETE_ROOT_ENTITY_CAPACITY` |
| SUPPORT_CRITICAL | residual/partition capacity=required-1 | `INCOMPLETE_RESIDUAL_CAPACITY`/`INCOMPLETE_PARTITION_CAPACITY` |
| SEARCH_QUALITY | action/matrix capacity=required-1 | interval + `INCOMPLETE_ACTION_SUPPORT`，不得 exact |
| CACHE_ONLY | cache capacity=0/full | miss/recompute，semantic checksum 不变 |
| OUTPUT_CRITICAL | policy capacity=required-1 | `INCOMPLETE_POLICY_CAPACITY`，独立 emergency deterministic output 可用 |
| EVENT/DELTA | capacity=required-1 | transition incomplete 且完整 undo |

## 9. Benchmark layers

1. function：materialize、hash、apply/undo、support iterator、policy normalize；
2. composite：world×joint action×chance×event×observation；
3. full-state：InformationState + partition + restricted matrix；
4. terminal：frame 128、star/runtime、multi-hit/bomb terminal payload；
5. high-water：最大 active depth/world/event/delta/policy；
6. fault-injection：逐类 only-one-short；
7. cache on/off；
8. deterministic rerun fingerprint。

报告必须包含 ops/s 或 ns/op、median/p95、bytes、high-water、oracle 数量和失败数。不能用单一 microbenchmark 决定综合布局。

## 10. 决策规则

- 正确性优先于性能；
- composite/full-state 权重大于单函数；
- bytes 明显减少且 runtime 差异在噪声区间时选择低内存候选；
- 本地 TypedArray/packed 结果只确定默认候选，DD8 平台复核；
- cache 只有 composite 净收益为正才保留为候选；
- 任何候选都必须保留 explicit incomplete 与 emergency 路径。

## 11. DD3 退出门

只有以下全部完成才将 DD3 标记 COMPLETE：

- prototype source 与 profiles 固定；
- correctness oracle 零失败；
- 所有 A/B 有报告和明确选择/保留理由；
- manifest 给出数组、arena、bytes 和 high-water；
- OI-ARCH-001/002 满足关闭条件；
- DEC-0101/0102/0106 被正式决策取代或冻结；
- `architecture-prototype-report.md` 与 `dd3-overview.md` 完成跨文档一致性检查。
