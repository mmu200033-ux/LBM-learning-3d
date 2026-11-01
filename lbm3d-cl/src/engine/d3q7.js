import { PHASE } from './reconstruct.js';

export const E = Object.freeze([
  [0, 0, 0],
  [1, 0, 0], [-1, 0, 0],
  [0, 1, 0], [0, -1, 0],
  [0, 0, 1], [0, 0, -1],
]);
export const WEIGHT = Object.freeze([1 / 4, 1 / 8, 1 / 8, 1 / 8, 1 / 8, 1 / 8, 1 / 8]);
export const OPP = Object.freeze([0, 2, 1, 4, 3, 6, 5]);
export const SUBSTEPS = Object.freeze(['stream', 'bounce', 'inlet', 'macro', 'reaction', 'collide']);

const R = 8.314;
const F = 96485;
const DIR_COUNT = 7;
const wrap = (value, size) => ((value % size) + size) % size;

function makeParams(params) {
  return {
    dt: params.dt ?? 1e-11,
    T: params.T ?? 348,
    RH: params.RH ?? 1,
    cIn: params.cIn ?? 7.354,
    eta: params.eta ?? 0.3,
    D0: params.D0 ?? 5e-5,
    kis: params.kis ?? 1e-2,
    Hi: params.Hi ?? 1.5,
    i0: params.i0 ?? 1.5e-3,
    cref: params.cref ?? 40,
    molarMass: params.molarMass ?? 32,
    reactionStartStep: params.reactionStartStep ?? 0,
  };
}

