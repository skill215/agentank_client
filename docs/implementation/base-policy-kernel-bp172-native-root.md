# BP172：无V1 VM的NativeBasePolicyRoot

## 目的

BP165–BP171已经分别验证七个production-shaped组件，但诊断arena仍逐个构造和接线。BP172把已接受
参数固化为一个根入口，避免未来在多个脚本中复制长参数向量，也明确划开算法和报告/oracle边界。

本阶段只改变实验装配方式，不修改`ProductionRootEngine`默认动作语义。

## 组件图

```text
NativeBasePolicyRoot
├─ NativeBasePolicyActionDomain ── owner + deep FIRE domain共享
├─ NativeBasePolicyStrategicIntent
├─ NativeBasePolicyOpponentHistory
├─ NativeBasePolicyLeafEvaluator ─ cache=2 + geometry table
├─ NativeBasePolicyPathUtility ─── 与leaf共享
├─ NativeBasePolicySearch ──────── domain/leaf/path共享
└─ NativeBasePolicyActionOwner ─── 最终消费search/intent/Risk
```

root没有自己的世界状态，也不创建按帧对象。每帧只按BP159/BP160已验证的顺序：更新一次原生对手
历史、把复用的context view绑定给search、调用owner。owner内部第二次observe由frame去重，不会重复
分类。

冻结配置：

- depth schedule `v1-state`，target depth 3，node budget 128；
- root/deep/enemy action domain均为V1-shaped/full primitive合同；
- `v1-deterministic` own chance、V1 stun countdown、V1 entry projectile collision；
- V1 terminal、superko、opponent context与path utility；
- joint Risk、`intent-known` soft band、intent bonus；
- 两项严格星图cache和预计算四邻居/x/y表。

## 等价验证

固定16的assembled和root各产生32个候选局：动作指纹均为
`e40ea471198b7eaea3dbb4b0591f86df973f0b43d49614f44a3e50da0574e998`，所有语义比较字段为0，
结果均为21/11/0。

Discovery64各产生128个候选局：动作指纹均为
`d6db15f8815dc9243ef758778bbeb558b6492f801e73e2fc36e4bd35f1162555`，所有语义比较字段为0，
结果均为67/48/13、57.42%。Hard、restore、timeout/error及joint dominated selection为0。

root自身TypedArray为0，完整共享组件图为81,879字节，没有重复FastState。完整Minimax测试为246/246。
跨进程Discovery耗时不用于root性能判定；BP171同进程交错标定仍是cache/geometry的有效本地证据。

## 边界与下一步

- arena默认仍为`assembled`，只有显式`--bounded-policy-stack-implementation root`才使用新根；
- `ProductionRootEngine`哈希未变，上传bundle和默认策略未改；
- arena的oracle hook改成能力检测，production Intent无需携带空诊断方法；
- 下一步只增加默认关闭的production candidate接点，先证明与BP172逐动作相同，再讨论默认所有权；
- 不在这一步调整depth、fallback、Risk阈值或战略分数。

该默认关闭接点及其资源所有权修复已在BP173完成；见
`docs/implementation/base-policy-kernel-bp173-production-hook.md`。

机器证据：`config/engine-v3/base-policy-kernel-bp172-native-root-evidence.json`。
