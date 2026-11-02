import { mkdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createSolver, reconstruct } from '../src/engine/index.js';
import { createConcentrationRecording, MAX_FRAMES, RECORD_INTERVAL } from '../src/ui/timeline.js';
import { cacheManifest, encodeRecording } from '../src/ui/concentration-cache.js';

const args = new Map(process.argv.slice(2).map(arg => {
  const [key, value] = arg.replace(/^--/, '').split('=');
  return [key, value];
}));
const seed = Number(args.get('seed') ?? 42);
const directory = args.has('out')
  ? pathToFileURL(resolve(args.get('out')) + '/')
  : new URL('../cache/', import.meta.url);
const structure = reconstruct({ seed });
const solver = createSolver(structure);
const recording = createConcentrationRecording(structure, solver);
recording.advance(1e9);
if (!recording.complete) throw new Error(`Expected ${MAX_FRAMES} frames, got ${recording.frames.length}`);
const manifest = cacheManifest(structure, solver.params, { interval: RECORD_INTERVAL, maxFrames: MAX_FRAMES });
const payload = gzipSync(encodeRecording(structure, recording.frames), { level: 9 });
await mkdir(directory, { recursive: true });
await writeFile(new URL('./concentration-v1.json', directory), JSON.stringify(manifest, null, 2));
await writeFile(new URL('./concentration-v1.bin.gz', directory), payload);
console.log(JSON.stringify({ seed, frames: recording.frames.length, rawBytes: manifest.frameBytes * recording.frames.length, compressedBytes: payload.length, manifest: 'concentration-v1.json', data: 'concentration-v1.bin.gz' }, null, 2));
