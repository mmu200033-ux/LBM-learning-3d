import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { deflateSync } from 'node:zlib';
import { createSolver, PHASE, reconstruct } from '../src/engine/index.js';

const outDir = new URL('../out/', import.meta.url);
await mkdir(outDir, { recursive: true });

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const payload = Buffer.concat([typeBytes, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(payload), 0);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  return Buffer.concat([length, payload, crc]);
}

function png(width, height, pixel) {
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = pixel(x, y);
      const offset = 1 + x * 4;
      row[offset] = r;
      row[offset + 1] = g;
      row[offset + 2] = b;
      row[offset + 3] = a;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const colors = {
  [PHASE.PORE]: [255, 255, 255, 255],
  [PHASE.IONOMER]: [74, 144, 217, 255],
  [PHASE.CARBON]: [51, 51, 51, 255],
  [PHASE.PT]: [224, 160, 32, 255],
  [PHASE.BUFFER]: [204, 204, 204, 255],
  [PHASE.WALL]: [0, 0, 0, 255],
};
const solid = (phase) => colors[phase] ?? [0, 0, 0, 255];
const gray = (value) => {
  const c = Math.max(0, Math.min(255, Math.round(value * 255)));
  return [c, c, c, 255];
};

function writePhaseImage(structure, z, name) {
  const scale = 8;
  const body = png(structure.L * scale, structure.H * scale, (px, py) => {
    const x = Math.floor(px / scale);
    const y = Math.floor(py / scale);
    return solid(structure.phase[x + structure.L * (y + structure.H * z)]);
  });
  return writeFile(new URL(name, outDir), body);
}

function writeConcImage(structure, solver, z, name) {
  const scale = 8;
  const body = png(structure.L * scale, structure.H * scale, (px, py) => {
    const x = Math.floor(px / scale);
    const y = Math.floor(py / scale);
    const i = x + structure.L * (y + structure.H * z);
    if (structure.phase[i] >= PHASE.CARBON) return solid(structure.phase[i]);
    return gray(solver.params.cIn > 0 ? solver.c[i] / solver.params.cIn : 0);
  });
  return writeFile(new URL(name, outDir), body);
}

function csvRow(values) {
  return values.map((value) => {
    if (typeof value === 'string') return value;
    return Number.isFinite(value) ? String(value) : '';
  }).join(',');
}

function steadyRun(structure, params) {
  const solver = createSolver(structure, params);
  let previous = 0;
  let stable = 0;
  const start = performance.now();
  let steps = 0;
  const maxSteps = 3000;
  while (steps < maxSteps) {
    solver.step(1);
    steps += 1;
    if (steps % 100 === 0) {
      const total = solver.diagnostics().totalO2;
      const rel = Math.abs(total - previous) / Math.max(1, Math.abs(total));
      stable = rel < 1e-6 ? stable + 1 : 0;
      previous = total;
      if (stable >= 3) break;
    }
  }
  return { solver, steps, stepMs: (performance.now() - start) / Math.max(1, steps) };
}

const structure = reconstruct();
const solver = createSolver(structure);
await Promise.all([
  writePhaseImage(structure, 16, 'phase-z16.png'),
  writePhaseImage(structure, 0, 'phase-z0.png'),
  writePhaseImage(structure, 31, 'phase-z31.png'),
  writeConcImage(structure, solver, 16, 'conc-z16-t0.png'),
]);
for (let step = 0; step < 1000; step += 1) solver.step();
await writeConcImage(structure, solver, 16, 'conc-z16-t1000.png');
const t100 = createSolver(structure);
for (let step = 0; step < 100; step += 1) t100.step();
await writeConcImage(structure, t100, 16, 'conc-z16-t100.png');
const steady = steadyRun(structure, {});
await writeConcImage(structure, steady.solver, 16, 'conc-z16-tsteady.png');
await writeConcImage(structure, steady.solver, 16, 'conc-z16-t稳态.png');

const profile = steady.solver.profileX();
let profileCsv = 'x,pore,ionomer\n';
for (let x = 0; x < structure.L; x += 1) profileCsv += `${x},${profile.pore[x]},${profile.ionomer[x]}\n`;
await writeFile(new URL('profile.csv', outDir), profileCsv);

const sweepRows = [['eta', 'molarMass', 'steadySteps', 'outletPoreOverCIn', 'totalReaction', 'stepMs']];
for (const molarMass of [32, 0.032]) {
  for (const eta of [0.2, 0.25, 0.3, 0.35, 0.4]) {
    const result = steadyRun(structure, { eta, molarMass });
    const p = result.solver.profileX().pore[structure.L - 4];
    sweepRows.push([eta, molarMass, result.steps, p / result.solver.params.cIn, result.solver.diagnostics().totalReaction, result.stepMs]);
  }
}
await writeFile(new URL('sweep.csv', outDir), sweepRows.map(csvRow).join('\n') + '\n');

console.log(`snapshot output: ${new URL('.', outDir).pathname}`);
console.log(`steady steps: ${steady.steps}, mean step ms: ${steady.stepMs.toFixed(3)}`);
