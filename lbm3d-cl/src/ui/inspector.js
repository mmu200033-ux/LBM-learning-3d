// 检查器：D3Q7 等轴投影立体图 + 七方向数据表
import { PHASE_NAME } from './palette.js';
import { neighborStatus } from './neighbors.js';

const DIRS = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const WEIGHT = [0.25, 0.125, 0.125, 0.125, 0.125, 0.125, 0.125];
const LABELS = ['g₀ (静止)', 'g₁ (+X)', 'g₂ (−X)', 'g₃ (+Y)', 'g₄ (−Y)', 'g₅ (+Z)', 'g₆ (−Z)'];
const STATUS_COLOR = { flow: '#1f7a72', bounce: '#c8683a', conj: '#4a8fd4', wall: '#1a1a1a' };

export function createInspector(container, structure, solver) {
  const svg = container.querySelector('#stencil');
  const tbody = container.querySelector('#dist-rows');
  const phaseTag = container.querySelector('.phase-tag');
  const inputs = [container.querySelector('#sel-x'), container.querySelector('#sel-y'), container.querySelector('#sel-z')];
  const macro = {
    c: container.querySelector('#macro-c'),
    tau: container.querySelector('#macro-tau'),
    d: container.querySelector('#macro-d'),
    src: container.querySelector('#macro-src'),
  };

  // 等轴投影：(x,y,z) → (sx, sy)，x 右下、y 左下、z 上
  const cx = 200, cy = 150, scale = 66;
  const iso = (x, y, z) => ({ x: cx + (x - y) * scale * 0.866, y: cy - z * scale + (x + y) * scale * 0.5 });

  const defs = `<defs>
    <marker id="ah-flow" markerWidth="6" markerHeight="6" refX="5.5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="${STATUS_COLOR.flow}"/></marker>
    <marker id="ah-bounce" markerWidth="6" markerHeight="6" refX="5.5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="${STATUS_COLOR.bounce}"/></marker>
    <marker id="ah-conj" markerWidth="6" markerHeight="6" refX="5.5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="${STATUS_COLOR.conj}"/></marker>
    <marker id="ah-wall" markerWidth="6" markerHeight="6" refX="5.5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="${STATUS_COLOR.wall}"/></marker>
  </defs>`;

  const stencilSVG = DIRS.slice(1).map((d, k) => {
    const p = iso(...d);
    const lx = p.x + d[0] * 18 + (d[1] !== 0 ? d[1] * 18 : 0);
    const ly = p.y - (d[2] !== 0 ? d[2] * 16 : (d[0] + d[1]) * 8);
    return `<g id="arr${k}">
      <line id="line${k}" x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="${STATUS_COLOR.flow}" stroke-width="2.5" marker-end="url(#ah-flow)"/>
      <circle id="dot${k}" cx="${p.x}" cy="${p.y}" r="5" fill="${STATUS_COLOR.flow}"/>
      <text x="${lx}" y="${ly}" font-size="11" fill="#6b7774" text-anchor="middle">${LABELS[k + 1]}</text>
      <text id="val${k + 1}" x="${lx}" y="${ly + 12}" font-size="10" fill="#1d2a2a" font-family="JetBrains Mono,monospace" text-anchor="middle">0.000</text>
    </g>`;
  }).join('');

  svg.innerHTML = `<rect fill="#f9faf8" stroke="#e1e4df" x="5" y="5" width="390" height="270" rx="4"/>${defs}${stencilSVG}
    <circle cx="${cx}" cy="${cy}" r="7" fill="#c99a2e"/>
    <text x="${cx - 36}" y="${cy - 12}" font-size="11" fill="#6b7774" text-anchor="end">g₀ (静止)</text>
    <text id="val0" x="${cx - 36}" y="${cy}" font-size="10" fill="#1d2a2a" font-family="JetBrains Mono,monospace" text-anchor="end">0.000</text>
    <g transform="translate(10,255)"><text font-size="10" fill="#6b7774">状态：</text>
      <circle cx="30" cy="-3" r="3" fill="${STATUS_COLOR.flow}"/><text x="36" font-size="10" fill="#6b7774">迁移</text>
      <circle cx="70" cy="-3" r="3" fill="${STATUS_COLOR.bounce}"/><text x="76" font-size="10" fill="#6b7774">反弹</text>
      <circle cx="110" cy="-3" r="3" fill="${STATUS_COLOR.conj}"/><text x="116" font-size="10" fill="#6b7774">共轭</text>
      <circle cx="150" cy="-3" r="3" fill="${STATUS_COLOR.wall}"/><text x="156" font-size="10" fill="#6b7774">墙</text>
    </g>`;

  const valTexts = [svg.querySelector('#val0'), ...Array.from({ length: 6 }, (_, k) => svg.querySelector(`#val${k + 1}`))];
  const lines = Array.from({ length: 6 }, (_, k) => svg.querySelector(`#line${k}`));
  const dots = Array.from({ length: 6 }, (_, k) => svg.querySelector(`#dot${k}`));

  function update(x, y, z, mode) {
    inputs[0].value = x; inputs[1].value = y; inputs[2].value = z;
    const i = x + structure.L * (y + structure.H * z);
    const p = structure.phase[i];
    phaseTag.textContent = PHASE_NAME[p];

    if (p >= 2) {
      // 固相：不显示箭头和分布函数
      macro.c.textContent = '—'; macro.tau.textContent = '—'; macro.d.textContent = '—'; macro.src.textContent = '—';
      for (let k = 0; k < 7; k++) valTexts[k].textContent = '—';
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#6b7774;">固相格点不参与氧气传输</td></tr>';
      lines.forEach(l => { l.style.display = 'none'; });
      dots.forEach(d => { d.style.display = 'none'; });
      return;
    }

    lines.forEach(l => { l.style.display = ''; });
    dots.forEach(d => { d.style.display = ''; });

    const status = DIRS.slice(1).map(([dx, dy, dz]) => neighborStatus(structure, x, y, z, dx, dy, dz));
    lines.forEach((l, k) => {
      const st = status[k];
      l.setAttribute('stroke', STATUS_COLOR[st]);
      l.setAttribute('marker-end', `url(#ah-${st})`);
      dots[k].setAttribute('fill', STATUS_COLOR[st]);
    });

    if (!solver || mode === 'build') {
      macro.c.textContent = '0.000';
      macro.tau.textContent = solver ? solver.tau[i].toFixed(3) : '0.500';
      macro.d.textContent = solver ? (solver.D[i] * 1e6).toFixed(2) : '0.00';
      macro.src.textContent = '0.0';
      for (let k = 0; k < 7; k++) valTexts[k].textContent = '0.000';
      tbody.innerHTML = DIRS.map((d, k) => `<tr><td>${LABELS[k]}</td><td>${WEIGHT[k].toFixed(3)}</td><td>0.000</td><td>—</td></tr>`).join('');
      return;
    }

    const node = solver.node(i);
    macro.c.textContent = node.c.toFixed(3);
    macro.tau.textContent = node.tau.toFixed(3);
    macro.d.textContent = (node.D * 1e6).toFixed(2);
    macro.src.textContent = (node.src / solver.params.dt).toExponential(1);

    for (let k = 0; k < 7; k++) valTexts[k].textContent = node.f[k].toFixed(3);

    const STATUS_NAME = { flow: '迁移', bounce: '反弹', conj: '共轭界面', wall: '墙' };
    const statuses = ['—', ...status.map(s => `<span class="st-dot" style="background:${STATUS_COLOR[s]}"></span>${STATUS_NAME[s]}`)];
    tbody.innerHTML = DIRS.map((d, k) => {
      const v = node.f[k];
      const st = statuses[k];
      return `<tr><td>${LABELS[k]}</td><td>${WEIGHT[k].toFixed(3)}</td><td>${v.toFixed(3)}</td><td>${st}</td></tr>`;
    }).join('');
  }

  return { update };
}
