import { reconstruct, createSolver, E, PHASE } from './engine/index.js';
import { createLatticeView } from './ui/lattice-view.js';
import { createVolumeView } from './ui/volume-view.js';
import { createInspector } from './ui/inspector.js';
import { createChart } from './ui/chart.js';
import { readUrlState } from './ui/url-state.js';
import { captureBlock, captureDistributions, blockFromSnapshot, blockOrigin, wrap, BLOCK_SIZE } from './ui/block-state.js';
import { createConcentrationRecording, createTimeline, MAX_FRAMES, RECORD_INTERVAL } from './ui/timeline.js';
import { loadConcentrationCache } from './ui/concentration-cache.js';

const BUILD_STAGES = [
  { key:'empty',label:'空格点阵',dur:0,cap:'初始化三维网格，每个格点可容纳一个相（孔隙、离聚物、碳、铂）。' },
  { key:'carbon-init',label:'初始碳球',dur:2200,cap:'无重叠放置初始碳球，radius = 5，实际球半径为 4 格。' },
  { key:'carbon-grow',label:'碳生长',dur:2200,cap:'按重叠生长规则继续填充碳球，y、z 两方向周期重构。' },
  { key:'pt',label:'铂沉积',dur:1800,cap:'在与碳相邻的孔隙格点上随机沉积铂；跨 y、z 周期边界的碳邻居同样有效。' },
  { key:'ionomer',label:'离聚物',dur:2200,cap:'优先贴近铂、其次离聚物、再次碳的孔隙格点逐步覆盖离聚物。' },
  { key:'buffer-wall',label:'缓冲与墙',dur:1200,cap:'x 两端各 3 层边界区，最外层为墙；x = 1 为恒浓度入口，另一端零通量。' },
  { key:'tau',label:'弛豫时间 τ',dur:0,cap:'孔隙内按克努森与体扩散计算 τ，离聚物扩散慢，缓冲层取虚拟扩散系数。切换到「时间步」查看浓度场演化。' }
];
const STEP_LABELS = ['迁移','反弹','宏观量','碰撞'];
const STEP_CAPS = [
  '每个格点的 6 个运动分量沿各自方向移到相邻格点，静止分量 f₀ 不动（式 2-32 左侧）。朝向碳的分量停在界面上，下一子步反弹。',
  '停在碳表面的分量原路返回，变成反方向的分量：f₁ 撞上去，就变回 f₂。碳格点里没有分布函数。',
  '每个格点 7 个分量求和得到 Σf，就是这个格点的氧气浓度（式 2-38）。迁移和反弹只搬运分量，不改变全场总和。',
  '每个格点在矩空间向平衡态 fᵢᵉᑫ = wᵢ·Σf 松弛（式 2-32 右侧、2-35、2-36）。Σf 不变，各分量之间的差别变小。'
];
const $ = id => document.getElementById(id);
const fixed = readUrlState(location.search);
const structure = reconstruct({ seed:fixed.seed });
// This solver belongs exclusively to the lower concentration panel.
const solver = createSolver(structure, fixed.dt === undefined ? {} : { dt:fixed.dt });
const ts = createSolver(structure, fixed.dt === undefined ? {} : { dt:fixed.dt });
const lattice = createLatticeView($('lattice-canvas'), document.querySelector('.lattice-overlay'), structure, ts);
const volume = createVolumeView($('conc-canvas'), document.querySelector('.conc-overlay'), structure, solver);
const inspector = createInspector($('panel-inspector'), structure, ts);
const chart = createChart($('profile-chart'), structure, solver);
const recording = createConcentrationRecording(structure, solver, { targetFrame:fixed.frame });
const timeline = createTimeline($('timeline'), recording, displayConcentration, { targetFrame:fixed.frame });
let cacheLoading = true;
let mode = 'build', stage = 0, progress = 0, history = null, animation = null, playing = false, speed = 1;
let buildSelection = defaultSelection(), stepSelection = defaultSelection();
let animationProgress = 1, nextPlay = Infinity, ready = false;
const metrics = { frames:[], intervals:[], lastFrame:null };

function defaultSelection() {
  const { L,H,W,phase } = structure;
  for (let x=6;x<=12;x++) for (let y=0;y<H;y++) for (let z=0;z<W;z++) {
    if (phase[x+L*(y+H*z)] !== PHASE.PORE) continue;
    let xSolid=false, poreNeighbors=0;
    for (let k=1;k<E.length;k++) { const [dx,dy,dz]=E[k],p=phase[x+dx+L*(wrap(y+dy,H)+H*wrap(z+dz,W))]; if(k<=2)xSolid ||= p===PHASE.CARBON||p===PHASE.PT; poreNeighbors += p===PHASE.PORE ? 1 : 0; }
    if (xSolid && poreNeighbors >= 3) return { x,y,z };
  }
  return { x:8,y:16,z:16 };
}
const selection = () => mode === 'step' ? stepSelection : buildSelection;
const snapshot = () => ({ f:captureDistributions(ts), c:ts.c.slice(), src:ts.src.slice() });

