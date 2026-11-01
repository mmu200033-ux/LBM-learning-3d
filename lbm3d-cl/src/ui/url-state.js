import { MAX_FRAMES } from './timeline.js';

const finite=(value,fallback)=>Number.isFinite(Number(value))&&value!==null?Number(value):fallback;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
export function readUrlState(search,dimensions={L:64,H:32,W:32}){
  const q=new URLSearchParams(search),{L,H,W}=dimensions;
  const integer=(key,fallback,min,max)=>Math.floor(clamp(finite(q.get(key),fallback),min,max));
  const stage=integer('stage',0,0,6),dt=finite(q.get('dt'),NaN);
  const selection=q.get('sel')?.split(',').map(Number);
  let clip;
  if(q.get('clip')==='0')clip={enabled:false};
  else if(q.get('clip')==='1')clip={enabled:true};
  else if(q.has('clip')){const parts=q.get('clip').split(',').map(s=>s.match(/^([0-9]+)-([0-9]+)$/));if(parts.length===3&&parts.every(Boolean)){clip={enabled:true};['x','y','z'].forEach((axis,i)=>{const max=[L,H,W][i]-1,a=clamp(Number(parts[i][1]),0,max),b=clamp(Number(parts[i][2]),0,max);clip[axis+'0']=Math.min(a,b);clip[axis+'1']=Math.max(a,b);});}}
  const slice=q.get('slice')?.match(/^([xyz])([0-9]+)$/);
  const frame = q.has('frame') ? integer('frame', 0, 0, MAX_FRAMES - 1) : null;
  return {seed:integer('seed',42,0,4294967295),dt:dt>0?dt:undefined,mode:q.get('mode')==='step'?'step':'build',stage,progress:clamp(finite(q.get('p'),stage===0?0:1),0,1),steps:integer('t',0,0,Number.MAX_SAFE_INTEGER),sub:q.has('sub')?integer('sub',0,0,3):null,animationProgress:clamp(finite(q.get('ap'),1),0,1),frame,selection:selection?.length===3&&selection.every(Number.isFinite)?{x:Math.floor(clamp(selection[0],0,L-1)),y:Math.floor(clamp(selection[1],0,H-1)),z:Math.floor(clamp(selection[2],0,W-1))}:null,clip,slice:slice?{axis:slice[1],position:clamp(Number(slice[2]),0,({x:L,y:H,z:W})[slice[1]]-1),sliceEnabled:true}:null};
}
