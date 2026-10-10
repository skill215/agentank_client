# BP34–BP35：物理转移复用调查

## BP34普查

固定16场景的535,138次转移请求中，35,607次是完全相同的父状态、动作、参数和Chance，占6.65%，且全部发生在Base与AttackPose两套策略之间。另有44,601次不同命令产生相同物理后继，占成功转移的8.35%。

严格重复转移平均产生7.43个delta写入，逐局真实最大值为30。根恢复失败和热路径分配均为0。

## BP35通用delta replay

实现曾使用固定TypedArray保存一套策略的物理delta，由另一套策略重放。预算仍按原逻辑转移计费，因此完整率、关系、质量向量和胜负必须与基线一致，实测全部一致。

Base-first需要记录329,652次转移以命中35,607次，固定16场景候选耗时增加20.23%。改为先记录较小的AttackPose搜索后，存储降至205,486次，但固定8场景五批交替A/B中：

- 候选总耗时增加1.46%；
- 候选/control平均比恶化1.92%；
- 完整对与不完整对完全不变；
- P95有噪声性改善，但不足以抵消吞吐退化。

因此BP35运行代码已撤回。BP34普查继续保留为Shadow工具。

## 下一方向

BP36普查证明，44,601次“不同命令、相同后继”全部可由动作规范化解释，且全部包含Stun反向后的有效转向等价；墙阻挡只与该原因共同出现，不是独立复用来源。通用规范化分支memo在固定8五批交替测试中保留全部97,670次命中，候选总耗时降低0.40%，按同批control归一化后改善0.74%，完整度和全部语义计数不变。因此保留为诊断实现，但不改production默认。

进一步只保留Stun键的BP36-C消融未带来收益：命中数和语义完全相同，但候选总耗时增加3.34%，归一化后仍退化0.56%。该运行代码已撤回。结果说明瓶颈不在通用规范化检查，而在仍需枚举和存储约49万条未命中分支。

下一阶段不再增加后继缓存，也不继续压缩动作键。应在保持敌方量词和Chance语义的前提下，研究执行物理转移之前的分支域缩减，减少lookup、store与真实apply总次数。

## BP37完整动作分布压缩

敌方处于Stun时，TURN_LEFT与TURN_RIGHT各自展开NORMAL/REVERSED后得到同一组物理后继。BP37在复制敌方动作域的原循环中只保留一个代表动作，将两者的Opponent weight相加；Chance结果本身不删除。

16,384节点高预算oracle中，压缩前后胜负、完整度、关系和全部质量向量逐项一致，质量哈希为`0bdfe3d3…efa`。Base与Candidate转移分别减少约10.1%和9.3%。

真实2,048预算下，固定8场景五批交替结果为：

- 完整比较累计从615增加到620；
- budget stop从705降到280；
- Base/Candidate转移分别降低5.62%和6.22%；
- 候选总耗时降低4.63%，按同批control归一化改善0.76%；
- P95均值受单批control异常影响退化3.23%，但P95中位数改善5.66%。

因此BP37按“深度效率优化”保留为Shadow诊断实现：它的主要价值是把重复预算转成更多唯一世界线，并非宣称纯吞吐跃迁。Production默认未修改。

## BP38预算前沿普查

BP37之后的固定16场景仍有144次预算停止。普查证明144次全部由物理transition budget触发，node budget触发为0。停止分布在深度0–5，并不集中在某个动作；记录到的GO、TURN或STUN只是计数器耗尽后首先遇到的分支，不能据此调整动作顺序。

真正的分母仍是敌方原子动作按帧展开：深度4和5占全部敌方动作的78.05%，其中深度5单独占51.25%。因此下一阶段将敌方nominal价值搜索也升级成多帧Response Option，只在根响应处分裂，后续由状态条件策略继续。Hard、ForcedWin与committed safety仍保留逐帧全量量词，不使用该近似。

## BP39单一敌方Response Option

第一版在根帧保留完整敌方动作，后续只运行一条状态条件nominal策略。最初的census包装器错误返回`null`，导致宿主已选的V3-base动作被丢弃并退回原始V2动作；该接口缺陷已由透明性UT固定。修复后固定8场景恢复为8胜7负1平，与BP37逐项相同，production hash未变。

单策略把总转移从217,805降到8,883，预算停止从56降到0，但259个根只有109个关系一致；在124个完整全域根中也只有70个一致。因此单策略只能证明压缩上限，不能替代value relation，更不能产生动作所有权。

