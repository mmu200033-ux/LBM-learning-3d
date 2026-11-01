// 主控制：结构生成、求解器、界面状态与播放
import { reconstruct, createSolver, SUBSTEPS } from './engine/mock-engine.js';
import { PHASE } from './ui/palette.js';
import { createLatticeView } from './ui/lattice-view.js';
import { createConcView } from './ui/conc-view.js';
import { createInspector } from './ui/inspector.js';
import { createChart } from './ui/chart.js';

const BUILD_STAGES = [
  { key: 'empty', label: '空格点阵', dur: 0, cap: '初始化三维网格，每个格点可容纳一个相（孔隙、离聚物、碳、铂）。' },
  { key: 'carbon-init', label: '初始碳球', dur: 2200, cap: (n, f) => `无重叠放置 <b>${n} 个碳球</b>（半径 5 格），占碳目标体积分数 ${(f * 100).toFixed(1)}% 的约 20%。` },
  { key: 'carbon-grow', label: '碳生长', dur: 2200, cap: (n, f) => `重叠率 ≤20% 的新球继续填充，碳体积分数达 <b>${(f * 100).toFixed(1)}%</b>。` },
  { key: 'pt', label: '铂沉积', dur: 1800, cap: (n, f) => `在与碳相邻的孔隙格点上随机放置 <b>${n} 个铂颗粒</b>（体积分数 ${(f * 100).toFixed(2)}%）。` },
  { key: 'ionomer', label: '离聚物', dur: 2200, cap: (n, f) => `优先贴近铂、其次离聚物、再次碳的孔隙格点逐步覆盖 <b>${n} 个</b>（体积分数 ${(f * 100).toFixed(1)}%）。` },
  { key: 'buffer-wall', label: '缓冲与墙', dur: 1200, cap: 'x 两端各 3 层缓冲层，最外层为墙（固定浓度边界 x=0，零通量边界 x=L−1）。' },
  { key: 'tau', label: '弛豫时间 τ', dur: 0, cap: '孔隙内按克努森+体扩散算 τ，离聚物内 τ≈0.5（扩散慢），缓冲层虚拟扩散系数 τ 高。切换到「时间步」查看浓度场演化。' },
];
const STEP_LABELS = ['迁移', '反弹', '入口', '宏观量', '反应', '碰撞'];
const STEP_CAPS = [
  '分布函数沿速度方向推向邻居格点',
  '碰到固相的分量反弹返回',
  'x=1 入口恒浓度边界',
  '七个分量求和得宏观浓度',
  '铂-离聚物界面按 Butler-Volmer 方程消耗氧气',
  'MRT 碰撞松弛到平衡态（原型用 BGK）',
];

let structure, solver, latticeView, concView, inspector, chart;
let mode = 'build', stage = 0, progress = 0, substep = 0;
let playing = false, running = false, speed = 1;
let animStart = null, animDur = 0;
let selX = 8, selY = 16, selZ = 16;

function init() {
  const params = new URLSearchParams(location.search);
  const seed = parseInt(params.get('seed'), 10) || 42;
  document.getElementById('seed').value = seed;
  document.getElementById('regen').addEventListener('click', () => {
    location.search = `?seed=${document.getElementById('seed').value}`;
  });

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => { if (btn.dataset.mode !== mode) setMode(btn.dataset.mode); });
  });
  document.getElementById('play').addEventListener('click', () => { playing = !playing; if (playing && !animStart) stepOnce(); });
  document.getElementById('step').addEventListener('click', stepOnce);
  document.getElementById('speed').addEventListener('input', e => {
    speed = parseFloat(e.target.value);
    document.getElementById('speed-val').textContent = speed.toFixed(1) + '×';
  });
  document.getElementById('run-toggle').addEventListener('click', () => {
    if (!running && mode === 'build') setMode('step');
    running = !running;
  });

  document.getElementById('sel-x').addEventListener('change', e => {
    selX = Math.max(0, Math.min(structure.L - 1, parseInt(e.target.value, 10)));
    updateSelection();
  });
  document.getElementById('sel-y').addEventListener('change', e => {
    selY = Math.max(0, Math.min(structure.H - 1, parseInt(e.target.value, 10)));
    updateSelection();
  });
  document.getElementById('sel-z').addEventListener('change', e => {
    selZ = Math.max(0, Math.min(structure.W - 1, parseInt(e.target.value, 10)));
    updateSelection();
  });

  generate(seed);
}