function updateBlock() {
  const current = captureBlock(structure, ts, blockOrigin(structure, stepSelection));
  const origin=blockOrigin(structure,stepSelection);
  const before=history?blockFromSnapshot(structure,origin,{f:history.beforeF,c:history.beforeC,src:history.beforeSrc}):current;
  const after=history?blockFromSnapshot(structure,origin,{f:history.afterF,c:history.afterC,src:history.afterSrc}):current;
  lattice.block.setSnapshot({before,after,sub:ts.lastSubstep},animationProgress);
}
function executeCaptured() {
  // Execute inlet and reaction physics without separate teaching animations.
  while (![0,1,3,5].includes(ts.substep)) ts.stepSub();
  const before = snapshot(), beforeBlock = captureBlock(structure, ts, blockOrigin(structure, stepSelection));
  ts.stepSub();
  const after = snapshot(), afterBlock = captureBlock(structure, ts, blockOrigin(structure, stepSelection));
  history = { beforeF:before.f, afterF:after.f, beforeC:before.c, afterC:after.c, beforeSrc:before.src, afterSrc:after.src, beforeBlock, afterBlock };
  animationProgress = 1; updateBlock();
}
function refreshUpper() {
  const s = selection();
  inspector.setSource(structure, ts);
  inspector.update(s.x,s.y,s.z,mode,mode === 'step' ? history : null,animation !== null || animationProgress < 1);
  renderStepper(); updateCaption(); updateButtons();
}
function displayConcentration(frame) {
  volume.setFrame(frame); volume.updateTexture(true);
  chart.update(mode === 'build' ? buildSelection.x : null, frame.profile);
  updateDiagnostics(frame.diagnostics);
}
function updateDiagnostics(d) {
  $('diag-step').textContent=d.t; $('diag-time').textContent=(d.timeSeconds*1e9).toFixed(2);
  $('diag-flux').textContent=d.inletFlux.toFixed(3); $('diag-rxn').textContent=d.totalReaction.toFixed(3); $('diag-err').textContent=(d.balanceError*100).toFixed(1);
}
function updateSelection(next,{immediate=false}={}) {
  const selected = selection(), data = structure;
  for (const key of ['x','y','z']) {
    const min = 0;
    const max = ({ x:data.L-1,y:data.H-1,z:data.W-1 })[key];
    selected[key] = Math.max(min, Math.min(max, Math.round(Number.isFinite(next[key]) ? next[key] : selected[key])));
  }
  lattice.setSelection(selected.x,selected.y,selected.z,{immediate});
  if (mode === 'build') {
    volume.setSelection(selected.x,selected.y,selected.z);
    chart.update(selected.x,timeline.frame?.profile);
  }
  updateBlock(); refreshUpper();
}
function setMode(next,{immediate=false}={}) {
  finishAnimation(); mode=next; playing=false; animation=null; nextPlay=Infinity;
  document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  $('step-status-row').hidden=mode!=='step';
  $('step-status').textContent=mode==='step'?'上下独立播放：本区逐步演示，下方浓度继续独立计算与回放。':'';
  lattice.setMode(mode,{immediate}); volume.setSelectionVisible(mode==='build');
  document.querySelector('.grid-info').textContent=structure.L+' × '+structure.H+' × '+structure.W;
  if (mode==='build') setBuild(stage,progress);
  updateSelection(selection(),{immediate});
  if (timeline.frame) chart.update(mode==='build'?buildSelection.x:null,timeline.frame.profile);
}
function setBuild(next,p) {
  stage=next; progress=p;
  const s=structure.stages.find(s=>s.name===BUILD_STAGES[next].key);
  const threshold=next===6?Infinity:next===0?0:s.start+Math.round((s.end-s.start+1)*p);
  lattice.setRevealOrder(threshold); lattice.setTau(next===6?solver.tau:null);
  renderStepper(); updateCaption();
}
function renderStepper() {
  const list=mode==='build'?BUILD_STAGES:STEP_LABELS.map(label=>({label}));
  const current=mode==='build'?stage:[0,1,3,5].indexOf(ts.lastSubstep);
  $('stage-stepper').innerHTML=list.map((item,i)=>'<div class="step-chip '+(i===current?'active':mode==='build'&&i<current?'done':'')+'" data-idx="'+i+'"><span class="num">'+(i+1)+'</span>'+item.label+(mode==='build'&&i===current&&progress>0&&progress<1?'<div class="bar" style="width:'+progress*100+'%"></div>':'')+'</div>').join('');
}
function updateCaption() {
  const index=[0,1,3,5].indexOf(ts.lastSubstep);
  $('caption-text').textContent=mode==='build'?BUILD_STAGES[stage].cap:index<0?'按 ⏭ 执行第一个子步：迁移':STEP_LABELS[index]+'：'+STEP_CAPS[index];
  const local=$('caption-local'),origin=blockOrigin(structure,stepSelection);
  local.hidden=mode!=='step';
  local.textContent='局部块 '+BLOCK_SIZE+'×'+BLOCK_SIZE+'×'+BLOCK_SIZE+' ('+origin.x+'..'+(origin.x+BLOCK_SIZE-1)+', '+origin.y+'..'+(origin.y+BLOCK_SIZE-1)+', '+origin.z+'..'+(origin.z+BLOCK_SIZE-1)+') · 当前第 '+ts.t+' 步';
}
function beginAnimation() {
  animationProgress=0; animation={kind:'sub',start:performance.now(),duration:900/speed}; lattice.block.animate(0); refreshUpper();
}
function finishAnimation() {
  if (!animation) return;
  if (animation.kind==='build') setBuild(stage,1); else { animationProgress=1; lattice.block.animate(1); }
  animation=null;
}
function stepOnce() {
  if (!ready) return;
  nextPlay=Infinity;
  if (animation) { finishAnimation(); refreshUpper(); return; }
  if (mode==='build') {
    if (progress>=1 || BUILD_STAGES[stage].dur===0) { if (stage===6) { playing=false;updateButtons();return; } setBuild(stage+1,0); }
    const duration=BUILD_STAGES[stage].dur/speed;
    if (duration>0) animation={kind:'build',start:performance.now(),duration}; else setBuild(stage,1);
  } else { executeCaptured(); beginAnimation(); }
  updateButtons();
}
function updateButtons() { $('play').textContent=playing?'⏸':'▶'; $('play').classList.toggle('playing',playing); }
function updateVolumeControls() {
  const axis=$('slice-axis').value,max=({x:structure.L,y:structure.H,z:structure.W})[axis]-1;
  $('slice-position').max=max; $('slice-position').value=Math.min(max,Number($('slice-position').value)); $('slice-value').textContent=$('slice-position').value;
  volume.setOptions({showSolids:$('show-solids').checked,sliceEnabled:$('slice-enabled').checked,axis,position:Number($('slice-position').value)});
}
$('seed').value=fixed.seed;
$('regen').addEventListener('click',()=>{const q=new URLSearchParams(location.search);q.set('seed',$('seed').value);location.search=q.toString();});
document.querySelectorAll('.mode-btn').forEach(b=>b.addEventListener('click',()=>{if(ready&&b.dataset.mode!==mode)setMode(b.dataset.mode);}));
$('play').addEventListener('click',()=>{if(!ready)return;playing=!playing;if(playing&&!animation)stepOnce();updateButtons();});
$('step').addEventListener('click',()=>{playing=false;stepOnce();});
$('stage-stepper').addEventListener('click',e=>{
  const chip=e.target.closest('.step-chip'); if(!chip||!ready)return; const target=Number(chip.dataset.idx);
  finishAnimation(); playing=false; animation=null; nextPlay=Infinity;
  if(mode==='build'){setBuild(target,0);if(BUILD_STAGES[target].dur>0)animation={kind:'build',start:performance.now(),duration:BUILD_STAGES[target].dur/speed};}
  else {const targetSub=[0,1,3,5][target]??0;for(let n=0;n<4;n++){executeCaptured();if(ts.lastSubstep===targetSub)break;}beginAnimation();}
  refreshUpper();
});
$('speed').addEventListener('input',()=>{
  const previous=speed; speed=Number($('speed').value); $('speed-val').textContent=speed.toFixed(1)+'×';
  if(animation){const p=Math.min(1,(performance.now()-animation.start)/animation.duration);animation.duration*=previous/speed;animation.start=performance.now()-p*animation.duration;}
});
for(const key of ['x','y','z'])$('sel-'+key).addEventListener('change',e=>updateSelection({...selection(),[key]:Number(e.target.value)}));
for(const id of ['show-solids','slice-enabled','slice-axis','slice-position'])$(id).addEventListener('input',updateVolumeControls);
lattice.onPick((x,y,z)=>updateSelection({x,y,z}));
const grid=structure.L+' × '+structure.H+' × '+structure.W;
document.querySelector('.grid-info').textContent=grid; $('footer-grid').textContent=grid;
$('footer-dt').textContent=(solver.params.dt*1e12).toFixed(1)+' ps'; $('footer-eta').textContent=solver.params.eta.toFixed(2)+' V'; $('colorbar-max').textContent=solver.params.cIn.toFixed(2);