## BP40短原语前缀加持久策略尾部

敌方尾部使用三条跨帧保持身份的状态条件策略：ATTACK、POSITION、DEFENSE。根动作域始终完整；原语前缀之后才锁定尾部策略。

- 前缀1：完整根关系一致91/124（73.39%），转移69,199/217,805（31.77%）；
- 前缀2：完整根关系一致97/124（78.23%），转移138,614/217,805（63.64%）；
- 前缀3：完整根关系一致112/124（90.32%），但转移达到256,371，超过完整搜索，淘汰。

前缀1位于当前Pareto前沿。前缀2多消耗约一倍转移，只增加4.84个百分点关系一致，可作为选择性细化，不能作为默认。

三策略一致也不构成证书：前缀1的candidate-dominance一致中仅9真、10假；前缀2也只有6真、4假。因此最终分工固定为：Option portfolio只服务nominal/Risk排序与区间；Hard、ForcedWin、committed safety仍使用完整逐帧量词；任何覆盖当前动作的value结论必须再经窄的完整原语verifier。

## BP41选择性完整原语Verifier

使用BP40前缀1作为第一通道，只在portfolio给出`CANDIDATE_DOMINATES`时计入一次完整原语verifier。固定16场景606个根中，verifier只触发87次：28个候选优势通过，37个近似假阳性被驳回，22个全域不完整保持UNKNOWN；仅漏掉1个未被portfolio提名的可证机会，不会产生错误覆盖。

选择性调度的估算节点为215,296，对比每根全跑438,685，占49.08%；转移为241,300，对比502,893，占47.98%。根恢复失败和热分配均为0。

因此下一阶段实现真实执行路径：先跑portfolio，只有候选支配才实际运行verifier。Shadow验证工作量和动作透明性后，ACTIVE只允许完整verifier确认且FinalGate允许的`EXACT_VALUE_DOMINANCE`提案。近似portfolio本身永远不拥有动作。

## BP42条件性续行证书的合同缺口

BP42首次把选择性调度接到真实动作覆盖。实现先用prefix-1 portfolio提名，再按需运行完整原语verifier；固定16场景只运行9%左右的完整根验证工作，并出现一个`DRAW→WIN`信号。

但该证书比较的是“候选首动作后持续使用AttackPose策略”，实际宿主只覆盖首动作，下一callback恢复V3-base。也就是说证明依赖了一个没有被提交的未来Plan。即使小样本结果为正，这种证书也不能作为首动作所有权依据。

## BP43同宿主续行首动作Verifier

BP43只允许AttackPose提出首动作；首动作之后，incumbent和candidate两棵树都使用相同的V3-base形状续行。敌方prefix-1 portfolio仍只负责调度，最终所有权仍要求完整原语响应验证和FinalActionGate通过。

固定64个Discovery场景中，shadow为69胜53负6平（56.25%），active为75胜49负4平（60.16%）。转换包含8个`LOSS→WIN`、2个`DRAW→WIN`和4个`WIN→LOSS`，提升3.91个百分点。没有新增Hard、Risk、restore或timeout问题。

该收益没有在不重叠的64个Tactical Holdout场景复现：shadow为62胜55负11平，active为61胜54负13平，两者都为52.73%。正向是1个`LOSS→WIN`和1个`LOSS→DRAW`，反向是1个`WIN→LOSS`和1个`WIN→DRAW`，净得分为0；场景级单侧符号检验`p=0.6875`。

因此BP43结论拆成两部分：

- 同宿主续行是正确的首动作反事实合同，保留为诊断Verifier；
- 当前response-mass支配关系不能取得动作所有权，默认保持关闭。

下一步不扩大样本也不调阈值，而是拆解Holdout的26次覆盖：终局/不败、击毁、星差和位置价值不能继续混在一个“候选支配”结论里。只有终局或不败区间构成严格优势时才可能再次申请动作所有权；星差与位置改善仍只作为战略证据。

## BP44证书类别与有限时域反例

在同一64场景Tactical Holdout上，BP44以透明shadow拆分26个完整verifier证书。动作流和胜负与BP43 shadow逐项一致。分类结果是：

- terminal win closure：0；
- horizon failure elimination：5；
- failure support reduction：0；
- nominal mass only：11；
- other outcome-mask change：10。

因此26个“完整支配”中21个不是严格终局/安全闭包，只是完整枚举之后的nominal mass或事件集合优势。完整的是搜索过程，不是效用定义。

