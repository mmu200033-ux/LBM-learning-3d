// Profile chart: pore & ionomer concentration along X.
import { viridis } from './palette.js';

export function createChart(svg, structure, solver) {
  const { L } = structure;
  const w = 340, h = 240;
  const ml = 45, mr = 20, mt = 20, mb = 35;
  const pw = w - ml - mr, ph = h - mt - mb;

  svg.innerHTML = `
    <rect fill="#fafbf9" stroke="#e1e4df" x="0" y="0" width="${w}" height="${h}" rx="4"/>
    <g transform="translate(${ml},${mt})">
      <line x1="0" y1="0" x2="0" y2="${ph}" stroke="#9aa5a1" stroke-width="1"/>
      <line x1="0" y1="${ph}" x2="${pw}" y2="${ph}" stroke="#9aa5a1" stroke-width="1"/>
      ${Array.from({ length: 5 }, (_, i) => {
        const y = (i / 4) * ph;
        return `<line x1="-3" y1="${y}" x2="0" y2="${y}" stroke="#9aa5a1"/><text x="-6" y="${y + 3}" text-anchor="end" font-size="10" fill="#6b7774">${(7.354 * (1 - i / 4)).toFixed(1)}</text>`;
      }).join('')}
      ${Array.from({ length: 5 }, (_, i) => {
        const x = (i / 4) * pw;
        return `<line x1="${x}" y1="${ph}" x2="${x}" y2="${ph + 3}" stroke="#9aa5a1"/><text x="${x}" y="${ph + 14}" text-anchor="middle" font-size="10" fill="#6b7774">${Math.floor(i * L / 4)}</text>`;
      }).join('')}
      <text x="${pw / 2}" y="${ph + 28}" text-anchor="middle" font-size="11" fill="#6b7774">x (格点)</text>
      <text x="-32" y="${ph / 2}" text-anchor="middle" font-size="11" fill="#6b7774" transform="rotate(-90 -32 ${ph / 2})">浓度 (mol/m³)</text>
      <path id="pore-line" fill="none" stroke="#1f7a72" stroke-width="2"/>
      <path id="ion-line" fill="none" stroke="#4a8fd4" stroke-width="1.5" stroke-dasharray="3,2"/>
      <line id="marker" stroke="#c99a2e" stroke-width="1.5" y1="0" y2="${ph}"/>
      <g transform="translate(${pw - 110},8)">
        <line x1="0" y1="0" x2="16" y2="0" stroke="#1f7a72" stroke-width="2"/><text x="20" y="4" font-size="10" fill="#6b7774">孔隙</text>
        <line x1="52" y1="0" x2="68" y2="0" stroke="#4a8fd4" stroke-width="1.5" stroke-dasharray="3,2"/><text x="72" y="4" font-size="10" fill="#6b7774">离聚物</text>
      </g>
    </g>
  `;

  const porePath = svg.querySelector('#pore-line');
  const ionPath = svg.querySelector('#ion-line');
  const marker = svg.querySelector('#marker');

  function update(selX, recordedProfile=null) {
    if (!solver) return;
    const prof = recordedProfile || solver.profileX();
    // 路径画在已平移的 <g> 内，坐标不再加 ml/mt
    const scale = (x, c) => `${((x / (L - 1)) * pw).toFixed(1)},${(ph - Math.min(1, c / 7.354) * ph).toFixed(1)}`;
    const toPath = arr => Array.from(arr, (c, x) => ({ x, c }))
      .filter(p => Number.isFinite(p.c))
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${scale(p.x, p.c)}`).join(' ');
    porePath.setAttribute('d', toPath(prof.pore));
    ionPath.setAttribute('d', toPath(prof.ionomer));
    marker.style.display=Number.isFinite(selX)?'':'none';
    const mx = ((selX / (L - 1)) * pw).toFixed(1);
    marker.setAttribute('x1', mx);
    marker.setAttribute('x2', mx);
  }

  return { update };
}
