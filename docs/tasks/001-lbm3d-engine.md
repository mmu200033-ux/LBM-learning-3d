# 任务 001：催化层重构与 D3Q7 氧气求解器（引擎层）

设计文档：`docs/design/lbm3d-cl.md`。先读它的"与论文和代码的对应""已定稿的决定"和"物理模型"三节。

## 目标

用 JS 移植论文代码中的催化层重构算法和 D3Q7 MRT 氧气传质求解器。现有原型界面（`index.html`、`style.css`、`src/app.js`、`src/ui/`）通过 `src/engine/mock-engine.js`（简化的假数据层）运行；本任务写真实引擎，界面的接入和改版是任务 002 的事。

## 参照代码（只读）

`lbm3d-cl/reference/cl-model/` 下的 `carbon.c`、`pt.c`、`ionomer.c`、`pore.c`、`mass_transfer.cu`。移植时**以代码为准**；代码与论文公式不一致的地方照代码实现，并写进汇报的偏离说明。唯一例外是周期边界，见下文"算法要求"。

## 允许改动的文件

- 新建：`lbm3d-cl/src/engine/reconstruct.js`、`d3q7.js`、`index.js`、`rng.js`（可选）、`lbm3d-cl/test/**`、`lbm3d-cl/tools/**`、`lbm3d-cl/vendor/**`、`lbm3d-cl/package.json`
- 修改：根目录 `.gitignore`（追加 `lbm3d-cl/reference/` 和 `lbm3d-cl/out/`）

**不改**：`index.html`、`style.css`、`src/app.js`、`src/ui/`、`src/engine/mock-engine.js`、`reference/`、`.claude/`。

## 第 0 步：提交基线

先单独提交现有文件，作为任务 001/002 的基线，提交信息 `[设计] lbm3d-cl 设计文档、任务说明与原型界面`：

- `docs/design/lbm3d-cl.md`、`docs/tasks/001-lbm3d-engine.md`、`docs/tasks/002-lbm3d-ui.md`
- `lbm3d-cl/index.html`、`lbm3d-cl/style.css`、`lbm3d-cl/src/app.js`、`lbm3d-cl/src/ui/*.js`、`lbm3d-cl/src/engine/mock-engine.js`
- `.gitignore`（同时追加上面两行）

不要提交 `lbm3d-cl/reference/` 和 `.claude/`。

## 模块与接口

全部为 ES 模块，浏览器和 Node 都能直接 `import`，引擎内不访问 DOM。数组一律用 TypedArray，一维下标 `i = x + L*(y + H*z)`。

`src/engine/index.js` 统一导出 `PHASE, E, WEIGHT, OPP, SUBSTEPS, reconstruct, createSolver`，导出名与 `mock-engine.js` 相同，任务 002 只需改一行 import。

### `src/engine/reconstruct.js`

```js
export const PHASE = { PORE: 0, IONOMER: 1, CARBON: 2, PT: 3, BUFFER: 4, WALL: 5 };
export function reconstruct(params) -> Structure
```

`params`（均有默认值，见设计文档"默认参数"）：`L, H, W, dx, radius, porosity, ptc, ic, seed, bufferLayers`（默认 3）。

`Structure`：

```js
{
  L, H, W, dx,
  phase:   Uint8Array(N),   // 0~5
  order:   Int32Array(N),   // 该格点在重构中被写入的序号，从 0 连续递增；未写入为 -1（界面用来回放构建过程）
  stages:  [{ name, start, end }],
  // 依次为 'empty' | 'carbon-init' | 'carbon-grow' | 'pt' | 'ionomer' | 'buffer-wall' | 'tau'
  // start/end 为 order 的闭区间；'empty' 与 'tau' 为空区间（end = start − 1）
  spheres: [{ x, y, z, r, stage }], // 每个碳球的球心与实际半径（radius−1）
  poreSize: Float32Array(N),        // 局部孔径（格数），非孔隙为 0
  fractions: { carbon, pt, ionomer, pore }, // 实际体积分数（只统计缓冲层以内）
  targets:   { carbon, pt, ionomer, pore }  // 按式 (2-5)~(2-8) 算出的目标值
}
```

算法要求：

