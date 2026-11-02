import * as THREE from 'three';

const WORLD_UP = new THREE.Vector3(0, 0, 1);

export function createFreeCameraControls(camera, canvas) {
  const keys = new Set();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const screenUp = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const panOffset = new THREE.Vector3();
  const pivot = new THREE.Vector3();
  const reference = new THREE.Vector3();
  const yawRotation = new THREE.Quaternion();
  const pitchRotation = new THREE.Quaternion();
  const rotation = new THREE.Quaternion();
  const nextOrientation = new THREE.Quaternion();
  const ndc = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  let yaw = 0;
  let pitch = 0;
  let dragging = null;
  let pivotPicker = null;
  let dragEndListener = null;
  let hover = false;
  let lastTime = performance.now();
  const minViewDepth = 0.1;
  const rotationSpeed = 0.005;
  const baseSpeed = 24;
  const dragThreshold = 4;

  canvas.tabIndex = 0;
  canvas.style.touchAction = 'none';

  function directionFromAngles() {
    const cosPitch = Math.cos(pitch);
    return forward.set(Math.cos(yaw) * cosPitch, Math.sin(yaw) * cosPitch, Math.sin(pitch)).normalize();
  }

  function syncAngles() {
    camera.getWorldDirection(forward).normalize();
    yaw = Math.atan2(forward.y, forward.x);
    pitch = THREE.MathUtils.clamp(Math.asin(THREE.MathUtils.clamp(forward.z, -1, 1)), -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
  }

  function viewDepth() {
    directionFromAngles();
    return Math.max(minViewDepth, reference.clone().sub(camera.position).dot(forward));
  }

  function pan(dx, dy) {
    directionFromAngles();
    right.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
    screenUp.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
    const scale = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * viewDepth()) / Math.max(1, canvas.clientHeight);
    panOffset.set(0, 0, 0).addScaledVector(right, -dx * scale).addScaledVector(screenUp, dy * scale);
    camera.position.add(panOffset);
    reference.add(panOffset);
  }

  function rotate(dx, dy) {
    const desiredPitch = THREE.MathUtils.clamp(pitch - dy * rotationSpeed, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
    yawRotation.setFromAxisAngle(WORLD_UP, -dx * rotationSpeed);
    camera.getWorldDirection(forward);
    right.copy(forward).cross(WORLD_UP).normalize();
    pitchRotation.setFromAxisAngle(right, (desiredPitch - pitch));
    rotation.copy(pitchRotation).multiply(yawRotation);
    offset.copy(camera.position).sub(pivot).applyQuaternion(rotation);
    camera.position.copy(pivot).add(offset);
    reference.sub(pivot).applyQuaternion(rotation).add(pivot);
    nextOrientation.copy(rotation).multiply(camera.quaternion).normalize();
    camera.quaternion.copy(nextOrientation);
    camera.updateMatrixWorld();
    syncAngles();
  }

  function moveAlongView(amount) {
    directionFromAngles();
    offset.copy(forward).multiplyScalar(amount);
    camera.position.add(offset);
  }

  function move(dt) {
    if (!keys.size) return;
    directionFromAngles();
    right.copy(WORLD_UP).cross(forward).normalize();
    const speed = baseSpeed * (keys.has('shift') ? 3 : 1) * Math.max(minViewDepth, viewDepth()) * dt;
    const motion = new THREE.Vector3();
    if (keys.has('w')) motion.add(forward);
    if (keys.has('s')) motion.sub(forward);
    if (keys.has('d')) motion.add(right);
    if (keys.has('a')) motion.sub(right);
    if (keys.has('e')) motion.add(WORLD_UP);
    if (keys.has('q')) motion.sub(WORLD_UP);
    if (motion.lengthSq() > 0) {
      motion.normalize().multiplyScalar(speed);
      camera.position.add(motion);
      reference.add(motion);
    }
  }

  function relevantKey(event) {
    if (event.target instanceof HTMLElement && event.target !== canvas && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(event.target.tagName)) return null;
    const key = event.key.toLowerCase();
    if (key === 'shift') return 'shift';
    return ['w', 'a', 's', 'd', 'q', 'e'].includes(key) ? key : null;
  }

  function onKeyDown(event) {
    const key = relevantKey(event);
    if (!key || (!hover && document.activeElement !== canvas)) return;
    keys.add(key);
    event.preventDefault();
  }

  function onKeyUp(event) {
    const key = relevantKey(event);
    if (key) keys.delete(key);
  }

  function fallbackPivot(event) {
    const rect = canvas.getBoundingClientRect();
    ndc.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    camera.updateMatrixWorld();
    raycaster.setFromCamera(ndc, camera);
    const depth = viewDepth();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(forward, camera.position.clone().addScaledVector(forward, depth));
    return raycaster.ray.intersectPlane(plane, pivot) ? pivot.clone() : reference.clone();
  }

  function onPointerDown(event) {
    if (event.button !== 0 && event.button !== 2) return;
    canvas.focus({ preventScroll: true });
    const panGesture = event.button === 2 || event.shiftKey;
    const start = { pointerId: event.pointerId, button: event.button, shift: event.shiftKey, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false, pan: panGesture };
    if (!panGesture && event.button === 0) {
      const picked = pivotPicker?.(event.clientX, event.clientY);
      pivot.copy(picked?.isVector3 ? picked : fallbackPivot(event));
    }
    dragging = start;
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!dragging || event.pointerId !== dragging.pointerId) return;
    const dx = event.clientX - dragging.lastX;
    const dy = event.clientY - dragging.lastY;
    dragging.lastX = event.clientX;
    dragging.lastY = event.clientY;
    if (!dragging.moved && Math.hypot(event.clientX - dragging.x, event.clientY - dragging.y) > dragThreshold) dragging.moved = true;
    if (dragging.pan) pan(dx, dy);
    else if (dragging.moved) rotate(dx, dy);
    event.preventDefault();
  }

  function stopDrag(event) {
    if (!dragging) return;
    const ended = dragging;
    dragging = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    dragEndListener?.(event, ended.moved, ended.pan);
  }

  canvas.addEventListener('pointerenter', () => { hover = true; });
  canvas.addEventListener('pointerleave', () => { hover = false; });
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
  canvas.addEventListener('lostpointercapture', stopDrag);
  canvas.addEventListener('wheel', (event) => {
    moveAlongView(-event.deltaY * Math.max(0.08, viewDepth() * 0.0015));
    event.preventDefault();
  }, { passive: false });
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  window.addEventListener('keydown', onKeyDown, { passive: false });
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => keys.clear());

  function setPose(position, target) {
    camera.position.copy(position);
    reference.copy(target);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    syncAngles();
  }

  function update(deltaSeconds) {
    const now = performance.now();
    const dt = Number.isFinite(deltaSeconds) ? Math.min(0.1, Math.max(0, deltaSeconds)) : Math.min(0.1, Math.max(0, (now - lastTime) / 1000));
    lastTime = now;
    move(dt);
    return true;
  }

  syncAngles();
  return {
    update, setPose, syncAngles, minViewDepth,
    setPivotPicker: picker => { pivotPicker = picker; },
    setDragEndListener: listener => { dragEndListener = listener; },
    get reference() { return reference; },
  };
}
