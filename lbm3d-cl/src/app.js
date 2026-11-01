import { reconstruct, createSolver, SUBSTEPS, E, PHASE } from './engine/index.js';
import { createLatticeView } from './ui/lattice-view.js';
import { createVolumeView } from './ui/volume-view.js';
import { createInspector } from './ui/inspector.js';
import { createChart } from './ui/chart.js';
import { readUrlState } from './ui/url-state.js';
import { blockOrigin, captureBlock, captureDistributions, blockFromSnapshot, wrap } from './ui/block-state.js';

const BUILD_STAGES=[
  {key:'empty',label:'空格点阵',dur:0,cap:'初始化三维网格，每个格点可容纳一个相（孔隙、离聚物、碳、铂）。'},
  {key:'carbon-init',label:'初始碳球',dur:2200,cap:'无重叠放置初始碳球，radius = 5，实际球半径为 4 格。'},
  {key:'carbon-grow',label:'碳生长',dur:2200,cap:'按重叠生长规则继续填充碳球，y、z 两方向周期重构。'},
  {key:'pt',label:'铂沉积',dur:1800,cap:'在与碳相邻的孔隙格点上随机沉积铂；跨 y、z 周期边界的碳邻居同样有效。'},
  {key:'ionomer',label:'离聚物',dur:2200,cap:'优先贴近铂、其次离聚物、再次碳的孔隙格点逐步覆盖离聚物。'},
  {key:'buffer-wall',label:'缓冲与墙',dur:1200,cap:'x 两端各 3 层边界区，最外层为墙；x = 1 为恒浓度入口，另一端零通量。'},
  {key:'tau',label:'弛豫时间 τ',dur:0,cap:'孔隙内按克努森与体扩散计算 τ，离聚物扩散慢，缓冲层取虚拟扩散系数。切换到「时间步」查看浓度场演化。'}
];
const STEP_LABELS=['迁移','反弹','入口','宏观量','反应','碰撞'];
const STEP_CAPS=[
  '每个格点的 6 个运动分量沿各自方向移到相邻格点（式 2-32 左侧）。朝向碳、铂的分量停在界面上，下一子步反弹；孔隙与离聚物之间按共轭界面公式交换（式 2-44、2-45）。',
  '停在固相界面上的分量原路返回，变成反方向的分量，氧气不进入碳和铂。',
  'x = 1 的缓冲层格点按恒浓度边界重设 f₁ = c_in/4 − f₂（式 2-40）。',
  '每个格点 7 个分量求和得到氧气浓度 c = Σf_i（式 2-38）。',
  '与铂相邻的离聚物格点按 Butler-Volmer 方程消耗氧气（式 2-23），过电势取定值 η。',
  '在矩空间按松弛矩阵 S 向平衡态松弛（式 2-32 右侧、2-35、2-36），并扣除反应消耗。'
];
const $=id=>document.getElementById(id);
const fixed=readUrlState(location.search);
const structure=reconstruct({seed:fixed.seed});
const solver=createSolver(structure,fixed.dt===undefined?{}:{dt:fixed.dt});
const lattice=createLatticeView($('lattice-canvas'),document.querySelector('.lattice-overlay'),structure,solver);
const volume=createVolumeView($('conc-canvas'),document.querySelector('.conc-overlay'),structure,solver);
const inspector=createInspector($('panel-inspector'),structure,solver);
const chart=createChart($('profile-chart'),structure,solver);
let mode='build',stage=0,progress=0,selection=defaultSelection(),history=null,animation=null,playing=false,running=false,speed=1,animationProgress=1,nextPlay=Infinity,lastRefresh=-Infinity;
const metrics={frames:[],intervals:[],lastFrame:null,physicsSteps:0};
let ready=false;

