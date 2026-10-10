# BP133：联合移动规则的证据等级与未决边界

BP133没有改FastKernel，而是在BP132的35个`GO/GO`失败根上补充起点、预备目标格、vacating mask和
双方效果位。遥测只存在于诊断TypedArray；固定16场景的动作、胜负、星、crash和资源均保持不变，
production root SHA-256仍是
`0a8f09c3bf54e7ecd708346b08ff1133a716aa62634484b10e549968a0cbc23e`。

## 35个根的实际结构

| 几何类型 | 根数 | 历史胜负关系 | 历史Pareto关系 |
|---|---:|---|---|
| 普通双方争同一目标格 | 26 | 相同23、原动作好2、候选好1 | 相同17、原动作支配5、混合1、候选支配3 |
| stun影响、仅一方可严格预备目标 | 9 | 相同8、候选好1 | 相同4、原动作支配1、混合3、候选支配1 |

9个部分预备根全部是stun：7次在seat0、2次在seat1；没有terrain、poison或boost伪装。35根全部位于
ply 2，没有direct swap，也没有已经由官方证据闭合的vacated-follow。历史结果仍然双向，因此不能把
未知规则分支统一写成候选优势或劣势。

## 四种证据不能混用

| 规则 | 证据等级 | 当前结论 |
|---|---|---|
| 静止坦克占位 | 官方定向probe，22次 | `GO`无效果阻挡，production已支持 |
| 同record跟随对方离开的起点 | 官方历史replay，31次；seat0 17、seat1 14 | 双座位都允许，production已支持 |
| 同目标 | 官方未观察到可判定样本 | 平台规则未决，production fail-closed |
| direct swap | 官方未观察到可判定样本 | 平台规则未决，production fail-closed |
| stun影响的移动竞争 | 官方未观察到可判定样本 | 平台规则未决，production fail-closed |

固定模拟器commit `1ef804eb2c187138c4c8e5229fb37cd0126beddf`会先执行seat0、再执行seat1，并按当前
占位阻挡。因此同目标表现为seat0占格、seat1阻挡，swap表现为双方阻挡。这只是一个有限规则世界，不是
官方平台真值。更重要的是，模拟器的固定顺序不能直接解释官方已经证明的“双座位都能跟随已离开起点”，
所以不能整体复制其移动实现。

## 决策

BP133接受的是“证据所有权已经分类”，不是“未决规则已经猜中”。production继续对同目标、swap和
stun竞争fail-closed；也不继续增加Minimax深度、宽度或预算。下一步BP134只在显式有限规则世界中
重算这35个根，并仅消费跨规则世界共同成立的区间结论。若规则世界之间改变关系，结果必须保持UNKNOWN。

机器证据见
`config/engine-v3/base-policy-kernel-bp133-joint-movement-oracle-evidence.json`。
