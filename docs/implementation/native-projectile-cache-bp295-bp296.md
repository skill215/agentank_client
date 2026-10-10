# BP295–BP296：弹丸威胁特征缓存——性能拒绝

## 结论

语义验证通过，但性能失败，默认关闭，不进入production。重复计算存在不代表缓存一定更快。

## 实现边界

仅缓存`projectileThreat(state, owner)`，不缓存leaf总值、路径收益或Minimax备份值。64个固定槽，根内生命周期，跨加深层复用。
状态hash仅选槽；命中必须逐项比对地图尺寸、owner、frame、双方cell/direction/boostUntil、弹丸active/owner/cell/direction和完整地形，避免hash碰撞或地形变化造成错误命中。
19×15地图固定数组内存29480字节。生产源码和上传体积未变化，开发原型额外内存不能视为已满足生产内存门。

## 语义证据

BP295：沿用18个胜/平/负分层诊断根，54次运行；缓存每次命中仍调用原函数验证返回值，零差异。
正序18根共57340次特征调用，21754次命中，命中率37.94%。

BP296：相同54次运行，命中时实际跳过原函数。相对BP292，无缓存与缓存的提交行值、动作、工作量、完成深度和续局结果逐项一致，漂移0。物理状态/hash恢复验证仍通过。

新增2项UT覆盖强制hash碰撞、所有依赖字段修改、地形、frame、owner和尺寸；与路径依赖及完整层测试一起，三个测试文件全部通过。

## 微基准

Node v24.16.0，每项预热3000次，5批、每批20000次。固定状态反复调用，是接近全命中的有利场景，不是完整引擎或平台毫秒。

| 局面 | 缓存/原计算，五批中位数耗时比 |
| --- | ---: |
| 无弹丸 | 22.25倍 |
| 单颗相关弹丸 | 6.89倍 |

完整依赖键构造和地形比对远比原函数扫8个弹丸槽昂贵。真实约38%命中率没有理由推翻该负向证据；不再为这条缓存路线做全量对战。
这是批次中位数，不是P95延迟资格报告。微基准未控制操作系统噪声或配对交错顺序，数值不应当作跨环境绝对倍数；大幅负收益足以否决当前原型。

## 下一步

1. 关闭这条轻量特征缓存路线，不继续微调缓存槽数。
2. 优先调查更重的、可复用结果占比高的计算，以及可靠的地形身份/变更机制；不得仅省略精确比对换取假快。
3. 物理转换缓存若要继续，先解决delta/events回放与generation、规则选项、完整身份合同，再测查找开销和实际收益。
4. 原胜局退化的估值问题独立推进，缓存语义中性不应改变胜负。

工具：
- `tools/agentank/diagnostics/projectile-feature-cache.js`（实验，默认不接线）
- `tools/agentank/diagnostics/projectile-feature-cache-benchmark.js`
- `native-complete-layer-poc.js --verify-projectile-cache` / `--projectile-cache`

证据：
- `artifacts/native-causal-audit/bp295-projectile-cache-verify.json`
- `artifacts/native-causal-audit/bp295-projectile-cache-benchmark.json`
- `artifacts/native-causal-audit/bp296-projectile-cache-active.json`

未执行官方simulate、publish或challenge。
