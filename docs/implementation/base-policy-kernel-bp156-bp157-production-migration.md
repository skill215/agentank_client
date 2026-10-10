# BP156–BP160：BasePolicy生产薄迁移

## 结论

高收益的BP68组合不再整体依赖诊断动作所有者和多功能domain容器。第一批两个组件已经迁入
`engine-v2/src/base-policy/`，默认production行为仍未改变：

- `NativeBasePolicyActionOwner`：Hard、Risk/intent-known软带、搜索域、动作域、Minimax＋Intent、
  joint Risk tie和稳定动作次序；
- `NativeBasePolicyActionDomain`：根资源资格以及深层搜索实际依赖的`qualifiedFire*`接口。

两个类都只拥有固定TypedArray scratch。动作所有者复用单一result对象；热路径不创建数组、Set、Map或
报告对象，也不引用V1 VM和诊断arena。

## BP156 所有权器

先把搜索、Intent和动作域保持为注入接口，只迁移最终所有权。4096个确定性合成root逐项比较旧诊断类
和薄类，action、argument、row及允许集合差异均为0。

固定16场景使用完整BP68配置运行两次，只切换owner实现。64份物理记录（其中候选32局）的：

- 动作流和参数；
- 终局、帧数和runtime-independent outcome；
- 星数、击毁、弹丸、炸弹与技能计数

全部零差异，候选保持`22胜/10负/0平`、68.75%。候选动作指纹均为
`33c5b8ebf82d6eee72123ed70f6f3538641083624544ca5c6322b3c50d11b925`。

| owner | 源码字节 | 独立Terser字节 |
|---|---:|---:|
| 旧诊断类 | 103,404 | 70,353 |
| production薄类 | 11,119 | 7,582 |

薄类独立压缩体积为旧类的10.77%。同输入本地测量中候选总时间为旧类的87.29%，P95最大值为81.81%；
这只是本地相对证据，不替代平台3000ms证据。

## BP157 动作域

BP68在根owner中以mode 2只筛炸弹和技能，但首次真实接线发现同一对象还被深层搜索调用
`qualifiedFire/qualifiedFireForSeat`。这不是可以删除的诊断代码，而是此前未显式表达的跨层接口。
BP157将根资源域与深层FIRE资格共同定义为production合同。

2048个确定性FastState同时比较双方FIRE资格和全部原始/资源动作，差异0。随后固定16再次只切换domain
实现，64份物理记录和候选动作指纹仍全部一致，结果继续为22/10/0。

薄domain为16,496源码字节、8,800独立压缩字节。旧114,600字节容器还混有leaf、Intent、attack pose和
history实验，因此这个比例只说明已隔离当前domain切片，不能宣称其余功能都被删除。

## BP158 战略Intent

`NativeBasePolicyStrategicIntent`只迁移BP68实际可达的`v1-exact + v1-action + v1-epoch`闭包：
context signature/epoch、威胁与攻击到达帧分类、星/边缘/攻击线动作映射、成员/bonus以及提交连续性。
旧诊断类的oracle矩阵、simple分类、通用quality frontier、直接攻击和预防安全捷径均不进入薄类。

4096个连续确定性root逐项比较分类、映射、成员、bonus、epoch和commit状态，差异0。固定16再只切换
Intent实现，64份物理记录和候选动作指纹继续全部一致，仍为22/10/0、68.75%。薄Intent为19,013源码
字节、10,524独立Terser字节；旧114,600字节容器还混有多个其他实验，不能把比例解释为完整bundle
节省。

本轮宿主总负载同时变高，绝对耗时不作因果结论。以同轮control归一化，candidate/control总耗时从
1.7151降至1.6874，P95从1.2435降至1.1461；仍只属于本地相对证据。

## BP159 对手历史与搜索ABI

`NativeBasePolicyOpponentHistory`用固定整数状态迁移了V1的GO/LEFT/RIGHT/FIRE计数、观察数、GO连续、
静止连续和期望混合比例。4096帧独立reference对拍差异0；Discovery64中8,018个实际搜索根与V1插桩
内容也是8,018/8,018一致。

