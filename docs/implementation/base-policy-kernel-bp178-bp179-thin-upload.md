# BP178–BP179：薄NativeBasePolicy上传根与真实对局资格

## 结论

BP178完成了不依赖旧`ProductionRootEngine`的`NativeBasePolicyEngine`。BP179进一步证明它不是只在模块
测试中成立的体积样品：开发模块、bundle source和最终minified字节在同一64场景、双座位的128局中
逐帧语义完全一致。因此后续V2算法开发以这套薄根为工作基线；旧双栈只保留为历史回归参考。

这不改变当前默认production入口，也不授权官方simulate、publish或challenge。

## 运行结构

```text
ProductionObservation / entity lifecycle
→ primitive action projection
→ FinalActionGate / Hard
→ InformationSafety + MultiFrameRisk
→ committed EscapeObligation
→ Risk acceptable/Pareto
→ thin strategic incumbent
→ closed depth-3 BasePolicy Minimax
→ final Hard gate / emit
```

该结构只拥有一份FastState、一份观察/实体生命周期和一个搜索根，不再先运行旧V2完整决策栈再让
BasePolicy覆盖动作。固定profile仍为depth 3、node budget 128，没有通过降深度换体积。

## 构建结果

- bundle source：557,251字节，SHA-256 `4a1e261e...ff99`；
- minified：180,466字节，SHA-256 `3b96f0bf...6503`；
- 平台限制：204,800字节，余量24,334字节；
- 两次独立构建SHA完全一致；
- 32回调构建fixture的source/minified动作指纹一致。

## BP179真实对局差分

资格工具运行三种执行形态：直接模块、bundle source VM、minified VM。每种均运行Discovery64的双座位
128局，总计384次物理对局。三者结果完全相同：

| 指标 | 结果 |
|---|---:|
| V2胜 / V1胜 / 平 | 71 / 45 / 12 |
| runtime-independent得分 | 60.15% |
| 单方击毁胜 / 负 | 51 / 31 |
| 星差 | -11 |
| timeout / error | 0 / 0 |
| root restore / 热分配 | 0 / 0 |

动作流、teleport参数、帧数、终局reason、星/击毁、分析胜负和终局分类的差异全部为0；三条路径的
语义指纹同为`c9e3caac...22d0d8`。固定16子集为20胜、9负、3平，得分67.18%。

有10个direct/source和1个source/minified的原始winner字段不同；它们全部是128帧同星、动作和物理
轨迹相同的本地耗时裁决。按照既有分析合同，这些局均为`DRAW`，原始runtime winner只记录，不参与
资格。资格工具为此显式保留`runtimeWinnerMetadata`计数，仍要求terminal reason和所有物理字段一致。

完整Minimax结构与理论测试265/265通过。

## 可重复命令

```bash
npm run test:minimax-core
npm run qualify:native-upload -- \
  --role DISCOVERY --limit 64 \
  --output /tmp/agentank-native-base-policy-upload-qualification
```

`--reuse-arenas true`只在角色、分母、源码闭包SHA或候选代码SHA完全一致时复用已有对局；任何引擎
变化都会自动使缓存失效。

## 下一步边界

从BP180开始只在薄根上研究决策质量。优先用独立角色切片验证当前60.15%是否外推，并对71胜/45负的
第一分歧与攻击/死亡漏斗做归因；不再把BasePolicy作为旧根的可选覆盖器，也不因局部结果重新引入双栈。

机器证据：`config/engine-v3/base-policy-kernel-bp179-upload-qualification.json`。
