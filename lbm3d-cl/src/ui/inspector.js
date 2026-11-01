import { PHASE_NAME, STATUS } from './palette.js';
import { neighborStatus } from './neighbors.js';
import { WEIGHT, E } from '../engine/index.js';
import { isFluid } from './block-state.js';

const LABELS=['f₀ (静止)','f₁ (+X)','f₂ (−X)','f₃ (+Y)','f₄ (−Y)','f₅ (+Z)','f₆ (−Z)'];
const SUB_LABELS=['迁移','反弹','入口','宏观量','反应','碰撞'];
export function createInspector(container,structure,solver){
  const svg=container.querySelector('#stencil'),tbody=container.querySelector('#dist-rows'),info=container.querySelector('#substep-info'),phaseTag=container.querySelector('.phase-tag');
  const inputs=[...container.querySelectorAll('.coord-input')];
  const macro={c:container.querySelector('#macro-c'),tau:container.querySelector('#macro-tau'),d:container.querySelector('#macro-d'),src:container.querySelector('#macro-src')};
  const cx=200,cy=150,scale=66;
  const iso=(x,y,z)=>({x:cx+(x-y)*scale*0.866,y:cy-z*scale+(x+y)*scale*0.5});
  const defs=Object.entries(STATUS).map(([key,st])=>'<marker id="ah-'+key+'" markerWidth="6" markerHeight="6" refX="5.5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="'+st.color+'"/></marker>').join('');
  const arrows=E.slice(1).map((d,k)=>{
    const p=iso(...d),lx=p.x+d[0]*18+(d[1]!==0?d[1]*18:0),ly=p.y-(d[2]!==0?d[2]*16:(d[0]+d[1])*8);
    return '<g id="arr'+k+'"><line id="line'+k+'" x1="'+cx+'" y1="'+cy+'" x2="'+p.x+'" y2="'+p.y+'" stroke="#1f7a72" stroke-width="2.5" marker-end="url(#ah-flow)"/>'+
      '<circle id="dot'+k+'" cx="'+p.x+'" cy="'+p.y+'" r="5" fill="#1f7a72"/><text x="'+lx+'" y="'+ly+'" font-size="11" fill="#6b7774" text-anchor="middle">'+LABELS[k+1]+'</text>'+
      '<text id="val'+(k+1)+'" x="'+lx+'" y="'+(ly+12)+'" font-size="10" fill="#1d2a2a" font-family="JetBrains Mono,monospace" text-anchor="middle">—</text></g>';
  }).join('');
  const legend=Object.values(STATUS).map((st,i)=>'<circle cx="'+(30+i*60)+'" cy="-3" r="3" fill="'+st.color+'"/><text x="'+(36+i*60)+'" font-size="10" fill="#6b7774">'+st.label+'</text>').join('');
  svg.innerHTML='<rect fill="#f9faf8" stroke="#e1e4df" x="5" y="5" width="390" height="270" rx="4"/><defs>'+defs+'</defs>'+arrows+
    '<circle cx="'+cx+'" cy="'+cy+'" r="7" fill="#c99a2e"/><text x="'+(cx-36)+'" y="'+(cy-12)+'" font-size="11" fill="#6b7774" text-anchor="end">f₀ (静止)</text>'+
    '<text id="val0" x="'+(cx-36)+'" y="'+cy+'" font-size="10" fill="#1d2a2a" font-family="JetBrains Mono,monospace" text-anchor="end">—</text><g transform="translate(10,255)"><text font-size="10" fill="#6b7774">状态：</text>'+legend+'</g>';
  const values=Array.from({length:7},(_,k)=>svg.querySelector('#val'+k));
  const arrowGroups=Array.from({length:6},(_,k)=>svg.querySelector('#arr'+k));
  function update(x,y,z,mode,history=null,animating=false){
    const teaching=mode==='step';
    const notation=teaching?'f':'g';
    const labels=LABELS.map(label=>notation+label.slice(1));
    for(const text of svg.querySelectorAll('text'))if(/^[fg][₀₁₂₃₄₅₆]/.test(text.textContent))text.textContent=notation+text.textContent.slice(1);
    inputs.forEach((el,k)=>{el.value=[x,y,z][k];el.min=teaching&&k===0?1:0;el.max=[structure.L-(teaching?2:1),structure.H-1,structure.W-1][k];});
    macro.c.parentElement.querySelector('label').textContent=teaching?'Σf':'浓度';
    macro.c.parentElement.querySelector('small').textContent=teaching?'':'mol/m³';
    macro.src.parentElement.hidden=teaching;
    container.querySelector('.macro-row').classList.toggle('teaching',teaching);
    const i=x+structure.L*(y+structure.H*z),p=structure.phase[i],last=solver.lastSubstep,N=structure.L*structure.H*structure.W;
    phaseTag.textContent=PHASE_NAME[p];
    info.textContent=last<0?'尚未开始':'子步：'+SUB_LABELS[last]+' · '+(teaching?'教学格点':'')+'第 '+solver.t+' 步';
    if(!isFluid(p)){
      for(const el of Object.values(macro))el.textContent='—';
      values.forEach(el=>{el.textContent='—';});arrowGroups.forEach(el=>{el.style.display='none';});
      tbody.innerHTML='<tr><td colspan="6" style="text-align:center;color:#6b7774">固相格点不参与氧气传输</td></tr>';return;
    }
    arrowGroups.forEach(el=>{el.style.display='';});
    const statuses=E.slice(1).map(d=>neighborStatus(structure,x,y,z,...d));
    statuses.forEach((status,k)=>{
      const line=svg.querySelector('#line'+k),dot=svg.querySelector('#dot'+k),involved=animating&&(last===0||last===1&&(status==='bounce'||status==='wall')||last===2&&k===0&&x===1);
      line.setAttribute('stroke',STATUS[status].color);line.setAttribute('marker-end','url(#ah-'+status+')');line.setAttribute('stroke-width',involved?'3.5':'2.5');dot.setAttribute('fill',STATUS[status].color);
    });
    const node=solver.node(i);
    macro.c.textContent=(teaching?node.f.reduce((sum,value)=>sum+value,0):node.c).toFixed(3);macro.tau.textContent=node.tau.toFixed(3);macro.d.textContent=(node.D*1e6).toFixed(2);macro.src.textContent=(node.src/solver.params.dt).toExponential(1);
    const before=history?.beforeF,after=history?.afterF;
    for(let k=0;k<7;k++)values[k].textContent=mode==='build'?'—':(after?after[k*N+i]:node.f[k]).toFixed(4);
    tbody.innerHTML=labels.map((label,k)=>{
      const st=k===0?'—':'<span class="st-dot" style="background:'+STATUS[statuses[k-1]].color+'"></span>'+STATUS[statuses[k-1]].label;
      if(mode==='build')return '<tr><td>'+label+'</td><td>'+WEIGHT[k].toFixed(3)+'</td><td>—</td><td>—</td><td class="d-zero">—</td><td>'+st+'</td></tr>';
      const a=before?before[k*N+i]:node.f[k],b=after?after[k*N+i]:node.f[k],delta=b-a;
      const formatted=Number(delta.toFixed(4)),cls=formatted>0?'d-pos':formatted<0?'d-neg':'d-zero',sign=formatted>0?'+':'';
      return '<tr><td>'+label+'</td><td>'+WEIGHT[k].toFixed(3)+'</td><td>'+a.toFixed(4)+'</td><td>'+b.toFixed(4)+'</td><td class="'+cls+'">'+sign+formatted.toFixed(4)+'</td><td>'+st+'</td></tr>';
    }).join('');
  }
  return {update,setSource(nextStructure,nextSolver){structure=nextStructure;solver=nextSolver;}};
}