function animate(now) {
  const start=performance.now();
  if(animation){
    const p=Math.min(1,(now-animation.start)/animation.duration);
    if(animation.kind==='build')setBuild(stage,p);else{animationProgress=p;lattice.block.animate(p);}
    if(p>=1){const kind=animation.kind;animation=null;if(kind==='sub')refreshUpper();if(playing){if(kind==='build'&&stage===6)playing=false;else nextPlay=now+(kind==='sub'?300:0);}}
  }
  if(playing&&!animation&&now>=nextPlay){nextPlay=Infinity;stepOnce();}
  if(!recording.complete && !cacheLoading){
    const previousLength=recording.frames.length;
    recording.advance(14);
    if(recording.frames.length!==previousLength)timeline.appended(previousLength);
    if(recording.complete&&fixed.frame!==null){ready=true;document.body.dataset.ready='true';}
  }
  timeline.tick(now); lattice.render(); volume.render(); updateButtons();
  metrics.frames.push(performance.now()-start); if(metrics.lastFrame!==null)metrics.intervals.push(now-metrics.lastFrame); metrics.lastFrame=now;
  if(metrics.frames.length>240)metrics.frames.shift(); if(metrics.intervals.length>240)metrics.intervals.shift();
  requestAnimationFrame(animate);
}
async function initialize() {
  document.body.dataset.ready='false';
  if(fixed.clip)lattice.clipControl.setState(fixed.clip);
  let remaining=fixed.steps;
  while(remaining>0){const end=performance.now()+14;do{ts.step(1);remaining--;}while(remaining>0&&performance.now()<end);if(remaining)await new Promise(resolve=>setTimeout(resolve,0));}
  if(fixed.sub!==null)for(let k=0;k<=fixed.sub;k++)executeCaptured();
  animationProgress=fixed.animationProgress;
  setMode(fixed.mode,{immediate:true});
  if(mode==='build')setBuild(fixed.stage,fixed.progress);
  if(fixed.selection)updateSelection(fixed.selection,{immediate:true});
  if(fixed.slice){$('slice-enabled').checked=true;$('slice-axis').value=fixed.slice.axis;$('slice-position').max=({x:structure.L,y:structure.H,z:structure.W})[fixed.slice.axis]-1;$('slice-position').value=fixed.slice.position;}
  updateVolumeControls(); updateBlock(); refreshUpper(); updateDiagnostics(solver.diagnostics());
  if (fixed.frame === null || !recording.complete) {
    const cachedFrames = await loadConcentrationCache(structure, solver.params, { interval:RECORD_INTERVAL, maxFrames:MAX_FRAMES });
    if (cachedFrames) {
      recording.loadFrames(cachedFrames);
      timeline.appended(0);
    }
  }
  cacheLoading = false;
  if (timeline.frame) displayConcentration(timeline.frame);
  if (!timeline.frame) chart.update(mode==='build'?buildSelection.x:null);
  lattice.render(); volume.render();
  ready=fixed.frame===null || recording.complete; document.body.dataset.ready=String(ready); requestAnimationFrame(animate);
}
window.__lbm={
  get ready(){return ready;},structure,solver,recording,timeline,latticeView:lattice,concView:volume,
  get state(){return{mode,stage,progress,selection:{...selection()},animationProgress,playing,running:!recording.complete||cacheLoading,lastSubstep:ts.lastSubstep,t:ts.t,concentrationT:solver.t,timeline:timeline.stats()};},
  get history(){return history;},
  stats(){const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;return{state:this.state,lattice:lattice.stats(),volume:volume.stats(),recording:recording.stats(),performance:{meanFrameCpuMs:mean(metrics.frames),meanIntervalMs:mean(metrics.intervals),fps:metrics.intervals.length?1000/mean(metrics.intervals):0}};},
  setMode,setSelection:updateSelection,stepOnce,
  setAnimationProgress(p){finishAnimation();animationProgress=Math.max(0,Math.min(1,p));lattice.block.animate(animationProgress);refreshUpper();}
};
initialize().catch(error=>{document.body.dataset.ready='error';console.error(error);});