function generate(seed) {
  playing = false; running = false; animStart = null;
  structure = reconstruct({ seed, L: 64, H: 32, W: 32 });
  solver = createSolver(structure);

  latticeView = createLatticeView(document.getElementById('lattice-canvas'), document.querySelector('#panel-lattice .lattice-overlay'), structure);
  concView = createConcView(document.getElementById('conc-canvas'), document.querySelector('#panel-conc .conc-overlay'), structure, solver);
  inspector = createInspector(document.getElementById('panel-inspector'), structure, solver);
  chart = createChart(document.getElementById('profile-chart'), structure, solver);

  latticeView.onPick((x, y, z) => { selX = x; selY = y; selZ = z; updateSelection(); });
  document.querySelector('.grid-info').textContent = `${structure.L} × ${structure.H} × ${structure.W}`;
  document.getElementById('footer-grid').textContent = `${structure.L} × ${structure.H} × ${structure.W}`;
  document.getElementById('footer-eta').textContent = `${solver.params.eta.toFixed(2)} V`;
  document.getElementById('footer-dt').textContent = `${(solver.params.dt * 1e12).toFixed(1)} ps`;

  // 默认选点：离聚物 + 铂邻居 + 孔隙邻居
  outer: for (let x = 6; x < Math.min(18, structure.L); x++) {
    for (let y = 0; y < structure.H; y++) {
      for (let z = 0; z < structure.W; z++) {
        const i = x + structure.L * (y + structure.H * z);
        if (structure.phase[i] !== PHASE.IONOMER) continue;
        const nb = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
        let pt = false, pore = false;
        for (const [dx, dy, dz] of nb) {
          const ni = (x + dx) + structure.L * ((y + dy + structure.H) % structure.H + structure.H * ((z + dz + structure.W) % structure.W));
          if (structure.phase[ni] === PHASE.PT) pt = true;
          if (structure.phase[ni] === PHASE.PORE) pore = true;
        }
        if (pt && pore) { selX = x; selY = y; selZ = z; break outer; }
      }
    }
  }

  setMode('build');
  setBuild(0, 0);
  updateSelection();
}

function setMode(m) {
  mode = m;
  playing = false; running = false; animStart = null;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  if (m === 'build') {
    latticeView.setArrowsVisible(false);
    setBuild(0, 0);
  } else {
    // 时间步模式：结构完整显示
    latticeView.setRevealOrder(Infinity);
    latticeView.setTau(null);
    latticeView.setArrowsVisible(true);
    setSubstep(solver.substep);
  }
  renderStepper();
  updateCaption();
}

function setBuild(s, p) {
  stage = s; progress = p;
  const st = structure.stages.find(x => x.name === BUILD_STAGES[stage].key);
  let threshold = 0;
  if (st) {
    if (st.name === 'tau') threshold = Infinity;
    else if (st.name === 'empty') threshold = 0;
    else threshold = st.start + Math.round((st.end - st.start + 1) * progress);
  }
  latticeView.setRevealOrder(threshold);
  latticeView.setTau(stage === 6 ? solver.tau : null);
  latticeView.render();
  renderStepper();
  updateCaption();
}

function setSubstep(s) {
  substep = s;
  renderStepper();
  updateCaption();
  inspector.update(selX, selY, selZ, 'step');
  concView.updateSlices();
  chart.update(selX);
  updateDiag();
}

function stepOnce() {
  if (mode === 'build') {
    if (animStart) { progress = 1; animStart = null; }
    if (stage < BUILD_STAGES.length - 1 || progress < 1) {
      if (BUILD_STAGES[stage].dur > 0 && progress < 1) {
        animStart = performance.now();
        animDur = BUILD_STAGES[stage].dur / speed;
      } else if (stage < BUILD_STAGES.length - 1) {
        setBuild(stage + 1, 0);
        if (BUILD_STAGES[stage].dur > 0) { animStart = performance.now(); animDur = BUILD_STAGES[stage].dur / speed; }
      }
    }
  } else {
    solver.stepSub();
    substep = solver.substep;
    setSubstep(substep);
    if (substep !== 0) { animStart = performance.now(); animDur = 550 / speed; }
  }
}

