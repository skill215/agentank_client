# HP9 Runtime Work标定与本地资格

状态：`PASS_LOCAL`。这不是平台3000ms资格，也没有运行V1/V2胜率arena。

## 目标与边界

HP9只解决一个问题：让RuntimeController中的work单位与实际热点成本同量级，使Minimax在相同本地
耗时内尽可能晚fallback、完成更多迭代。胜率、击毁和FIRE数量只记录，不作为性能门；它们属于HP10。

本阶段没有改变Hard、Proof、Risk阈值、搜索深度数组、领先保护、技能语义或战略profile。

## 实现

- DiagnosticBot增加十类work ledger和固定栈inclusive/exclusive阶段计时；默认关闭，不进入上传逻辑。
- 新增`runtime-work-calibration`五批标定脚本和`runtime-work-qualification`资格脚本。
- Work charge改为`[368,3,199,6,6,2,1,24,10,5000]`。
- Root Hard按真实apply、classify/cache、ReverseViability build收费，不再按候选数粗收Hard全价。
- Physical/Information搜索同时计Value loop、Fast apply、Hard cache/build；TT replay只收cache。
- StageMatrix先按剩余work限制iteration，再按solver实际iteration收费。
- Direct-fire trap probe若被work budget截断，当前迭代返回不完整并保留上一完整深度。
- IMP6 emergency reserve probe改为按当前Value charge计算，不依赖旧常量。

## 证据

五批标定输入包含80局、8,170 callback、110,060 search nodes、58,385 lattice hits和11,305 misses。
固定128帧ROOT+EMITTER为48,384 work，低于120,000 degraded门。

同一8场景、16局旧/新因果对照：

| 指标 | 旧计费 | HP9 | 变化 |
|---|---:|---:|---:|
| 搜索帧 | 160 | 655 | +309.4% |
| 搜索节点 | 22,012 | 105,131 | +377.6% |
| fallback中位帧 | 15 | 41 | +26帧 |
| emergency中位帧 | 30 | 92 | +62帧 |
| 本地总耗时 | 1,541,104us | 1,473,001us | -4.42% |
| 最大局P95 | 5,239us | 5,418us | +3.42% |
| 完整迭代率 | 100% | 100% | 持平 |

独立32场景、64局验证：6,182 callback中2,494帧运行搜索，产生417,747节点；完整迭代率100%，
fallback/emergency中位帧38/90。avoidable Hard、Risk支配选择、root restore和hot allocation均为0。

报告：

```text
artifacts/benchmarks/runtime-work-calibration/hp9-local.json
artifacts/benchmarks/runtime-work-calibration/hp9-qualification.json
artifacts/benchmarks/minimax-depth-calibration/hp9-runtime-work.json
config/engine-v2/minimax-depth-baselines/after-hp9.json
```

## 验证结果

- Minimax core：134/134；
- diagnostics：68/68；
- GR0：268/268；
- IMP5：14/14；
- SR2/SR3：93/93；
- IMP6：16/16；
- 标准Minimax深度profile：24个profile、每profile 80次，全部restore/cache/hot-allocation不变量为0。

IMP6构建的source/minified为631,179/609,201字节，TypedArray为889,188字节。体积门仍失败，这是
独立发布阻塞，不通过放宽约束解决。平台runtime比例未标定，`PLATFORM_RUNTIME_SCALE_PENDING`保留。

## 下一阶段

HP10冻结HP9的cache、work accounting、node/depth profile。在固定性能版本上分别验证叶值、
Information量词、risk backup、StageMatrix证据和最终动作所有权；此时才用胜率与击毁转化判断改进。
