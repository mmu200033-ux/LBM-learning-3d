import * as THREE from 'three';
import { E, WEIGHT, OPP } from '../engine/index.js';
import { PHASE, PHASE_COLOR } from './palette.js';
import { blockOrigin, wrap, blockOffset, isFluid } from './block-state.js';

const FLOW=0x1f7a72, BOUNCE=0xc8683a, CONJ=0x4a8fd4, GOLD=0xc99a2e;
const easeQuad=p=>p<0.5?2*p*p:1-((-2*p+2)**2)/2;
const mix=(a,b,p)=>a+(b-a)*p;
const central=(x,y,z)=>x>=0&&x<5&&y>=0&&y<5&&z>=0&&z<5;

// Per-instance opacity keeps the 875+ moving distributions in a few draw calls.
function instances(geometry,capacity,{wireframe=false}={}) {
  const alpha=new THREE.InstancedBufferAttribute(new Float32Array(capacity),1);
  geometry.setAttribute('instanceAlpha',alpha);
  const material=new THREE.MeshBasicMaterial({transparent:true,depthWrite:false,wireframe});
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nattribute float instanceAlpha; varying float vAlpha;').replace('#include <begin_vertex>','#include <begin_vertex>\nvAlpha = instanceAlpha;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying float vAlpha;').replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.a *= vAlpha;');
  };
  const mesh=new THREE.InstancedMesh(geometry,material,capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled=false;mesh.count=0;
  const matrix=new THREE.Matrix4(),col=new THREE.Color(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3();
  return {mesh,reset(){mesh.count=0;},add(position,size,color,opacity,rotation=quaternion){
    if(opacity<=0.0001||size<=0.00001)return;
    const i=mesh.count++;
    if(i>=capacity)throw new RangeError('Local block instance capacity exceeded');
    matrix.compose(position,rotation,scale.setScalar(size));mesh.setMatrixAt(i,matrix);
    if(color instanceof THREE.Color)col.copy(color);else col.setHex(color);
    mesh.setColorAt(i,col);alpha.setX(i,opacity);
  },finish(){mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;alpha.needsUpdate=true;}};
}

export function createBlockView(stage,structure,solver,{fixedOrigin=null,toWorld=stage.toWorld,cRef=1}={}) {
  const {L,H,W}=structure,{scene}=stage;
  const group=new THREE.Group();scene.add(group);
  const packets=instances(new THREE.BoxGeometry(1,1,1),2401);
  const ghosts=instances(new THREE.BoxGeometry(1,1,1),1000,{wireframe:true});
  const solids=instances(new THREE.BoxGeometry(0.9,0.9,0.9),125);
  const spheres=instances(new THREE.SphereGeometry(1,14,10),125);
  const discs=instances(new THREE.CircleGeometry(0.3,24),750);
  discs.mesh.material.side=THREE.DoubleSide;
  for(const batch of [packets,ghosts,solids,spheres,discs])group.add(batch.mesh);
  const frameGeometry=new THREE.EdgesGeometry(new THREE.BoxGeometry(0.9,0.9,0.9));
  const frames=Array.from({length:125},()=>{const mesh=new THREE.LineSegments(frameGeometry,new THREE.LineBasicMaterial({color:0xc9d1ce,transparent:true,opacity:0.5,depthWrite:false}));group.add(mesh);return mesh;});
  const marker=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.06,1.06,1.06)),new THREE.LineBasicMaterial({color:GOLD,depthTest:false}));marker.renderOrder=10;group.add(marker);
  const pickMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(0.94,0.94,0.94),new THREE.MeshBasicMaterial(),125);
  pickMesh.frustumCulled=false;
  const pulsePlane=new THREE.Mesh(new THREE.PlaneGeometry(H,W).rotateY(Math.PI/2),new THREE.MeshBasicMaterial({color:FLOW,transparent:true,depthWrite:false,side:THREE.DoubleSide,opacity:0}));
  pulsePlane.position.copy(toWorld(1,(H-1)/2,(W-1)/2));scene.add(pulsePlane);
  let selection={x:3,y:1,z:1},origin=fixedOrigin||blockOrigin(structure,selection),snapshot=null,progress=1,visible=false;
  const sumLabel=document.createElement('span');sumLabel.className='teaching-sum';sumLabel.hidden=true;
  stage.overlay.appendChild(sumLabel);
  const sumPosition=new THREE.Vector3();stage.pinLabel(sumLabel,sumPosition);
  let nodes=[],counts={};
  const world=(x,y,z)=>toWorld(origin.x+x,origin.y+y,origin.z+z);
  const physical=(x,y,z)=>({x:origin.x+x,y:wrap(origin.y+y,H),z:wrap(origin.z+z,W)});
  function setSelection(next){
    selection={...next};origin=fixedOrigin||blockOrigin(structure,selection);nodes=[];solids.reset();
    const matrix=new THREE.Matrix4();
    for(let z=0;z<5;z++)for(let y=0;y<5;y++)for(let x=0;x<5;x++){
      const n=x+5*(y+5*z),p=world(x,y,z),actual=physical(x,y,z),i=actual.x+L*(actual.y+H*actual.z);
      nodes.push({x,y,z,n,i,phase:structure.phase[i],position:p,actual});
      frames[n].position.copy(p);frames[n].visible=isFluid(structure.phase[i]);
      matrix.makeTranslation(p.x,p.y,p.z);pickMesh.setMatrixAt(n,matrix);
      if(!isFluid(structure.phase[i]))solids.add(p,1,PHASE_COLOR[structure.phase[i]],structure.phase[i]===PHASE.PT?0.35:0.22);
    }
    solids.finish();pickMesh.instanceMatrix.needsUpdate=true;pickMesh.computeBoundingSphere();pickMesh.updateMatrixWorld(true);
    marker.position.copy(fixedOrigin ? toWorld(selection.x, selection.y, selection.z) : toWorld(selection.x, origin.y + 2, origin.z + 2));
    sumPosition.copy(marker.position).add(new THREE.Vector3(0.35,0,0.45));
  }
  const offset=(x,y,z)=>blockOffset(x+1,y+1,z+1);
  function value(data,k,x,y,z){const n=data?.f[k*343+offset(x,y,z)];return Number.isFinite(n)?Math.max(0,n):0;}
  function phaseAt(data,x,y,z){return data?.phase[offset(x,y,z)]??PHASE.WALL;}
  const size=(v,k)=>0.10+0.22*Math.sqrt(Math.max(0,Math.min(1.5,v/(WEIGHT[k]*cRef))));
  const alpha=(v,k)=>0.35+0.65*Math.sqrt(Math.max(0,Math.min(1,v/(WEIGHT[k]*cRef))));
  const at=(x,y,z,k)=>world(x,y,z).addScaledVector(new THREE.Vector3(...E[k]),0.3);
  const isSelected=(x,y,z)=>origin.x+x===selection.x&&wrap(origin.y+y,H)===selection.y&&wrap(origin.z+z,W)===selection.z;
  function radius(c){return 0.12+0.25*Math.cbrt(Math.max(0,c/cRef));}
  function sphere(p,c,opacity=1){spheres.add(p,radius(c),0x8e9a96,opacity);}
  function render(p=progress){
    progress=p;if(!snapshot)return;
    const {before,after,sub}=snapshot,b=before||after,a=after,q=easeQuad(p);
    const selectedOffset=offset(selection.x-origin.x,selection.y-origin.y,selection.z-origin.z);
    sumLabel.hidden=!visible||sub!==3||!isFluid(structure.phase[selection.x+L*(selection.y+H*selection.z)]);
    sumLabel.textContent='Σf = '+a.c[selectedOffset].toFixed(4);
    for(const batch of [packets,ghosts,spheres,discs])batch.reset();
    counts={incoming:0,outgoing:0,bouncing:0,conjugate:0,reacting:0};
    let maxDelta=0;
    const delta=nodes.map(node=>{let d=0;for(let k=0;k<7;k++)d+=Math.abs(value(a,k,node.x,node.y,node.z)-value(b,k,node.x,node.y,node.z));maxDelta=Math.max(maxDelta,d);return d;});
    for(const node of nodes){
      const {x,y,z,n,phase,position}=node,j=offset(x,y,z);
      frames[n].material.color.setHex(0xc9d1ce);frames[n].material.opacity=0.5;
      if(!isFluid(phase))continue;
      if(sub===5&&maxDelta>0){const flash=Math.sin(Math.PI*p)**2*delta[n]/maxDelta;frames[n].material.color.lerp(new THREE.Color(CONJ),flash);frames[n].material.opacity=0.5+0.5*flash;}
      // Macro spheres survive the reaction stage and fade during collision's first 30%.
      if(sub===3){sphere(position,mix(b.c[j],a.c[j],q),Math.min(1,p/0.6));}
      else if(sub===4){const consumed=a.src[j];const c=consumed>0?mix(a.c[j],Math.max(0,a.c[j]-consumed),q):a.c[j];sphere(position,c);
        if(phase===PHASE.IONOMER&&consumed>0){counts.reacting++;for(let k=1;k<7;k++){const [ex,ey,ez]=E[k];if(phaseAt(a,x+ex,y+ey,z+ez)!==PHASE.PT)continue;const rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,0,1),new THREE.Vector3(...E[k]));discs.add(position.clone().addScaledVector(new THREE.Vector3(...E[k]),0.5),1,BOUNCE,Math.sin(Math.PI*p),rotation);}}
      }else if(sub===5&&p<0.3){sphere(position,Math.max(0,b.c[j]-b.src[j]),1-p/0.3);}
      for(let k=0;k<7;k++){
        if(sub===0&&k>0)continue;
        const pre=value(b,k,x,y,z),post=value(a,k,x,y,z);let v=mix(pre,post,q),pos=at(x,y,z,k),col=FLOW,opacity=alpha(v,k),s=size(v,k);
        if(sub===1&&k>0){
          const [ex,ey,ez]=E[k],oppositeNeighbor=phaseAt(a,x-ex,y-ey,z-ez);
          if(!isFluid(oppositeNeighbor)){const outgoing=value(b,OPP[k],x-ex,y-ey,z-ez);v=mix(outgoing,post,q);s=size(v,k);opacity=alpha(v,k);pos.lerpVectors(position.clone().addScaledVector(new THREE.Vector3(...E[k]),-0.5),at(x,y,z,k),q);col=BOUNCE;counts.bouncing++;}
        }else if(sub===2){
          if(origin.x+x===1&&k===1)ghosts.add(pos,s*1.08,GOLD,Math.sin(Math.PI*p));
        }else if(sub===3){
          const spread=p<=0.6?1-easeQuad(p/0.6):easeQuad((p-0.6)/0.4);pos.lerpVectors(position,pos,spread);s*=spread;
        }else if(sub===4){v=post;s=size(post,k);opacity=alpha(post,k);}
        else if(sub===5){ghosts.add(at(x,y,z,k),size(pre,k),GOLD,0.8*(1-p));}
        packets.add(pos,s,col,opacity);
      }
    }
    if(snapshot.sub===0){
      // The halo contributes only trajectories that enter the middle 5-cube.
      for(let z=-1;z<=5;z++)for(let y=-1;y<=5;y++)for(let x=-1;x<=5;x++){
        if(!isFluid(phaseAt(b,x,y,z)))continue;
        for(let k=1;k<7;k++){
          const [ex,ey,ez]=E[k],tx=x+ex,ty=y+ey,tz=z+ez;
          const sourceInside=central(x,y,z),targetInside=central(tx,ty,tz);
          if(!sourceInside&&!targetInside)continue;
          const targetPhase=phaseAt(a,tx,ty,tz),blocked=!isFluid(targetPhase);
          const pre=value(b,k,x,y,z),post=value(a,k,tx,ty,tz),v=mix(pre,post,q);
          let start=at(x,y,z,k),end=blocked?world(x,y,z).addScaledVector(new THREE.Vector3(...E[k]),0.5):at(tx,ty,tz,k);
          let opacity=alpha(v,k),col=FLOW,scale=1;
          if(blocked){if(p>=0.6)col=BOUNCE;counts.bouncing++;}
          else if((phaseAt(b,x,y,z)===PHASE.PORE&&targetPhase===PHASE.IONOMER)||(phaseAt(b,x,y,z)===PHASE.IONOMER&&targetPhase===PHASE.PORE)){col=CONJ;counts.conjugate++;}
          if(!sourceInside){opacity*=Math.min(1,p/0.3);counts.incoming++;
            start=world(tx,ty,tz).addScaledVector(new THREE.Vector3(...E[k]),-0.5);
          }else if(!targetInside&&!blocked){opacity*=Math.min(1,(1-p)/0.3);counts.outgoing++;}
          if(isSelected(x,y,z)){scale=1.6;col=FLOW;}
          else if(isSelected(tx,ty,tz)){scale=1.6;col=GOLD;}
          // A blocked packet reaches the face at the fixed mid-frame; keep
          // the original quad easing and total 900 ms substep duration.
          packets.add(start.lerp(end,blocked?easeQuad(Math.min(1,p*2)):q),size(v,k)*scale,col,opacity);
        }
      }
    }
    pulsePlane.visible=visible&&snapshot.sub===2&&!nodes.some(node=>origin.x+node.x===1);
    pulsePlane.material.opacity=0.35*Math.sin(Math.PI*p);
    for(const batch of [packets,ghosts,spheres,discs])batch.finish();
  }
  function setSnapshot(next,p=1){snapshot=next;render(p);}
  function setVisible(value){visible=value;group.visible=value;sumLabel.hidden=!value||snapshot?.sub!==3||!isFluid(structure.phase[selection.x+L*(selection.y+H*selection.z)]);if(!value)pulsePlane.visible=false;}
  function pick(raycaster){if(!visible)return null;const hit=raycaster.intersectObject(pickMesh)[0];return hit?nodes[hit.instanceId].actual:null;}
  setSelection(selection);setVisible(false);
  return {setSelection,setSnapshot,setVisible,animate:render,target:()=>world(2,2,2),pick,
    stats:()=>({origin:{...origin},visible,sub:snapshot?.sub??-1,progress,fluidCells:nodes.filter(n=>isFluid(n.phase)).length,packets:packets.mesh.count,ghosts:ghosts.mesh.count,spheres:spheres.mesh.count,discs:discs.mesh.count,...counts})};
}
