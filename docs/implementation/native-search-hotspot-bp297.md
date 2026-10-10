# BP297：搜索耗时归因（生产不变）

## 方法与证据

复用 BP292 的 18 个根（原胜/平/负各 6；来自分歧根池，不代表全局随机样本），运行 CURRENT、LAYERED、LAYERED_REVERSE，共 54 次。嵌套计时使用 self time，子调用不会重复加到父调用。包装器只用于诊断，含计时/调用开销，不是平台 3000ms 标定，也不是优化后的 benchmark。

结果：`artifacts/native-causal-audit/bp297-phase-profile.json`。对 BP292 逐项校验 id、seat、frame、mode、apply 次数、完成深度、选择动作、行评分、最终胜负、restore failures：全部一致。Production tree SHA 仍为 `4a5056ae736d5d4cc1bd3f397837c4cc2660ba516dc6e580e17760c2fbbdadba`。

| 独占阶段占已测阶段比例 | CURRENT | 完整层正序 | 完整层逆序 |
| --- | ---: | ---: | ---: |
| ReverseViability（不含 rebuild） | 78.19% | 82.01% | 83.54% |
| 物理推进 | 8.93% | 7.51% | 6.59% |
| 叶估值（不含弹丸/炸弹子特征） | 6.28% | 5.74% | 4.66% |
| 弹丸特征 | 0.76% | 0.45% | 0.44% |

CURRENT：3,319 次 apply，677 次 reverseViable。完整层正序：31,675 次 apply，8,315 次 reverseViable。这里仅完成一批诊断；不能把这些时间当成预热五批 P95，也不能据此声称已经加速。

## 下一优先级

不要继续缓存 projectileThreat。首要候选是 committed 可活度倒推的规模与复用。

源码核查：专用搜索已启用 16 项完整状态 reverse cache，但 `reverseLatticeCacheEntries=0`。现有 reverseViable 未命中后会遍历 horizon × 全地图 × 四朝向，即使只问根 pose 的可活性。

下一步先统计 exact cache 命中/冲突、格架构建节点及危险支持签名复用；对已有 lattice cache 做诊断 A/B，并审计签名是否包含全部依赖，不能仅因为已有实现就默认安全。若复用不足，再比较只覆盖可达 pose 的求解方式；必须保留完整 hazard deadline、UNKNOWN、盾/特殊逃生和窄证明边界。不缩短危险视野、不降低 Hard 证明标准。

性能与胜率分开：估值导致的两个旧胜局退化仍未修复；更快/更深不等于更强，不因热点定位而改战略分数。

## 重跑

```sh
node tools/agentank/diagnostics/native-complete-layer-poc.js artifacts/native-causal-audit/bp280-root-oracle36.json artifacts/native-causal-audit/bp297-phase-profile.json --work-budget 4096 --max-depth 3 --sample-per-outcome 6 --profile-phases
node tools/agentank/diagnostics/search-phase-profile-report.js artifacts/native-causal-audit/bp297-phase-profile.json artifacts/native-causal-audit/bp292-balanced-depth3-calibration.json
node --test test/minimax-core/search-phase-profiler.test.js test/minimax-core/complete-layer-scheduler.test.js test/minimax-core/projectile-feature-cache.test.js
```

报告工具发现任意语义漂移会失败。Profiler UT 覆盖嵌套独占计时、receiver/返回值、异常传播和原方法恢复。没有修改 production，没有官方平台写操作。
