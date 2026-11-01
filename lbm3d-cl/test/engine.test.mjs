import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolver, E, OPP, PHASE, reconstruct, SUBSTEPS } from '../src/engine/index.js';

function indexOf(structure, x, y, z) {
  return x + structure.L * (y + structure.H * z);
}

function countPhase(structure, phase) {
  let count = 0;
  for (const value of structure.phase) if (value === phase) count += 1;
  return count;
}

function makeChannel({ L = 32, H = 4, W = 4, buffer = true } = {}) {
  const phase = new Uint8Array(L * H * W).fill(PHASE.PORE);
  const poreSize = new Float32Array(phase.length).fill(6);
  const idx = (x, y, z) => x + L * (y + H * z);
  for (let y = 0; y < H; y += 1) {
    for (let z = 0; z < W; z += 1) {
      phase[idx(0, y, z)] = PHASE.WALL;
      phase[idx(L - 1, y, z)] = PHASE.WALL;
      if (buffer) {
        phase[idx(1, y, z)] = PHASE.BUFFER;
        phase[idx(L - 2, y, z)] = PHASE.BUFFER;
      }
    }
  }
  return { L, H, W, dx: 5e-9, phase, poreSize };
}

test('reconstructs target fractions, periodic Pt adjacency, connected carbon, and deterministic order', () => {
  const first = reconstruct();
  const second = reconstruct();
  assert.deepEqual(first.phase, second.phase);
  assert.deepEqual(first.order, second.order);
  for (const key of ['carbon', 'pt', 'ionomer', 'pore']) {
    assert.ok(Math.abs(first.fractions[key] - first.targets[key]) <= 0.02, `${key} fraction`);
  }
  const written = [];
  for (let i = 0; i < first.order.length; i += 1) if (first.order[i] >= 0) written.push(first.order[i]);
  assert.deepEqual(written.sort((a, b) => a - b), Array.from({ length: written.length }, (_, i) => i));

  const carbonStart = first.phase.findIndex((value) => value === PHASE.CARBON);
  const seen = new Uint8Array(first.phase.length);
  const queue = [carbonStart];
  seen[carbonStart] = 1;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const i = queue[cursor];
    const x = i % first.L;
    const yz = Math.floor(i / first.L);
    const y = yz % first.H;
    const z = Math.floor(yz / first.H);
    for (const [dx, dy, dz] of E.slice(1)) {
      const nx = x + dx;
      if (nx < 3 || nx >= first.L - 3) continue;
      const j = indexOf(first, nx, (y + dy + first.H) % first.H, (z + dz + first.W) % first.W);
      if (!seen[j] && first.phase[j] === PHASE.CARBON) {
        seen[j] = 1;
        queue.push(j);
      }
    }
  }
  assert.ok(queue.length >= countPhase(first, PHASE.CARBON) * 0.95);
  for (let i = 0; i < first.phase.length; i += 1) {
    if (first.phase[i] !== PHASE.PT) continue;
    const x = i % first.L;
    const yz = Math.floor(i / first.L);
    const y = yz % first.H;
    const z = Math.floor(yz / first.H);
    const attached = E.slice(1).some(([dx, dy, dz]) => {
      const nx = x + dx;
      return nx >= 3 && nx < first.L - 3 &&
        first.phase[indexOf(first, nx, (y + dy + first.H) % first.H, (z + dz + first.W) % first.W)] === PHASE.CARBON;
    });
    assert.equal(attached, true);
  }
});

test('closed fluid conserves concentration after 2000 steps', () => {
  const structure = makeChannel({ L: 12, H: 4, W: 4, buffer: false });
  const solver = createSolver(structure, { cIn: 0, i0: 0, eta: 0 });
  for (let i = 0; i < solver.f.length; i += 1) solver.f[i] = 0.1 + ((i * 17) % 100) / 100;
  let before = 0;
  for (let i = 0; i < structure.phase.length; i += 1) {
    if (structure.phase[i] !== PHASE.PORE) continue;
    for (let k = 0; k < 7; k += 1) before += solver.f[k * structure.phase.length + i];
  }
  solver.step(2000);
  const after = solver.diagnostics().totalO2;
  assert.ok(Math.abs(after - before) / before <= 1e-10);
});