随后只启用terminal closure和horizon failure elimination。实际产生4次覆盖，结果从62胜55负11平降为61胜55负12平，唯一转换是`WIN→DRAW`；Hard、Risk、restore和timeout均未变化。这证明即使六帧内完全消除失败支持，也不能替代整局价值：OPEN叶没有表达后续攻击位置、星差与终局资源。

所以在加入正确的horizon bootstrap之前，response-mass只能服务Risk/证据。动作所有权只保留给真正terminal closure和独立ForcedWin。下一步优先交叉检查已算出的V1形状root leaf/path value；不增加深度，也不重复计算另一套叶估值。

## BP45–BP46复用root value的合取门

BP45没有增加搜索，而是把26个response证书与同一帧已算出的V1形状`rootScore`交叉对账。只有6个候选root value更高，20个更低。按证书类别分解：horizon failure elimination为1高/4低，nominal mass为3高/8低，outcome-mask change为2高/8低。

这解释了BP43的波动：response verifier证明的是短期事件向量，AttackPose候选却经常损害已存在的长期leaf/path价值。

BP46只允许“response支配且rootScore严格更高”的6个候选覆盖。结果产生1个`LOSS→DRAW`和1个`WIN→DRAW`，净得分仍为0，Hard、Risk、restore和timeout无变化。两个有限时域估值一致仍不足以成为通用动作所有权，因此停止继续叠第三个门或阈值。

下一阶段改proposal而不是继续改verifier：当前所有实验都只验证AttackPose提出的一个动作。应把proposal生成与验证彻底拆开，让已经计算完成的Minimax root frontier提出自己的argmax，再由同宿主response verifier独立验证。

## BP47–BP48：Minimax根前沿提案与独立验证

BP47让已经计算完成的Minimax根值前沿自行提出argmax，不再由AttackPose生成唯一候选。候选仍需通过prefix-1敌方策略组合、完整原语响应验证、根值严格提高和FinalActionGate，搜索深度与预算没有变化。诊断汇总最初遗漏proposal mode和计数，合同测试补齐后，固定Tactical Holdout记录到6,805次有效根提案、57个完整响应证书。

宿主wrapper原先可能在production FinalGate之后覆盖动作，导致shadow仍有5次avoidable Hard reject。BP48增加独立的`guarded-shadow`，使FinalGate成为所有wrapper动作的统一终门，再比较同门禁下的Minimax所有权：

- guarded-shadow：63胜53负12平，53.91%；
- value-active：68胜45负15平，58.98%；
- 净增5.08个百分点，9个败转胜、1个败转平、1个平转胜，对应2个胜转败和3个胜转平；
- FIRE增加34次、己方被击毁减少2次，Hard、Risk、restore和timeout均为0。

候选和源码指纹在读取新数据前冻结。独立EO Holdout的64场景结果只有正向但不显著的提升：guarded-shadow为53胜69负6平（43.75%），value-active为55胜67负6平（45.31%），净增1.56个百分点，场景级`p=0.548828125`。因此通用根argmax不能取得生产动作所有权。

首个动作分歧审计进一步显示，独立集40个行为分歧中26个首先改成FIRE；这些FIRE只有1个正向转换、2个反向转换，其余23个不改变胜负。机动/技能动作承担了主要净收益。这说明下一阶段应分开所有权类别：普通根值证书只能提出机动候选；FIRE/BOMB必须经过独立VerifiedAttack目的、反击暴露与自逃合同。

证据：

- `config/engine-v3/base-policy-kernel-bp34-transition-reuse-census.json`
- `config/engine-v3/base-policy-kernel-bp35-deep-transition-replay-rejection.json`
- `config/engine-v3/base-policy-kernel-bp36-action-canonicalization-evidence.json`
- `config/engine-v3/base-policy-kernel-bp37-stun-turn-domain-compaction.json`
- `config/engine-v3/base-policy-kernel-bp38-budget-frontier-census.json`
- `config/engine-v3/base-policy-kernel-bp39-enemy-response-option.json`
- `config/engine-v3/base-policy-kernel-bp40-enemy-response-portfolio.json`
- `config/engine-v3/base-policy-kernel-bp41-selective-primitive-verifier.json`
- `config/engine-v3/base-policy-kernel-bp43-host-continuation-verifier.json`
- `config/engine-v3/base-policy-kernel-bp44-certificate-class-audit.json`
- `config/engine-v3/base-policy-kernel-bp45-bp46-value-crosscheck.json`
