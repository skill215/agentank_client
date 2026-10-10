# BP107–BP111：终局监督、Chance量词与所有权边界

## 结论

本轮证明了两个看似矛盾、实际同时成立的事实：

1. V2当前根价值排序存在真实因果缺陷；精确终局第一动作反事实可以在小样本中显著改善整局结果。
2. 单场历史终局不是可直接学习的状态价值。未来出星不可观测，控制器私有历史也不能在物理根随意重置；
   忽略这两点会把hindsight和history-reset误差伪装成强oracle。

因此，终局反事实继续作为离线监督与审计证据，但不得直接拥有primitive动作，也不得先压成一个通用
scalar leaf。下一层结构必须是持久objective及其chance-conditioned interval；Minimax只在objective内部
提供局部敌方响应证据。

所有新增路径均为诊断工具。Production bundle、Hard、Proof、Risk、EO、搜索预算和发布行为没有变化。

## 90-root终局语料

固定16场景、双方换位、每16帧分层抽取一个根，得到90个Physical root、454个候选标签。每个标签先以
V2/V3响应策略运行到终局。根因分布为：

- 32个无搜索value inversion；
- 31个continuation policy gap；
- 14个Risk移除；
- 7个candidate coverage gap；
- 只有4个根没有regret。

86/90个根根本没有运行Minimax；因此这批失败不能归咎为“Minimax不够深”。在32个
`STRATEGIC_NAVIGATION`根中，当前动作32/32全为`poison`，而历史单路径终局oracle分散为GO 8、TURN 10、
FIRE 5、BOMB 3、poison 6。简单禁用poison此前已被整局实验否决；真正缺失的是资源动作之后可持续的
objective和continuation。

## 整数线性bootstrap被拒绝

离线ranker使用固定整数特征、场景级四折交叉验证、零动作行号特征。随后增加了预注册的粗动作语义
`GO/TURN/FIRE/RESOURCE`与`far/contact/star-behind/terminal`交互，共54维。

| 终局目标 | 90-root CV变化 | 改善/退化 | 判定 |
|---|---:|---:|---|
| robust-lex | -0.28pp | 16/11 | REJECTED |
| epsilon-1 | -1.67pp | 14/15 | REJECTED |
| 已知V3响应列 | +1.11pp | 14/10 | REJECTED |

训练内拟合最高达到+8.34pp，但场景CV不能复现。继续增加线性权重或动作特例只会扩大过拟合面。

## 未来出星hindsight

旧response matrix明确复用了每场历史的未来`scenario.stars`。Bot在根节点看不到该序列。新增量词后，
同一Physical root分别运行`HISTORICAL/RANDOM0/RANDOM1/RANDOM2`：

- 44个根中，11个历史单路径oracle动作被多未来robust oracle推翻；
- 220个候选中，70个候选的终局胜负随未来出星改变；
- 历史单路径robust oracle在前8场景曾提升21.88pp；加入ChanceOutcome后，同一批只提升6.25pp。

这证明旧oracle的大部分表观强度来自不可观测未来，而不是可部署的状态价值。

## EnemyPolicy与ChanceOutcome分离

标签工具现可独立指定：

```text
OwnPolicy × EnemyPolicy × ChanceOutcome
```

固定为`Own=V2`、`Enemy={V2,V3}`、四个ChanceOutcome后，两个8场景批次合计32局：

- CURRENT：4胜27负1平，14.06%；
- oracle intervention：5胜25负2平，18.75%，净+4.69pp；
- 转换：2个败→胜、2个败→平、1个胜→败、1个平→败；
- candidate crash由11增至13，FIRE由152降至124；
- Hard、dominated selection、root restore、timeout/error均为0。

它有因果杠杆，但存在明确负转换，不能取得动作所有权。

## Exact controller history

reset-suffix会在物理根重建V2/V3私有历史。新增`EXACT_REPLAY + exact-history-chance-matrix`：从第0帧重放，
在相同FastState hash强制第一动作，只在根之后替换未来出星。

- Discovery 400/400 matrix cell命中根、强制成功且序列满足，8局得到1个败→胜、0退化；
- 独立批480/480 cell同样完整，但8局得到1个败→平和1个胜→败，净-6.25pp；
- 两批合并仅+3.13pp，仍不具备所有权充分性。

控制器历史是必要状态，但补齐它仍不能把四个未来样本升级为确定动作证书。

## 真正的Chance holdout

用`HISTORICAL+R0–R2`选择动作，只在完全未参与选择的`R3–R6`上评价：

| 选择层级 | Score变化 | Robust变化 | 改善/退化 | 判定 |
|---|---:|---:|---:|---|
| primitive row | +1.42pp | 0 | 11/13 | REJECTED |
| option kind，类内由当前V2值选primitive | -1.70pp | 0 | 8/10 | REJECTED |

所以问题既不是“再加几个leaf feature”，也不是“把primitive换成ATTACK/POSITION/ZONE类别”即可解决。
必须保存跨帧目标身份、完成条件、事件deadline和可观察进度，并对整个option的响应集合与ChanceOutcome
返回区间值。

## 保留与拒绝

保留：

- `OwnPolicy/EnemyPolicy/ChanceOutcome`三量词标签接口；
- exact-controller-history Chance matrix；
- 整数离线ranker、终局oracle intervention，作为审计和反例工具；
- BasePolicy深层压缩，作为Minimax性能基线。

拒绝：

- 单条历史星序列作为状态最终值；
- terminal oracle直接覆盖primitive；
- 通用线性leaf继续堆权重；
- 只选择option kind但没有持久target/continuation；
- 用增加depth替代objective语义。

下一步固定结构为：

```text
Observable ObjectiveEpoch / target generation
→ 2–4个持久Option候选（purpose、deadline、progress、abort）
→ 每个Option的EnemyPolicy × ChanceOutcome value interval
→ Hard与committed rescue逐帧约束
→ Minimax只在接触态内比较该Option允许的局部动作
→ 事件或证书失效时重规划；不因普通下一帧分数抖动换目标
```

机器摘要：
`config/engine-v3/base-policy-kernel-bp107-bp111-terminal-chance-evidence.json`。

