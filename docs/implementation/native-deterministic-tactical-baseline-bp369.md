# BP369 — 确定性战术基线

## 结果

协议 `V1_CONSTANT_CLOCK_PROGRESS_FALLBACK_V1` 验证通过。

- 17 场景：BP365/366 的16场景，加 BP367 漂移场景；双方换位、重复2次，共68局。
- 34个唯一局面/座位组合：24胜9负1平；第二遍结果完全一致。两遍不是68个独立统计样本。
- 双方完整动作流、动作参数、事件计数和分析胜负：重复差异0。
- 5,918次V1回调检查：累计测试耗时0，原有进度回退与64/100/112阈值一致。
- errors/timeouts/root restore failure：0。
- UT：434/434。

本轮证书关闭。分数不是证书收益，也不能直接与旧34局以外的分母比较。

## 协议

`deterministic-v1-clock.js` 仅在V1诊断VM每次回调期间提供 `Date.now()=100000`。开始/结束相减为0；不改V1源码、累积计时变量、动作、进度计数或搜索参数。回调结束或抛错都恢复原Date属性；宿主真实Date和运行耗时测量不变。

每帧直接核对原V1状态和函数：

- `AT_ACCUMULATED_RUNTIME_MS === 0`；
- `AT_MC_DISABLED_BY_RUNTIME === (AT_MATCH_PROGRESS >= 64)`；
- `minimaxRuntimeReductionActive() === (AT_MATCH_PROGRESS >= 100)`；
- `minimaxRuntimeEmergencyActive() === (AT_MATCH_PROGRESS >= 112)`。

这保留按进度回退，但禁用了依赖运行机器速度的时间回退。因此它是**新的战术实验对手条件**，不是官方耗时仿真，也不冒充BP349历史运行。

真实性能仍由宿主单调时钟测量，不以合成时间报告性能。后续OFF与ACTIVE必须使用同一时钟协议。若研究其他V1计算预算，应另列预注册profile，不能把有利profile的结果合并成默认胜率。

## 冻结与复现

新增入口：

```sh
node tools/agentank/diagnostics/deterministic-tactical-baseline.js <不存在的新目录>
```

输出目录：`artifacts/native-causal-audit/bp369-deterministic-tactical-baseline/`。

manifest记录：协议、Node版本、V1精确源码hash、V2 production tree、候选导航依赖、V1宿主/控制器、场景指纹、星序列加载器、seed函数、模拟器engine/constants/map哈希、重复次数。结果使用紧凑gzip，无逐帧大replay。异常时调用BP368失败留存器保留已完成记录和失败局。

production tree仍为 `285f9863227d6af3638bed74e008f0260fd25440034d95eec5e3f8cac44d9120`。没有改变production或冻结V1字节，没有官方simulate/publish/challenge。

## 下一步

以本协议恢复BP367已冻结64场景的OFF/ACTIVE配对。OFF重新现场生成，ACTIVE只与同协议OFF比较；旧BP349结果仅作旁列参考，不再要求不同计时条件的动作相同。检查证书覆盖必须实际当帧获胜终局，保留全部输赢转移和真实耗时。未完成该配对前不宣称扩大验证通过。
