// 邻居状态判定：共享给 lattice-view 和 inspector
export function neighborStatus(structure, x, y, z, dx, dy, dz) {
  const { L, H, W, phase } = structure;
  const { PORE, IONOMER, CARBON, PT, BUFFER, WALL } = { PORE: 0, IONOMER: 1, CARBON: 2, PT: 3, BUFFER: 4, WALL: 5 };
  const nx = x + dx;
  if (nx < 0 || nx >= L) return 'wall';
  const ny = (y + dy + H) % H, nz = (z + dz + W) % W;
  const i = x + L * (y + H * z), ni = nx + L * (ny + H * nz);
  const p = phase[i], np = phase[ni];
  if (np === WALL) return 'wall';
  if (np === CARBON || np === PT) return 'bounce';
  if ((p === PORE || p === BUFFER) && np === IONOMER) return 'conj';
  if (p === IONOMER && (np === PORE || np === BUFFER)) return 'conj';
  return 'flow';
}
