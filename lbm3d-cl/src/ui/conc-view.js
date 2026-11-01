// 3D concentration view: two orthogonal slice planes (y and x), marker box.
import { createStage } from './stage.js';
import { PHASE, PHASE_COLOR, viridis } from './palette.js';

export function createConcView(canvas, overlay, structure, solver) {
  const { L, H, W, phase } = structure;
  const idx = (x, y, z) => x + L * (y + H * z);
  const stage = createStage(canvas, overlay, { L, H, W });
  const { THREE, scene, toWorld, pinLabel } = stage;

  let cMax = 7.354;

  // Y-slice (xz plane at y=selY)
  const texY = new THREE.DataTexture(new Uint8Array(L * W * 4), L, W, THREE.RGBAFormat);
  texY.minFilter = texY.magFilter = THREE.NearestFilter;
  const sliceY = new THREE.Mesh(
    new THREE.PlaneGeometry(L, W),
    new THREE.MeshBasicMaterial({ map: texY, side: THREE.DoubleSide })
  );
  sliceY.rotation.x = Math.PI / 2;
  scene.add(sliceY);

  // X-slice (yz plane at x=selX)
  const texX = new THREE.DataTexture(new Uint8Array(H * W * 4), H, W, THREE.RGBAFormat);
  texX.minFilter = texX.magFilter = THREE.NearestFilter;
  const sliceX = new THREE.Mesh(
    new THREE.PlaneGeometry(H, W).rotateX(Math.PI / 2).rotateZ(Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: texX, side: THREE.DoubleSide })
  );
  scene.add(sliceX);

  // Selection marker
  const selBox = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.08, 1.08, 1.08)),
    new THREE.LineBasicMaterial({ color: 0xc99a2e, depthTest: false })
  );
  selBox.renderOrder = 10;
  scene.add(selBox);

  let selX = Math.floor(L / 2), selY = Math.floor(H / 2);

  function setSelection(x, y) {
    selX = Math.max(0, Math.min(L - 1, x));
    selY = Math.max(0, Math.min(H - 1, y));
    sliceY.position.copy(toWorld((L - 1) / 2, selY, (W - 1) / 2));
    sliceX.position.copy(toWorld(selX, (H - 1) / 2, (W - 1) / 2));
    updateSlices();
  }

  function updateSlices() {
    if (!solver) return;
    const c = solver.c;

    // Y slice
    for (let z = 0; z < W; z++) {
      for (let x = 0; x < L; x++) {
        const i = idx(x, selY, z);
        const p = phase[i];
        let rgb;
        if (p >= PHASE.CARBON) {
          const col = PHASE_COLOR[p];
          rgb = [(col >> 16) & 0xff, (col >> 8) & 0xff, col & 0xff, 255];
        } else {
          const t = Math.min(1, c[i] / cMax);
          const v = viridis(t);
          rgb = [v[0], v[1], v[2], 255];
        }
        const ti = (z * L + x) * 4;
        texY.image.data.set(rgb, ti);
      }
    }
    texY.needsUpdate = true;

    // X slice
    for (let z = 0; z < W; z++) {
      for (let y = 0; y < H; y++) {
        const i = idx(selX, y, z);
        const p = phase[i];
        let rgb;
        if (p >= PHASE.CARBON) {
          const col = PHASE_COLOR[p];
          rgb = [(col >> 16) & 0xff, (col >> 8) & 0xff, col & 0xff, 255];
        } else {
          const t = Math.min(1, c[i] / cMax);
          const v = viridis(t);
          rgb = [v[0], v[1], v[2], 255];
        }
        const ti = (z * H + y) * 4;
        texX.image.data.set(rgb, ti);
      }
    }
    texX.needsUpdate = true;
  }

  function updateMarker(x, y, z) {
    selBox.position.copy(toWorld(x, y, z));
  }

  pinLabel(overlay.querySelector('.inlet-label'), toWorld(-1.5, (H - 1) / 2, W + 1));
  pinLabel(overlay.querySelector('.outlet-label'), toWorld(L + 0.5, (H - 1) / 2, W + 1));

  setSelection(selX, selY);
  updateSlices();

  return { render: stage.render, setSelection, updateSlices, updateMarker, setCMax: v => { cMax = v; } };
}
