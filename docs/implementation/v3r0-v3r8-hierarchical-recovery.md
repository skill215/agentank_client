# V3R0–V3R8 实验结果（V2恢复结论已撤销）

> 状态：`RETRACTED_AS_V2_RECOVERY / EVIDENCE_RETAINED`
>
> 2026-07-31 修正：`NATIVE_REPAIRED` 实际是冻结 V1 的无 VM、模块化 V3
> controller，不是真实 V2 ProductionRoot。它与 V1 对战得到 50% 是基准等价结果，
> 不能证明 V2 恢复。以下数据继续保留用于组件因果分析，但“V2恢复到50%”的结论撤销。

## 结论

本轮证明了 V3 无 VM 实现仍与 V1 等价，但**没有达到真实 V2 恢复到 V1 水平的目标**，
也没有证明任何新的 V2 行为所有者优于 V1。

在首次读取的 Final Recovery 256 场景、双换位 512 局中：

| 实现 | V2胜 | V1胜 | 平 | 分析得分 | 星 | 被击毁/碰撞 | FIRE |
|---|---:|---:|---:|---:|---:|---:|---:|
| 冻结 CURRENT_V2 | 33 | 476 | 3 | 6.74% | 149:600 | 460:61 | 1,219:1,725 |
| V3_NATIVE_BASELINE（旧标签 NATIVE_REPAIRED） | 232 | 232 | 48 | **50.00%** | 322:322 | 202:202 | 2,892:2,893 |

表中的 **+43.26 个百分点不能归因于 V2 修改**：它来自用 V3/V1-compatible controller
替换真实 V2。runtime 胜负没有计入分析结果；两种实现的本地 timeout/error 都为 0。

真实有效的结论是：完整 V2 TacticalCore、早期 EO、Combat 和 Strategy 作为 V3 端口所有者时
分别表现为负向或中性。下一轮必须把这些 V2 组件逐个替换进 `V3_BASE`，与未替换的
`V3_BASE` 对战；通过后再原生回迁 V2。

## 最终所有权

```text
V1-compatible native control flow
→ ProposalBus（组件只能 PROPOSED）
→ Physical Hard
→ committed rescue
→ strict ForcedWin
→ exact value dominance
→ verified attack
→ strategic progress
→ V1 preferred
→ stable fallback
→ ACTION_EMIT
```

- `NO_PROPOSAL` 与 `INTENTIONAL_WAIT` 已分开；无证书的 NONE 不能被选中。
- InformationSafety、possible projectile、future FIRE 和普通搜索完成状态只提供证据，不能直接
  拥有动作。
- 14 个端口共享一个 210-byte、构造期一次分配的 `ProposalBus`。
- Candidate、projected pose 和 enemy action slabs 直接复用 V2 ProductionRoot 数组。
- 三个内容相同的只读 `RiskProfile` 已合并为一个实例；风险公式和整数权重不变。

## 组件因果结论

| 阶段 | 结论 | 数据 | 评分 | 是否进入 BEST |
|---|---|---|---:|---|
| V3R1 Proposal ownership | FACT_ACCEPTED | VC0 62/62/4，动作等价 | 9/10 | 是 |
| V3R2 Tactical evidence-only | NEUTRAL | exact candidate 62/62/4；exact ownership=0 | 5/10 | 否 |
| V3R2 FULL 负对照 | NEGATIVE | 60/66/2，47.66% | 1/10 | 否 |
| V3R2 minus InformationSafety | NEGATIVE | 53/71/4，42.97% | 0/10 | 否 |
| V3R3 final EO rescue | NEUTRAL | EO Holdout 91/91/10；0 次救援、0 次退化 | 6/10 | 否 |
| V3R4 verified Combat | NEGATIVE | 60/63/5，48.83%，p=0.625，crash +2 | 2/10 | 否 |
| V3R5 non-contact Strategy | NEUTRAL | 62/62/4，0 次有效覆盖 | 4/10 | 否 |
| V3R6 Plan/Persistent/PVA | DEPENDENCY_BLOCKED | R5 没有有效战略提案，未读 Plan Holdout | N/A | 否 |
| V3R7 cumulative BEST | BEST_FROZEN | VC1 observation + VC2 complete Physical Hard | 9/10 | 是 |
| V3R8 native hierarchy | BASELINE_EQUIVALENT | V3/V1 Final Recovery 50.00% | 8/10 | 仅实验宿主 |