function defaultSelection(){
  const {L,H,W,phase}=structure;
  for(let x=6;x<18;x++)for(let y=0;y<H;y++)for(let z=0;z<W;z++){
    if(phase[x+L*(y+H*z)]!==PHASE.IONOMER)continue;
    let pt=false,pore=false;
    for(const [dx,dy,dz] of E.slice(1)){const p=phase[x+dx+L*(wrap(y+dy,H)+H*wrap(z+dz,W))];pt ||= p===PHASE.PT;pore ||= p===PHASE.PORE;}
    if(pt&&pore)return{x,y,z};
  }
  return{x:8,y:16,z:16};
}
function snapshotGlobal(){return{f:captureDistributions(solver),c:solver.c.slice(),src:solver.src.slice()};}
function updateBlock(){
  const origin=blockOrigin(structure,selection);
  let before,after;
  if(history){before=blockFromSnapshot(structure,origin,{f:history.beforeF,c:history.beforeC,src:history.beforeSrc});after=blockFromSnapshot(structure,origin,{f:history.afterF,c:history.afterC,src:history.afterSrc});}
  else{before=after=captureBlock(structure,solver,origin);}
  lattice.block.setSnapshot({before,after,sub:solver.lastSubstep},animationProgress);
}
function executeCaptured(){
  const origin=blockOrigin(structure,selection),before=captureBlock(structure,solver,origin),a=snapshotGlobal();
  solver.stepSub();
  const after=captureBlock(structure,solver,origin),b=snapshotGlobal();
  history={beforeF:a.f,afterF:b.f,beforeC:a.c,afterC:b.c,beforeSrc:a.src,afterSrc:b.src};
  animationProgress=1;lattice.block.setSnapshot({before,after,sub:solver.lastSubstep},1);volume.markDirty();
}
function refresh(){
  renderStepper();updateCaption();inspector.update(selection.x,selection.y,selection.z,mode,history,animation!==null||animationProgress<1);
  chart.update(selection.x);updateDiagnostics();volume.markDirty();lastRefresh=performance.now();
}
function updateDiagnostics(){const d=solver.diagnostics();$('diag-step').textContent=d.t;$('diag-time').textContent=(d.timeSeconds*1e9).toFixed(2);$('diag-flux').textContent=d.inletFlux.toFixed(3);$('diag-rxn').textContent=d.totalReaction.toFixed(3);$('diag-err').textContent=(d.balanceError*100).toFixed(1);}
function updateSelection(next,{immediate=false}={}){
  const limits={x:structure.L,y:structure.H,z:structure.W};
  for(const key of ['x','y','z'])selection[key]=Math.max(0,Math.min(limits[key]-1,Math.round(Number.isFinite(next[key])?next[key]:selection[key])));
  lattice.setSelection(selection.x,selection.y,selection.z,{immediate});volume.setSelection(selection.x,selection.y,selection.z);updateBlock();refresh();
}
function setMode(next,{immediate=false}={}){
  mode=next;playing=running=false;animation=null;nextPlay=Infinity;
  document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  lattice.setMode(mode,{immediate});
  if(mode==='build')setBuild(stage,progress);else updateBlock();
  refresh();updateButtons();
}
function setBuild(next,p){
  stage=next;progress=p;const s=structure.stages.find(s=>s.name===BUILD_STAGES[next].key);
  const threshold=next===6?Infinity:next===0?0:s.start+Math.round((s.end-s.start+1)*p);
  lattice.setRevealOrder(threshold);lattice.setTau(next===6?solver.tau:null);renderStepper();updateCaption();
}
function renderStepper(){
  const list=mode==='build'?BUILD_STAGES:STEP_LABELS.map((label,i)=>({key:SUBSTEPS[i],label})),current=mode==='build'?stage:solver.lastSubstep;
  $('stage-stepper').innerHTML=list.map((item,i)=>'<div class="step-chip '+(i===current?'active':mode==='build'&&i<current?'done':'')+'" data-idx="'+i+'"><span class="num">'+(i+1)+'</span>'+item.label+(mode==='build'&&i===current&&progress>0&&progress<1?'<div class="bar" style="width:'+progress*100+'%"></div>':'')+'</div>').join('');
}
function updateCaption(){
  const cap=document.querySelector('.caption');
  if(mode==='build')cap.textContent=BUILD_STAGES[stage].cap;
  else if(solver.lastSubstep<0)cap.textContent='按 ⏭ 执行第一个子步：迁移';
  else{cap.textContent=STEP_LABELS[solver.lastSubstep]+'：'+STEP_CAPS[solver.lastSubstep];const origin=blockOrigin(structure,selection);if(solver.lastSubstep===2&&!(origin.x<=1&&origin.x+4>=1))cap.textContent+=' 入口层不在当前局部块内';}
}
function beginAnimation(){animationProgress=0;animation={kind:'sub',start:performance.now(),duration:900/speed};lattice.block.animate(0);refresh();}
function finishAnimation(){if(!animation)return;if(animation.kind==='build')setBuild(stage,1);else{animationProgress=1;lattice.block.animate(1);}animation=null;}
function stepOnce(){
  if(!ready)return;
  running=false;nextPlay=Infinity;
  if(animation){finishAnimation();refresh();return;}
  if(mode==='build'){
    if(progress>=1||BUILD_STAGES[stage].dur===0){if(stage===6){playing=false;return;}setBuild(stage+1,0);}
    const duration=BUILD_STAGES[stage].dur/speed;
    if(duration>0)animation={kind:'build',start:performance.now(),duration};else setBuild(stage,1);
  }else{executeCaptured();beginAnimation();}
  updateButtons();
}
function updateButtons(){$('play').textContent=playing?'⏸':'▶';$('play').classList.toggle('playing',playing);$('run-toggle').textContent=running?'停止':'连续求解';$('run-toggle').classList.toggle('running',running);}
function setRunning(value){
  if(!ready)return;
  if(mode!=='step')setMode('step');
  finishAnimation();playing=false;nextPlay=Infinity;running=value;
  if(value){metrics.frames=[];metrics.intervals=[];metrics.lastFrame=null;}
  updateButtons();
}
function updateVolumeControls(){
  const axis=$('slice-axis').value,max=({x:structure.L,y:structure.H,z:structure.W})[axis]-1;
  $('slice-position').max=max;$('slice-position').value=Math.min(max,Number($('slice-position').value));$('slice-value').textContent=$('slice-position').value;
  volume.setOptions({showSolids:$('show-solids').checked,sliceEnabled:$('slice-enabled').checked,axis,position:Number($('slice-position').value)});
}