接线同时暴露了旧BP68的隐藏依赖：V1只有进入自身战术搜索时才把历史交给原生搜索；是否进入又依赖V1
私有动作历史，而实际执行的是BP68/V2动作。这是反事实诊断gate，不是可迁入production的搜索ABI。
fixed16中旧gate为22/10/0、始终原生为21/11/0、完全uniform为16/14/2，说明历史本身有明显价值。
Discovery64扩大到128候选局后，旧gate为67/47/14（57.81%），始终原生为67/48/13（57.42%），
仅差39bp；配对正向7.0局、反向7.5局。因而接受始终原生历史作为后续薄搜索ABI，拒绝复制V1 gate，
但仍不修改production默认。

## BP160 搜索可达闭包与双重执行消融

BP68此前仍运行在`DIFFERENTIAL_ORACLE_ACTIVE`诊断宿主里。每个回调先执行完整V1 VM策略搜索，再执行
原生有界Minimax，并逐层比较root snapshot、transition、动作域、递归census和价值排序。因此原有本地
计时并不是原生搜索成本，而是“两套搜索＋全量审计”的总成本。

新增默认开启的`--bounded-policy-oracle-audit on|off`只控制V1 reference执行与比较，不改变原生搜索、
Risk、Intent、domain、opponent history或最终动作。fixed16关闭后与BP159基线逐项差异全部为0，仍为
21/11/0、65.63%；候选动作指纹继续为
`e40ea471198b7eaea3dbb4b0591f86df973f0b43d49614f44a3e50da0574e998`。

| 模式 | candidate/control总耗时 | candidate/control P95 |
|---|---:|---:|
| V1 VM＋native＋审计 | 172.91% | 135.13% |
| native-only | 56.11% | 45.72% |

这是同输入本地相对证据，不替代平台3000ms证据。跨轮候选总耗时降至45.03%，只能作为量级旁证。

Discovery64的128个候选局给出相同结论：动作流、参数、帧数、物理计数及runtime-independent outcome
全部零差异，结果保持67/48/13、57.42%。13个raw result差异只来自本地runtime winner字段；不进入
分析胜负。native-only在该轮的总耗时/P95为匹配V1的57.43%/41.00%，跨轮候选总耗时为审计版的
21.14%。

运行时方法普查进一步给出生产裁剪边界：总方法83个；审计模式触达72个，native-only触达50个。关闭
审计消除了22个实际热方法和1,292,073次调用，包括`compare*`、mismatch、oracle recursion/domain和
legacy action转换。native-only仍有280,283次`recordPolicyEnvelopeLeaf`调用，但BP68的continuation
policy固定为BASE，每次都会立即返回；生产薄搜索必须把这个分支以及33个当前profile从未触达的方法
一起裁掉，而不是复制18.8万字节诊断类。

## 验证与边界

- Minimax core：包含新增历史UT；完整门在BP159证据冻结后重跑；
- Hard误拒、root restore、timeout/error、joint dominated selection均为0；
- production root源码未修改，arena新开关默认仍使用旧诊断实现；
- BP68普通Risk-only dominated计数仍存在，但joint Risk＋value支配选择为0，这是原候选既有语义；
- 本轮未运行Discovery64、动态全量或官方simulate。

证据：

- `config/engine-v3/base-policy-kernel-bp156-owner-migration-evidence.json`；
- `config/engine-v3/base-policy-kernel-bp157-domain-migration-evidence.json`；
- `config/engine-v3/base-policy-kernel-bp158-intent-migration-evidence.json`。
- `config/engine-v3/base-policy-kernel-bp159-opponent-context-evidence.json`。
- `config/engine-v3/base-policy-kernel-bp160-search-reachability-evidence.json`。

下一片直接实现BP68的50方法native可达闭包，并把leaf/path依赖同时变成production薄实现；先用同状态
差分保证动作、矩阵值和restore等价，再做fixed16因果验证。不能把诊断容器整体复制进production。
