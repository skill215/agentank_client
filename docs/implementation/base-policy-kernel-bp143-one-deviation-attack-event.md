# BP143：单次偏离可以改善位置，但不能把现有candidate变成攻击

## 证明边界

BP142的8个candidate证书由反击安全、机动、距离和资源决定，没有攻击维度。BP143不再比较位置值，
而是对两个严格事件做AND/OR证明：

- `SAFE_THREAT_FIRE`：产生新弹丸，我方不处于已证明必死反击，弹丸至少形成可结算威胁；
- `DOOMED_TARGET_FIRE`：上述条件成立且目标已进入无逃生弹道。

每条世界线仍最多一次响应偏离，敌方动作、Chance和三种规则世界完整。时域结束而未发生事件返回
`UNKNOWN`。正证明会导出固定容量的`semantic state + depth + deviation privilege → action`表；三个规则
世界中相同语义状态动作冲突时，策略不可执行。

## 8个位置证书

depth4无证明后扩大到引擎上限depth6。96个side/goal/world搜索全部支持完整，预算、TT、Fast、Hard、
restore和热分配失败均为0。candidate观察到105次FIRE，但安全威胁和必杀均为0；两个目标都是8/8
`NEITHER_PROVEN`。因此这8个位置证书正式拒绝作为攻击入口。

## 全35根扫描

为了避免BP142位置过滤漏掉攻击根，又对全部35个精确根运行depth6：

| 目标 | 结果 |
|---|---:|
| `SAFE_THREAT_FIRE/NEITHER_PROVEN` | 35 |
| `DOOMED_TARGET_FIRE/NEITHER_PROVEN` | 35 |
| candidate可执行攻击策略 | 0 |

candidate分支执行366次FIRE，但威胁与必杀仍为0。incumbent分支在safe目标搜索中出现438次FIRE、48次
威胁和36次必杀，在doomed目标搜索中出现408次FIRE、24次威胁和18次必杀；它们只存在于部分敌方
响应，未覆盖AND量词，因此同样不能成为强制攻击证明。

全量420个搜索只使用40,644节点，单搜索最大516；没有性能、预算或支持问题。失败属于candidate来源，
不是Minimax能力不足。现有35根来自联合移动/位置标量方向，本来就不是代表性的攻击机会集合。

## 决策

保留严格事件证明和可执行策略导出机制，拒绝全部现有candidate取得攻击所有权。下一步BP144从真实对战
重新建立攻击机会根：V1实际FIRE→命中/击毁、V2可见接触却未开火、以及双方首次动作分歧。根动作将
由攻击事件证明直接生成，不再继承位置scalar产生的候选。

production行为未改变，SHA-256仍为
`0a8f09c3bf54e7ecd708346b08ff1133a716aa62634484b10e549968a0cbc23e`。机器证据见
`config/engine-v3/base-policy-kernel-bp143-one-deviation-attack-event-evidence.json`。