export function createSolver(structure, input = {}) {
  if (!structure || !structure.phase) throw new TypeError('createSolver requires a reconstruction structure');
  const { L, H, W, dx, phase, poreSize } = structure;
  const params = makeParams(input);
  const N = L * H * W;
  const fluid = new Uint8Array(N);
  const nbr = new Int32Array(DIR_COUNT * N).fill(-1);
  const tau = new Float64Array(N);
  const D = new Float64Array(N);
  const c = new Float64Array(N);
  const src = new Float64Array(N);
  const f = new Float64Array(DIR_COUNT * N);
  const g = new Float64Array(DIR_COUNT * N);
  const ptCount = new Uint8Array(N);

  const idx = (x, y, z) => x + L * (y + H * z);
  for (let i = 0; i < N; i += 1) {
    const x = i % L;
    const yz = Math.floor(i / L);
    const y = yz % H;
    const z = Math.floor(yz / H);
    fluid[i] = (phase[i] === PHASE.PORE || phase[i] === PHASE.IONOMER || phase[i] === PHASE.BUFFER) ? 1 : 0;
    for (let k = 0; k < DIR_COUNT; k += 1) {
      const nx = x + E[k][0];
      if (nx >= 0 && nx < L) nbr[k * N + i] = idx(nx, wrap(y + E[k][1], H), wrap(z + E[k][2], W));
    }
  }

  const lambda = 0.043 + 17.18 * params.RH - 39.85 * params.RH ** 2 + 36 * params.RH ** 3;
  const dIonomer = 1.14698e-10 * Math.pow(Math.max(0, lambda), 0.708);
  const cSound2 = 0.25;
  for (let i = 0; i < N; i += 1) {
    let diffusivity = 0;
    if (phase[i] === PHASE.PORE) {
      const pore = Math.max(1e-6, poreSize?.[i] ?? 0);
      const dKn = (1 / 3) * Math.sqrt((8 * R * params.T) / (Math.PI * params.molarMass)) * pore * dx;
      diffusivity = 1 / (1 / dKn + 1 / 2.84e-5);
    } else if (phase[i] === PHASE.IONOMER) {
      diffusivity = dIonomer;
    } else if (phase[i] === PHASE.BUFFER) {
      diffusivity = params.D0;
    }
    D[i] = diffusivity;
    if (fluid[i]) tau[i] = Math.max(0.500001, 0.5 + diffusivity * params.dt / (dx * dx * cSound2));
  }
  for (let i = 0; i < N; i += 1) {
    if (phase[i] !== PHASE.IONOMER) continue;
    for (let k = 1; k < DIR_COUNT; k += 1) {
      const j = nbr[k * N + i];
      if (j >= 0 && phase[j] === PHASE.PT) ptCount[i] += 1;
    }
  }

  let t = 0;
  let substep = 0;
  let lastSubstep = -1;
  let reactionCurrent = new Float64Array(N);
  const currentBuffer = () => (substep === 0 ? f : g);
  const isFluidPhase = (value) => value === PHASE.PORE || value === PHASE.IONOMER || value === PHASE.BUFFER;
  const clearWorking = () => g.fill(0);

  function stream() {
    clearWorking();
    const interfaceTerm = -1 / params.kis * cSound2 * dx / params.dt;
    for (let i = 0; i < N; i += 1) {
      if (!fluid[i]) continue;
      for (let k = 0; k < DIR_COUNT; k += 1) {
        const j = nbr[k * N + i];
        if (j < 0) continue;
        let value = f[k * N + i];
        if (k > 0 && phase[i] === PHASE.PORE && phase[j] === PHASE.IONOMER) {
          const denominator = interfaceTerm - 1 / params.Hi - 1;
          const numerator = (interfaceTerm - 1 / params.Hi + 1) * f[OPP[k] * N + j] - (2 / params.Hi) * f[k * N + i];
          value = numerator / denominator;
        } else if (k > 0 && phase[i] === PHASE.IONOMER &&
          (phase[j] === PHASE.PORE || phase[j] === PHASE.BUFFER)) {
          const denominator = interfaceTerm - 1 / params.Hi - 1;
          const numerator = (interfaceTerm + 1 / params.Hi - 1) * f[OPP[k] * N + j] - 2 * f[k * N + i];
          value = numerator / denominator;
        }
        g[k * N + j] = value;
      }
    }
  }

  function bounce() {
    for (let i = 0; i < N; i += 1) {
      if (fluid[i]) continue;
      for (let k = 1; k < DIR_COUNT; k += 1) {
        const source = nbr[OPP[k] * N + i];
        if (source >= 0 && fluid[source]) g[OPP[k] * N + source] = g[k * N + i];
      }
    }
  }

  function inlet() {
    let inletX = 1;
    let hasBuffer = false;
    for (let i = 0; i < N; i += 1) if (phase[i] === PHASE.BUFFER) { hasBuffer = true; break; }
    if (!hasBuffer) {
      if (params.cIn === 0) return;
      inletX = 0;
    }
    for (let y = 0; y < H; y += 1) {
      for (let z = 0; z < W; z += 1) {
        const i = idx(inletX, y, z);
        if (fluid[i]) g[N + i] = 2 * WEIGHT[1] * params.cIn - g[2 * N + i];
      }
    }
  }

  function macro() {
    for (let i = 0; i < N; i += 1) {
      if (!fluid[i]) {
        c[i] = 0;
        continue;
      }
      let total = 0;
      for (let k = 0; k < DIR_COUNT; k += 1) total += g[k * N + i];
      c[i] = total;
    }
  }

  function reaction() {
    src.fill(0);
    reactionCurrent.fill(0);
    if (t < params.reactionStartStep) return;
    const kEta = (4 * 0.5 * F) / (R * params.T);
    const driving = Math.exp(kEta * params.eta) - Math.exp(-kEta * params.eta);
    const coefficient = params.i0 / (params.cref * dx) * driving;
    for (let i = 0; i < N; i += 1) {
      if (phase[i] !== PHASE.IONOMER || ptCount[i] === 0 || c[i] <= 0) continue;
      const current = coefficient * c[i] * ptCount[i];
      const consumed = Math.min(c[i], Math.max(0, current * params.dt / (4 * F)));
      reactionCurrent[i] = consumed * 4 * F / params.dt;
      src[i] = consumed;
    }
  }

  function collide() {
    for (let i = 0; i < N; i += 1) {
      if (!fluid[i]) continue;
      const rho = c[i];
      const tauI = Math.max(0.500001, tau[i]);
      const tau4 = 0.5 + 1 / (6 * (tauI - 0.5));
      const p0 = g[i];
      const p1 = g[N + i];
      const p2 = g[2 * N + i];
      const p3 = g[3 * N + i];
      const p4 = g[4 * N + i];
      const p5 = g[5 * N + i];
      const p6 = g[6 * N + i];
      const M1 = p1 - p2;
      const M2 = p3 - p4;
      const M3 = p5 - p6;
      const M4 = 6 * p0 - p1 - p2 - p3 - p4 - p5 - p6;
      const M5 = 2 * p1 + 2 * p2 - p3 - p4 - p5 - p6;
      const M6 = p3 + p4 - p5 - p6;
      const consumed = src[i];
      const m0 = rho - consumed;
      const m1 = M1 - M1 / tauI;
      const m2 = M2 - M2 / tauI;
      const m3 = M3 - M3 / tauI;
      const m4 = M4 + (-M4 + 0.75 * rho) / tau4 - 1.5 * consumed;
      const m5 = M5 - M5 / tau4;
      const m6 = M6 - M6 / tau4;
      const values = [
        m0 / 7 + m4 / 7,
        m0 / 7 + 0.5 * m1 - m4 / 42 + m5 / 6,
        m0 / 7 - 0.5 * m1 - m4 / 42 + m5 / 6,
        m0 / 7 + 0.5 * m2 - m4 / 42 - m5 / 12 + 0.25 * m6,
        m0 / 7 - 0.5 * m2 - m4 / 42 - m5 / 12 + 0.25 * m6,
        m0 / 7 + 0.5 * m3 - m4 / 42 - m5 / 12 - 0.25 * m6,
        m0 / 7 - 0.5 * m3 - m4 / 42 - m5 / 12 - 0.25 * m6,
      ];
      for (let k = 0; k < DIR_COUNT; k += 1) f[k * N + i] = Math.max(0, values[k]);
    }
  }

  const operations = [stream, bounce, inlet, macro, reaction, collide];
  function stepSub() {
    const executed = substep;
    operations[executed]();
    lastSubstep = executed;
    // The six substeps are indexed 0..5; keep this independent from D3Q7's
    // seven velocity directions.
    substep = executed === SUBSTEPS.length - 1 ? 0 : executed + 1;
    if (substep === 0) t += 1;
    return SUBSTEPS[executed];
  }

  function step(n = 1) {
    const count = Math.max(0, Math.floor(n));
    if (substep !== 0) while (substep !== 0) stepSub();
    for (let iteration = 0; iteration < count; iteration += 1) {
      for (let k = 0; k < SUBSTEPS.length; k += 1) stepSub();
    }
  }

  function current(k, i) {
    if (k < 0 || k >= DIR_COUNT || i < 0 || i >= N) return NaN;
    return currentBuffer()[k * N + i];
  }
  function node(i) {
    return {
      phase: phase[i],
      c: c[i],
      tau: tau[i],
      D: D[i],
      src: src[i],
      f: Array.from({ length: DIR_COUNT }, (_, k) => current(k, i)),
    };
  }
  function block(xStart, yStart, zStart, n) {
    const size = Math.max(0, Math.floor(n));
    const out = new Float64Array(DIR_COUNT * size ** 3);
    out.fill(NaN);
    for (let dz = 0; dz < size; dz += 1) {
      for (let dy = 0; dy < size; dy += 1) {
        for (let ddx = 0; ddx < size; ddx += 1) {
          const x = xStart + ddx;
          if (x < 0 || x >= L) continue;
          const i = idx(x, wrap(yStart + dy, H), wrap(zStart + dz, W));
          const offset = ddx + size * (dy + size * dz);
          for (let k = 0; k < DIR_COUNT; k += 1) out[k * size ** 3 + offset] = current(k, i);
        }
      }
    }
    return out;
  }
  function profileX() {
    const pore = new Float64Array(L);
    const ionomer = new Float64Array(L);
    const poreCount = new Uint32Array(L);
    const ionomerCount = new Uint32Array(L);
    for (let i = 0; i < N; i += 1) {
      const x = i % L;
      if (phase[i] === PHASE.PORE) {
        pore[x] += c[i];
        poreCount[x] += 1;
      } else if (phase[i] === PHASE.IONOMER) {
        ionomer[x] += c[i];
        ionomerCount[x] += 1;
      }
    }
    for (let x = 0; x < L; x += 1) {
      pore[x] = poreCount[x] ? pore[x] / poreCount[x] : NaN;
      ionomer[x] = ionomerCount[x] ? ionomer[x] / ionomerCount[x] : NaN;
    }
    return { pore, ionomer };
  }
  function diagnostics() {
    let inletX = 1;
    let hasBuffer = false;
    for (let i = 0; i < N; i += 1) if (phase[i] === PHASE.BUFFER) { hasBuffer = true; break; }
    let netInlet = 0;
    if (hasBuffer || params.cIn !== 0) {
      if (!hasBuffer) inletX = 0;
      for (let y = 0; y < H; y += 1) {
        for (let z = 0; z < W; z += 1) {
          const i = idx(inletX, y, z);
          netInlet += f[N + i] - f[2 * N + i];
        }
      }
    }
    let totalConsumed = 0;
    let totalO2 = 0;
    for (let i = 0; i < N; i += 1) {
      totalConsumed += src[i];
      totalO2 += c[i];
    }
    const toCurrent = (amount) => (4 * F * amount * dx) / (params.dt * H * W) / 1e4;
    const inletFlux = toCurrent(netInlet);
    const totalReaction = toCurrent(totalConsumed);
    return {
      t,
      timeSeconds: t * params.dt,
      inletFlux,
      totalReaction,
      balanceError: Math.abs(inletFlux) > 1e-30 ? Math.abs(inletFlux - totalReaction) / Math.abs(inletFlux) : 0,
      totalO2,
    };
  }
  function reset() {
    t = 0;
    substep = 0;
    lastSubstep = -1;
    f.fill(0);
    g.fill(0);
    c.fill(0);
    src.fill(0);
    reactionCurrent.fill(0);
  }

  return {
    get t() { return t; },
    get substep() { return substep; },
    get lastSubstep() { return lastSubstep; },
    params,
    c,
    tau,
    D,
    src,
    f,
    g,
    stepSub,
    step,
    current,
    node,
    block,
    profileX,
    diagnostics,
    reset,
  };
}