function updateSelection() {
  selX = Math.max(0, Math.min(structure.L - 1, selX));
  selY = Math.max(0, Math.min(structure.H - 1, selY));
  selZ = Math.max(0, Math.min(structure.W - 1, selZ));
  latticeView.setSelection(selX, selY, selZ);
  concView.setSelection(selX, selY);
  concView.updateMarker(selX, selY, selZ);
  inspector.update(selX, selY, selZ, mode);
  chart.update(selX);
  latticeView.render();
  concView.render();
}

function renderStepper() {
  const list = mode === 'build' ? BUILD_STAGES : SUBSTEPS.map((s, i) => ({ key: s, label: STEP_LABELS[i] }));
  const stepper = document.getElementById('stage-stepper');
  const cur = mode === 'build' ? stage : substep;
  const prg = mode === 'build' ? progress : 0;
  stepper.innerHTML = list.map((s, i) => {
    const done = i < cur || (i === cur && prg >= 1);
    const active = i === cur;
    const cls = done ? 'done' : active ? 'active' : '';
    const bar = active && prg > 0 && prg < 1 ? `<div class="bar" style="width:${prg * 100}%"></div>` : '';
    return `<div class="step-chip ${cls}" data-idx="${i}"><span class="num">${i + 1}</span>${s.label}${bar}</div>`;
  }).join('');
  stepper.querySelectorAll('.step-chip').forEach((ch, i) => {
    ch.addEventListener('click', () => {
      if (mode === 'build') { setBuild(i, 0); if (BUILD_STAGES[i].dur > 0) { animStart = performance.now(); animDur = BUILD_STAGES[i].dur / speed; } }
      else { while (solver.substep !== i) solver.stepSub(); setSubstep(i); }
    });
  });
}

function updateCaption() {
  const cap = document.querySelector('.caption');
  if (mode === 'build') {
    const st = BUILD_STAGES[stage];
    if (typeof st.cap === 'function') {
      const stg = structure.stages.find(x => x.name === st.key);
      const n = stg ? stg.end - stg.start + 1 : 0;
      const key = st.key.replace('-init', '').replace('-grow', '').replace('-wall', '');
      const f = structure.fractions[key] || 0;
      cap.innerHTML = st.cap(n, f);
    } else {
      cap.innerHTML = st.cap;
    }
  } else {
    cap.innerHTML = `<b>${STEP_LABELS[substep]}</b>：${STEP_CAPS[substep]}`;
  }
}

function updateDiag() {
  const d = solver.diagnostics();
  document.getElementById('diag-step').textContent = d.t;
  document.getElementById('diag-time').textContent = (d.timeSeconds * 1e9).toFixed(2);
  document.getElementById('diag-flux').textContent = d.inletFlux.toFixed(3);
  document.getElementById('diag-rxn').textContent = d.totalReaction.toFixed(3);
  document.getElementById('diag-err').textContent = (d.balanceError * 100).toFixed(1);
}

function animate(time) {
  if (animStart && animDur > 0) {
    const elapsed = time - animStart;
    const p = Math.min(1, elapsed / animDur);
    if (mode === 'build') {
      setBuild(stage, p);
      if (p >= 1) {
        animStart = null;
        if (playing && stage < BUILD_STAGES.length - 1) {
          setBuild(stage + 1, 0);
          if (BUILD_STAGES[stage].dur > 0) { animStart = time; animDur = BUILD_STAGES[stage].dur / speed; }
        } else if (playing && stage === BUILD_STAGES.length - 1) {
          playing = false;
        }
      }
    } else {
      latticeView.animate(SUBSTEPS[substep], p);
      if (p >= 1) { animStart = null; if (playing) stepOnce(); }
    }
  }

  if (running && mode === 'step') {
    const budget = 14, t0 = performance.now();
    while (performance.now() - t0 < budget) solver.step(1);
    setSubstep(solver.substep);
  }

  const playBtn = document.getElementById('play');
  playBtn.textContent = playing ? '⏸' : '▶';
  playBtn.classList.toggle('playing', playing);

  const runBtn = document.getElementById('run-toggle');
  runBtn.textContent = running ? '停止' : '连续求解';
  runBtn.classList.toggle('running', running);

  latticeView.render();
  concView.render();
  requestAnimationFrame(animate);
}

init();
requestAnimationFrame(animate);
window.__lbm = { get structure() { return structure; }, get solver() { return solver; }, get latticeView() { return latticeView; } };
