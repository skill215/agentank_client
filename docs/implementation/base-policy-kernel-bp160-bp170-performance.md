# BP160–BP170：BasePolicy Minimax真实性能与薄栈

## 结论

此前的性能结论混入了完整V1 VM搜索和逐节点oracle比较。BP160关闭审计后，固定16和Discovery64的
动作、参数与物理结果保持不变，说明这部分工作不属于Minimax语义。随后按真实运行可达闭包生成薄
search、leaf和path，并针对leaf最重的星图与坐标运算做算法级优化。

本轮没有修改production root默认接线，也没有改变深度、节点预算、Risk、Hard或动作所有权。

## 运行闭包

- 审计搜索类共有83个方法；native-only触达50个。
- 关闭审计移除22个实际热方法和固定16中的1,292,073次调用。
- 生成后的search保留50个运行方法，删除35个方法、195条无关构造语句，以及4个热循环中的确定空
  调用点。
- leaf保留31个运行方法；path保留20个，删除5个未到达path方法。
- 生成器由runtime evidence驱动，UT逐项验证prototype方法集合并验证重复生成SHA-256稳定。

## 星图缓存

原实现每次leaf评价都对星位置执行一次全图BFS。两项cache在固定16中得到：

| 模式 | 请求 | BFS重建 | 命中 |
|---|---:|---:|---:|
| 无缓存 | 133,901 | 133,901 | 0 |
| cache=1 | 133,901 | 200 | 133,701 |
| cache=2 | 133,901 | 77 | 133,824 |
| cache=4 | 133,901 | 77 | 133,824 |

选择两项cache，因为与四项的重建数相同且内存更小。cache identity不能只使用
`TERRAIN_VERSION`：两个搜索分支可能各破坏不同土块但拥有相同version。因此采用严格身份：

1. `beginRoot`只在根地图变化时保存一次完整地形快照；
2. cache entry绑定根拓扑generation；
3. 同一根内读取FastState已有delta日志，比较实际改变的terrain cell集合；
4. 真实根后来到达已缓存分支拓扑时，进行稀有的完整重绑定；
5. 独立、不遵守`beginRoot`合同的调用仍保留整图校验。

固定16分支格比较从3,395,124降到2,769；Discovery64中701,283次cache lookup只需10,028次分支
格比较，BFS仅重建434次。所有同version不同terrain、undo、跨根重绑定fixture均逐值等价。

## 几何表

leaf方法普查中`target`调用4,969,169次，`walkable`调用4,801,677次。每次`target`原本通过`%`和
整数除法恢复x/y。现在每个控制器一次分配并按地图尺寸构造：

- `neighbor[cell*4+direction]`；
- `cellX[cell]`；
- `cellY[cell]`。

总固定BasePolicy search/leaf/path TypedArray为48,939字节；热路径无分配。全cell、全方向UT与原始
坐标公式一致。

## 行为与性能

固定16最终为21胜11负，候选动作指纹
`e40ea471198b7eaea3dbb4b0591f86df973f0b43d49614f44a3e50da0574e998`。Discovery64最终为
67胜48负13平、57.42%，候选动作指纹
`d6db15f8815dc9243ef758778bbeb558b6492f801e73e2fc36e4bd35f1162555`。两组相对各自native-only
基线的动作、参数、result、frame、counts、分析结果和终局类别差异均为0。

Discovery64本地候选总耗时28,311,019µs→23,923,383µs，下降15.50%；P95
10,550µs→10,330µs。由于不同轮的V1宿主总耗时也变化，本结果只能证明候选绝对工作减少并提供本地
相对趋势，不能作为平台3秒或发布资格证据。

源码体积：search 82,009字节、leaf 29,361字节、path 16,007字节；三个独立Terser结果合计
76,234字节。最终上传包仍需整体bundle tree-shaking/minify，不能把独立压缩体积直接相加当成平台包。

## 下一步

BP171已经完成同进程五批标定：每个模式先预热一次，5批均使用相同8场景并交替先后顺序；每批读取
动作指纹后立即删除逐局artifact。优化版总耗时5/5批更低，中位比率82.48%；P95中位比率77.18%，
但仅3/5批更低。动作、参数、结果、frame和物理计数每批零差异。因此接受cache=2和geometry table，
但P95只记噪声较大的本地趋势。

后续顺序：

1. 把thin owner/domain/intent/opponent/search/leaf/path组成无诊断依赖的单一NativeBasePolicyRoot。
2. 对新root做逐帧动作等价和source/minified等价，再决定是否成为production candidate。
3. 只有接入后的完整候选才重新标定depth/fallback；本轮不改搜索深度。

机器证据：

- `config/engine-v3/base-policy-kernel-bp165-bp170-performance-evidence.json`；
- `config/engine-v3/base-policy-kernel-bp171-runtime-calibration.json`。
