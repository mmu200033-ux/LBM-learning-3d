import fs from 'node:fs/promises';
import path from 'node:path';
import { createSolver, reconstruct } from '../src/engine/index.js';

const structure = reconstruct();
const solver = createSolver(structure, { dt: 1e-12, molarMass: 32 });
const N = structure.phase.length;
const mass = () => {
  let total = 0;
  for (let k = 0; k < 7; k += 1) {
    for (let i = 0; i < N; i += 1) total += solver.current(k, i);
  }
  return total;
};
const sum = (values) => values.reduce((total, value) => total + value, 0);
const rows = ['step,mass_before,mass_after,inlet_delta,reaction_consumed,clamp_added,residual'];

for (let step = 1; step <= 200; step += 1) {
  const before = mass();
  solver.stepSub();
  solver.stepSub();
  const beforeInlet = mass();
  solver.stepSub();
  const afterInlet = mass();
  solver.stepSub();
  solver.stepSub();
  const consumed = sum(Array.from(solver.src));
  solver.stepSub();
  const after = mass();
  const clampAdded = solver.diagnostics().stepClampAdded;
  const inletDelta = afterInlet - beforeInlet;
  const residual = after - before - inletDelta + consumed - clampAdded;
  rows.push([step, before, after, inletDelta, consumed, clampAdded, residual]
    .map((value) => Number(value).toPrecision(17)).join(','));
}

const output = path.resolve('lbm3d-cl/out/mass-budget.csv');
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, `${rows.join('\n')}\n`, 'utf8');
console.log(`wrote ${output}`);
