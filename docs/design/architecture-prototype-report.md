# DD3 Architecture Validation Prototype Report

状态：DD3 完成报告，2026-07-15。报告记录独立架构原型的正确性、A/B、容量与选择；不把 synthetic transition 数值升级为平台规则。

关联：[architecture-prototype-plan.md](architecture-prototype-plan.md)、[dd3-capacity-profiles.json](dd3-capacity-profiles.json)、[dd3-frozen-abi.md](dd3-frozen-abi.md)、`DEC-0039` 至 `DEC-0042`。

## 1. 范围与环境

原型位于 [architecture-prototype.js](../../prototypes/dd3/architecture-prototype.js)，与 Tank v1、平台模拟器和未来生产 Kernel 分离。它只验证完整数据流与物理表示：地图、双方 tank/skill、多 projectile/bomb、hidden factors、歧义关联、多个 immutable worlds、lossless residual、enemy information partition、restricted matrix、apply/undo、terminal composite 和 mixed policy。

```text
prototype       DD3-AVP-1
runtime         Node.js v24.16.0, linux-x64
clock           process.hrtime.bigint()
samples         11 per candidate
warmup          3 per candidate
source bytes    57,753
minified bytes  29,798 (Terser 5.49.0, only for equivalence validation)
```

平台引擎仍未知，因此本地性能选择是 DD3 默认实现，不是不可逆的平台结论。DD8 必须在真实 source/minified 运行环境复核。

## 2. 正确性与确定性

| profile | oracle | failures | support | semantic | terminal | transitions | event HW | delta HW |
|---|---:|---:|---|---|---|---:|---:|---:|
| corpus_max_observed | 20 | 0 | `709fb329` | `b38b4dd7` | `86a0959e` | 12,288 | 12/32 | 15/48 |
| conservative_build | 20 | 0 | `bbd04443` | `fb90b01f` | `1be842ad` | 73,728 | 24/64 | 27/96 |

两档的 snapshot/delta、typed/packed、explicit/residual、recursive/stack 和 cache off/on 均得到相同语义结果。source 与 minified 在两档的 support、semantic、terminal fingerprint 完全相同。mixed policy 均产生 4 个 entry，权重归一化为 10000。

故障注入逐类通过：

- FACT_CRITICAL：不截断事实，返回根 incomplete 或 emergency；
- SUPPORT_CRITICAL：residual/partition 不足显式 incomplete；
- SEARCH_QUALITY：返回 incomplete interval，不升级 exact；
- CACHE_ONLY：容量 0 等价 miss + recompute；
- OUTPUT_CRITICAL：独立 deterministic emergency output 可用；
- EVENT/DELTA：required-1 时 transition incomplete 且 fully undone。

conservative build 正常复合负载 required event/delta 分别为 22/25，高水位为 24/27；注入 21/24 均被精确拒绝，说明 guard 不是依赖最终高水位猜测。

## 3. A/B 结果

以下均为 median ns/op；p95 以 sample 总时间观察，选择不使用单次最快值。

### 3.1 World representation 与 scalar storage

| candidate | corpus materialize | corpus full-state | conservative materialize | conservative full-state | conservative world bytes |
|---|---:|---:|---:|---:|---:|
| snapshot typed | 255.09 | 706.49 | 213.97 | 974.20 | 37,408 |
| delta typed | **193.39** | 778.23 | **164.80** | **970.93** | **5,764** |
| snapshot packed | 242.83 | 713.03 | 278.54 | 1,030.02 | 75,328 |
| delta packed | 232.54 | 786.64 | 192.16 | 1,082.29 | 15,176 |

结论：multi-world 采用 immutable delta + TypedArray。corpus full-state 中 delta typed 慢约 10%，但 materialize 更快且 world storage 从 11,568 降到 3,108 bytes；conservative full-state 已与 snapshot typed 持平，同时 world storage 从 37,408 降到 5,764 bytes。内存下降约 73%/85%，能直接减少搜索高水位和 GC 风险。singleton 允许 snapshot/direct physical fast path，但不复制规则语义。

packed Array 没有展示整体优势，且 conservative full-state 更慢、容量更大，因此从当前 production candidate 退出。

### 3.2 Support

