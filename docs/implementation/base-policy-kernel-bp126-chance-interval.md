# BP126：独立Chance holdout否决全部局部标量证书

## 固定实验

BP126复用BP125的64个精确Physical root，不重新抽根，也不改变EnemyPolicy。每个根比较incumbent和
candidate两种第一动作，之后恢复相同V2 BasePolicy与V3历史控制器。

ChanceOutcome固定拆分：

- Discovery：HISTORICAL、RANDOM0、RANDOM1、RANDOM2；
- Holdout：RANDOM3、RANDOM4、RANDOM5、RANDOM6。

总计64乘2乘8等于1,024个终局cell，状态哈希、强制动作和控制器历史全部精确。历史128个cell直接复用
BP125，新增896条随机未来分支。输出只保存压缩终局向量，不保存逐帧replay，artifact约28 KiB。

## 三层关系

同一份结果并列计算三种关系，避免用定义选择结果：

1. paired no-regression：每个Chance逐项比较终局、death、kill和可比星差；
2. terminal interval：比较worst outcome、nonloss数量和death上界；
3. full vector interval：再加入kill、最差星差和累计星差。

Discovery中7个根逐Chance无退化，20个terminal interval支配，10个full vector支配；同时满足
paired和full vector的只有6个。这6个在历史出星上全都是败局仍败，改善证据完全来自R0–R2中的少量
死亡或星差变化，并非历史终局正转换。

## 真正Chance holdout

6个Discovery候选在R3–R6上通过0个：

- paired no-regression：0/6；
- terminal interval：2/6；
- full vector interval：3/6；
- paired与full vector同时成立：0/6。

退化原因合计为2次新增死亡和9次可比星差下降，没有胜负rank下降或lost kill。两个根甚至在holdout
聚合full vector上占优，却在具体Chance上交换了好坏世界线，因此不能通过paired合同。

全64根、全部Chance合计24个candidate更好终局、22个更差终局、466个相同；20个根至少一次改善，
18个至少一次退化，7个同时出现正负世界线。局部深度2 value margin没有提供这种Chance稳定性。

## 决定

- BP126语料与paired/interval双视图保留；
- 六个Discovery证书全部否决；
- 不继续运行EnemyPolicy矩阵，因为Chance holdout已经没有幸存者；
- 不运行ACTIVE、不调阈值、不复用holdout选参数。

下一步不能继续扩大不可观测终局采样数量。搜索应输出“基于当前可观察状态的Objective进度区间”，例如
接敌deadline、射位覆盖、敌方合法动作压缩和我方自逃余量；终局Chance语料只用于离线反证这些区间，
不再作为primitive动作的直接监督标量。

机器摘要：
config/engine-v3/base-policy-kernel-bp126-chance-interval-evidence.json。
