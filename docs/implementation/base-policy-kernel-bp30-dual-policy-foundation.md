# BasePolicyKernel BP30-A：双策略 continuation 基础合同

BP29证明把`FIRE`当作`SUCCESS`并让两条根分支共用AttackPose continuation会产生负收益。
BP30-A先加固比较语义，不取得动作所有权，也不修改production V2。

固定事件向量把`FIRE_EMITTED`与`ENEMY_DEATH/TERMINAL_WIN`分开。发射本身既不是收益，
也不是失败；只有真实击毁或终局胜利才能进入收益集合。

同一PhysicalState分别由`BASE`与`ATTACK_POSE`路由。TT键包含
`hashLo + hashHi + remaining + policyId`，禁止不同策略共享结果。缺少任一策略路由器时
显式返回incomplete，不能退化成共享AttackPose continuation。

下一步提供可在FastState运行的明确BasePolicy continuation，再把两套策略接入共同的
enemy/chance/Fast/Hard展开，以Shadow测量完整支持率、节点数和P95。

## BP30-B固定16场景Shadow结果

在32局、2,557个候选根上，606个根进入双策略成对评估，其中293个完整，完整率48.35%。
第一步不同的根为322个。完整关系为AttackPose支配28、BasePolicy支配49、tradeoff 209、equal 8；
所以不存在可直接启用的普遍AttackPose所有权。

把FIRE从收益中删除后，AttackPose相对BasePolicy的终局收益质量总增量为296,954/10000，
但失败质量也增加121,688/10000。它更容易推进到攻击事件，同时也确实扩大死亡/失败世界线；这与
BP29整局负收益一致。

性能方面共执行535,138次transition，BASE为329,652、AttackPose为205,486；386次预算截止，
完整率不足一半。TT容量失败、root restore失败和声明热分配均为0。下一阶段先压缩BASE continuation
及共享展开成本，并提高同预算完整率，不增加深度、不启用动作所有权。

## BP31路由缓存消融

固定8场景、16局的OFF/ON A/B保持全部胜负、质量向量、关系、节点和transition一致，但缓存仅命中
296/38,424次（0.77%）。墙钟时间增加8.78%，candidate累计时间增加9.28%，P95增加11.71%。
搜索TT已经消除了绝大多数重复状态，第二层动作缓存只重复哈希和内存访问，因此实现已撤回并记录为
`REJECTED`。下一项优化转向同首动作双策略共享根transition。

同首动作共享根transition经过预算语义修正后做到质量、关系、完整度和W/L/D逐项一致，但只节省
539/231,347次逻辑transition（0.23%）。candidate累计时间仅改善0.17%，墙钟反而增加1.90%；P95
改善5.39%不足以抵消复杂度和噪声。该实现已撤回并标为`REJECTED_FOR_COMPLEXITY`。性能主成本位于
深层展开，下一步改为渐进帧深和可靠早停。