| candidate | corpus ns/op | conservative ns/op | 语义 |
|---|---:|---:|---|
| explicit world list | **1.87** | **1.48** | 完整 exact support |
| exact prefix + lossless residual | 3.42 | 2.58 | 相同完整联合 support |

结论：小集合先走 exact explicit prefix；容量超过 prefix 时才走 lossless residual。不能因为 residual 较慢而裁 Possibility，也不能把两者作为可改变语义的 SearchProfile 开关。

### 3.3 Search driver

| candidate | corpus ns/node | conservative ns/node |
|---|---:|---:|
| recursive | 31.00 | 24.70 |
| explicit preallocated stack | **16.29** | **12.61** |

显式栈在两档约快 47%/49%，且 result、visited count、trace hash 相同。正式候选冻结为显式栈；递归实现只保留为开发 oracle。

### 3.4 Trajectory derived work

| candidate | corpus ns/op | conservative ns/op |
|---|---:|---:|
| direct recompute | 88.87 | 65.04 |
| direct-address cache | **70.00** | **28.22** |

直址 cache 在两档分别降低约 21%/57%，语义 checksum 相同。DD3 冻结其接口候选和 miss=recompute 语义；生产 entry count、跨帧失效与字节配额仍由 DD8 决定。

## 4. Terminal 与复合负载

terminal composite 同时覆盖 frame-limit、star/runtime、multi-hit、projectile、bomb 和地形事件：

| profile | median ns/op | median sample | p95 sample |
|---|---:|---:|---:|
| corpus_max_observed | 657.53 | 8.080 ms | 10.143 ms |
| conservative_build | 988.69 | 72.894 ms | 84.137 ms |

这些是 synthetic kernel 的吞吐证据，不是 3 秒整局预算预测。DD8 需要把根解析、真实规则、搜索节点、cache、1.5 秒 fallback 与 minified bundle 合成测量。

## 5. 内存清单

| profile | Match | Persistent | Search w/o world | Cache | Emergency | world delta typed | total w/o world |
|---|---:|---:|---:|---:|---:|---:|---:|
| corpus_max_observed | 7,760 | 80 | 2,256 | 16,384 | 1,464 | 3,108 | 27,944 |
| conservative_build | 18,048 | 192 | 4,592 | 65,536 | 2,928 | 5,764 | 91,296 |

`normalBytesWithoutWorldStorage` 分别为 10,096/22,832。表中没有 RootArena 的独立 prototype 段，根工作量被计入 Match/Persistent/Search synthetic pools；生产 manifest 必须按 schema 分离。所有数字是原型的可行性和量级证据，不是最终生产字节门。

## 6. 决策

1. 多 world：common immutable base + sorted immutable WorldDelta；singleton direct fast path。
2. 热池：TypedArray SoA；packed Array 退出当前 production candidate。
3. support：exact prefix + overflow 时 lossless residual；不允许有损概率裁 possibility。
4. driver：显式预分配栈；递归只作 oracle。
5. branch：generated fixed BranchMark + 分离 Event/TransitionDelta buffers；任何失败 fully undo。
6. cache：直址 trajectory cache 保留候选，miss/recompute 语义冻结，生产配额延后 DD8。

具体规范见 [dd3-frozen-abi.md](dd3-frozen-abi.md)。这些选择分别取代 `DEC-0101`、`DEC-0102` 和 `DEC-0106` 的 DD3 未决部分。

## 7. 限制与后续门

- synthetic rules 不能校准技能、碰撞、bomb 或 terminal 平台细节；这些属于 DD4。
- conservative build 是显式配置，不是平台最大地图/实体/support；平台上限与总 bundle 字节门属于 DD8。
- 本地 Node 赢家必须在平台 source/minified 环境复核；反转需新 ABI revision 和全量差分。
- prototype 不包含完整 Reference/Fast/Proof/Risk/策略，因此其 ns/op 不能外推整局深度。
- cache 只证明该 workload 有净收益，没有冻结跨帧 cache inventory。

## 8. 可复现命令

```text
node prototypes/dd3/architecture-prototype.js --profile corpus_max_observed --samples 11 --warmup 3
node prototypes/dd3/architecture-prototype.js --profile conservative_build --samples 11 --warmup 3
```

报告 fingerprints：corpus `8726ea5d`，conservative `db1c6470`。任何原型、profile、runtime 或 benchmark method 变化都必须生成新 fingerprint，不得覆盖本报告数字。
