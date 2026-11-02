import { PHASE } from '../engine/index.js';

export const BLOCK_SIZE = 20;
export const BLOCK_COUNT = BLOCK_SIZE ** 3;
export const BLOCK_CENTER = (BLOCK_SIZE - 1) / 2;
export const HALO = 1;
export const CAPTURE_SIZE = BLOCK_SIZE + 2 * HALO;
export const CAPTURE_COUNT = CAPTURE_SIZE ** 3;
export const wrap = (value, size) => ((value % size) + size) % size;
export const isFluid = phase => phase === PHASE.PORE || phase === PHASE.IONOMER || phase === PHASE.BUFFER;
export const blockOffset = (x,y,z) => x + CAPTURE_SIZE * (y + CAPTURE_SIZE * z);
export function blockOrigin(structure, selection) {
  const offset = Math.floor(BLOCK_SIZE / 2);
  return {
    x: Math.max(3, Math.min(structure.L - 3 - BLOCK_SIZE, selection.x - offset)),
    y: Math.max(0, Math.min(structure.H - BLOCK_SIZE, selection.y - offset)),
    z: Math.max(0, Math.min(structure.W - BLOCK_SIZE, selection.z - offset)),
  };
}

// Keep the captured neighborhood contiguous; y/z values are wrapped only when reading the solver.
export function captureBlock(structure, solver, origin) {
  const { L,H,W } = structure;
  const c = new Float64Array(CAPTURE_COUNT), src = new Float64Array(CAPTURE_COUNT), phase = new Int8Array(CAPTURE_COUNT).fill(PHASE.WALL);
  for (let z=0;z<CAPTURE_SIZE;z++) for (let y=0;y<CAPTURE_SIZE;y++) for (let x=0;x<CAPTURE_SIZE;x++) {
    const ax=origin.x+x-HALO, ay=wrap(origin.y+y-HALO,H), az=wrap(origin.z+z-HALO,W);
    if (ax<0 || ax>=L) continue;
    const i=ax+L*(ay+H*az), j=blockOffset(x,y,z);
    c[j]=solver.c[i]; src[j]=solver.src[i]; phase[j]=structure.phase[i];
  }
  return { origin: { ...origin }, f: solver.block(origin.x-HALO,origin.y-HALO,origin.z-HALO,CAPTURE_SIZE), c,src,phase };
}

export function captureDistributions(solver) {
  return (solver.substep === 0 ? solver.f : solver.g).slice();
}

// Re-selecting a site reuses the same executed operation, even outside the old halo.
export function blockFromSnapshot(structure, origin, data) {
  const {L,H,W}=structure,N=L*H*W;
  const out={origin:{...origin},f:new Float64Array(7*CAPTURE_COUNT).fill(NaN),c:new Float64Array(CAPTURE_COUNT),src:new Float64Array(CAPTURE_COUNT),phase:new Int8Array(CAPTURE_COUNT).fill(PHASE.WALL)};
  for(let z=0;z<CAPTURE_SIZE;z++)for(let y=0;y<CAPTURE_SIZE;y++)for(let x=0;x<CAPTURE_SIZE;x++){
    const ax=origin.x+x-HALO;if(ax<0||ax>=L)continue;
    const i=ax+L*(wrap(origin.y+y-HALO,H)+H*wrap(origin.z+z-HALO,W)),j=blockOffset(x,y,z);
    out.phase[j]=structure.phase[i];out.c[j]=data.c[i];out.src[j]=data.src[i];
    for(let k=0;k<7;k++)out.f[k*CAPTURE_COUNT+j]=data.f[k*N+i];
  }
  return out;
}
