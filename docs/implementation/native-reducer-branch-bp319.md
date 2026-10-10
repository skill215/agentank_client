# BP319：高收益分支来源

## 核心发现

两个退化根的实际敌方第一步均为左转（action2），不是抬高期望的GO（action1）。不能把“敌方选择GO时的条件高收益”当成当前根的强制胜。

### 2oo，frame39，FIRE vs GO

- root cell值100000。
- 49次transition，45个模拟终局记录，全部100000；0个pairedLeaf。
- 该cell只增到4个policy节点，不是该cell预算耗尽造成的启发高值。
- root之后敌方生成域为GO/左转/右转/stun；我方为GO/左转/右转。
- 所搜索的条件后继都返回击毁胜；但这是生成域内的模拟结果，不是穷尽全部合法动作、物理规则及隐藏状态的独立Proof。
- 实际敌方frame39左转；该响应的FIRE cell仅7062，低于GO的15641。敌GO权重41600/53600约77.6%，其条件100000通过32.16%期望混合，使FIRE取得动作所有权。

因此“100000纯粹由预算叶虚构”不符合证据。尚未与完整物理oracle逐分支验证，不能进一步断言模拟终局都正确；但修复高分不应只靠截断或恢复哨兵。

### I52，frame48，右转 vs GO

- root cell20362，70次transition、60个模拟击毁终局记录、30个pairedLeaf。
- 启发叶值范围-15785至24886；6个leaf记录发生于nodes≥32、perRootBudget=32。
- 条件下一帧敌GO时，我方GO后继值-833，stun后继6042；敌方转向分支有100000。
- 因而20362是递归MIN/期望和我方MAX聚合的结果，混合了条件击毁和截断启发值，不是一个严格胜利值。
- 实际敌方frame48左转；该响应右转值-103，而GO为40。敌GO权重16200/37200约43.5%，期望混合27%。

终局记录数是遍历事件，包含不同chance/路径重复，不是独立对局、独立胜率样本或概率分母。

## 对上一轮判断的细化

两根最终决策都存在不完整搜索，但不应据此断言每个收益cell都由截断造成。2oo收益cell没有leaf，I52则有。

当前最直接机制：对手nominal权重偏向有利GO→条件终局高值进入期望→压过对实际左转响应更稳的动作→最终改选。两例预测偏差不证明OpponentModel整体失效，更不支持直接把权重设零。

下一步应在已冻结整局数据上检查nominal动作概率的校准，区分生成域遗漏、概率失配和已知风险下注；同时用同根影子比较最坏/期望分离的选择合同。不再把问题简化为“深度不足”或“高分一定是bug”。

## 实施和验证

新增开发工具 `reducer-branch-trace.js`，只包装两个指定root cell的transition、domain、apply、leaf、terminal，记录父子ID和返回值。最多4096事件，超限显式失败。退出恢复方法，不改变搜索预算、顺序或production代码。

两个局面的双方整局动作流与BP317修复版逐项一致；胜负不变、timeout/error/root restore failure为0。增加异常退出恢复UT。没有进行新ACTIVE候选试验或平台调用。

产物：`artifacts/native-causal-audit/bp319-branch-trace/`，manifest、overview、traces.ndjson.gz。production tree保持285f9863…d9120。
