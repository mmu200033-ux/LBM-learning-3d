import * as THREE from 'three';

export function createClipBox(container, { L, H, W }, onChange) {
  const state = { enabled: true, x0: 0, x1: L - 1, y0: Math.floor(H / 2), y1: H - 1, z0: 0, z1: W - 1 };
  container.innerHTML = `<div class="clip-heading"><strong>剖切</strong><label><input id="clip-enabled" type="checkbox" checked> 开启</label></div>
    ${[['x',L],['y',H],['z',W]].map(([axis,n]) => `<div class="clip-row"><b>${axis}</b><div class="dual-range">${[0,1].map(end => `<input aria-label="${axis} ${end ? '最大' : '最小'}值" data-axis="${axis}${end}" type="range" min="0" max="${n-1}" step="1" value="${state[axis+end]}">`).join('')}</div><output id="clip-${axis}"></output></div>`).join('')}`;
  function emit() {
    container.querySelector('#clip-enabled').checked = state.enabled;
    for (const axis of ['x','y','z']) {
      container.querySelector(`#clip-${axis}`).textContent = `${state[axis+'0']}–${state[axis+'1']}`;
      for (const end of [0,1]) container.querySelector(`[data-axis="${axis}${end}"]`).value = state[axis+end];
    }
    onChange({ ...state });
  }
  container.querySelector('#clip-enabled').addEventListener('change', e => { state.enabled = e.target.checked; emit(); });
  container.querySelectorAll('input[type=range]').forEach(input => input.addEventListener('input', () => {
    const key = input.dataset.axis, axis = key[0], end = key[1];
    state[key] = Number(input.value);
    if (state[axis+'0'] > state[axis+'1']) state[axis+(end === '0' ? '1' : '0')] = state[key];
    emit();
  }));
  // Initialize the readouts and renderer from the same explicit defaults.
  emit();
  return { get state() { return { ...state }; }, setState(next) { Object.assign(state, next); emit(); } };
}

export function clipPlanes(state, center) {
  if (!state.enabled) return [];
  return ['x','y','z'].flatMap((axis, k) => {
    const normal = new THREE.Vector3(); normal.setComponent(k, 1);
    return [new THREE.Plane(normal, -(state[axis+'0'] - center.getComponent(k) - 0.5)), new THREE.Plane(normal.clone().negate(), state[axis+'1'] - center.getComponent(k) + 0.5)];
  });
}

export function insideClip(state, x, y, z) {
  return !state.enabled || x >= state.x0 && x <= state.x1 && y >= state.y0 && y <= state.y1 && z >= state.z0 && z <= state.z1;
}
