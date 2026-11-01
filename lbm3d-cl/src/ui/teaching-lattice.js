import { createSolver, PHASE, WEIGHT } from '../engine/index.js';
import { mulberry32 } from '../engine/rng.js';

// The visible x coordinates are 1..5; hidden walls close x=0 and x=6.
export const TEACHING_ORIGIN = Object.freeze({ x: 1, y: 0, z: 0 });
export const TEACHING_SELECTION = Object.freeze({ x: 3, y: 1, z: 1 });
export const TEACHING_SUBSTEPS = Object.freeze([0, 1, 3, 5]);
export const C_REF = 1;

export function createTeachingLattice() {
  const L = 7, H = 5, W = 5, dx = 5e-9;
  const phase = new Uint8Array(L * H * W).fill(PHASE.PORE);
  const poreSize = new Float32Array(phase.length).fill(6);
  const idx = (x, y, z) => x + L * (y + H * z);
  for (let z = 0; z < W; z += 1) for (let y = 0; y < H; y += 1) {
    phase[idx(0, y, z)] = phase[idx(6, y, z)] = PHASE.WALL;
  }
  for (let z = 1; z <= 2; z += 1) for (let y = 1; y <= 2; y += 1) for (let x = 4; x <= 5; x += 1) {
    phase[idx(x, y, z)] = PHASE.CARBON;
  }
  const structure = { L, H, W, dx, phase, poreSize };
  const params = { i0: 0, eta: 0, cIn: 0 };
  const probe = createSolver(structure);
  const dt = 0.125 * dx ** 2 / probe.D[idx(1, 0, 0)];
  const solver = createSolver(structure, { ...params, dt });
  function reset() {
    solver.reset();
    const random = mulberry32(7), N = phase.length;
    // Traverse global node indices, then k=0..6, for reproducible perturbations.
    for (let i = 0; i < N; i += 1) {
      if (phase[i] !== PHASE.PORE) continue;
      const ci = 1 - 0.12 * ((i % L) - 1);
      for (let k = 0; k < 7; k += 1) {
        const value = WEIGHT[k] * ci * (1 + 0.4 * (2 * random() - 1));
        solver.f[k * N + i] = value;
        solver.c[i] += value;
      }
    }
  }
  reset();
  return { structure, solver, reset, dt, tau: solver.tau[idx(1, 0, 0)] };
}