- **周期边界（设计决定，覆盖原代码）**：碳球、铂、离聚物的生成在 y、z 方向全部周期：碳球跨出 y/z 边界的部分从对面接上；铂、离聚物判断邻居时 y、z 取模。x 方向不周期，碳球在 x 方向截断。原 `carbon.c` 不周期，列入偏离说明。
- 碳：照 `carbon.c` `generate1_carbon`。初始球数 = 碳目标格点数·0.2 ÷ (4/3·π·radius³)，初始球与已有碳不重叠；之后重叠率 ∈ (0, 0.2]，判定方式照代码；球内判据 d² ≤ (radius−1)²（d 按 y、z 周期的最短距离算）。
- 铂：照 `pt.c` 的随机赋值与概率区间（可沿已有铂继续生长）。
- 离聚物：照 `ionomer.c`。
- 目标分数由 porosity、ptc、ic 和密度（碳 1800、铂 21450、离聚物 2000 mg/cm³）按论文式 (2-5)~(2-8) 计算，不要照抄 C 代码里写死的分数。
- 孔径：照 `pore.c` 的 13 方向法，y、z 周期。
- 缓冲层与墙：照 `mass_transfer.cu` `initboundary`，x 两端各 `bufferLayers` 层设为 4，x=0 和 x=L−1 设为 5。碳、铂、离聚物只生成在缓冲层以内。
- 随机数用带种子的 PRNG（如 mulberry32），同一 seed 结果完全一致。不必复刻 C 的 `rand()` 序列。
- C 代码里明显的笔误（如 `carbon.c:447` 用 H 夹 z）按正确意图实现，并列入偏离说明。

### `src/engine/d3q7.js`

```js
export const E = [[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]; // 与 mass_transfer.cu 的 p0..p6 一致
export const WEIGHT = [1/4, 1/8, 1/8, 1/8, 1/8, 1/8, 1/8];
export const OPP = [0, 2, 1, 4, 3, 6, 5];
export const SUBSTEPS = ['stream', 'bounce', 'inlet', 'macro', 'reaction', 'collide'];
export function createSolver(structure, params) -> Solver
```

`params`：`dt, T, RH, cIn, eta, D0, kis, Hi, i0, cref, molarMass, reactionStartStep`。默认值取 `mass_transfer.cu` 顶部常数；`eta` 默认 0.3；`molarMass` 默认 32（照代码）；`reactionStartStep` 默认 0。

`Solver`：

```js
{
  t,                         // 已完成的完整时间步数
  substep,                   // 下一个要执行的子步下标 0~5
  lastSubstep,               // 刚执行完的子步下标，未执行过为 -1
  params,                    // 实际生效的参数（含默认值）
  c:   Float64Array(N),      // 宏观浓度 mol/m³
  tau: Float64Array(N),      // 每格点 τ
  D:   Float64Array(N),      // 每格点扩散系数 m²/s
  src: Float64Array(N),      // 本时间步每格点消耗的浓度 mol/m³（collide 中扣除的量）
  stepSub(),                 // 执行一个子步，返回其名字
  step(n = 1),               // 先补完当前时间步剩余子步，再走 n−1 个完整时间步；n=1 且 substep=0 时正好走一个完整时间步
  current(k, i),             // 当前状态下格点 i 第 k 个分量的值（见下文"当前状态"）
  node(i) -> { phase, c, tau, D, src, f: [7] },   // f 为 current(0..6, i)
  block(x0, y0, z0, n) -> Float64Array(7*n³),     // n³ 小块的当前分量，下标 k*n³ + (dx + n*(dy + n*dz))，y、z 周期取模，x 越界填 NaN
  profileX() -> { pore: Float64Array(L), ionomer: Float64Array(L) },  // 每个 x 截面的平均浓度，该截面无此相时为 NaN
  diagnostics() -> { t, timeSeconds, inletFlux, totalReaction, balanceError, totalO2 },  // 通量与反应换算为 A/cm²
  reset()
}
```

**当前状态**：每执行完一个子步，`current`/`node`/`block` 都返回该子步之后的分量值。界面在子步前后各取一次 `block`，用来画逐格点动画和"前 / 后 / Δ"。具体缓冲区如何安排由你决定，但必须满足这一语义。