动作所有者没有一个达到“Discovery +3pp 后再读 Holdout”的条件，因此 Tactical、Combat、
Strategy、Plan 均未进入组件 BEST。EO 正确但没有产生正转换，保留实现与证据、默认不拥有动作。
组件 BEST 是 V3 实验配置，不是 V2 production。

## 原生根与等价性

`NativeHierarchicalRoot` 在构建时把冻结 V1 转为独立 CommonJS factory；运行时不使用
`node:vm`，不加载或执行源码字符串。每个 controller 拥有独立 V1 状态，并通过 14 个端口接入
V2 FastState observation、Physical Hard、统一仲裁和 ACTION_EMIT。

同一 observation 的逐帧等价结果：

| 集合 | 决策数 | 动作差异 |
|---|---:|---:|
| VC0 64 场景/128 局 | 9,080 | 0 |
| Discovery 64 场景/128 局 | 10,824 | 0 |
| EO Holdout 96 场景/192 局 | 14,577 | 0 |
| Final Recovery 对照 | 512 局 | 0 |

当前原生模块保留 V1 的内部数值计算；它只解决 V3 实验宿主的 VM 和字符串加载问题，
不能作为 V2 production 或 Candidate。V2 后续只能吸收经过因果验证的组件，禁止加载该模块。

## 性能与内存

- 旧 ProductionRoot TypedArray 上限：999,280 bytes。
- 共享 RiskProfile 后 V2 engine：994,432 bytes。
- Native hierarchy（含独立 ProposalBus）：994,642 bytes。
- 余量：4,638 bytes；热路径没有新增对象分配。
- Final Recovery 的 decision-count-weighted per-match P95：17,800µs vs V1 17,377µs，
  比值 **102.43%**，通过 ≤110% 门。
- 非接触 Minimax/StageMatrix 节点：0。

IMP6 的语义、sandbox、cold-init、callback 和 TypedArray 门通过。保留两个已知容量 blocker：

- source 534,367 > local 500,000 bytes；
- minified 515,275 > platform 204,800 bytes。

该实验当时没有以代码体积阻断 V3 基准等价验证，因此没有压缩、没有生成发布 Candidate；
这不构成 V2 恢复或发布资格。

## 测试与证据

最终本地门：

- V3 ownership/native：23/23；
- Minimax core：91/91；
- GR0：208/208；
- IMP5：14/14；
- SR4 combat ownership：20/20；
- IMP6：15/16，唯一失败为上述预先允许的 source-byte gate；source/minified
  semantic mismatch=0，sandbox=PASS。

统一入口：

```bash
./tools/v3-repair-toolchain.sh freeze
./tools/v3-repair-toolchain.sh run --stage V3R8
./tools/v3-repair-toolchain.sh verify --stage V3R8
./tools/v3-repair-toolchain.sh run-all
./tools/v3-repair-toolchain.sh report
```

盲测不会被 `run-all` 重新执行；命令只把已完成且按 SHA-256 绑定的 compact evidence 固化为
阶段验收。最终汇总位于忽略目录
`artifacts/v3-repair/v3r0-v3r8-report.json`，fingerprint 为
`ac30678beaef0fb349072b62a7c77038c2bd08991f1470f7dd65eb547ca54d13`。
其中 `ACCEPTED` 仅表示旧实验流程和 V3 等价门通过，不能再解释为 V2 acceptance。

所有 V3R evidence 约 2.1MiB；单阶段最大约 14KiB，满足每阶段 2MiB、总计 32MiB 限制。
没有执行官方 simulate、publish 或 challenge。
