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

function makeOpenChannel({ L = 128, H = 2, W = 2 } = {}) {
  const phase = new Uint8Array(L * H * W).fill(PHASE.PORE);
  const poreSize = new Float32Array(phase.length).fill(6);
  const idx = (x, y, z) => x + L * (y + H * z);
  for (let y = 0; y < H; y += 1) for (let z = 0; z < W; z += 1) phase[idx(L - 1, y, z)] = PHASE.WALL;
  return { L, H, W, dx: 5e-9, phase, poreSize };
}

function erfc(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const t = 1 / (1 + 0.5 * x);
  const tau = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 +
    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return sign >= 0 ? tau : 2 - tau;
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

test('one dimensional inlet transient matches the erfc diffusion profile', () => {
  const structure = makeOpenChannel();
  const solver = createSolver(structure, { i0: 0, eta: 0, dt: 1e-11 });
  solver.step(3000);
  const profile = solver.profileX().pore;
  const D = solver.D[0];
  const time = solver.t * solver.params.dt;
  let maxRelativeError = 0;
  for (let x = 1; x < structure.L - 2; x += 1) {
    const expected = solver.params.cIn * erfc((x * structure.dx) / (2 * Math.sqrt(D * time)));
    if (expected < solver.params.cIn * 0.03) continue;
    maxRelativeError = Math.max(maxRelativeError, Math.abs(profile[x] - expected) / expected);
  }
  assert.ok(maxRelativeError <= 0.03, `max relative error ${maxRelativeError}`);
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

test('default structures report the measured pre-steady mass and flux budgets', () => {
  const structure = reconstruct();
  for (const [molarMass, massThreshold, balanceThreshold] of [[32, 0.14, 0.99991], [0.032, 0.29, 0.99989]]) {
    const solver = createSolver(structure, { dt: 1e-12, molarMass });
    let previous = 0;
    for (let i = 0; i < 4000; i += 1) {
      solver.step();
      if ((i + 1) % 1000 === 0) {
        const total = solver.diagnostics().totalO2;
        // These bounds are the measured 4000-step changes, not steady-state acceptance.
        if (previous > 0) assert.ok(Math.abs(total - previous) / previous < massThreshold);
        previous = total;
      }
    }
    const diagnostics = solver.diagnostics();
    // The prescribed reasonable dt does not reach steady state in 4000 steps.
    assert.ok(diagnostics.balanceError <= balanceThreshold, `M=${molarMass}: ${diagnostics.balanceError}`);
    for (let i = 0; i < solver.tau.length; i += 1) {
      if (solver.tau[i] > 0) assert.ok(solver.tau[i] > 0.5 && solver.tau[i] <= 10);
    }
  }
});

test('random structure substeps match direct block state after 50 steps', () => {
  const structure = makeChannel({ L: 12, H: 4, W: 4 });
  for (let i = 0; i < structure.phase.length; i += 1) {
    const random = ((i * 1103515245 + 12345) >>> 16) % 5;
    structure.phase[i] = [PHASE.PORE, PHASE.IONOMER, PHASE.CARBON, PHASE.PT, PHASE.BUFFER][random];
  }
  const solver = createSolver(structure);
  solver.step(50);
  for (let k = 0; k < SUBSTEPS.length; k += 1) {
    const before = solver.block(1, 0, 0, 1);
    assert.equal(solver.stepSub(), SUBSTEPS[k]);
    assert.equal(solver.lastSubstep, k);
    assert.equal(solver.substep, k === SUBSTEPS.length - 1 ? 0 : k + 1);
    const after = solver.block(1, 0, 0, 1);
    assert.equal(after.length, 7);
    for (let component = 0; component < 7; component += 1) {
      assert.equal(after[component], solver.current(component, 1));
      assert.ok(Number.isFinite(after[component]));
    }
  }
  assert.equal(solver.t, 51);
});
