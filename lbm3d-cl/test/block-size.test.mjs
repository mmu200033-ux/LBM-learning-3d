import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three.module.min.js';
import { createSolver, PHASE } from '../src/engine/index.js';
import { BLOCK_SIZE, BLOCK_COUNT, CAPTURE_SIZE, CAPTURE_COUNT, blockOrigin, blockOffset, captureBlock, captureDistributions, blockFromSnapshot } from '../src/ui/block-state.js';

function fixture() {
  const L=64,H=32,W=32,N=L*H*W;
  return {L,H,W,dx:5e-9,phase:new Uint8Array(N),poreSize:new Float32Array(N).fill(6)};
}

test('20-cube origins stay in the interior and include selected interior sites', () => {
  const structure=fixture();
  assert.equal(BLOCK_SIZE,20);assert.equal(BLOCK_COUNT,8000);
  assert.equal(CAPTURE_SIZE,22);assert.equal(CAPTURE_COUNT,10648);
  assert.deepEqual(blockOrigin(structure,{x:0,y:0,z:0}),{x:3,y:0,z:0});
  assert.deepEqual(blockOrigin(structure,{x:63,y:31,z:31}),{x:41,y:12,z:12});
  for(const x of [3,8,32,60])for(const y of [0,16,31])for(const z of [0,16,31]) {
    const origin=blockOrigin(structure,{x,y,z});
    for(const [axis,value] of Object.entries({x,y,z}))assert.ok(value>=origin[axis]&&value<origin[axis]+20);
  }
});

test('22-cube halo reads real distributions with periodic yz and invalid x preserved', () => {
  const structure=fixture(),solver=createSolver(structure,{cIn:0,i0:0}),N=structure.phase.length;
  for(let i=0;i<N;i++) {solver.c[i]=i;solver.src[i]=i/10;for(let k=0;k<7;k++)solver.f[k*N+i]=k*N+i;}
  for(const origin of [{x:3,y:0,z:0},{x:41,y:12,z:12},{x:0,y:0,z:0}]) {
    const captured=captureBlock(structure,solver,origin);
    const snap=blockFromSnapshot(structure,origin,{f:captureDistributions(solver),c:solver.c,src:solver.src});
    assert.equal(captured.f.length,74536);
    assert.deepEqual(captured,snap);
    for(let z=0;z<22;z++)for(let y=0;y<22;y++)for(let x=0;x<22;x++) {
      const j=blockOffset(x,y,z),ax=origin.x+x-1;
      if(ax<0||ax>=64) {assert.ok(Number.isNaN(captured.f[j]));assert.equal(captured.phase[j],PHASE.WALL);continue;}
      const ay=(origin.y+y-1+32)%32,az=(origin.z+z-1+32)%32,i=ax+64*(ay+32*az);
      assert.equal(captured.c[j],i);assert.equal(captured.src[j],i/10);
      for(let k=0;k<7;k++)assert.equal(captured.f[k*10648+j],k*N+i);
    }
  }
});

async function loadBlockView() {
  let source=await readFile(new URL('../src/ui/block-view.js',import.meta.url),'utf8');
  for(const [specifier,path] of Object.entries({'three':'../vendor/three.module.min.js','../engine/index.js':'../src/engine/index.js','./palette.js':'../src/ui/palette.js','./block-state.js':'../src/ui/block-state.js'})) {
    source=source.replaceAll(`'${specifier}'`,JSON.stringify(new URL(path,import.meta.url).href));
  }
  return import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}

test('production block renders all 8000 nodes across substeps with bounded scene objects', async () => {
  const {createBlockView}=await loadBlockView();
  const previousDocument=globalThis.document;
  globalThis.document={createElement:()=>({hidden:false,className:'',textContent:''})};
  try {
    const structure=fixture(),scene=new THREE.Scene();
    const stage={scene,overlay:{appendChild(){}},pinLabel(){},toWorld:(x,y,z)=>new THREE.Vector3(x-31.5,y-15.5,z-15.5)};
    const block=createBlockView(stage,structure,{});
    block.setSelection({x:32,y:16,z:16});block.setVisible(true);
    const origin=blockOrigin(structure,{x:32,y:16,z:16});
    const before={origin,f:new Float64Array(7*CAPTURE_COUNT).fill(1),c:new Float64Array(CAPTURE_COUNT).fill(7),src:new Float64Array(CAPTURE_COUNT),phase:new Int8Array(CAPTURE_COUNT)};
    const after={...before,f:new Float64Array(before.f).fill(2)};
    for(const sub of [0,1,2,3,4,5])for(const progress of [0,0.5,1]) {
      block.setSnapshot({before,after,sub},progress);
      const stats=block.stats();
      assert.equal(stats.totalCells,8000);assert.equal(stats.fluidCells,8000);
      assert.ok(stats.packets<=7*10648);assert.ok(stats.ghosts<=56000);
      if(sub===0&&progress===0.5)assert.equal(stats.packets,58400);
      if(sub===5&&progress===0.5)assert.equal(stats.ghosts,56000);
      if(sub===3&&progress===1)assert.equal(stats.spheres,8000);
    }
    const objects=[];scene.traverse(o=>objects.push(o));
    assert.ok(objects.length<15,'merged lattice frames must not create 8000 scene objects');
    const frames=objects.find(o=>o.isLineSegments&&o.geometry.getAttribute('color')?.itemSize===4);
    assert.ok(frames);assert.equal(frames.geometry.getAttribute('position').count,8000*24);
    for(const selection of [{x:3,y:0,z:0},{x:60,y:31,z:31}]) {
      block.setSelection(selection);
      const o=block.stats().origin;
      const ray=new THREE.Raycaster(stage.toWorld(o.x-2,o.y+19,o.z+19),new THREE.Vector3(1,0,0));
      assert.deepEqual(block.pick(ray),{x:o.x,y:o.y+19,z:o.z+19});
    }
  } finally {globalThis.document=previousDocument;}
});
