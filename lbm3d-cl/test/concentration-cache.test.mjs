import test from 'node:test';
import assert from 'node:assert/strict';
import { createSolver, reconstruct } from '../src/engine/index.js';
import { createConcentrationRecording, MAX_FRAMES, RECORD_INTERVAL } from '../src/ui/timeline.js';
import { cacheManifest, decodeRecording, encodeRecording, frameByteLength, solverParamsHash, structureHash } from '../src/ui/concentration-cache.js';

test('concentration cache round-trips recorded frames without aliasing', () => {
  const structure = reconstruct({ seed: 42 });
  const solver = createSolver(structure);
  const recording = createConcentrationRecording(structure, solver, { targetFrame: 1 });
  recording.advance(1e9);
  const bytes = encodeRecording(structure, recording.frames);
  assert.equal(bytes.byteLength, recording.frames.length * frameByteLength(structure));
  const decoded = decodeRecording(structure, bytes, { count: recording.frames.length });
  assert.deepEqual(Array.from(decoded[0].concentration), Array.from(recording.frames[0].concentration));
  for (let x = 0; x < structure.L; x += 1) {
    const actual = decoded[0].profile.pore[x], expected = recording.frames[0].profile.pore[x];
    if (Number.isNaN(expected)) assert.ok(Number.isNaN(actual));
    else assert.ok(Math.abs(actual - expected) < 1e-5);
  }
  assert.equal(decoded[0].diagnostics.t, recording.frames[0].diagnostics.t);
  decoded[0].concentration[0] ^= 255;
  assert.notEqual(decoded[0].concentration[0], recording.frames[0].concentration[0]);
});

test('concentration cache manifest identifies structure and solver parameters', () => {
  const structure = reconstruct({ seed: 42 });
  const solver = createSolver(structure);
  const manifest = cacheManifest(structure, solver.params, { interval: RECORD_INTERVAL, maxFrames: MAX_FRAMES });
  assert.equal(manifest.version, 1);
  assert.equal(manifest.grid.L, 64);
  assert.equal(manifest.recordInterval, 25);
  assert.equal(manifest.maxFrames, 400);
  assert.equal(manifest.structureHash, structureHash(structure));
  assert.equal(manifest.solverParamsHash, solverParamsHash(solver.params));
  assert.notEqual(manifest.structureHash, structureHash(reconstruct({ seed: 43 })));
  assert.notEqual(manifest.solverParamsHash, solverParamsHash({ ...solver.params, dt: solver.params.dt * 2 }));
});

test('concentration cache rejects truncated payloads', () => {
  const structure = reconstruct({ seed: 42 });
  assert.throws(() => decodeRecording(structure, new Uint8Array(3), { count: 1 }), /byte length mismatch/);
});
