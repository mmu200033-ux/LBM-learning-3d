import * as THREE from 'three';
import { createStage } from './stage.js';
import { PHASE_COLOR, viridis } from './palette.js';

export function createVolumeView(canvas,overlay,structure,solver) {
  const {L,H,W,phase}=structure,N=L*H*W,idx=(x,y,z)=>x+L*(y+H*z);
  const stage=createStage(canvas,overlay,structure),{scene,renderer,toWorld}=stage;
  const concentration=new THREE.Data3DTexture(new Uint8Array(N),L,H,W);
  const phases=new THREE.Data3DTexture(new Uint8Array(phase),L,H,W);
  for(const tex of [concentration,phases]){tex.format=THREE.RedFormat;tex.type=THREE.UnsignedByteType;tex.unpackAlignment=1;tex.internalFormat='R8';}
  concentration.minFilter=concentration.magFilter=THREE.LinearFilter;
  phases.minFilter=phases.magFilter=THREE.NearestFilter;phases.needsUpdate=true;
  const lutData=new Uint8Array(256*4);
  for(let i=0;i<256;i++){lutData.set(viridis(i/255).map(v=>Math.round(v)),i*4);lutData[i*4+3]=255;}
  const lut=new THREE.DataTexture(lutData,256,1,THREE.RGBAFormat);lut.minFilter=lut.magFilter=THREE.LinearFilter;lut.needsUpdate=true;
  const uniforms={uConcentration:{value:concentration},uPhase:{value:phases},uLut:{value:lut},uSize:{value:new THREE.Vector3(L,H,W)},uShowSolid:{value:true},uSlice:{value:false},uSliceNormal:{value:new THREE.Vector3(0,1,0)},uSlicePosition:{value:0.5}};
  const vertexShader=[
    'out vec3 vPosition; out vec3 vOrigin;',
    'void main(){ vPosition=position; vOrigin=(inverse(modelMatrix)*vec4(cameraPosition,1.0)).xyz;',
    'gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }'
  ].join('\n');
  const fragmentShader=[
    'precision highp float; precision highp sampler3D;',
    'in vec3 vPosition; in vec3 vOrigin; out vec4 fragColor;',
    'uniform sampler3D uConcentration,uPhase; uniform sampler2D uLut;',
    'uniform vec3 uSize,uSliceNormal; uniform bool uShowSolid,uSlice; uniform float uSlicePosition;',
    'void main(){',
    'vec3 direction=normalize(vPosition-vOrigin); vec3 inverseDir=1.0/direction;',
    'vec3 a=(-uSize*0.5-vOrigin)*inverseDir,b=(uSize*0.5-vOrigin)*inverseDir;',
    'vec3 lo=min(a,b),hi=max(a,b);float enter=max(max(lo.x,lo.y),lo.z),leave=min(min(hi.x,hi.y),hi.z);',
    'enter=max(enter,0.0);if(enter>=leave)discard;',
    // The opaque slice is drawn first. Composite only the volume in front of it.
    'if(uSlice){float den=dot(direction,uSliceNormal);if(abs(den)>0.00001){float sliceT=(uSlicePosition-dot(vOrigin,uSliceNormal))/den;if(sliceT>enter&&sliceT<leave)leave=sliceT;}}',
    'vec4 accumulated=vec4(0.0);float distance=enter+0.001;',
    'for(int i=0;i<256;i++){if(distance>=leave||accumulated.a>=0.97)break;',
    'float ds=min(0.5,leave-distance); vec3 uv=(vOrigin+direction*(distance+0.5*ds))/uSize+0.5;',
    'float t=texture(uConcentration,uv).r;float phase=texture(uPhase,uv).r*255.0;',
    'vec3 color;float perUnit;if(phase>=1.5){color=vec3(154.0,165.0,161.0)/255.0;perUnit=uShowSolid?0.06:0.0;}',
    'else {color=texture(uLut,vec2(t,0.5)).rgb;perUnit=0.04+0.5*pow(t,1.5);}',
    'float alpha=1.0-pow(1.0-perUnit,ds);accumulated.rgb+=(1.0-accumulated.a)*alpha*color;',
    'accumulated.a+=(1.0-accumulated.a)*alpha;distance+=ds;}',
    'if(accumulated.a<0.00001)discard;fragColor=vec4(accumulated.rgb/accumulated.a,accumulated.a);}'
  ].join('\n');
  const material=new THREE.ShaderMaterial({glslVersion:THREE.GLSL3,uniforms,vertexShader,fragmentShader,side:THREE.BackSide,transparent:true,depthWrite:false,depthTest:false});
  const volume=new THREE.Mesh(new THREE.BoxGeometry(L,H,W),material);volume.renderOrder=1;scene.add(volume);
  const marker=new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.06,1.06,1.06)),new THREE.LineBasicMaterial({color:0xc99a2e,depthTest:false}));marker.renderOrder=10;scene.add(marker);
  const sliceTexture=new THREE.DataTexture(new Uint8Array(4),1,1,THREE.RGBAFormat);sliceTexture.minFilter=sliceTexture.magFilter=THREE.NearestFilter;sliceTexture.colorSpace=THREE.SRGBColorSpace;
  const slicePlane=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:sliceTexture,side:THREE.DoubleSide}));slicePlane.visible=false;scene.add(slicePlane);
  let axis='y',position=Math.floor(H/2),sliceEnabled=false,lastUpdate=-Infinity,dirty=true,cMax=solver.params.cIn,overrideBytes=null;
  const timings={updates:0,lastCpuMs:0,totalCpuMs:0,lastUploadMs:0,totalUploadMs:0};
  function updateSliceData(){
    if(!sliceEnabled)return;
    const width=axis==='x'?H:L,height=axis==='z'?H:W,bytes=new Uint8Array(width*height*4);
    for(let v=0;v<height;v++)for(let u=0;u<width;u++){
      const x=axis==='x'?position:u,y=axis==='x'?u:axis==='y'?position:v,z=axis==='z'?position:v;
      const i=idx(x,y,z),p=phase[i];let rgb;
      if(p>=2){const c=PHASE_COLOR[p];rgb=[(c>>16)&255,(c>>8)&255,c&255];}else rgb=viridis(overrideBytes?overrideBytes[i]/255:solver.c[i]/cMax);
      bytes.set(rgb.map(v=>Math.round(v)),4*(u+width*v));bytes[4*(u+width*v)+3]=255;
    }
    if(sliceTexture.image.width!==width||sliceTexture.image.height!==height){sliceTexture.dispose();}
    sliceTexture.image={data:bytes,width,height};sliceTexture.needsUpdate=true;
  }
  function setOptions(options){
    if(options.showSolids!==undefined)uniforms.uShowSolid.value=!!options.showSolids;
    if(options.axis!==undefined)axis=options.axis;
    if(options.position!==undefined)position=Math.max(0,Math.min(({x:L,y:H,z:W})[axis]-1,Math.round(options.position)));
    if(options.sliceEnabled!==undefined)sliceEnabled=!!options.sliceEnabled;
    uniforms.uSlice.value=sliceEnabled;uniforms.uSliceNormal.value.set(axis==='x'?1:0,axis==='y'?1:0,axis==='z'?1:0);
    uniforms.uSlicePosition.value=position-(({x:L,y:H,z:W})[axis]-1)/2;
    slicePlane.visible=sliceEnabled;
    slicePlane.geometry.dispose();
    if(axis==='x')slicePlane.geometry=new THREE.PlaneGeometry(H,W).rotateX(Math.PI/2).rotateZ(Math.PI/2);
    else if(axis==='y')slicePlane.geometry=new THREE.PlaneGeometry(L,W).rotateX(Math.PI/2);
    else slicePlane.geometry=new THREE.PlaneGeometry(L,H);
    slicePlane.position.set(0,0,0);slicePlane.position[axis]=uniforms.uSlicePosition.value;
    updateSliceData();
  }
  function updateTexture(force=false){
    const now=performance.now();if(!dirty||!force&&now-lastUpdate<100)return false;
    const start=performance.now();
    if(overrideBytes) concentration.image.data.set(overrideBytes); else for(let i=0;i<N;i++)concentration.image.data[i]=Math.round(255*Math.min(1,Math.max(0,solver.c[i]/cMax)));
    concentration.needsUpdate=true;updateSliceData();
    const prepared=performance.now();renderer.initTexture(concentration);const end=performance.now();
    timings.updates++;timings.lastCpuMs=prepared-start;timings.totalCpuMs+=prepared-start;timings.lastUploadMs=end-prepared;timings.totalUploadMs+=end-prepared;
    lastUpdate=now;dirty=false;return true;
  }
  function setSelection(x,y,z){marker.position.copy(toWorld(x,y,z));}
  function setSelectionVisible(value){marker.visible=!!value;}
  stage.pinLabel(overlay.querySelector('.inlet-label'),toWorld(-1.5,(H-1)/2,W+1));stage.pinLabel(overlay.querySelector('.outlet-label'),toWorld(L+0.5,(H-1)/2,W+1));
  setOptions({});updateTexture(true);
  function setFrame(frame){ overrideBytes=frame?.concentration??null; dirty=true; updateSliceData(); }
  return {render(){updateTexture();stage.render();},setSelection,setSelectionVisible,setOptions,setFrame,markDirty(){dirty=true;},updateTexture,
    stats:()=>({volume:true,step:0.5,maxSteps:256,format:'R8',slice:{enabled:sliceEnabled,axis,position},showSolids:uniforms.uShowSolid.value,texture:{...timings,meanCpuMs:timings.totalCpuMs/Math.max(1,timings.updates),meanUploadMs:timings.totalUploadMs/Math.max(1,timings.updates)}})};
}
