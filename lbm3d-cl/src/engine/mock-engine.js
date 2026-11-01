// 假数据层：接口与任务 001 一致，物理做了简化（BGK、无共轭界面、τ 被夹在稳定区间）。
// 任务 001 完成后由真实引擎替换。

export const PHASE = { PORE: 0, IONOMER: 1, CARBON: 2, PT: 3, BUFFER: 4, WALL: 5 };
export const E = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
export const WEIGHT = [1 / 4, 1 / 8, 1 / 8, 1 / 8, 1 / 8, 1 / 8, 1 / 8];
export const SUBSTEPS = ['stream', 'bounce', 'inlet', 'macro', 'reaction', 'collide'];
const OPP = [0, 2, 1, 4, 3, 6, 5];
const NB6 = E.slice(1);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 式 (2-5)~(2-8)，Pt/C、I/C 取质量比 m/mC
function targetFractions(porosity, ptc, ic) {
  const rhoC = 1800, rhoPt = 21450, rhoI = 2000;
  const carbon = (1 - porosity) / (1 + (rhoC * ptc) / rhoPt + (rhoC * ic) / rhoI);
  return { carbon, pt: (carbon * rhoC * ptc) / rhoPt, ionomer: (carbon * rhoC * ic) / rhoI, pore: porosity };
}

