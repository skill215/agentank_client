# HP25：Minimax逐层成本标定

## 结论

HP25没有提高生产节点预算，也没有修改Minimax值、动作、Hard或搜索深度语义。它新增了一套外部
成本census，通过包装现有Fast、Hard、TT和估值方法，并依据FastState帧号反推搜索ply。生产对象
没有新增逐节点计数数组，默认仍受512节点上限约束。

这次标定修正了此前一个容易误读的指标：`completedDepth`表示完整矩阵值owner；P3以上使用
selective action proof，必须同时读取`selectiveCompletedDepth`。在固定16根中，9个根有完整P2
基础并能进入P3；512节点冷启动只有2个完成P3 selective proof，warm cache则有8个完成。

预算阶梯给出了明确近期目标：

| 节点预算 | 冷P3完成 | warm P3完成 |
|---:|---:|---:|
| 512 | 2/9 | 8/9 |
| 576 | 4/9 | 8/9 |
| 640 | 8/9 | 9/9 |
| 768 | 8/9 | 9/9 |
| 896 | 9/9 | 9/9 |

八个常规冷根完成P3需要476–599节点；最难根需要822节点。因此近期性能目标不是追求P4，而是让
冷P3的有效节点成本下降约6–15%，覆盖8/9根；822节点长尾单独处理。P4在约2,048节点才达到
6/9，继续加到4,096也没有改善，不适合作为下一轮目标。

## 成本分布

512节点标准census中，P3冷搜索合计6,499节点：

- ply1 Fast build 840，加root replay 666，约占全部节点23.2%；
- ply2 Fast build 3,741，占57.6%；
- ply3 Fast build 1,252，占19.3%；
- state-ply1 TT命中72/658，state-ply2命中52/369；
- alpha-beta跳过1,707个敌方动作cell；
- `probeDirectFireTrap`被调用5,150次，但只真正展开128节点。

所以主战场非常明确：冷P3的ply2状态推进、Hard分类、TT命中和排序，而不是root微缓存。零预算
trap调用是可能的墙钟微优化，但不会减少节点或提升深度，不能冒充本轮主性能跃迁。

## 容量与预算分离

最初把预算改为1,024/2,048/4,096后结果完全相同，原因是ProductionDepthSearch内部再次截断到
`SEARCH_CAPACITY.MAX_NODES=512`。HP25增加了仅构造选项可开启的`diagnosticNodeCapacity`：

- production默认仍为512；
- runtime profile、work limit和上传代码行为不变；
- 诊断可以测量512以上真实曲线；
- 迭代搜索不按节点分配状态，所以该诊断覆盖不增加per-node TypedArray；
- 是否提高生产budget必须由后续独立A/B决定，HP25不授权提高。

固定根中，完成冷P3的work为6,504–13,571，低于60,000 callback work上限，但这不能直接推广到
全部真实局面。它只说明512节点cap与work cap是两个不同约束，后续需要分别标定。

## 被拒绝的排序POC

P2使用full-width=4，而P3+切换到width=2。HP25曾尝试只读取width4完整TT条目的动作program，
作为width2的排序提示；值、区间和cache身份没有跨width复用。结果：P3 cold只减少2/6,499节点，
work反而增加772；warm节点增加10。P4–P6节点和深度完全不变，cold work增加786。因此该POC已
完整撤销，不能作为下一轮方向。

## 固化工具

常用命令：

```text
./tools/minimax-cost-census.sh run \
  --scenarios 16 --min-depth 3 --max-depth 4 \
  --node-budget 640 --output /tmp/minimax-cost.json
./tools/minimax-cost-census.sh verify --report /tmp/minimax-cost.json
```

标准24-profile、每profile 80次的深度标定也已重跑。所有节点、完成深度和值支持直方图相对HP23
零变化；跨时墙钟虽更低，但运行顺序和机器漂移没有受控，不声称是加速。新基线冻结为
`config/engine-v2/minimax-depth-baselines/after-hp25.json`，状态`CURRENT`。

最终验证为Minimax 159/159、Diagnostics 111/111、GR0 293/293、IMP2 53/53、IMP3 28/28、
IMP5 14/14；root restore、cache replay、语义指纹和热分配不变量全部为0。

下一轮应以“512节点得到接近640节点的冷P3完成率”为硬目标，优先减少ply2重复推进或提高同语义
TT复用；每个候选必须同时报告节点、work、selective depth和动作/值指纹。

机器证据见`config/engine-v2/hp25-minimax-cost-census-evidence.json`。
