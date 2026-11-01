import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSolver, E, PHASE } from '../src/engine/index.js';
import { createConcentrationRecording, MAX_FRAMES, RECORD_INTERVAL } from '../src/ui/timeline.js';
import { readUrlState } from '../src/ui/url-state.js';
import { neighborStatus } from '../src/ui/neighbors.js';

function indexOf(structure, x, y, z) {
  return x + structure.L * (y + structure.H * z);
}

function makeInterface(left, right, { L = 6, H = 2, W = 2 } = {}) {
  const phase = new Uint8Array(L * H * W).fill(PHASE.PORE);
  const poreSize = new Float32Array(phase.length).fill(6);
  for (let y = 0; y < H; y += 1) {
    for (let z = 0; z < W; z += 1) {
      phase[indexOf({ L, H }, 0, y, z)] = PHASE.WALL;
      phase[indexOf({ L, H }, L - 1, y, z)] = PHASE.WALL;
      phase[indexOf({ L, H }, 2, y, z)] = left;
      phase[indexOf({ L, H }, 3, y, z)] = right;
    }
  }
  return { L, H, W, dx: 5e-9, phase, poreSize };
}

test('PORE and BUFFER conjugate links use the measured two-way interface coupling', () => {
  for (const left of [PHASE.PORE, PHASE.BUFFER]) {
    const structure = makeInterface(left, PHASE.IONOMER);
    const solver = createSolver(structure, { cIn: 0, i0: 0, eta: 0 });
    const N = structure.phase.length;
    const x2 = indexOf(structure, 2, 0, 0);
    const x3 = indexOf(structure, 3, 0, 0);
    solver.f[N + x2] = 1;
    solver.stepSub();
    assert.ok(Math.abs(solver.current(1, x3) - 4 / 37505) < 1e-12);
    assert.ok(Math.abs(solver.current(2, x2) - 37501 / 37505) < 1e-12);
    solver.stepSub();
    assert.ok(Math.abs(solver.current(1, x3) - 4 / 37505) < 1e-12);
    assert.ok(Math.abs(solver.current(2, x2) - 37501 / 37505) < 1e-12);

    solver.reset();
    solver.f[2 * N + x3] = 1;
    solver.stepSub();
    assert.ok(Math.abs(solver.current(1, x3) - 37499 / 37505) < 1e-12);
    assert.ok(Math.abs(solver.current(2, x2) - 6 / 37505) < 1e-12);

    assert.equal(neighborStatus(structure, 2, 0, 0, 1, 0, 0), 'conj');
    assert.equal(neighborStatus(structure, 3, 0, 0, -1, 0, 0), 'conj');
    assert.equal(neighborStatus(structure, 2, 0, 0, 0, -1, 0), 'flow');
    assert.equal(neighborStatus(structure, 2, 0, 0, 0, 0, -1), 'flow');
  }
});

test('solid interface returns the opposite population while PT and WALL keep their classifications', async () => {
  for (const solid of [PHASE.CARBON, PHASE.PT]) {
    const structure = makeInterface(PHASE.IONOMER, solid);
    const solver = createSolver(structure, { cIn: 0, i0: 0, eta: 0 });
    const N = structure.phase.length;
    const x2 = indexOf(structure, 2, 0, 0);
    const x3 = indexOf(structure, 3, 0, 0);
    solver.f[N + x2] = 1;
    solver.stepSub();
    assert.equal(solver.current(1, x3), 1);
    assert.equal(solver.current(2, x2), 0);
    solver.stepSub();
    assert.equal(solver.current(2, x2), 1);
    assert.equal(neighborStatus(structure, 2, 0, 0, 1, 0, 0), 'bounce');
  }
  const wall = makeInterface(PHASE.IONOMER, PHASE.WALL);
  assert.equal(neighborStatus(wall, 2, 0, 0, 1, 0, 0), 'wall');
  const blockView = await readFile(new URL('../src/ui/block-view.js', import.meta.url), 'utf8');
  assert.match(blockView, /source === PHASE\.PORE \|\| source === PHASE\.BUFFER/);
  assert.match(blockView, /target === PHASE\.PORE \|\| target === PHASE\.BUFFER/);
  assert.match(blockView, /isConjugatePhasePair\(phaseAt\(b,x,y,z\),targetPhase\)/);
});

test('default recording keeps 400 independent real solver frames at interval 25', () => {
  const structure = makeInterface(PHASE.PORE, PHASE.PORE, { L: 8, H: 2, W: 2 });
  const solver = createSolver(structure, { cIn: 1, i0: 0, eta: 0 });
  const recording = createConcentrationRecording(structure, solver);
  recording.advance(1e9);
  assert.equal(MAX_FRAMES, 400);
  assert.equal(RECORD_INTERVAL, 25);
  assert.equal(recording.frames.length, 400);
  assert.deepEqual(recording.frames.slice(0, 3).map(frame => frame.step), [25, 50, 75]);
  assert.equal(recording.frames.at(-1).step, 10000);
  assert.equal(solver.t, 10000);
  assert.ok(recording.frames.every((frame, i, frames) => i === 0 || frame.step - frames[i - 1].step === 25));
  assert.equal(recording.stats().limit, 400);
  assert.equal(recording.stats().retainedFieldBytes, 400 * structure.phase.length);
  assert.notEqual(recording.frames[0].concentration, recording.frames[1].concentration);
  assert.notEqual(recording.frames[0].profile, recording.frames[1].profile);
  const firstConcentration = recording.frames[0].concentration.slice();
  const firstProfile = recording.frames[0].profile.pore.slice();
  solver.c.fill(999);
  assert.deepEqual(recording.frames[0].concentration, firstConcentration);
  assert.deepEqual(recording.frames[0].profile.pore, firstProfile);
  const completedAt = solver.t;
  assert.deepEqual(recording.advance(1e9), []);
  assert.equal(solver.t, completedAt);
});

test('frame URL state clamps against the shared 400-frame limit', () => {
  assert.equal(readUrlState('?frame=0').frame, 0);
  assert.equal(readUrlState('?frame=199').frame, 199);
  assert.equal(readUrlState('?frame=399').frame, 399);
  assert.equal(readUrlState('?frame=999').frame, 399);
  assert.equal(readUrlState('?frame=-4').frame, 0);
  assert.equal(readUrlState('').frame, null);
});
