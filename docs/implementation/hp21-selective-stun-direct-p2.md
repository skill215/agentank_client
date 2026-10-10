# HP21：选择性stun Direct-P2

## 问题

HP19把12个stun根归类为旧调度阻断，但直接对所有stun根启用full-width P1/P2并不高效。
固定真实场景中它能增加精确P2 owner；专用五批反例中，90节点的根矩阵却80次都不能增深，
每次平均多消耗118个搜索节点。

因此HP21不按“是否stun”一刀切，而是在搜索前用已有`rootMatrixNodeCount`计算本帧
ChanceOutcome根矩阵规模。只有规模不超过48节点才进入Direct-P2；更宽的根继续走旧迭代路径。
这个门只读取物理分支数，不读取评分、动作结果或胜负。

## Discovery与独立验证

固定16场景中，11个小stun根进入Direct调度，9个完成P2，精确owner深度从
`P1=19/P2=47`变为`P1=14/P2=52`，净增5个P2 owner。Physical节点增加1,875，整局
work增加28,136（0.64%）；32局动作和结果零差异。

独立32场景中，30个小stun根进入，22个完成P2，精确owner深度从
`P1=32/P2=112`变为`P1=28/P2=116`，净增4个P2 owner。Physical节点只增加776，整局
work增加7,342（0.081%）；64局动作和结果同样零差异。

## 宽根性能护栏

专用benchmark固定16个双方stun、root matrix=90的根，预热1批后交替profile顺序测5批，
每个profile共80次cold/warm调用。选择性调度全部保持legacy路径：节点差0、owner深度差0、
动作行差0，root restore和热分配均为0。它避免了未设规模门时平均每次多118节点而没有增深的退化。

## 决策

- production默认启用`root Chance matrix nodes <= 48`的stun Direct-P2；
- 保留显式legacy、无上限Direct和选择性Direct诊断profile；
- ChanceOutcome仍完整枚举normal/reversed支持，robust backup和所有权合同未变化；
- HP21只优化深度覆盖，不用胜率调阈值。

24-profile标定已冻结为`config/engine-v2/minimax-depth-baselines/after-hp21.json`，source
fingerprint为`0ca00e2d0abe38d4cd6fed4f0f54b45316d62d4aa0dca4aac369eeaf68f68a68`。
机器证据见`config/engine-v2/hp21-selective-stun-direct-p2-evidence.json`。

## 验证

- Minimax：152/152；
- Diagnostics：108/108；
- GR0：286/286；
- IMP5：14/14；
- 24-profile calibration：PASS，全部restore/cache/allocation不变量为0。