export function reconstruct(params = {}) {
  const L = params.L ?? 64, H = params.H ?? 32, W = params.W ?? 32;
  const dx = params.dx ?? 5e-9;
  const radius = params.radius ?? 5;
  const bl = params.bufferLayers ?? 3;
  const rng = mulberry32(params.seed ?? 42);
  const N = L * H * W;
  const idx = (x, y, z) => x + L * (y + H * z);
  const phase = new Uint8Array(N);
  const order = new Int32Array(N).fill(-1);
  const stages = [];
  const spheres = [];
  let seq = 0;

  const targets = targetFractions(params.porosity ?? 0.4, params.ptc ?? 0.6, params.ic ?? 0.6);
  const x0 = bl, x1 = L - bl;               // 催化层内部 [x0, x1)
  const Ninner = (x1 - x0) * H * W;
  const nTargetC = Math.round(targets.carbon * Ninner);
  const nTargetPt = Math.round(targets.pt * Ninner);
  const nTargetI = Math.round(targets.ionomer * Ninner);
  const r2 = (radius - 1) * (radius - 1);

  const randCenter = () => [x0 + Math.floor(rng() * (x1 - x0)), Math.floor(rng() * H), Math.floor(rng() * W)];
  function sphereVoxels(cx, cy, cz) {
    const out = [];
    for (let x = Math.max(x0, cx - radius); x <= Math.min(x1 - 1, cx + radius); x++)
      for (let y = Math.max(0, cy - radius); y <= Math.min(H - 1, cy + radius); y++)
        for (let z = Math.max(0, cz - radius); z <= Math.min(W - 1, cz + radius); z++)
          if ((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2 <= r2) out.push(idx(x, y, z));
    return out;
  }
  function placeCarbon(vox) {
    let added = 0;
    for (const i of vox) if (phase[i] === PHASE.PORE) { phase[i] = PHASE.CARBON; order[i] = seq++; added++; }
    return added;
  }

  stages.push({ name: 'empty', start: 0, end: -1 });

  // 初始碳球：互不重叠
  let start = seq, nC = 0;
  const nInit = Math.max(1, Math.floor((nTargetC * 0.2) / ((4 / 3) * Math.PI * radius ** 3)));
  for (let n = 0; n < nInit; n++) {
    for (let tries = 0; tries < 2000; tries++) {
      const [cx, cy, cz] = randCenter();
      const vox = sphereVoxels(cx, cy, cz);
      if (vox.some(i => phase[i] === PHASE.CARBON)) continue;
      nC += placeCarbon(vox);
      spheres.push({ x: cx, y: cy, z: cz, r: radius - 1, stage: 'carbon-init' });
      break;
    }
  }
  stages.push({ name: 'carbon-init', start, end: seq - 1 });

  // 碳生长：与已有碳重叠率 (0, 0.2]
  start = seq;
  for (let tries = 0; nC < nTargetC && tries < 40000; tries++) {
    const [cx, cy, cz] = randCenter();
    const vox = sphereVoxels(cx, cy, cz);
    const overlap = vox.filter(i => phase[i] === PHASE.CARBON).length / vox.length;
    if (overlap <= 0 || overlap > 0.2) continue;
    nC += placeCarbon(vox);
    spheres.push({ x: cx, y: cy, z: cz, r: radius - 1, stage: 'carbon-grow' });
  }
  stages.push({ name: 'carbon-grow', start, end: seq - 1 });

  const neighbors = i => {
    const x = i % L, y = Math.floor(i / L) % H, z = Math.floor(i / (L * H));
    const out = [];
    for (const [dx, dy, dz] of NB6) {
      const nx = x + dx;
      if (nx < x0 || nx >= x1) continue;
      out.push(idx(nx, (y + dy + H) % H, (z + dz + W) % W));
    }
    return out;
  };

  // 铂：只放在与碳相邻的孔隙格点上
  start = seq;
  const ptCand = [];
  for (let i = 0; i < N; i++) {
    const x = i % L;
    if (x < x0 || x >= x1 || phase[i] !== PHASE.PORE) continue;
    if (neighbors(i).some(j => phase[j] === PHASE.CARBON)) ptCand.push(i);
  }
  for (let i = ptCand.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [ptCand[i], ptCand[j]] = [ptCand[j], ptCand[i]];
  }
  for (let k = 0; k < Math.min(nTargetPt, ptCand.length); k++) { phase[ptCand[k]] = PHASE.PT; order[ptCand[k]] = seq++; }
  stages.push({ name: 'pt', start, end: seq - 1 });

  // 离聚物：贴铂概率最高，其次已有离聚物，再次碳
  start = seq;
  let nI = 0;
  for (let pass = 0; pass < 400 && nI < nTargetI; pass++) {
    for (let i = 0; i < N && nI < nTargetI; i++) {
      const x = i % L;
      if (x < x0 || x >= x1 || phase[i] !== PHASE.PORE) continue;
      let w = 0;
      for (const j of neighbors(i)) {
        const p = phase[j];
        if (p === PHASE.PT) w += 0.6; else if (p === PHASE.IONOMER) w += 0.25; else if (p === PHASE.CARBON) w += 0.08;
      }
      if (w > 0 && rng() < w * 0.04) { phase[i] = PHASE.IONOMER; order[i] = seq++; nI++; }
    }
  }
  stages.push({ name: 'ionomer', start, end: seq - 1 });

  // 缓冲层与墙
  start = seq;
  for (let i = 0; i < N; i++) {
    const x = i % L;
    if (x === 0 || x === L - 1) { phase[i] = PHASE.WALL; order[i] = seq++; }
    else if (x < x0 || x >= x1) { phase[i] = PHASE.BUFFER; order[i] = seq++; }
  }
  stages.push({ name: 'buffer-wall', start, end: seq - 1 });
  stages.push({ name: 'tau', start: seq, end: seq - 1 });

  // 局部孔径：13 方向（正反两向弦长相加）取平均，单位格
  const dirs13 = [[1,0,0],[0,1,0],[0,0,1],[1,1,0],[1,-1,0],[1,0,1],[1,0,-1],[0,1,1],[0,1,-1],[1,1,1],[-1,1,1],[1,-1,1],[1,1,-1]];
  const poreSize = new Float32Array(N);
  const isPore = (x, y, z) => x >= x0 && x < x1 && phase[idx(x, (y % H + H) % H, (z % W + W) % W)] === PHASE.PORE;
  for (let i = 0; i < N; i++) {
    if (phase[i] !== PHASE.PORE) continue;
    const x = i % L, y = Math.floor(i / L) % H, z = Math.floor(i / (L * H));
    let sum = 0;
    for (const [a, b, c] of dirs13) {
      let len = 1;
      for (let s = 1; s < 40 && isPore(x + a * s, y + b * s, z + c * s); s++) len++;
      for (let s = 1; s < 40 && isPore(x - a * s, y - b * s, z - c * s); s++) len++;
      sum += len;
    }
    poreSize[i] = sum / 13;
  }

  const count = p => { let n = 0; for (let i = 0; i < N; i++) { const x = i % L; if (x >= x0 && x < x1 && phase[i] === p) n++; } return n / Ninner; };
  const fractions = { carbon: count(PHASE.CARBON), pt: count(PHASE.PT), ionomer: count(PHASE.IONOMER), pore: count(PHASE.PORE) };

  return { L, H, W, dx, phase, order, stages, spheres, poreSize, fractions, targets };
}

export function createSolver(structure, params = {}) {
  const { L, H, W, dx, phase, poreSize } = structure;
  const N = L * H * W;
  const dt = params.dt ?? 2.5e-12;
  const T = params.T ?? 348;
  const RH = params.RH ?? 1.0;
  const cIn = params.cIn ?? 7.354;
  const eta = params.eta ?? 0.33;
  const D0 = params.D0 ?? 5e-5;
  const i0 = params.i0 ?? 1.5e-3;
  const cref = params.cref ?? 40;
  const M = params.molarMass ?? 32;
  const F = 96485, R = 8.314;

  const fluid = new Uint8Array(N);
  for (let i = 0; i < N; i++) fluid[i] = phase[i] === PHASE.PORE || phase[i] === PHASE.IONOMER || phase[i] === PHASE.BUFFER ? 1 : 0;

  // 邻居表：nbr[k*N+i]，y、z 周期，x 越界为 -1
  const nbr = new Int32Array(7 * N);
  for (let i = 0; i < N; i++) {
    const x = i % L, y = Math.floor(i / L) % H, z = Math.floor(i / (L * H));
    for (let k = 0; k < 7; k++) {
      const nx = x + E[k][0];
      nbr[k * N + i] = nx < 0 || nx >= L ? -1 : nx + L * (((y + E[k][1] + H) % H) + H * ((z + E[k][2] + W) % W));
    }
  }

  // 扩散系数与 τ（同 mass_transfer.cu:341，原型里 τ 夹在 [0.505, 1.9]）
  const lambda = 0.043 + 17.18 * RH - 39.85 * RH * RH + 36 * RH ** 3;
  const Dion = 1.14698e-10 * Math.pow(lambda, 0.708);
  const tau = new Float64Array(N), D = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let d = 0;
    if (phase[i] === PHASE.PORE) {
      const dkn = (1 / 3) * Math.sqrt((8 * R * T) / (Math.PI * M)) * poreSize[i] * dx;
      d = 1 / (1 / dkn + 1 / 2.84e-5);
    } else if (phase[i] === PHASE.IONOMER) d = Dion;
    else if (phase[i] === PHASE.BUFFER) d = D0;
    D[i] = d;
    tau[i] = fluid[i] ? Math.min(1.9, Math.max(0.505, 0.5 + (4 * d * dt) / (dx * dx))) : 0;
  }

  const f = new Float64Array(7 * N);   // 碰撞后
  const g = new Float64Array(7 * N);   // 迁移后（工作区）
  const c = new Float64Array(N);
  const src = new Float64Array(N);     // 每步消耗的浓度 mol/m³
  let t = 0, substep = 0;

  const kBV = (4 * 0.5 * F) / (R * T);
  const rateCoef = (i0 / (cref * dx)) * (Math.exp(kBV * eta) - Math.exp(-kBV * eta)) * (dt / (4 * F));
  const ptCount = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    if (phase[i] !== PHASE.IONOMER) continue;
    for (let k = 1; k < 7; k++) { const j = nbr[k * N + i]; if (j >= 0 && phase[j] === PHASE.PT) ptCount[i]++; }
  }

  const ops = {
    stream() {
      for (let i = 0; i < N; i++) {
        if (!fluid[i]) continue;
        g[i] = f[i];
        for (let k = 1; k < 7; k++) { const j = nbr[k * N + i]; if (j >= 0) g[k * N + j] = f[k * N + i]; }
      }
    },
    bounce() {
      // 同 bboxy：到达固相格点的分量沿反方向送回来源格点
      for (let i = 0; i < N; i++) {
        if (fluid[i]) continue;
        for (let k = 1; k < 7; k++) {
          const s = nbr[OPP[k] * N + i];
          if (s >= 0 && fluid[s]) g[OPP[k] * N + s] = g[k * N + i];
        }
      }
    },
    inlet() {
      // 同 bdoxy：x=1 缓冲层格点 f1 = 2·w1·c_in − f2
      for (let z = 0; z < W; z++) for (let y = 0; y < H; y++) {
        const i = 1 + L * (y + H * z);
        if (fluid[i]) g[N + i] = 2 * WEIGHT[1] * cIn - g[2 * N + i];
      }
    },
    macro() {
      for (let i = 0; i < N; i++) {
        if (!fluid[i]) { c[i] = 0; continue; }
        let s = 0;
        for (let k = 0; k < 7; k++) s += g[k * N + i];
        c[i] = s;
      }
    },
    reaction() {
      for (let i = 0; i < N; i++) src[i] = ptCount[i] && c[i] > 0 ? Math.min(c[i], rateCoef * c[i] * ptCount[i]) : 0;
    },
    collide() {
      for (let i = 0; i < N; i++) {
        if (!fluid[i]) continue;
        const ta = tau[i], ci = c[i], si = src[i];
        for (let k = 0; k < 7; k++) {
          const gi = g[k * N + i];
          const v = gi - (gi - WEIGHT[k] * ci) / ta - WEIGHT[k] * si;
          f[k * N + i] = v > 0 ? v : 0;
        }
      }
    },
  };

  function stepSub() {
    const name = SUBSTEPS[substep];
    ops[name]();
    substep = (substep + 1) % 6;
    if (substep === 0) t++;
    return name;
  }
  function step(n = 1) {
    for (let s = 0; s < n; s++) { do stepSub(); while (substep !== 0); }
  }
  const buf = () => (substep === 0 ? f : g);

  function node(i) {
    const b = buf();
    return { phase: phase[i], c: c[i], tau: tau[i], D: D[i], src: src[i], f: Array.from({ length: 7 }, (_, k) => b[k * N + i]) };
  }

  function profileX() {
    const pore = new Float64Array(L), ionomer = new Float64Array(L), np = new Float64Array(L), ni = new Float64Array(L);
    for (let i = 0; i < N; i++) {
      const x = i % L;
      if (phase[i] === PHASE.PORE) { pore[x] += c[i]; np[x]++; }
      else if (phase[i] === PHASE.IONOMER) { ionomer[x] += c[i]; ni[x]++; }
    }
    for (let x = 0; x < L; x++) { pore[x] = np[x] ? pore[x] / np[x] : NaN; ionomer[x] = ni[x] ? ionomer[x] / ni[x] : NaN; }
    return { pore, ionomer };
  }

  function diagnostics() {
    // 等效电流密度 A/cm²：入口为 x=1→2 截面的净通量，反应为全场消耗
    let flux = 0, rxn = 0, tot = 0;
    for (let z = 0; z < W; z++) for (let y = 0; y < H; y++) {
      const a = 1 + L * (y + H * z), b = a + 1;
      flux += f[N + a] - f[2 * N + b];
    }
    for (let i = 0; i < N; i++) { rxn += src[i]; tot += c[i]; }
    const toCurrent = v => (4 * F * v * dx) / (dt * H * W) / 1e4;
    const inletFlux = toCurrent(flux), totalReaction = toCurrent(rxn);
    return {
      t, timeSeconds: t * dt, inletFlux, totalReaction,
      balanceError: inletFlux > 0 ? Math.abs(inletFlux - totalReaction) / inletFlux : 0,
      totalO2: tot,
    };
  }

  function reset() { f.fill(0); g.fill(0); c.fill(0); src.fill(0); t = 0; substep = 0; }

  return {
    get t() { return t; }, get substep() { return substep; },
    c, f, tau, D, src, params: { dt, eta, cIn },
    stepSub, step, node, profileX, diagnostics, reset,
  };
}