$('seed').value=fixed.seed;$('regen').addEventListener('click',()=>{const q=new URLSearchParams(location.search);q.set('seed',$('seed').value);location.search=q.toString();});
document.querySelectorAll('.mode-btn').forEach(b=>b.addEventListener('click',()=>{if(ready&&b.dataset.mode!==mode)setMode(b.dataset.mode);}));
$('play').addEventListener('click',()=>{if(!ready)return;running=false;playing=!playing;if(playing&&!animation)stepOnce();updateButtons();});
$('step').addEventListener('click',()=>{playing=false;stepOnce();});
$('stage-stepper').addEventListener('click',e=>{const chip=e.target.closest('.step-chip');if(!chip||!ready)return;const target=Number(chip.dataset.idx);playing=running=false;animation=null;
  if(mode==='build'){setBuild(target,0);if(BUILD_STAGES[target].dur>0)animation={kind:'build',start:performance.now(),duration:BUILD_STAGES[target].dur/speed};}
  else{for(let n=0;n<6;n++){executeCaptured();if(solver.lastSubstep===target)break;}beginAnimation();}refresh();updateButtons();
});
$('speed').addEventListener('input',()=>{const previous=speed;speed=Number($('speed').value);$('speed-val').textContent=speed.toFixed(1)+'×';if(animation){const p=Math.min(1,(performance.now()-animation.start)/animation.duration);animation.duration*=previous/speed;animation.start=performance.now()-p*animation.duration;}});
$('run-toggle').addEventListener('click',()=>setRunning(!running));
for(const key of ['x','y','z'])$('sel-'+key).addEventListener('change',e=>updateSelection({...selection,[key]:Number(e.target.value)}));
for(const id of ['show-solids','slice-enabled','slice-axis','slice-position'])$(id).addEventListener('input',updateVolumeControls);
lattice.onPick((x,y,z)=>updateSelection({x,y,z}));
const grid=structure.L+' × '+structure.H+' × '+structure.W;document.querySelector('.grid-info').textContent=grid;$('footer-grid').textContent=grid;
$('footer-dt').textContent=(solver.params.dt*1e12).toFixed(1)+' ps';$('footer-eta').textContent=solver.params.eta.toFixed(2)+' V';$('colorbar-max').textContent=solver.params.cIn.toFixed(2);

