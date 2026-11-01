import { PHASE } from '../engine/index.js';

export const wrap = (value, size) => ((value % size) + size) % size;
export const isFluid = phase => phase === PHASE.PORE || phase === PHASE.IONOMER || phase === PHASE.BUFFER;
export const blockOffset = (x,y,z) => x + 7 * (y + 7 * z);
export function blockOrigin(structure, selection) {
  return { x: Math.max(0, Math.min(structure.L - 5, selection.x - 2)), y: selection.y - 2, z: selection.z - 2 };
}

// Keep y/z unwrapped for a contiguous teaching block; only physical data is wrapped.
export function captureBlock(structure, solver, origin) {
  const { L,H,W } = structure;
  const c = new Float64Array(343), src = new Float64Array(343), phase = new Int8Array(343).fill(PHASE.WALL);
  for (let z=0;z<7;z++) for (let y=0;y<7;y++) for (let x=0;x<7;x++) {
    const ax=origin.x+x-1, ay=wrap(origin.y+y-1,H), az=wrap(origin.z+z-1,W);
    if (ax<0 || ax>=L) continue;
    const i=ax+L*(ay+H*az), j=blockOffset(x,y,z);
    c[j]=solver.c[i]; src[j]=solver.src[i]; phase[j]=structure.phase[i];
  }
  return { origin: { ...origin }, f: solver.block(origin.x-1,origin.y-1,origin.z-1,7), c,src,phase };
}

export function captureDistributions(solver) {
  return (solver.substep === 0 ? solver.f : solver.g).slice();
}

// Re-selecting a site reuses the same executed operation, even outside the old halo.
export function blockFromSnapshot(structure, origin, data) {
  const {L,H,W}=structure,N=L*H*W;
  const out={origin:{...origin},f:new Float64Array(7*343).fill(NaN),c:new Float64Array(343),src:new Float64Array(343),phase:new Int8Array(343).fill(PHASE.WALL)};
  for(let z=0;z<7;z++)for(let y=0;y<7;y++)for(let x=0;x<7;x++){
    const ax=origin.x+x-1;if(ax<0||ax>=L)continue;
    const i=ax+L*(wrap(origin.y+y-1,H)+H*wrap(origin.z+z-1,W)),j=blockOffset(x,y,z);
    out.phase[j]=structure.phase[i];out.c[j]=data.c[i];out.src[j]=data.src[i];
    for(let k=0;k<7;k++)out.f[k*343+j]=data.f[k*N+i];
  }
  return out;
}
