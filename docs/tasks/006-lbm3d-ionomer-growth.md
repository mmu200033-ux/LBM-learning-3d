# 任务 006：离聚物生成改回迭代生长算法并降低体积分数

背景：`docs/design/lbm3d-cl.md`。基线是当前 HEAD（任务 005 `0dc0bb6` + 任务 003 `958e84c`）。

## 问题

当前 `reconstruct.js` 的离聚物生成用一次打分排序（`reconstruct.js:236-262`），导致 17.6% 的离聚物不贴固相、6.9% 完全孤立在孔隙中。真实催化层里离聚物是紧贴碳/铂表面的 Nafion 薄膜（几纳米到几十纳米），不会悬浮在孔隙里。

原代码 `reference/cl-model/ionomer.c:82-270` 用迭代生长：每轮在已有离聚物/碳/铂的 6 邻居中随机挑概率最高的孔隙格点长出去，重复数千轮直到达到目标体积分数。这让离聚物 100% 贴固相、连成片，物理上更真实。

**性能影响**：迭代算法在 64×32×32 上跑 20000 轮约需 **37 秒**（当前打分排序 < 0.1 秒），但它只在页面加载时执行一次，后续拖动时间轴、切换时间步都不重新生成，所以可以接受。

**体积分数**：当前代码 `ic` 已经是 `0.6`（`reconstruct.js:43`），在迭代算法下会生成约 10000 个离聚物格点（占内部区域约 16%）。如果你论文里用的离聚物/碳质量比不是 0.6，请在验收前告诉我，我改 `ic` 参数。

## 要做的

1. **改回迭代生长算法**：
   - 删除 `reconstruct.js:236-262` 的打分排序逻辑。
   - 按 `ionomer.c` 原算法实现迭代生长，伪代码：
     ```javascript
     const prob = new Int32Array(N).fill(-1);
     let count = 0;
     while (count < targetIonomer && passes < 某个上限) {
       passes++;
       // 顺序同原代码：离聚物邻居 20000 → 碳邻居 10000 → 铂邻居 5000
       for (const [srcPhase, range] of [[PHASE.IONOMER, 20000], [PHASE.CARBON, 10000], [PHASE.PT, 5000]]) {
         for (let i in 有效区域) {
           if (phase[i] !== srcPhase) continue;
           for (const j of 6邻居(i)) {
             if (phase[j] === PHASE.PORE) prob[j] = random() % range;
           }
         }
       }
       for (let i in 有效区域) {
         if (phase[i] === PHASE.PORE && prob[i] > 0 && prob[i] < 20) {
           phase[i] = PHASE.IONOMER;
           order[i] = sequence++;
           count++;
         }
       }
     }
     ```
   - 有效区域：x ∈ [x0, x1)、y、z 周期。
   - 随机数用 `mulberry32(seed + 某偏移)`，每次 `reconstruct` 调用时新建一个生成器。
   - 迭代上限建议 20000。达到上限还没到目标时，在控制台 `console.warn` 一次，说明实际生成了多少、目标是多少。

2. **保持当前 `ic = 0.6`**：
   - 代码里已经是 `const ic = params.ic ?? 0.6;`（`reconstruct.js:43`），不用改。

3. **验证**：
   - 跑我的对比脚本（在汇报里粘贴输出）：
     ```bash
     node C:\Users\15263\AppData\Local\Temp\lbm-scratch\ionomer-stats.mjs
     ```
   - 确认"不贴碳/铂"接近 0%、"距固相 1 格"接近 100%。

## 允许改动的文件

- 修改：`lbm3d-cl/src/engine/reconstruct.js`

**不改**：`src/ui/`、`index.html`、`style.css`、`src/app.js`（任务 005 可能同时在改这些文件）、`d3q7.js`、`test/`、`tools/`、`reference/`、`docs/`、`.claude/`。

## 验收

- `node C:\Users\15263\AppData\Local\Temp\lbm-scratch\ionomer-stats.mjs` 输出："不贴碳/铂" ≤ 1%、"距固相 1 格" ≥ 98%。
- `node --test lbm3d-cl/test` 的 6 项测试仍然通过（离聚物分布变了但测试逻辑不依赖具体形貌）。
- `node --check lbm3d-cl/src/engine/reconstruct.js` 通过。

## 提交

能提交就提交，信息 `[工程] lbm3d-cl 离聚物生成改回迭代生长算法`；不能就在汇报里说明，由我提交。

## 汇报要回答

1. 迭代了多少轮、实际生成了多少离聚物格点、目标是多少。
2. 对比脚本的输出（粘贴完整）。
3. 测试是否通过。
4. 推断清单、偏离说明、已知问题。
