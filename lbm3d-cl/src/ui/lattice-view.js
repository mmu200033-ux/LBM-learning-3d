import * as THREE from 'three';
import { createStage } from './stage.js';
import { PHASE, PHASE_COLOR, tauColor } from './palette.js';
import { createClipBox, clipPlanes, insideClip } from './clip-box.js';
import { createBlockView } from './block-view.js';
import { TEACHING_ORIGIN, C_REF } from './teaching-lattice.js';

export function createLatticeView(canvas, overlay, structure, solver, teaching) {
  const { L,H,W,phase,order } = structure, N=L*H*W;
  const stage=createStage(canvas,overlay,structure);
  const { scene,renderer,toWorld,camera }=stage;
  renderer.localClippingEnabled=true;
  const center=new THREE.Vector3((L-1)/2,(H-1)/2,(W-1)/2);
  const coord=i=>[i%L,Math.floor(i/L)%H,Math.floor(i/(L*H))];
  const solidList=Array.from({length:N},(_,i)=>i).filter(i=>phase[i]>=PHASE.IONOMER&&phase[i]<=PHASE.PT).sort((a,b)=>order[a]-order[b]);
  const solidMat=new THREE.MeshLambertMaterial({transparent:true,opacity:1});
  const solidMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(0.94,0.94,0.94),solidMat,solidList.length);
  const matrix=new THREE.Matrix4(), color=new THREE.Color();
  solidList.forEach((i,n)=>{const p=toWorld(...coord(i));matrix.makeTranslation(p.x,p.y,p.z);solidMesh.setMatrixAt(n,matrix);solidMesh.setColorAt(n,color.setHex(PHASE_COLOR[phase[i]]));});
  solidMesh.instanceMatrix.needsUpdate=true; solidMesh.instanceColor.needsUpdate=true; scene.add(solidMesh);

  // Every lattice site starts as a point, including future buffers and walls.
  const dotKey=i=>order[i]<0?Infinity:order[i];
  const dotList=Array.from({length:N},(_,i)=>i).sort((a,b)=>dotKey(b)-dotKey(a));
  const positions=new Float32Array(N*3), colors=new Float32Array(N*3);
  dotList.forEach((i,n)=>{const p=toWorld(...coord(i));positions.set([p.x,p.y,p.z],n*3);});
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(positions,3));geo.setAttribute('color',new THREE.BufferAttribute(colors,3));
  const pointMat=new THREE.PointsMaterial({size:0.22,sizeAttenuation:true,vertexColors:true,transparent:true,opacity:0.55});
  const points=new THREE.Points(geo,pointMat);scene.add(points);
  const slabMat=new THREE.MeshLambertMaterial({color:PHASE_COLOR[PHASE.BUFFER],transparent:true,opacity:0.28,depthWrite:false});
  const wallMat=new THREE.MeshLambertMaterial({color:PHASE_COLOR[PHASE.WALL],transparent:true,opacity:0.55,depthWrite:false});
  const slabs=new THREE.Group();
  for(const side of [0,1]){
    const slab=new THREE.Mesh(new THREE.BoxGeometry(2,H,W),slabMat);slab.position.copy(toWorld(side?L-2.5:1.5,center.y,center.z));
    const wall=new THREE.Mesh(new THREE.BoxGeometry(1,H,W),wallMat);wall.position.copy(toWorld(side?L-1:0,center.y,center.z));slabs.add(slab,wall);
  }
  scene.add(slabs);
  const frame=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)),new THREE.LineDashedMaterial({color:0xc99a2e,dashSize:0.6,gapSize:0.4}));scene.add(frame);
  const selectedBox=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.06,1.06,1.06)),new THREE.LineBasicMaterial({color:0xc99a2e,depthTest:false}));selectedBox.renderOrder=10;scene.add(selectedBox);
  const block=createBlockView(stage,teaching.structure,teaching.solver,{fixedOrigin:TEACHING_ORIGIN,cRef:C_REF,toWorld:(x,y,z)=>new THREE.Vector3(x-3,y-2,z-2)});
  let threshold=0,mode='build',cameraMode='global',tau=null,selection={x:8,y:16,z:16},onPick=null;
  let clip={enabled:true,x0:0,x1:L-1,y0:Math.floor(H/2),y1:H-1,z0:0,z1:W-1};
  const clipControl=createClipBox(overlay.querySelector('#clip-controls'),structure,next=>{clip=next;applyClipping();});
  function applyClipping(){
    const planes=mode==='build'?clipPlanes(clip,center):[];
    for(const material of [solidMat,pointMat,slabMat,wallMat]){material.clippingPlanes=planes;material.needsUpdate=true;}
    const geometry=new THREE.EdgesGeometry(new THREE.BoxGeometry(clip.x1-clip.x0+1,clip.y1-clip.y0+1,clip.z1-clip.z0+1));
    frame.geometry.dispose();frame.geometry=geometry;frame.position.copy(toWorld((clip.x0+clip.x1)/2,(clip.y0+clip.y1)/2,(clip.z0+clip.z1)/2));frame.computeLineDistances();
    frame.visible=mode==='build'&&clip.enabled;
  }
  const lower=(list,pred)=>{let lo=0,hi=list.length;while(lo<hi){const m=(lo+hi)>>1;if(pred(list[m]))lo=m+1;else hi=m;}return lo;};
  function setRevealOrder(value){
    threshold=value;solidMesh.count=lower(solidList,i=>order[i]<value);geo.setDrawRange(0,lower(dotList,i=>dotKey(i)>=value));
    slabs.visible=value>(structure.stages.find(s=>s.name==='buffer-wall')?.start??Infinity);
  }
  function setTau(value){
    tau=value;overlay.querySelector('#tau-legend').hidden=!value;pointMat.size=value?0.4:0.22;
    dotList.forEach((i,n)=>{if(value&&phase[i]===PHASE.PORE){const rgb=tauColor((value[i]-0.5)/1.4);color.setRGB(...rgb.map(v=>v/255),THREE.SRGBColorSpace);}else color.set('#8e9a96');colors.set([color.r,color.g,color.b],n*3);});geo.attributes.color.needsUpdate=true;
  }
  function background(){
    const build=mode==='build';
    solidMesh.visible=build;points.visible=build;slabs.visible=build&&threshold>(structure.stages.find(s=>s.name==='buffer-wall')?.start??Infinity);
    stage.box.visible=build;selectedBox.visible=build;frame.visible=build&&clip.enabled;block.setVisible(!build);
    for(const el of overlay.querySelectorAll('.inlet-label,.outlet-label'))el.hidden=!build;
    for(const [i,el] of [...overlay.querySelectorAll('.legend-item')].entries())el.hidden=!build&&i!==0&&i!==2;
  }
  function setCameraMode(value,immediate=false){
    cameraMode=mode==='step'?'block':value;
    if(cameraMode==='block'){const target=block.target();const distance=7/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*0.75);stage.flyTo(target,distance,immediate);}else stage.fit();
    overlay.querySelector('#camera-toggle').dataset.camera=value;background();
  }
  function setSelection(x,y,z,{fly=true,immediate=false}={}){
    selection={x,y,z};selectedBox.position.copy(toWorld(x,y,z));
  }
  function setMode(value,{immediate=false}={}){
    mode=value;overlay.querySelector('#clip-controls').hidden=value!=='build';overlay.querySelector('#camera-toggle').hidden=true;
    if(value==='step'){setTau(null);setCameraMode('block',immediate);}else{setCameraMode('global',immediate);}
    applyClipping();background();
  }
  stage.resetBtn.addEventListener('click',()=>{if(mode==='step'&&cameraMode==='block')setCameraMode('block');});
  overlay.querySelector('#camera-toggle').addEventListener('click',()=>setCameraMode(cameraMode==='global'?'block':'global'));

  const raycaster=new THREE.Raycaster();raycaster.params.Points.threshold=0.4;const ndc=new THREE.Vector2();let down=null;
  canvas.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
  canvas.addEventListener('pointerup',e=>{
    if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>4)return;down=null;
    const rect=canvas.getBoundingClientRect();ndc.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(ndc,camera);
    if(mode==='step'){const node=block.pick(raycaster);if(node)onPick?.(node.x,node.y,node.z);return;}
    const hits=raycaster.intersectObjects([solidMesh,...(points.visible?[points]:[])]);
    for(const hit of hits){const i=hit.object===solidMesh?solidList[hit.instanceId]:dotList[hit.index];if(i===undefined)continue;const xyz=coord(i);if(mode==='build'&&!insideClip(clip,...xyz))continue;onPick?.(...xyz);break;}
  });
  stage.pinLabel(overlay.querySelector('.inlet-label'),toWorld(-1.5,center.y,W+1));stage.pinLabel(overlay.querySelector('.outlet-label'),toWorld(L+0.5,center.y,W+1));
  setTau(null);setRevealOrder(0);applyClipping();block.setVisible(false);
  return { camera,controls:stage.controls,renderer,block,clipControl,setRevealOrder,setTau,setSelection,setMode,setCameraMode,
    render:stage.render,onPick:callback=>{onPick=callback;},
    stats:()=>({totalSites:N,points:geo.drawRange.count,solids:solidMesh.count,clip:{...clip},mode,camera:cameraMode,tau:!!tau,block:block.stats()}) };
}
