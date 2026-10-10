# NO_ACCEPTABLE 与 Observation 所有权诊断

本阶段没有继续放宽 Risk，也没有把诊断开关接入 production。目标是解释独立
Tactical Holdout 中约 9.63% 的 `NO_ACCEPTABLE_ACTION`，并判断 Soft Safety 是否是
V2 低胜率的主因。

## 全量 census

96 场景、192 局、19,953 次 V2 决策中共有 1,922 个 `NO_ACCEPTABLE` 根。其中：

- 1,707 个是 `UNKNOWN_UNAVOIDABLE`；每个根的最小 unknown 都是 10,000；
- 1,644 个仅由 ObservationSafety 覆盖产生，占上述 UNKNOWN 根的 96.31%；
- 1,700 个 UNKNOWN 根至少存在一颗 possible projectile；
- 1,798 个根存在不受 committed hazard 约束的替代动作；
- 没有“完整无死亡 witness 被阈值错误拒绝”的根。

实现链条是确定的：`possibleProjectiles.count() > 0` 会令观察支持不完整；
`refineObservationSafety()` 只审计当前 `PROVEN_SAFE` 的行；不完整支持令 universal frontier
返回 UNKNOWN，随后该行被改成 `unknownMass=10000 / coverage=0`。原本属于
`POSSIBLE_DEATH` 的行却不会进入审计。因此当前 Risk 集合存在不对称：较危险的量化行可能
保留资格，较安全的行反而因无法获得严格证书被清除。

只读 census 与原 pose Holdout 做了逐局、逐动作、逐参数和逐帧 flags 对比，行为完全一致。

## 三个反事实均未通过

第一种 POC 在支持不完整时跳过 Observation frontier，保留原量化 Safety。固定16场景从
CURRENT 的4胜27负1平降到2胜29负1平，自身 crash 增加5局，FIRE减少16次。关闭错误覆盖
是局部语义改善，但它立即暴露了下游单帧动作所有权问题，不能单独上线。

第二种 POC 在上述 guard 后加入 projected-pose 优先。它相对 guard 恢复1胜，但相对
CURRENT 仍少1胜、得分低3.12个百分点。该实验已从生产热路径完整移除，production源码
指纹恢复为实验前值。

第三种 POC 保留 guard，同时重新启用 Information evidence search。深度0帧从3,019降到
1,760，出现大量depth 2–6结果；但结果仅从2胜29负1平变为2胜28负2平，V2本地总计算时间
由1,769,974µs升至3,250,086µs，约增加83.6%。29个首动作分歧中22个只是左右转互换；终局
只有3个正转移、2个负转移。这否决了全局重开 Information Minimax。

## 可复用第一分歧语料

新增 `paired-first-divergence-corpus.js`，它按场景指纹和座位配对两种实现，使用真实 callback
frame 对齐动作，提取第一条不同的已发出命令，并绑定：

- 双方当帧状态和候选风险向量；
- Physical/Information完成深度和支持完整度；
- 控制模式、possible projectile 数量；
- 整局最终的 runtime-independent W/L/D 转移。

focused guard语料的4个分歧根全部是“Observation支持不完整 + depth 0”。动作转移为3个
`GO→TURN_LEFT`和1个`TURN_LEFT→GO`；其中两个原本的 V2 胜局变成 V1 胜局。这给出了下一步
真正需要解决的边界：当严格观察证书和完整搜索值都不存在时，不能由单帧 tactical/strategy
分数直接决定长期动作。

## 下一步边界

下一实验应是一个诊断专用、固定内存的 `ActionContinuationEnvelope`：

1. 只在 Observation 支持不完整且没有完整 value owner 的根触发；
2. 只评估 Risk/Pareto 后的少量候选，不扩大完整 Minimax；
3. 复用 `RootTransitionSlab`，对候选计算2–4帧的物理/Plan延续区间；
4. 完整区间严格支配时才可形成 proposal；不完整结果只能在同一合格 proposal 类中排序；
5. 不写 Hard、Proof 或 Safety，不允许全局拥有根；
6. 先在第一分歧语料上离线验证，再跑固定16整局，最后才有资格读取独立 Holdout。

机器证据：
`config/engine-v2/no-acceptable-observation-ownership-evidence.json`。