六个子步的内容和顺序照 `mass_transfer.cu` 主循环中的氧气部分：`streamoxy`（含共轭界面）→ `bboxy` → `bdoxy` → `macrofluidoxy` → `bc`（固定 η：用 η 代替 φ_ion − φ_ele，去掉对质子、电子电势的判断）→ `collideoxy`（含负值截断）。`diffusivity` 在创建时算一次。

性能：64×32×32 时，单个完整时间步在 Node 下中位数目标 ≤ 15 ms。达不到就如实汇报实测值，不要为此改变数值格式。

## 测试（`lbm3d-cl/test/`，`node --test`）

1. 重构：默认参数下，碳、铂、离聚物、孔隙的实际分数与目标值相差 ≤ 0.02（绝对值）；每个铂格点在 y、z 周期意义下至少有一个碳邻居；同一 seed 两次结果逐字节一致；碳最大连通团（6 邻接，y、z 周期）≥ 碳格点总数的 95%；`order` 在已写入格点上恰为 0..max 的排列。
2. 守恒：全孔隙、四周全墙、无入口、无反应的封闭域，随机初值，运行 2000 步后 Σc 相对变化 ≤ 1e-10。
3. 一维瞬态扩散：全孔隙、无反应、入口恒浓度。在离入口足够远、尚未感受到出口的时刻，x 方向剖面与 c_in·erfc(x / 2√(Dt)) 的最大相对误差 ≤ 3%。
4. 碰撞单点：给定一组 f 和 τ，碰撞结果与按 `collideoxy` 公式手算的值一致（误差 ≤ 1e-12）。
5. 稳态通量平衡：默认结构跑到稳态（Σc 每 1000 步相对变化 < 1e-6），|入口通量 − 总反应消耗| / 入口通量 ≤ 1%。
6. 子步语义：随机结构跑 50 步后，逐个执行 6 个子步，每次执行前后 `block` 的结果与按该子步定义直接计算的结果一致；`lastSubstep` 正确；跑完 6 个子步后 `t` 加 1。

## 验收产物

`lbm3d-cl/tools/snapshot.mjs`，运行 `node tools/snapshot.mjs` 输出到 `lbm3d-cl/out/`（不入库）：

- `phase-z16.png`：z=16 截面的相别图，固定占位色：孔隙白、离聚物 #4a90d9、碳 #333、铂 #e0a020、缓冲层 #ccc、墙黑。每格点放大 8 像素。
- `phase-z0.png`、`phase-z31.png`：两个 z 边界截面，用来目视检查周期接缝。
- `conc-z16-t{0,100,1000,稳态}.png`：同截面浓度灰度图，0 为黑、c_in 为白，固相用占位色。
- `profile.csv`：稳态时各 x 的孔内、离聚物内平均浓度。
- `sweep.csv`：η = 0.2、0.25、0.3、0.35、0.4 V，以及 molarMass = 32 和 0.032 两种情况（共 10 组），每组记录稳态所需步数、出口侧（x=L−4）孔内平均浓度 ÷ c_in、总反应消耗、单步耗时。

PNG 用 Node 自带的 zlib 自己写编码，不加依赖。

`lbm3d-cl/tools/serve.mjs`：在 8770 端口提供 `lbm3d-cl/` 的静态文件服务，正确设置 `.mjs`/`.js` 的 MIME 类型。

`lbm3d-cl/vendor/`：放入 three.js r170 的 `three.module.min.js` 和 `OrbitControls.js`（改成相对路径导入），附上版本号和 LICENSE。

## 提交

第 0 步的基线提交之后，工程部分单独提交，提交信息 `[工程] lbm3d-cl 引擎：周期重构与 D3Q7 氧气求解器`。只 `git add` 本任务的文件。

## 汇报要回答

1. 测试命令和每项结果，单步耗时实测值。
2. `sweep.csv` 的内容，以及你观察到的现象：哪组 η 下浓度梯度最明显而不耗尽到 0。
3. 加大 Δt（例如 ×10、×100）对收敛步数和稳态剖面的影响，各一句话。
4. 偏离说明：代码与论文不一致处、周期边界的改动、修正的笔误、移植中不得已的改动。
5. 推断清单：任务说明和参照代码都没写明、靠你推断的地方。
6. 已知问题。
