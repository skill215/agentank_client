# HP16：真实预算中的选择性几何 Shadow

## 结论

HP16把HP15的三行单层几何矩阵接到真实production决策顺序：

```text
Hard / Safety / EO
→ Risk / Pareto / Strategy基准动作
→ 三行Geometry Shadow
→ FinalActionGate
```

Shadow没有动作所有权，但使用同一个`RuntimeController`、`ProductionInformationSearch`、
`ProductionDepthSearch`和work ledger。因此它会真实影响后续帧的runtime mode，正好用于验证
“几何计算是否值得占用Physical Minimax预算”。

固定16场景结果拒绝“每个合格接触根都运行”的调度。几何值确实有辨别力，但它提前进入
degraded/fallback，并减少更严格的Physical完整搜索。Production默认保持关闭。

## 实现合同

- 插点位于Risk/Pareto和Strategy形成基准动作之后、FinalActionGate之前；
- 候选固定为基准动作、最强普通challenger、最强攻击challenger；
- challenger必须`acceptable && !dominated`，禁止恢复Risk拒绝动作；
- 仅处理敌人可见、隐藏位置质量为10000、方向完整的一层几何；
- 只有一个合格动作时零搜索；
- 复用现有Information/Physical搜索器，不创建第二套搜索栈；
- 预计矩阵不能在quota内完整完成时整次取消，不发布部分值；
- quota保留一个完整optional callback窗口，避免本次计算直接吃掉下一帧全部机会；
- 结果只记录strict improvement机会，绝不回写动作；
- 默认构造不创建Shadow对象；启用时仅新增12字节候选TypedArray；热分配为0。

## 固定16场景因果结果

命令：

```bash
./tools/runtime-schedule-poc.sh \
  --profiles CURRENT,SELECTIVE_GEOMETRY_SHADOW \
  --role DISCOVERY --scenarios 16 \
  --capture-work-ledger true \
  --output /tmp/hp16-fixed16.json
```

| 指标 | CURRENT | Geometry Shadow | 变化 |
|---|---:|---:|---:|
| W/L/D | 3/28/1 | 3/28/1 | 无胜负变化 |
| match work | 4,383,247 | 4,887,161 | +11.50% |
| 本地总耗时 | 2,494,689us | 2,976,939us | +19.33% |
| Physical搜索帧 | 73 | 69 | -5.48% |
| Physical节点 | 24,366 | 21,412 | -12.12% |
| 完整value owner | 70 | 66 | -5.71% |
| Information Shadow完成 | 0 | 658 | +658 |
| Information Shadow节点 | 0 | 13,422 | +13,422 |
| strict improvement机会 | 0 | 96 | +96 |
| Risk/Hard/restore/hot allocation错误 | 0 | 0 | 无退化 |

动作流有5/32局不同，但paired结果全部保持；差异来自Shadow work使runtime mode提前变化，
不是Shadow直接选择动作。固定场景中degraded首帧普遍提前约8–16帧，fallback callback从371
增加到596。保留下一帧quota只能限制单次破坏，不能解决高频调用的累计预算占用。

本地微秒会受同进程JIT影响，仅作同输入辅助；拒绝结论主要依赖确定性work、runtime mode、
Physical节点和完整owner数量。

## 验收判断

分类为：

```text
GEOMETRY_MECHANISM = USEFUL
EVERY-CONTACT SCHEDULE = REJECTED
PRODUCTION DEFAULT = OFF
```

验证结果：Minimax core 146/146、Diagnostics 100/100、GR0 280/280、IMP5 14/14；
24-profile深度标定的restore、cache语义和热分配不变量全部为0。冻结证据：

- report fingerprint：`46825145a068de90b3f1f5d0d6496a7d7d68740b137059b3a6f23f45b2b8121d`；
- source fingerprint：`ef9d4fe3a4327c2f3fb182e55f6141c8d43dd74f18225cf99dbd0713ce803c78`；
- baseline：`config/engine-v2/minimax-depth-baselines/after-hp16.json`；
- baseline fingerprint：`5934224ad93f978402d5957200604dbfbc11ce2478c3e31368c3097e94912457`。

96个strict机会说明不能删除这条算法路径；但当前调度每得到一个机会平均消耗约140个节点，
并系统性挤压Physical证书。下一步HP17不再扩大深度或提高quota，而是记录这些机会发生前可用
的零搜索特征，构造稀疏触发器：只有预计能产生严格分离、且不会跨越下一帧Physical reserve时
才运行。触发器必须先Shadow验证召回率、work和Physical owner净变化，不能直接取得动作所有权。
