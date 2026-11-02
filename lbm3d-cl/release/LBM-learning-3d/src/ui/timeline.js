export const RECORD_INTERVAL = 25;
export const MAX_FRAMES = 400;

// Each frame owns its bytes/profile/diagnostics; it never aliases live solver data.
export function createConcentrationRecording(structure, solver, { targetFrame = null } = {}) {
  const frames = [], N = structure.L * structure.H * structure.W;
  const limit = targetFrame === null ? MAX_FRAMES : targetFrame + 1;
  let startedAt = null, completedAt = null, solveCpuMs = 0;
  function recordCurrent() {
    if (solver.t % RECORD_INTERVAL !== 0 || frames.length >= limit || frames.at(-1)?.step === solver.t) return [];
    const concentration = new Uint8Array(N);
    for (let i = 0; i < N; i += 1) concentration[i] = Math.round(255 * Math.min(1, Math.max(0, solver.c[i] / solver.params.cIn)));
    const frame = { step: solver.t, timeSeconds: solver.t * solver.params.dt, concentration, profile: solver.profileX(), diagnostics: solver.diagnostics() };
    frames.push(frame);
    if (frames.length >= limit) completedAt = performance.now();
    return [frame];
  }
  function loadFrames(nextFrames) {
    frames.length = 0;
    frames.push(...nextFrames.slice(0, limit));
    startedAt = performance.now();
    completedAt = startedAt;
    return frames;
  }
  function advance(budgetMs = 14) {
    if (frames.length >= limit) return [];
    const start = performance.now(), added = [];
    if (startedAt === null) startedAt = start;
    // Complete time steps are atomic in the engine. Check the budget between steps.
    do {
      solver.step(1);
      added.push(...recordCurrent());
      if (frames.length >= limit) break;
    } while (frames.length < limit && performance.now() - start < budgetMs);
    const end = performance.now(); solveCpuMs += end - start;
    if (frames.length >= limit) completedAt = end;
    return added;
  }
  return { frames, advance, recordCurrent, loadFrames,
    get complete() { return frames.length >= limit; },
    get capped() { return frames.length === MAX_FRAMES; },
    get limit() { return limit; },
    stats() { return { frames: frames.length, steps: solver.t, complete: this.complete, capped: this.capped, limit, solveCpuMs, elapsedMs: startedAt === null ? 0 : (completedAt ?? performance.now()) - startedAt, retainedFieldBytes: frames.length * N }; }
  };
}

export function createTimeline(container, recording, onDisplay, { targetFrame = null } = {}) {
  container.innerHTML = '<button id="timeline-play" type="button" aria-label="暂停浓度回放">⏸</button>' +
    '<input id="timeline-slider" type="range" min="0" max="0" step="1" value="0" aria-label="浓度记录帧" disabled>' +
    '<output id="timeline-time">等待第 1 帧</output>' +
    '<label>播放速度 <select id="timeline-speed" aria-label="浓度播放速度"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label>' +
    '<span id="timeline-status" role="status">计算中</span>';
  const button = container.querySelector('#timeline-play'), slider = container.querySelector('#timeline-slider');
  const time = container.querySelector('#timeline-time'), status = container.querySelector('#timeline-status'), speedInput = container.querySelector('#timeline-speed');
  let index = -1, pendingTarget = targetFrame, playing = targetFrame === null, speed = 1, lastTick = null, accumulator = 0;
  function controls() {
    // The thumb represents the requested frame, not only the part already cached.
    slider.disabled = false; button.disabled = !recording.frames.length;
    slider.max = Math.max(0, recording.limit - 1);
    slider.value = pendingTarget === null ? Math.max(0, index) : pendingTarget;
    button.textContent = playing ? '⏸' : '▶'; button.classList.toggle('playing', playing);
    button.setAttribute('aria-label', playing ? '暂停浓度回放' : '播放浓度回放');
    const frame = recording.frames[index];
    if (frame) time.textContent = '第 ' + frame.step + ' 步 · t = ' + (frame.timeSeconds * 1e9).toFixed(2) + ' ns';
    status.textContent = pendingTarget !== null
      ? '正在计算第 ' + pendingTarget + ' 帧 · 已完成 ' + recording.frames.length + '/' + recording.limit + ' 帧'
      : targetFrame !== null && recording.complete ? '已到指定帧' : recording.capped ? '已到记录上限' : '计算中 · ' + recording.frames.length + '/' + recording.limit + ' 帧';
  }
  function display(next) {
    if (!recording.frames.length) return;
    index = Math.max(0, Math.min(recording.frames.length - 1, Math.floor(next)));
    if (pendingTarget !== null && pendingTarget < recording.frames.length && index === pendingTarget) pendingTarget = null;
    onDisplay(recording.frames[index], index); controls();
  }
  function appended(previousLength) {
    if (index < 0 || index >= previousLength - 1) { accumulator = 0; lastTick = null; }
    if (pendingTarget !== null && pendingTarget < recording.frames.length) display(pendingTarget);
    else if (index < 0 && recording.frames.length) display(0);
    controls();
  }
  function tick(now) {
    if (lastTick === null) lastTick = now;
    if (pendingTarget === null && playing && index >= 0) {
      accumulator += Math.max(0, now - lastTick) * speed;
      const count = Math.floor(accumulator / 100);
      if (count) {
        const next = Math.min(recording.frames.length - 1, index + count);
        if (next !== index) display(next);
        accumulator -= count * 100;
      }
      if (index === recording.frames.length - 1) accumulator = 0;
      if (recording.complete && index === recording.frames.length - 1) { playing = false; controls(); }
    }
    lastTick = now;
  }
  function seek(next) {
    const target = Math.max(0, Math.min(recording.limit - 1, Math.floor(Number(next))));
    pendingTarget = target < recording.frames.length ? null : target;
    playing = false; accumulator = 0; lastTick = null;
    if (pendingTarget === null) display(target); else controls();
  }
  button.addEventListener('click', () => {
    if (pendingTarget !== null) pendingTarget = null;
    if (!playing && index === recording.frames.length - 1 && recording.complete) display(0);
    playing = !playing; accumulator = 0; lastTick = performance.now(); controls();
  });
  slider.addEventListener('pointerdown', () => { playing = false; accumulator = 0; controls(); });
  slider.addEventListener('input', () => seek(slider.value));
  speedInput.addEventListener('change', () => { speed = Number(speedInput.value); accumulator = 0; });
  controls();
  return { appended, tick, display, get frame() { return recording.frames[index] ?? null; }, stats: () => ({ index, playing, speed, pendingTarget, following: pendingTarget === null && playing && index === recording.frames.length - 1 }) };
}