function animate(now){
  const start=performance.now();
  if(animation){const p=Math.min(1,(now-animation.start)/animation.duration);if(animation.kind==='build')setBuild(stage,p);else{animationProgress=p;lattice.block.animate(p);}
    if(p>=1){const kind=animation.kind;animation=null;if(kind==='sub')refresh();if(playing){if(kind==='build'&&stage===6){playing=false;}else nextPlay=now+(kind==='sub'?300:0);}}}
  if(playing&&!animation&&now>=nextPlay){nextPlay=Infinity;stepOnce();}
  if(running&&mode==='step'){
    const end=performance.now()+10;let count=0;
    if(solver.substep!==0)solver.step(0);
    do{solver.step(1);count++;}while(performance.now()<end);
    if(now-lastRefresh>=100){for(let k=0;k<5;k++)solver.stepSub();executeCaptured();count++;animationProgress=1;refresh();}
    volume.markDirty();metrics.physicsSteps+=count;
  }
  lattice.render();volume.render();
  if(running){metrics.frames.push(performance.now()-start);if(metrics.lastFrame!==null)metrics.intervals.push(now-metrics.lastFrame);metrics.lastFrame=now;if(metrics.frames.length>240)metrics.frames.shift();if(metrics.intervals.length>240)metrics.intervals.shift();}
  updateButtons();requestAnimationFrame(animate);
}
async function initialize(){
  ready=false;document.body.dataset.ready='false';
  updateSelection(fixed.selection||selection,{immediate:true});
  if(fixed.clip)lattice.clipControl.setState(fixed.clip);
  // The final complete step retains a genuine collision-before/after snapshot.
  let remaining=fixed.steps;
  while(remaining>0){const end=performance.now()+45;do{if(remaining===1){for(let k=0;k<5;k++)solver.stepSub();executeCaptured();}else solver.step(1);remaining--;}while(remaining>0&&performance.now()<end);
    $('diag-step').textContent=solver.t;if(remaining>0)await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(fixed.sub!==null)for(let k=0;k<=fixed.sub;k++)executeCaptured();
  animationProgress=fixed.animationProgress;
  lattice.block.animate(animationProgress);
  setMode(fixed.mode,{immediate:true});
  if(mode==='build')setBuild(fixed.stage,fixed.progress);else{lattice.setCameraMode(fixed.camera,true);updateBlock();}
  if(fixed.slice){$('slice-enabled').checked=true;$('slice-axis').value=fixed.slice.axis;$('slice-position').max=({x:structure.L,y:structure.H,z:structure.W})[fixed.slice.axis]-1;$('slice-position').value=fixed.slice.position;}
  updateVolumeControls();volume.markDirty();volume.updateTexture(true);refresh();
  lattice.render();volume.render();ready=true;document.body.dataset.ready='true';requestAnimationFrame(animate);
}
window.__lbm={get ready(){return ready;},structure,solver,latticeView:lattice,concView:volume,get state(){return{mode,stage,progress,selection:{...selection},animationProgress,playing,running,lastSubstep:solver.lastSubstep,t:solver.t};},get history(){return history;},stats(){const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:0;return{state:this.state,lattice:lattice.stats(),volume:volume.stats(),performance:{meanFrameCpuMs:mean(metrics.frames),meanIntervalMs:mean(metrics.intervals),fps:metrics.intervals.length?1000/mean(metrics.intervals):0,samples:metrics.frames.length,physicsSteps:metrics.physicsSteps}};},setMode,setSelection:updateSelection,stepOnce,setRunning,setAnimationProgress(p){finishAnimation();animationProgress=Math.max(0,Math.min(1,p));lattice.block.animate(animationProgress);refresh();}};
initialize().catch(error=>{document.body.dataset.ready='error';console.error(error);});
