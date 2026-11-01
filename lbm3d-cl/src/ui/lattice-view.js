// 3D lattice view: solid voxels revealed in reconstruction order, pore nodes as dots,
// a y-cutaway that follows the selected node, and the selected node's D3Q7 arrows.
import { createStage } from './stage.js';
import { PHASE, PHASE_COLOR, tauColor } from './palette.js';
import { neighborStatus } from './neighbors.js';

const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const SOLIDISH = new Set([PHASE.IONOMER, PHASE.CARBON, PHASE.PT]);
const STATUS = { flow: { color: '#1f7a72' }, bounce: { color: '#c8683a' }, conj: { color: '#4a8fd4' }, wall: { color: '#1a1a1a' } };

export function createLatticeView(canvas, overlay, structure) {
  const { L, H, W, phase, order } = structure;
  const N = L * H * W;
  const idx = (x, y, z) => x + L * (y + H * z);
  const cx = i => i % L, cy = i => Math.floor(i / L) % H, cz = i => Math.floor(i / (L * H));
  const stage = createStage(canvas, overlay, { L, H, W });
  const { THREE, scene, toWorld, pinLabel } = stage;

  let cutY = 0;
  let threshold = 0;          // nodes with order < threshold are revealed
  let tauArr = null;

  // ---- Solid voxels (ionomer / carbon / Pt) ----
  const solidMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.94, 0.94, 0.94),
    new THREE.MeshLambertMaterial(),
    N
  );
  solidMesh.count = 0;
  scene.add(solidMesh);
  let solidList = [];         // node indices, sorted by order, filtered by cut
  let solidOrders = [];

  // ---- Node dots (anything not yet solid) ----
  const dotPos = new Float32Array(N * 3), dotCol = new Float32Array(N * 3);
  const dotGeo = new THREE.BufferGeometry();
  dotGeo.setAttribute('position', new THREE.BufferAttribute(dotPos, 3));
  dotGeo.setAttribute('color', new THREE.BufferAttribute(dotCol, 3));
  const dots = new THREE.Points(dotGeo, new THREE.PointsMaterial({
    size: 0.22, vertexColors: true, sizeAttenuation: true,
  }));
  scene.add(dots);
  let dotList = [];           // sorted by order descending (never-solid nodes first)
  let dotOrders = [];

  // ---- Buffer slabs and walls ----
  const bl = 3;
  const slabMat = new THREE.MeshLambertMaterial({ color: PHASE_COLOR[PHASE.BUFFER], transparent: true, opacity: 0.28, depthWrite: false });
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x2a2f31, transparent: true, opacity: 0.55, depthWrite: false });
  const slabs = new THREE.Group();
  for (const side of [0, 1]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(bl - 1, H, W), slabMat);
    slab.position.copy(toWorld(side ? L - bl + (bl - 2) / 2 : 1 + (bl - 2) / 2, (H - 1) / 2, (W - 1) / 2));
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, H, W), wallMat);
    wall.position.copy(toWorld(side ? L - 1 : 0, (H - 1) / 2, (W - 1) / 2));
    slabs.add(slab, wall);
  }
  slabs.visible = false;
  scene.add(slabs);
  const bufferStage = structure.stages.find(s => s.name === 'buffer-wall');

  // ---- Cut plane outline ----
  const cutFrame = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(L, W)),
    new THREE.LineBasicMaterial({ color: 0xc99a2e, transparent: true, opacity: 0.6 })
  );
  cutFrame.rotation.x = Math.PI / 2;
  scene.add(cutFrame);

  const col = new THREE.Color(), mat = new THREE.Matrix4();
  const lower = (arr, v) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; arr[m] < v ? lo = m + 1 : hi = m; } return lo; };

  function rebuild() {
    solidList = [];
    dotList = [];
    for (let i = 0; i < N; i++) {
      if (cy(i) < cutY) continue;
      const p = phase[i];
      if (SOLIDISH.has(p)) solidList.push(i);
      // 只在切面和外表面画格点，避免内部点阵叠出摩尔纹
      const x = cx(i), y = cy(i), z = cz(i);
      const onShell = y === cutY || y === H - 1 || z === 0 || z === W - 1 || x === 3 || x === L - 4;
      if (onShell && p !== PHASE.BUFFER && p !== PHASE.WALL) dotList.push(i);
    }
    solidList.sort((a, b) => order[a] - order[b]);
    solidOrders = solidList.map(i => order[i]);
    // dots: never-solid first (order -1 → treated as +inf), then by order descending
    const key = i => (SOLIDISH.has(phase[i]) ? order[i] : Infinity);
    dotList.sort((a, b) => key(b) - key(a));
    dotOrders = dotList.map(i => -key(i));   // ascending

    for (let k = 0; k < solidList.length; k++) {
      const i = solidList[k];
      mat.makeTranslation(toWorld(cx(i), cy(i), cz(i)));
      solidMesh.setMatrixAt(k, mat);
      col.setHex(PHASE_COLOR[phase[i]]);
      solidMesh.setColorAt(k, col);
    }
    solidMesh.instanceMatrix.needsUpdate = true;
    if (solidMesh.instanceColor) solidMesh.instanceColor.needsUpdate = true;

    for (let k = 0; k < dotList.length; k++) {
      const i = dotList[k];
      const v = toWorld(cx(i), cy(i), cz(i));
      dotPos.set([v.x, v.y, v.z], k * 3);
    }
    dotGeo.attributes.position.needsUpdate = true;
    colorDots();

    cutFrame.position.set(0, cutY - (H - 1) / 2 - 0.5, 0);
    pickPlane.constant = -(cutY - (H - 1) / 2 - 0.5);
    applyThreshold();
  }

  function colorDots() {
    for (let k = 0; k < dotList.length; k++) {
      const i = dotList[k];
      let r = 0.55, g = 0.6, b = 0.58;
      if (tauArr && phase[i] === PHASE.PORE) {
        const c = tauColor((tauArr[i] - 0.5) / 1.4);
        r = c[0] / 255; g = c[1] / 255; b = c[2] / 255;
      }
      dotCol.set([r, g, b], k * 3);
    }
    dotGeo.attributes.color.needsUpdate = true;
    dots.material.size = tauArr ? 0.5 : 0.32;
  }

  function applyThreshold() {
    solidMesh.count = lower(solidOrders, threshold);
    // dots visible while order >= threshold  ⇔  -order <= -threshold
    let n = dotOrders.length;
    let lo = 0, hi = n;
    while (lo < hi) { const m = (lo + hi) >> 1; dotOrders[m] <= -threshold ? lo = m + 1 : hi = m; }
    dotGeo.setDrawRange(0, lo);
    slabs.visible = bufferStage && threshold > bufferStage.start;
  }

  function setRevealOrder(th) { if (th !== threshold) { threshold = th; applyThreshold(); } }
  function setCut(y) { y = Math.max(0, Math.min(H - 1, y)); if (y !== cutY) { cutY = y; rebuild(); } }
  function setTau(arr) { tauArr = arr; colorDots(); }

  // ---- Selection marker and D3Q7 arrows ----
  const sel = new THREE.Group();
  sel.renderOrder = 10;
  const selBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.08, 1.08, 1.08)),
    new THREE.LineBasicMaterial({ color: 0xc99a2e, depthTest: false, transparent: true })
  );
  sel.add(selBox);
  const shaftGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.72, 10).translate(0, 0.36, 0);
  const tipGeo = new THREE.ConeGeometry(0.13, 0.26, 12).translate(0, 0.85, 0);
  const arrows = DIRS.map(d => {
    const m = new THREE.MeshBasicMaterial({ color: STATUS.flow.color, depthTest: false, transparent: true });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(shaftGeo, m), new THREE.Mesh(tipGeo, m));
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...d));
    g.userData.mat = m;
    sel.add(g);
    return g;
  });
  const packetGeo = new THREE.SphereGeometry(0.11, 12, 8);
  const packets = DIRS.map(() => {
    const m = new THREE.Mesh(packetGeo, new THREE.MeshBasicMaterial({ color: 0x1f7a72, depthTest: false, transparent: true }));
    m.visible = false;
    sel.add(m);
    return m;
  });
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xc99a2e, depthTest: false, transparent: true }));
  sel.add(core);
  sel.traverse(o => { o.renderOrder = 10; });
  scene.add(sel);

  let selNode = null, status = [];
  function setSelection(x, y, z) {
    selNode = { x, y, z };
    sel.position.copy(toWorld(x, y, z));
    status = DIRS.map(([dx, dy, dz]) => neighborStatus(structure, x, y, z, dx, dy, dz));
    arrows.forEach((a, k) => a.userData.mat.color.set(STATUS[status[k]].color));
    setCut(y);
  }

  // Substep animation for the selected node. p in [0,1]; substep null = idle.
  function animate(substep, p) {
    const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
    packets.forEach((m, k) => {
      m.visible = false;
      const d = DIRS[k], st = status[k];
      if (substep === 'stream') {
        m.visible = true;
        const blocked = st === 'bounce' || st === 'wall';
        const reach = blocked ? 0.5 : 1;
        m.position.set(d[0] * reach * ease, d[1] * reach * ease, d[2] * reach * ease);
        m.material.color.set(st === 'conj' ? STATUS.conj.color : STATUS.flow.color);
      } else if (substep === 'bounce' && (st === 'bounce' || st === 'wall')) {
        m.visible = true;
        const s = 0.5 * (1 - ease);
        m.position.set(d[0] * s, d[1] * s, d[2] * s);
        m.material.color.set(STATUS.bounce.color);
      }
    });
    const pulse = substep === 'collide' || substep === 'macro' || substep === 'reaction'
      ? 1 + 0.6 * Math.sin(Math.PI * p) : 1;
    core.scale.setScalar(pulse);
    core.material.color.set(substep === 'reaction' ? 0xc8683a : 0xc99a2e);
    arrows.forEach((a, k) => {
      const lit = substep === 'stream' || (substep === 'bounce' && (status[k] === 'bounce' || status[k] === 'wall'));
      a.userData.mat.opacity = substep && !lit ? 0.35 : 1;
    });
  }
  function setArrowsVisible(v) { arrows.forEach(a => { a.visible = v; }); }

  // ---- Picking on the cut face ----
  const pickPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
  let down = null, onPick = null;
  canvas.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, stage.camera);
    if (!raycaster.ray.intersectPlane(pickPlane, hit)) return;
    const x = Math.round(hit.x + (L - 1) / 2), z = Math.round(hit.z + (W - 1) / 2);
    if (x >= 0 && x < L && z >= 0 && z < W) onPick?.(x, cutY, z);
  });

  pinLabel(overlay.querySelector('.inlet-label'), toWorld(-1.5, (H - 1) / 2, W + 1));
  pinLabel(overlay.querySelector('.outlet-label'), toWorld(L + 0.5, (H - 1) / 2, W + 1));

  rebuild();

  return {
    camera: stage.camera, controls: stage.controls,
    render: stage.render, setRevealOrder, setCut, setTau, setSelection, animate, setArrowsVisible,
    onPick: f => { onPick = f; },
  };
}
