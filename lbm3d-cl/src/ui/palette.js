// Shared colors and labels for the UI layer.
import { PHASE } from '../engine/index.js';
export { PHASE };

export const PHASE_COLOR = {
  [PHASE.PORE]: 0xf2f3f0,
  [PHASE.IONOMER]: 0x6fa8dc,
  [PHASE.CARBON]: 0x3b4245,
  [PHASE.PT]: 0xe0a020,
  [PHASE.BUFFER]: 0xc9d6d3,
  [PHASE.WALL]: 0x1a1a1a,
};

export const PHASE_NAME = {
  [PHASE.PORE]: '孔隙',
  [PHASE.IONOMER]: '离聚物',
  [PHASE.CARBON]: '碳',
  [PHASE.PT]: '铂',
  [PHASE.BUFFER]: '缓冲层',
  [PHASE.WALL]: '墙',
};

export const STATUS = {
  flow:   { color: '#1f7a72', label: '迁移' },
  bounce: { color: '#c8683a', label: '反弹' },
  conj:   { color: '#4a8fd4', label: '共轭界面' },
  wall:   { color: '#1a1a1a', label: '墙' },
};

// Viridis, 9 stops
const VIRIDIS = [
  [68,1,84],[72,40,120],[62,74,137],[49,104,142],[38,130,142],
  [31,158,137],[53,183,121],[109,205,89],[180,222,44],[253,231,37],
];
export function viridis(t) {
  t = Math.min(1, Math.max(0, t));
  const s = t * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(s));
  const f = s - i;
  const a = VIRIDIS[i], b = VIRIDIS[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

// τ colormap: pale teal → deep teal
export function tauColor(t) {
  t = Math.min(1, Math.max(0, t));
  const a = [226, 241, 238], b = [20, 96, 90];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
