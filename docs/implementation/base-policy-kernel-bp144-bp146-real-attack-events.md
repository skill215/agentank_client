# BP144–BP146：真实攻击根恢复了严格证书，并得到首个正向漏射因果样本

## 结论

BP143在35个位置型candidate根上没有找到攻击证书，不是严格事件证明无效，而是输入根不是攻击机会。
BP144改从真实战斗事实构造攻击语料；BP145在同一严格量词下重新证明；BP146只对V2漏射根中的严格证书
做同根`CONTROL/ACTIVE FIRE`因果测试。

结果首次形成完整正向链：真实攻击事实 → exact物理根 → 全敌方动作/全Chance/三规则世界证明 → 整局正向
转换。Production行为未改变。

## BP144：真实攻击机会根

源为`shot-quality-counterexposure-blind96-v2`的192局Discovery。弹丸结果按独立bullet id归因，FIRE按
DecisionAudit中的第n次FIRE与第n条shot记录配对，不把frame当作动作数组下标。

- 932个V1 FIRE：64个安全击毁、1个击毁后四帧内反杀、744个无坦克命中、108个地形命中、
  15个终局仍存活弹丸。
- 选择全部65个击毁根，并按几何、距离、counter-line匹配65个未击毁根；50个完全同stratum，
  15个只放宽counter-line。
- 当前V2座位产生192个首个V1/V2动作分歧根，以及346个“V1同根会FIRE、V2未FIRE”的接触根。
- 130/130历史证明根、192/192首次分歧根、346/346漏射根均exact。
- 103个历史V1回放与192个V2 oracle回放共295/295终局复现，动作流失配0。

首轮回放曾暴露两个诊断缺陷：production poison emitter会把历史`CAST_STUN`降为`TURN_RIGHT`；复用
observed-skill bridge又会让内部skill绕过final override并错移callback index。最终合同明确分离两种权威：
recorded command唯一拥有模拟器物理，ProductionRoot只作shadow观察/证明；技能兼容只安装在final
replacement emitter，不改generateActions或包住整个emit。两个旧REJECTED artifact保留为故障证据。

## BP145：真实根上的严格攻击事件证明

选择130个历史正负配对根和346个V2漏射根，共476根。每根固定根动作为FIRE，后续允许每条已观察
世界线最多一次响应偏离；敌方动作、ChanceOutcome和三个移动规则世界保持全量。depth 6、单搜索预算
32768、固定TT 8192；无事件到horizon为`UNKNOWN`。跨规则policy只有在相同语义状态选择相同动作时
才可执行。

- 476/476 exact，FIRE生成476，Hard Allow 469。
- `SAFE_THREAT_FIRE`：48个全世界可执行证书。
- `DOOMED_TARGET_FIRE`：30个全世界可执行证书。
- 历史65个击毁根中安全威胁40、必杀30；65个匹配未击毁根中安全威胁4、必杀0。
- 346个V2漏射根中安全威胁4、必杀0。
- 1根安全威胁支持不完整，明确保留为`INCOMPLETE/executable=false`；7个Hard拒绝FIRE全部第一步
  `DISPROVEN`。
- `unsafeExecutableCount=0`；总节点35,721，单搜索最大868；预算、TT容量、restore、热分配失败均为0。

分类artifact允许局部UNKNOWN存在，但验收硬门改为任何不完整或Hard拒绝结果都不得进入executable集合。
这不是放宽证明，而是把“完整分类语料”与“单根动作所有权”分开。

## BP146：4个漏射证书的因果POC

4个漏射证书的FIRE事件都在根第一步闭合，导出的continuation policy entry均为0，因此POC无需伪造
后续Plan。每根先用recorded prefix恢复完全相同物理状态；根上CONTROL归还当前V2所有权，ACTIVE只
覆盖为FIRE；之后双方分别使用当前V2和确定性V3。

- 8/8个arm命中exact root，Hard/restore失败0。
- 转换：`V1_WIN→V2_WIN` 1、`DRAW→DRAW` 1、`V1_WIN→V1_WIN` 2。
- 正向1、负向0、相等3；分析点数由1增至3，delta +2。

四根不足以证明总体显著性，也不能按hash写入production。它证明了可泛化方向：不是提高FIRE固定分，
而是在线识别“FIRE在所有敌方首动作和Chance下都会建立安全威胁”的结构证书，再由统一FinalGate取得
动作所有权。

## 保留、拒绝与下一步

保留：真实弹丸事实语料、recorded-command物理权威、严格攻击事件证明、UNKNOWN fail-closed、
跨规则policy冲突拒绝、4根正向POC。

拒绝：位置scalar根替代攻击语料、按历史击毁标签直接开火、全局FIRE bonus、把safe threat等同必杀、
按4个状态hash写补丁。

下一步BP147扩大证书触发域：从48个可执行安全威胁根提取不含match/hash的结构必要条件，使用全部
65+65历史配对根控制假阳性，并在346个漏射根上预注册Discovery/Holdout。候选必须先通过在线证明，
再进入独立整局因果验证；不修改Risk、Hard或Minimax深度参数。

