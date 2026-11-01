// Shared three.js setup: renderer, camera, orbit controls, axis gizmo, HTML labels.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createStage(canvas, overlay, { L, H, W }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 2000);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;
  controls.minDistance = 2;
  controls.maxDistance = Math.hypot(L, H, W) * 4;
  scene.add(new THREE.AmbientLight(0xffffff, 0.62));
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(-0.6, -1, 1.3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25);
  fill.position.set(1, 0.6, -0.4);
  scene.add(fill);

  // World coords: lattice (x,y,z) → three (x - L/2, y - H/2, z - W/2); z is up.
  const center = new THREE.Vector3((L - 1) / 2, (H - 1) / 2, (W - 1) / 2);
  const toWorld = (x, y, z) => new THREE.Vector3(x - center.x, y - center.y, z - center.z);

  // Domain outline
  const box = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(L, H, W)),
    new THREE.LineBasicMaterial({ color: 0x9aa5a1 })
  );
  scene.add(box);

  function fit(target = new THREE.Vector3(), heightFraction = null) {
    if (!canvas.clientWidth || !canvas.clientHeight) return;
    const vFov = (camera.fov * Math.PI) / 180;
    const dir = new THREE.Vector3(0.32, -1, 0.5).normalize();
    let dist;
    if (heightFraction) {
      const screenUp = new THREE.Vector3(0, 0, 1).addScaledVector(dir, -dir.z).normalize();
      const projectedHeight = 5 * (Math.abs(screenUp.x) + Math.abs(screenUp.y) + Math.abs(screenUp.z));
      dist = projectedHeight / (2 * Math.tan(vFov / 2) * heightFraction);
    } else {
      const r = Math.hypot(L, H, W) * 0.5;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      const fov = Math.min(vFov, hFov);
      dist = (r / Math.sin(fov / 2)) * 0.92;
    }
    camera.position.copy(dir.multiplyScalar(dist));
    camera.position.add(target);
    controls.target.copy(target);
    controls.update();
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  // 画布尺寸确定后再定相机，之后只在用户点「重置视角」时再调用
  let fitted = false;
  new ResizeObserver(() => { resize(); if (!fitted && canvas.clientWidth) { fit(); fitted = true; } }).observe(canvas);
  resize();
  if (canvas.clientWidth) { fit(); fitted = true; }

  // Axis gizmo (SVG, follows camera rotation)
  const gizmoEl = overlay.querySelector('.gizmo');
  gizmoEl.innerHTML = `<svg viewBox="-32 -32 64 64" width="64" height="64">
    <line id="gx" stroke="#c8683a" stroke-width="2"/><text id="tx" fill="#c8683a" font-size="10">X</text>
    <line id="gy" stroke="#1f7a72" stroke-width="2"/><text id="ty" fill="#1f7a72" font-size="10">Y</text>
    <line id="gz" stroke="#4a8fd4" stroke-width="2"/><text id="tz" fill="#4a8fd4" font-size="10">Z</text>
  </svg>`;
  const gl = { x: gizmoEl.querySelector('#gx'), y: gizmoEl.querySelector('#gy'), z: gizmoEl.querySelector('#gz') };
  const gt = { x: gizmoEl.querySelector('#tx'), y: gizmoEl.querySelector('#ty'), z: gizmoEl.querySelector('#tz') };
  const axes = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
  const qInv = new THREE.Quaternion();
  function updateGizmo() {
    qInv.copy(camera.quaternion).invert();
    for (const k of ['x', 'y', 'z']) {
      const v = axes[k].clone().applyQuaternion(qInv);
      const ex = v.x * 20, ey = -v.y * 20;
      gl[k].setAttribute('x1', 0); gl[k].setAttribute('y1', 0);
      gl[k].setAttribute('x2', ex); gl[k].setAttribute('y2', ey);
      gt[k].setAttribute('x', ex * 1.3 - 3); gt[k].setAttribute('y', ey * 1.3 + 3);
    }
  }

  // HTML labels pinned to 3D points
  const labels = [];
  function pinLabel(el, pos) { labels.push({ el, pos }); }
  const tmp = new THREE.Vector3();
  function updateLabels() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    for (const { el, pos } of labels) {
      tmp.copy(pos).project(camera);
      const visible = tmp.z < 1;
      el.style.display = visible ? '' : 'none';
      el.style.left = `${(tmp.x * 0.5 + 0.5) * w}px`;
      el.style.top = `${(-tmp.y * 0.5 + 0.5) * h}px`;
    }
  }

  const resetBtn = document.createElement('button');
  resetBtn.className = 'reset-view';
  resetBtn.textContent = '重置视角';
  overlay.appendChild(resetBtn);

  function render() {
    controls.update();
    renderer.render(scene, camera);
    updateGizmo();
    updateLabels();
  }

  return { THREE, renderer, scene, camera, controls, toWorld, overlay, pinLabel, render, fit, box, resetBtn };
}
