# BP173：默认关闭的ProductionRoot BasePolicy接点

## 目的

BP172只在诊断arena外部覆盖最终动作，无法证明真实`ProductionRootEngine`内的生命周期、Plan提交与
资源所有权正确。BP173把同一个`NativeBasePolicyRoot`作为显式依赖注入真实生产根，但保持默认关闭，
先验证接线语义，不改变参数、Risk、depth或上传入口。

## 接点合同

顺序固定为：

```text
原ProductionRoot选择
→ runtime.finishCallback
→ 可选NativeBasePolicyRoot
→ emit
→ 只提交真实所有者的principal/Plan
```

- 默认`nativeBasePolicyRoot=null`；源码不静态引用或构造BasePolicy组件图；
- 覆盖动作后重置旧DepthSearch principal，不提交旧动作Plan；
- 非poison自身技能由Resource Controller拥有，BasePolicy不观察该帧；
- poison继续留在BP68正常动作域；
- 不增加第二份FastState、世界状态或每帧对象。

## 被拒绝的直接接线

最初版本在每个已选动作后都调用BasePolicy，固定16从21/11/0降到17/15/0，25/32局动作流变化，候选
指纹变为`cc2e22f6...5906047`。首个分歧是frame 1发射STUN，frame 2由TURN_LEFT变成TURN_RIGHT。

这不是Minimax估值错误，而是隐藏的阶段合同：旧宿主在非poison技能帧先emit，根本不进入外部
BasePolicy回调。内部接点却推进了Intent、OpponentHistory和superko，使下一帧历史错位。显式资源
owner gate恢复了原合同。

## 验证

固定16三方比较：

- BP170接受基线；
- 当前默认关闭ProductionRoot；
- 当前注入启用ProductionRoot。

三者32局候选指纹均为`e40ea471...574e998`，动作、参数、result、帧数、物理计数、分析胜负和终局
类别全部零差异，结果均为21/11/0。

Discovery64再比较BP172外部root和BP173内部接点：128局候选指纹均为
`d6db15f8...f1162555`，所有语义字段零差异，结果均为67/48/13、57.42%。Hard、restore、
timeout/error及joint dominated selection为0。完整Minimax测试247/247。

## 边界

- production源码哈希变化为`3381b6f9...54017f8`，但默认动作语义不变；
- 当前上传入口不会携带或启用BasePolicy组件图；
- 跨进程arena耗时只作信息，不替代BP171同进程标定或平台3000ms证据；
- 后续BP174–BP177已经证明双栈候选超限，并完成精确Observation提取与BP68闭合特化；下一步改为构造
  不含旧ProductionRoot决策链的薄原生根。

机器证据：`config/engine-v3/base-policy-kernel-bp173-production-hook-evidence.json`。
