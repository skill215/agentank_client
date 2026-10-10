# BasePolicyKernel BP29：独立验证否决响应质量所有权

## 结论

BP28在已知16场景的`+3.12pp`没有泛化。冻结同一资格规则后，在cohort offset 16开始的32个独立场景、
64局上，公平控制`GUARDED_SHADOW`为`34/28/2`、54.69%，ACTIVE为`28/32/4`、46.88%，下降
7.81个百分点。因此response-mass动作所有权被拒绝，保留Shadow事实服务和统一末端Hard closure。

## 公平控制修正

第一次独立运行中，普通Shadow没有启用BP28发现的host Final Hard closure，产生2次avoidable Hard，
而ACTIVE为0。虽然ACTIVE仍下降6.25pp，这两个模式并非只差动作所有权。BP29随后把开关拆开：

- `GUARDED_SHADOW`：运行质量比较，不覆盖动作，启用host Final Hard closure；
- `ACTIVE`：运行相同质量比较和Hard closure，并允许完整逐根Pareto覆盖。

更正后的两边timeout、avoidable Hard、Risk支配选择和root restore全部为0。重新运行同一独立切片属于
修正实验控制，不是根据结果调参；资格规则、帧深和预算均未改变。

## 因果结果

71次ACTIVE覆盖由16个GO、31个TURN_LEFT和24个TURN_RIGHT构成，全部通过候选Final Hard复核。
整局转换是5个`LOSS→WIN`、1个`LOSS→DRAW`，但有9个`WIN→LOSS`、2个`WIN→DRAW`和
1个`DRAW→LOSS`。按局6正12负，双侧精确符号检验`p=0.238`；按场景4正11负，`p=0.118`。
它既没有显著正向，也在点估计上明显为负。

ACTIVE比控制多发26颗子弹，但少拿6颗星、我方单方碰撞/击毁计数多3，胜局少6。这个结果正好说明
“更可能到达FIRE事件”不等于“更可能击毁敌人”。

## 结构根因

当前BP27质量定义有两个根本限制：

1. 派生`SUCCESS`把FIRE与终局WIN取并集。FIRE只是弹丸发射事件，不是命中或击杀；它能让候选在
   SUCCESS维度变好，同时真实反击暴露和后续失败增加。
2. incumbent与candidate只有第一步不同，之后都执行AttackPose continuation。因此所谓candidate
   dominance是“假设以后都执行AttackPose”条件下的第一步优势，不是对当前BasePolicyKernel完整策略
   的优势证明。

下一轮若继续，必须比较两套完整policy continuation：incumbent分支继续BasePolicyKernel，候选分支
继续AttackPose；同时把FIRE保留为事件，把hit/kill/terminal nonloss单独作为收益。由于同一PhysicalState
在不同policy下会选择不同后续动作，TT key必须加入policy identity，不能继续跨policy盲共享。

BP29不允许继续在该独立切片上调阈值或重跑候选。复现入口为`tools/base-policy-kernel-bp29.sh`，机器
证据为`config/engine-v3/base-policy-kernel-bp29-independent-evidence.json`。
