# BP174–BP177：候选体积归因与BP68闭合编译

## 结论

平台体积阻塞的根因是双决策栈，不是Minimax深度，也不是Terser没有正常工作。旧
`ProductionRootEngine`先完成整套V2决策，新`NativeBasePolicyRoot`再覆盖最终动作；把两者一同打包必然
超限。正确的production形态应为：

```text
精确Observation/实体生命周期
→ 薄候选投影与Hard/Risk
→ 闭合BP68 Minimax
→ 薄fallback/final emit
```

## BP174：独立候选构建

`native-base-policy-entry.js`显式构造双栈候选。source、保守压缩和安全mangle的32回调动作指纹完全
一致，重复构建SHA一致；但安全mangle仍有684,158字节，超过204,800字节上限479,358字节。
默认入口包含73个模块，新入口80个模块；BasePolicy隔离闭包为22模块、174,983字节。结论是移除旧
决策栈，而不是继续给双栈调压缩参数。

## BP175：精确Observation切片

生成器从当前接受的`production-root.js`机械提取实体追踪和Observation适配器，并绑定源文件SHA。
12帧差分UT覆盖普通观察、跨帧状态、实体数组、support状态、地图/状态哈希和根状态，差异为0。

fixed16的V8覆盖在保持动作指纹不变的情况下显示ProductionRoot 125个函数中105个被调用。旧Pipeline
不是大块死代码，因此“只删未覆盖方法”不能形成上传架构。

## BP176：删除纯诊断负担

`generate-compact-base-policy.js`只删除不被决策读取的计数、累计量和summary。它不更改动作域、搜索
深度、节点预算、terminal、leaf、path或Risk语义。compact root与接受root在fixed16和Discovery64的
动作、参数、result、帧数、物理计数、分析胜负和终局类别全部零差异。

## BP177：固定profile的编译期特化

`generate-specialized-base-policy.js`把`NativeBasePolicyRoot`已经固定的配置字段替换成编译期常量，
再让Terser删除不可到达分支。主要固定事实包括depth 3、budget 128、V1-state深度调度、V1-shaped
动作域、V1-exact对手模型、joint Risk、两项星图cache及geometry table。闭合构造根只传递实际对象
依赖，不再保留通用配置解析。

等价验收：

| Cohort | 结果 | 动作指纹 | 语义差异 |
|---|---:|---|---:|
| fixed16 / 32局 | 21/11/0 | `e40ea471...574e998` | 0 |
| Discovery64 / 128局 | 67/48/13 | `d6db15f8...f1162555` | 0 |

尺寸矩阵（Terser 5.43.1、passes=5、仅标识符mangle）：

| 闭包 | 字节 | 距平台上限 |
|---|---:|---:|
| compact BasePolicy | 160,777 | +44,023 |
| specialized BasePolicy | 145,694 | +59,106 |
| compact + Observation | 188,923 | +15,877 |
| specialized + Observation | 173,840 | +30,960 |
| specialized + Observation + Risk/Safety | 199,115 | +5,685 |

完整Minimax测试251/251通过。上述最后一行只是依赖闭包尺寸，不是可运行候选；下一步薄根必须在
不重复world/search状态的前提下完成候选、Hard/Risk和emit。若实际根超过剩余空间，应继续特化
Risk/Safety或移除其纯报表字段，不得降低已接受的Minimax深度来换体积。

## 可重复命令

```bash
./tools/generate-specialized-base-policy.sh
./tools/base-policy-footprint-audit.sh
node --test test/minimax-core/*.test.js
```

机器证据：`config/engine-v3/base-policy-kernel-bp177-footprint-evidence.json`。
