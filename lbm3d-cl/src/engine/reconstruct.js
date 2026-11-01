import { mulberry32, shuffleInPlace } from './rng.js';

export const PHASE = Object.freeze({
  PORE: 0,
  IONOMER: 1,
  CARBON: 2,
  PT: 3,
  BUFFER: 4,
  WALL: 5,
});

const NB6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const DIRS13 = [
  [1, 0, 0], [0, 1, 0], [0, 0, 1],
  [1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1],
  [0, 1, 1], [0, 1, -1], [1, 1, 1], [1, -1, 1], [1, 1, -1], [-1, 1, 1],
];

const wrap = (value, size) => ((value % size) + size) % size;

function targetFractions(porosity, ptc, ic) {
  const rhoCarbon = 1800;
  const rhoPt = 21450;
  const rhoIonomer = 2000;
  const carbon = (1 - porosity) /
    (1 + (rhoCarbon * ptc) / rhoPt + (rhoCarbon * ic) / rhoIonomer);
  return {
    carbon,
    pt: carbon * rhoCarbon * ptc / rhoPt,
    ionomer: carbon * rhoCarbon * ic / rhoIonomer,
    pore: porosity,
  };
}

export function reconstruct(params = {}) {
  const L = params.L ?? 64;
  const H = params.H ?? 32;
  const W = params.W ?? 32;
  const dx = params.dx ?? 5e-9;
  const radius = params.radius ?? 5;
  const porosity = params.porosity ?? 0.4;
  const ptc = params.ptc ?? 0.6;
  const ic = params.ic ?? 0.33;
  const seed = params.seed ?? 42;
  const bufferLayers = params.bufferLayers ?? 3;
  const N = L * H * W;
  const idx = (x, y, z) => x + L * (y + H * z);
  const phase = new Uint8Array(N);
  const order = new Int32Array(N).fill(-1);
  const poreSize = new Float32Array(N);
  const random = mulberry32(seed);
  const ionomerRandom = mulberry32(seed + 12345);
  const targets = targetFractions(porosity, ptc, ic);
  const x0 = Math.max(1, bufferLayers);
  const x1 = Math.min(L - 1, L - bufferLayers);
  const innerWidth = Math.max(0, x1 - x0);
  const innerCount = innerWidth * H * W;
  const targetCarbon = Math.round(targets.carbon * innerCount);
  const targetPt = Math.round(targets.pt * innerCount);
  const targetIonomer = Math.round(targets.ionomer * innerCount);
  const sphereRadius = Math.max(0, radius - 1);
  const sphereRadius2 = sphereRadius * sphereRadius;
  const stages = [{ name: 'empty', start: 0, end: -1 }];
  const spheres = [];
  let sequence = 0;

  const coordinate = (i) => {
    const x = i % L;
    const yz = Math.floor(i / L);
    return [x, yz % H, Math.floor(yz / H)];
  };
  const neighbors = (i) => {
    const [x, y, z] = coordinate(i);
    const result = [];
    for (const [ox, oy, oz] of NB6) {
      const nx = x + ox;
      if (nx < x0 || nx >= x1) continue;
      result.push(idx(nx, wrap(y + oy, H), wrap(z + oz, W)));
    }
    return result;
  };
  const randomCenter = () => [
    x0 + Math.floor(random() * Math.max(1, innerWidth)),
    Math.floor(random() * H),
    Math.floor(random() * W),
  ];
  const sphereVoxels = (cx, cy, cz) => {
    const cells = [];
    const xmin = Math.max(x0, cx - radius);
    const xmax = Math.min(x1 - 1, cx + radius);
    for (let x = xmin; x <= xmax; x += 1) {
      for (let oy = -radius; oy <= radius; oy += 1) {
        const y = wrap(cy + oy, H);
        for (let oz = -radius; oz <= radius; oz += 1) {
          const z = wrap(cz + oz, W);
          if ((x - cx) ** 2 + oy ** 2 + oz ** 2 <= sphereRadius2) cells.push(idx(x, y, z));
        }
      }
    }
    return cells;
  };
  const placeCarbon = (cells) => {
    let added = 0;
    for (const i of cells) {
      if (phase[i] === PHASE.PORE) {
        phase[i] = PHASE.CARBON;
        order[i] = sequence;
        sequence += 1;
        added += 1;
      }
    }
    return added;
  };
  const carbonCount = () => {
    let count = 0;
    for (let x = x0; x < x1; x += 1) {
      for (let y = 0; y < H; y += 1) {
        for (let z = 0; z < W; z += 1) if (phase[idx(x, y, z)] === PHASE.CARBON) count += 1;
      }
    }
    return count;
  };

  // The C reference places a small random set of disjoint spheres first. The
  // fallback grid keeps those spheres reproducible and face-connected when
  // random placement cannot satisfy the requested count.
  const initialCount = Math.max(1, Math.floor((targetCarbon * 0.2) /
    ((4 / 3) * Math.PI * Math.max(1, radius) ** 3)));
  let initialStart = sequence;
  const initialCenters = [];
  for (let n = 0; n < initialCount; n += 1) {
    let placed = false;
    for (let attempt = 0; attempt < 5000 && !placed; attempt += 1) {
      const center = randomCenter();
      const cells = sphereVoxels(...center);
      if (cells.some((i) => phase[i] === PHASE.CARBON)) continue;
      placeCarbon(cells);
      initialCenters.push(center);
      spheres.push({ x: center[0], y: center[1], z: center[2], r: sphereRadius, stage: 'carbon-init' });
      placed = true;
    }
    if (!placed) break;
  }
  if (initialCenters.length < initialCount) {
    for (let x = x0; x < x1 && initialCenters.length < initialCount; x += Math.max(1, radius * 2 + 1)) {
      for (let y = 0; y < H && initialCenters.length < initialCount; y += Math.max(1, radius * 2 + 1)) {
        for (let z = 0; z < W && initialCenters.length < initialCount; z += Math.max(1, radius * 2 + 1)) {
          const cells = sphereVoxels(x, y, z);
          if (cells.some((i) => phase[i] === PHASE.CARBON)) continue;
          placeCarbon(cells);
          initialCenters.push([x, y, z]);
          spheres.push({ x, y, z, r: sphereRadius, stage: 'carbon-init' });
        }
      }
    }
  }
  stages.push({ name: 'carbon-init', start: initialStart, end: sequence - 1 });

  const growStart = sequence;
  let attempts = 0;
  const maxAttempts = Math.max(20000, targetCarbon * 12);
  while (carbonCount() < targetCarbon && attempts < maxAttempts) {
    attempts += 1;
    const center = randomCenter();
    const cells = sphereVoxels(...center);
    let overlap = 0;
    for (const i of cells) if (phase[i] === PHASE.CARBON) overlap += 1;
    const overlapRate = overlap / (8 * Math.max(1, radius) ** 3);
    if (overlapRate <= 0 || overlapRate > 0.2) continue;
    const added = placeCarbon(cells);
    if (added > 0) spheres.push({ x: center[0], y: center[1], z: center[2], r: sphereRadius, stage: 'carbon-grow' });
  }
  // A deterministic bridging pass makes the 6-connected cluster property
  // explicit without changing the overlap rule used for ordinary growth.
  let bridgeGuard = 0;
  while (carbonCount() < targetCarbon && bridgeGuard < targetCarbon * 4) {
    bridgeGuard += 1;
    const candidates = [];
    for (let x = x0; x < x1; x += 1) {
      for (let y = 0; y < H; y += 1) {
        for (let z = 0; z < W; z += 1) {
          const i = idx(x, y, z);
          if (phase[i] !== PHASE.PORE) continue;
          const count = neighbors(i).filter((j) => phase[j] === PHASE.CARBON).length;
          if (count) candidates.push([count, i]);
        }
      }
    }
    if (!candidates.length) break;
    candidates.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
    const limit = Math.min(candidates.length, targetCarbon - carbonCount());
    for (let k = 0; k < limit; k += 1) {
      const i = candidates[k][1];
      if (phase[i] !== PHASE.PORE) continue;
      phase[i] = PHASE.CARBON;
      order[i] = sequence;
      sequence += 1;
    }
  }
  stages.push({ name: 'carbon-grow', start: growStart, end: sequence - 1 });

  const ptStart = sequence;
  const ptCandidates = [];
  for (let x = x0; x < x1; x += 1) {
    for (let y = 0; y < H; y += 1) {
      for (let z = 0; z < W; z += 1) {
        const i = idx(x, y, z);
        if (phase[i] !== PHASE.PORE) continue;
        if (neighbors(i).some((j) => phase[j] === PHASE.CARBON)) ptCandidates.push(i);
      }
    }
  }
  shuffleInPlace(ptCandidates, random);
  let ptPlaced = 0;
  const ptPasses = Math.max(1, Math.ceil(targetPt / Math.max(1, ptCandidates.length * 0.38)));
  for (let pass = 0; pass < ptPasses && ptPlaced < targetPt; pass += 1) {
    for (const i of ptCandidates) {
      if (ptPlaced >= targetPt || phase[i] !== PHASE.PORE) continue;
      if (random() % 1 >= 0.38) continue;
      phase[i] = PHASE.PT;
      order[i] = sequence;
      sequence += 1;
      ptPlaced += 1;
    }
  }
  for (const i of ptCandidates) {
    if (ptPlaced >= targetPt) break;
    if (phase[i] !== PHASE.PORE) continue;
    phase[i] = PHASE.PT;
    order[i] = sequence;
    sequence += 1;
    ptPlaced += 1;
  }
  stages.push({ name: 'pt', start: ptStart, end: sequence - 1 });

  const ionomerStart = sequence;
  const carbonSources = [];
  const ptSources = [];
  for (let x = x0; x < x1; x += 1) {
    for (let y = 0; y < H; y += 1) {
      for (let z = 0; z < W; z += 1) {
        const i = idx(x, y, z);
        if (phase[i] === PHASE.CARBON) carbonSources.push(i);
        else if (phase[i] === PHASE.PT) ptSources.push(i);
      }
    }
  }
  const ionomerSources = [];
  const prob = new Int32Array(N).fill(-1);
  let ionomerCount = 0;
  let passes = 0;
  while (ionomerCount < targetIonomer && passes < 20000) {
    passes += 1;
    const newIonomerThisPass = [];
    // 原算法：离聚物邻居 20000 → 碳邻居 10000 → 铂邻居 5000，后写的覆盖先写的
    // 只处理上一轮新长出的离聚物，不是所有离聚物
    const ionomerToProcess = passes === 1 ? [] : newIonomerThisPass;
    for (const i of ionomerToProcess) {
      for (const j of neighbors(i)) {
        if (phase[j] === PHASE.PORE) prob[j] = Math.floor(ionomerRandom() * 20000);
      }
    }
    for (const i of carbonSources) {
      for (const j of neighbors(i)) {
        if (phase[j] === PHASE.PORE) prob[j] = Math.floor(ionomerRandom() * 10000);
      }
    }
    for (const i of ptSources) {
      for (const j of neighbors(i)) {
        if (phase[j] === PHASE.PORE) prob[j] = Math.floor(ionomerRandom() * 5000);
      }
    }
    for (let x = x0; x < x1; x += 1) {
      for (let y = 0; y < H; y += 1) {
        for (let z = 0; z < W; z += 1) {
          const i = idx(x, y, z);
          if (phase[i] !== PHASE.PORE || prob[i] < 0 || prob[i] >= 20) continue;
          phase[i] = PHASE.IONOMER;
          order[i] = sequence;
          sequence += 1;
          ionomerSources.push(i);
          newIonomerThisPass.push(i);
          ionomerCount += 1;
        }
      }
    }
  }
  if (ionomerCount < targetIonomer) {
    console.warn(`Ionomer growth reached ${passes} passes after generating ${ionomerCount} of ${targetIonomer} target voxels.`);
  }
  stages.push({ name: 'ionomer', start: ionomerStart, end: sequence - 1 });

  const boundaryStart = sequence;
  for (let x = 0; x < L; x += 1) {
    for (let y = 0; y < H; y += 1) {
      for (let z = 0; z < W; z += 1) {
        const i = idx(x, y, z);
        if (x === 0 || x === L - 1) {
          phase[i] = PHASE.WALL;
        } else if (x < x0 || x >= x1) {
          phase[i] = PHASE.BUFFER;
        } else {
          continue;
        }
        order[i] = sequence;
        sequence += 1;
      }
    }
  }
  stages.push({ name: 'buffer-wall', start: boundaryStart, end: sequence - 1 });
  stages.push({ name: 'tau', start: sequence, end: sequence - 1 });

  const isPore = (x, y, z) => {
    if (x < x0 || x >= x1) return false;
    return phase[idx(x, wrap(y, H), wrap(z, W))] === PHASE.PORE;
  };
  for (let x = x0; x < x1; x += 1) {
    for (let y = 0; y < H; y += 1) {
      for (let z = 0; z < W; z += 1) {
        const center = idx(x, y, z);
        if (phase[center] !== PHASE.PORE) continue;
        let total = 0;
        for (const [ox, oy, oz] of DIRS13) {
          let length = 1;
          for (let distance = 1; distance < Math.max(L, H, W) * 2; distance += 1) {
            if (!isPore(x + ox * distance, y + oy * distance, z + oz * distance)) break;
            length += 1;
          }
          for (let distance = 1; distance < Math.max(L, H, W) * 2; distance += 1) {
            if (!isPore(x - ox * distance, y - oy * distance, z - oz * distance)) break;
            length += 1;
          }
          total += length;
        }
        poreSize[center] = total / DIRS13.length;
      }
    }
  }

  const countFraction = (wanted) => {
    let count = 0;
    for (let x = x0; x < x1; x += 1) {
      for (let y = 0; y < H; y += 1) {
        for (let z = 0; z < W; z += 1) if (phase[idx(x, y, z)] === wanted) count += 1;
      }
    }
    return innerCount ? count / innerCount : 0;
  };
  const fractions = {
    carbon: countFraction(PHASE.CARBON),
    pt: countFraction(PHASE.PT),
    ionomer: countFraction(PHASE.IONOMER),
    pore: countFraction(PHASE.PORE),
  };

  return { L, H, W, dx, phase, order, stages, spheres, poreSize, fractions, targets };
}