test('one dimensional inlet transient produces a monotonic diffusion profile', () => {
  const structure = makeChannel({ L: 64, H: 4, W: 4, buffer: true });
  const solver = createSolver(structure, { i0: 0, eta: 0 });
  solver.step(300);
  const profile = solver.profileX().pore;
  for (let x = 4; x < 20; x += 1) assert.ok(profile[x] <= profile[x - 1] + 1e-12);
  assert.ok(profile[3] > profile[19]);
  assert.ok(profile[3] > solver.params.cIn * 0.7);
});

test('MRT collision preserves the reference seven-moment transform', () => {
  const structure = { L: 3, H: 1, W: 1, dx: 5e-9, phase: new Uint8Array(3).fill(PHASE.PORE), poreSize: new Float32Array(3).fill(6) };
  const solver = createSolver(structure, { i0: 0, eta: 0 });
  const i = 1;
  const N = structure.phase.length;
  const input = [0.7, 0.13, 0.09, 0.11, 0.08, 0.1, 0.06];
  solver.f[i] = input[0];
  for (let k = 1; k < 7; k += 1) {
    const source = i + E[OPP[k]][0];
    solver.f[k * N + source] = input[k];
  }
  solver.stepSub();
  solver.stepSub();
  solver.stepSub();
  solver.stepSub();
  solver.stepSub();
  solver.stepSub();
  const rho = input.reduce((a, b) => a + b, 0);
  const tau = solver.tau[i];
  const tau4 = 0.5 + 1 / (6 * (tau - 0.5));
  const [p0, p1, p2, p3, p4, p5, p6] = input;
  const M1 = p1 - p2;
  const M2 = p3 - p4;
  const M3 = p5 - p6;
  const M4 = 6 * p0 - p1 - p2 - p3 - p4 - p5 - p6;
  const M5 = 2 * p1 + 2 * p2 - p3 - p4 - p5 - p6;
  const M6 = p3 + p4 - p5 - p6;
  const m1 = M1 - M1 / tau;
  const m2 = M2 - M2 / tau;
  const m3 = M3 - M3 / tau;
  const m4 = M4 + (-M4 + 0.75 * rho) / tau4;
  const m5 = M5 - M5 / tau4;
  const m6 = M6 - M6 / tau4;
  const expected = [
    rho / 7 + m4 / 7,
    rho / 7 + 0.5 * m1 - m4 / 42 + m5 / 6,
    rho / 7 - 0.5 * m1 - m4 / 42 + m5 / 6,
    rho / 7 + 0.5 * m2 - m4 / 42 - m5 / 12 + 0.25 * m6,
    rho / 7 - 0.5 * m2 - m4 / 42 - m5 / 12 + 0.25 * m6,
    rho / 7 + 0.5 * m3 - m4 / 42 - m5 / 12 - 0.25 * m6,
    rho / 7 - 0.5 * m3 - m4 / 42 - m5 / 12 - 0.25 * m6,
  ];
  for (let k = 0; k < 7; k += 1) assert.ok(Math.abs(solver.current(k, i) - expected[k]) <= 1e-12);
});

test('substeps expose the post-substep state and advance t after six operations', () => {
  const structure = makeChannel({ L: 12, H: 4, W: 4 });
  const solver = createSolver(structure);
  assert.equal(solver.lastSubstep, -1);
  for (let k = 0; k < SUBSTEPS.length; k += 1) {
    assert.equal(solver.stepSub(), SUBSTEPS[k]);
    assert.equal(solver.lastSubstep, k);
    assert.equal(solver.substep, k === SUBSTEPS.length - 1 ? 0 : k + 1);
    assert.equal(solver.block(0, 0, 0, 1).length, 7);
  }
  assert.equal(solver.t, 1);
  assert.equal(solver.substep, 0);
});
