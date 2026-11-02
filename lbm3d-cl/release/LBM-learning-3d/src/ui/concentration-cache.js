export const CACHE_VERSION = 1;
export const DIAGNOSTIC_FIELDS = Object.freeze([
  't', 'timeSeconds', 'inletFlux', 'totalReaction', 'balanceError',
  'totalO2', 'inletAdded', 'stepInletAdded', 'stepConsumed', 'clampAdded', 'stepClampAdded',
]);
export const ENCODINGS = Object.freeze({
  concentration: 'uint8-round-clamp-c-over-cIn',
  profile: 'float32-le-pore-ionomer',
  diagnostics: 'float64-le-v1',
});
const HEADER_BYTES = 16;

function bytesOf(value) {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

function hashBytes(bytes, hash = 2166136261) {
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function structureHash(structure) {
  let hash = hashBytes(new Uint8Array(structure.phase.buffer, structure.phase.byteOffset, structure.phase.byteLength));
  hash = hashBytes(new Uint8Array(structure.poreSize.buffer, structure.poreSize.byteOffset, structure.poreSize.byteLength), hash);
  return hash.toString(16).padStart(8, '0');
}

function canonicalParams(params) {
  return JSON.stringify(Object.fromEntries(Object.keys(params).sort().map(key => [key, params[key]])));
}

export function solverParamsHash(params) {
  const bytes = new TextEncoder().encode(canonicalParams(params));
  return hashBytes(bytes).toString(16).padStart(8, '0');
}

export function cacheManifest(structure, solverParams, { interval, maxFrames }) {
  return {
    version: CACHE_VERSION,
    grid: { L: structure.L, H: structure.H, W: structure.W, dx: structure.dx },
    structureHash: structureHash(structure),
    solverParams: JSON.parse(canonicalParams(solverParams)),
    solverParamsHash: solverParamsHash(solverParams),
    recordInterval: interval,
    maxFrames,
    concentrationEncoding: ENCODINGS.concentration,
    profileEncoding: ENCODINGS.profile,
    diagnosticsEncoding: ENCODINGS.diagnostics,
    frameBytes: frameByteLength(structure),
  };
}

export function frameByteLength(structure) {
  return HEADER_BYTES + structure.L * 2 * 4 + DIAGNOSTIC_FIELDS.length * 8 + structure.L * structure.H * structure.W;
}

export function encodeRecording(structure, frames) {
  const bytes = new Uint8Array(frames.length * frameByteLength(structure));
  const view = new DataView(bytes.buffer);
  const N = structure.L * structure.H * structure.W;
  const profileBytes = structure.L * 2 * 4;
  const concentrationOffset = HEADER_BYTES + profileBytes + DIAGNOSTIC_FIELDS.length * 8;
  frames.forEach((frame, index) => {
    const base = index * frameByteLength(structure);
    view.setUint32(base, frame.step, true);
    view.setFloat64(base + 4, frame.timeSeconds, true);
    const profile = new Float32Array(bytes.buffer, base + HEADER_BYTES, structure.L * 2);
    profile.set(frame.profile.pore, 0);
    profile.set(frame.profile.ionomer, structure.L);
    DIAGNOSTIC_FIELDS.forEach((field, offset) => view.setFloat64(base + HEADER_BYTES + profileBytes + offset * 8, frame.diagnostics[field], true));
    bytes.set(frame.concentration, base + concentrationOffset);
    if (frame.concentration.length !== N) throw new RangeError('Concentration frame size mismatch');
  });
  return bytes;
}

export function decodeRecording(structure, bytes, { count, interval = null, dt = null } = {}) {
  const frameBytes = frameByteLength(structure);
  if (bytes.byteLength !== count * frameBytes) throw new RangeError('Concentration cache byte length mismatch');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames = [];
  const N = structure.L * structure.H * structure.W;
  const profileBytes = structure.L * 2 * 4;
  const concentrationOffset = HEADER_BYTES + profileBytes + DIAGNOSTIC_FIELDS.length * 8;
  for (let index = 0; index < count; index += 1) {
    const base = index * frameBytes;
    const pore = new Float32Array(structure.L), ionomer = new Float32Array(structure.L);
    for (let x = 0; x < structure.L; x += 1) {
      pore[x] = view.getFloat32(base + HEADER_BYTES + x * 4, true);
      ionomer[x] = view.getFloat32(base + HEADER_BYTES + (structure.L + x) * 4, true);
    }
    const diagnostics = {};
    DIAGNOSTIC_FIELDS.forEach((field, offset) => { diagnostics[field] = view.getFloat64(base + HEADER_BYTES + profileBytes + offset * 8, true); });
    const step = view.getUint32(base, true);
    const timeSeconds = view.getFloat64(base + 4, true);
    if (interval !== null && (step !== (index + 1) * interval || (dt !== null && Math.abs(timeSeconds - step * dt) > Math.max(1e-20, Math.abs(step * dt) * 1e-12)))) throw new RangeError('Concentration cache frame sequence mismatch');
    frames.push({
      step,
      timeSeconds,
      concentration: new Uint8Array(bytes.buffer.slice(bytes.byteOffset + base + concentrationOffset, bytes.byteOffset + base + concentrationOffset + N)),
      profile: { pore, ionomer }, diagnostics,
    });
  }
  return frames;
}

export async function loadConcentrationCache(structure, solverParams, {
  baseUrl = './cache/concentration-v1', interval, maxFrames,
} = {}) {
  try {
    const manifestResponse = await fetch(`${baseUrl}.json`, { cache: 'force-cache' });
    if (!manifestResponse.ok) return null;
    const manifest = await manifestResponse.json();
    const expected = cacheManifest(structure, solverParams, { interval, maxFrames });
    const encodingKeys = ['concentrationEncoding', 'profileEncoding', 'diagnosticsEncoding'];
    for (const key of ['version', 'structureHash', 'solverParamsHash', 'recordInterval', 'maxFrames', 'frameBytes', ...encodingKeys]) {
      if (manifest[key] !== expected[key]) return null;
    }
    if (manifest.grid.L !== expected.grid.L || manifest.grid.H !== expected.grid.H || manifest.grid.W !== expected.grid.W || manifest.grid.dx !== expected.grid.dx) return null;
    const response = await fetch(`${baseUrl}.bin.gz`, { cache: 'force-cache' });
    if (!response.ok) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return decodeRecording(structure, bytes, { count: manifest.maxFrames, interval, dt: solverParams.dt });
  } catch {
    return null;
  }
}
