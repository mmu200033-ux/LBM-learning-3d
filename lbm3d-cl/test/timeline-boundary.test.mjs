import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSolver, E, PHASE } from '../src/engine/index.js';
import { createConcentrationRecording, createTimeline, MAX_FRAMES, RECORD_INTERVAL } from '../src/ui/timeline.js';
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

function timelineFixture({ targetFrame = null } = {}) {
  const elements = new Map();
  const container = { innerHTML: '', querySelector(id) {
    if (!elements.has(id)) elements.set(id, { value: '', disabled: false, handlers: {}, classList: { toggle() {} }, setAttribute() {},
      addEventListener(name, fn) { this.handlers[name] = fn; }, fire(name) { this.handlers[name]?.(); } });
    return elements.get(id);
  } };
  const recording = { frames: [], limit: targetFrame === null ? 400 : targetFrame + 1,
    get complete() { return this.frames.length === this.limit; }, get capped() { return this.frames.length === 400; } };
  const displayed = [];
  const timeline = createTimeline(container, recording, (frame, index) => displayed.push(index), { targetFrame });
  function append(count) {
    const previous = recording.frames.length;
    for (let i = 0; i < count; i++) recording.frames.push({ step: (recording.frames.length + 1) * 25, timeSeconds: (recording.frames.length + 1) * 25e-12 });
    timeline.appended(previous);
  }
  return { timeline, recording, displayed, append, slider: container.querySelector('#timeline-slider'), button: container.querySelector('#timeline-play'), speed: container.querySelector('#timeline-speed') };
}

test('timeline uses a fixed range and appending never advances the displayed frame', () => {
  const f = timelineFixture();
  assert.equal(Number(f.slider.max), 399);
  f.append(10);
  assert.equal(f.timeline.stats().index, 0);
  f.timeline.tick(0); f.timeline.tick(100);
  assert.equal(f.timeline.stats().index, 1);
  f.append(10);
  assert.equal(f.timeline.stats().index, 1);
  assert.equal(Number(f.slider.max), 399);
  f.slider.value = 5; f.slider.fire('input');
  assert.equal(f.timeline.stats().playing, false);
  f.append(10); f.timeline.tick(10000);
  assert.equal(f.timeline.stats().index, 5);
  f.slider.value = 399; f.slider.fire('input');
  assert.equal(f.timeline.stats().index, 5);
  assert.equal(f.timeline.stats().pendingTarget, 399);
  f.append(10);
  assert.equal(f.timeline.stats().index, 5);
  assert.equal(f.timeline.stats().pendingTarget, 399);
  f.append(370);
  assert.equal(f.timeline.stats().index, 399);
  assert.equal(f.timeline.stats().pendingTarget, null);
});

test('timeline allows seeking before any frame is cached and retargets pending work', () => {
  const f = timelineFixture();
  assert.equal(f.slider.disabled, false);
  f.slider.value = 250; f.slider.fire('input');
  assert.equal(f.timeline.stats().index, -1);
  assert.equal(f.timeline.stats().pendingTarget, 250);
  f.append(10);
  assert.equal(f.timeline.stats().index, 0);
  assert.equal(f.timeline.stats().pendingTarget, 250);
  f.slider.value = 4; f.slider.fire('input');
  assert.equal(f.timeline.stats().index, 4);
  assert.equal(f.timeline.stats().pendingTarget, null);
  f.slider.value = 300; f.slider.fire('input');
  assert.equal(f.timeline.stats().pendingTarget, 300);
  f.button.fire('click');
  assert.equal(f.timeline.stats().pendingTarget, null);
  assert.equal(f.timeline.stats().playing, true);
});

test('playback waits at a buffer frontier without jumping when a batch arrives', () => {
  const f = timelineFixture(); f.append(1);
  f.timeline.tick(0); f.timeline.tick(10000);
  assert.equal(f.timeline.stats().index, 0);
  assert.equal(f.timeline.stats().playing, true);
  f.append(20);
  assert.equal(f.timeline.stats().index, 0);
  f.timeline.tick(20000); f.timeline.tick(20099);
  assert.equal(f.timeline.stats().index, 0);
  f.timeline.tick(20100);
  assert.equal(f.timeline.stats().index, 1);
  f.speed.value = 2; f.speed.fire('change');
  f.timeline.tick(20150);
  assert.equal(f.timeline.stats().index, 2);
});

test('completed playback stops at last frame and restarts; explicit frame waits for its target', () => {
  const f = timelineFixture(); f.append(400);
  f.timeline.tick(0); f.timeline.tick(39900);
  assert.equal(f.timeline.stats().index, 399);
  assert.equal(f.timeline.stats().playing, false);
  f.button.fire('click');
  assert.equal(f.timeline.stats().index, 0);
  assert.equal(f.timeline.stats().playing, true);
  const target = timelineFixture({ targetFrame: 3 });
  target.append(2); assert.equal(target.timeline.stats().index, 0);
  target.append(2); assert.equal(target.timeline.stats().index, 3);
  assert.equal(target.timeline.stats().playing, false);
  assert.equal(Number(target.slider.max), 3);
});

test('upper full-grid substeps and lower recording have independent evolving state', () => {
  const structure = makeInterface(PHASE.PORE, PHASE.IONOMER);
  const params = { cIn: 1, i0: 0, eta: 0 };
  const upper = createSolver(structure, params), lower = createSolver(structure, params);
  const recording = createConcentrationRecording(structure, lower, { targetFrame: 3 });
  const lowerBefore = { f: lower.f.slice(), g: lower.g.slice(), c: lower.c.slice() };
  upper.step(10); upper.stepSub();
  assert.equal(lower.t, 0); assert.equal(lower.substep, 0);
  for (const field of ['f','g','c']) assert.deepEqual(lower[field], lowerBefore[field]);
  const upperBefore = { f: upper.f.slice(), g: upper.g.slice(), c: upper.c.slice(), t: upper.t, substep: upper.substep };
  recording.advance(1e9);
  assert.deepEqual(recording.frames.map(f => f.step), [25,50,75,100]);
  assert.equal(upper.t, upperBefore.t); assert.equal(upper.substep, upperBefore.substep);
  for (const field of ['f','g','c']) assert.deepEqual(upper[field], upperBefore[field]);
});
