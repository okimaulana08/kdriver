/**
 * Multi-Species Anatomical Pet Auto-Rigger for Project K-DRIVER:
 * - `winged`  (pet_phoenix.glb)  -> 8-bone Avian rig (2-joint articulated flapping wings, head, tail, talons)
 * - `beast`   (pet_raiju.glb)    -> Auto-aligns +Z forward + 9-bone Quadruped rig (4 galloping legs, spine, chest, head, 2-bone whip tail)
 * - `serpent` (pet_leviathan.glb)-> 7-bone Coiled Asian Dragon rig (flowing head->neck->coil->tail chain + front claws)
 *
 * Uses strict region partitioning + 4-pass topology Laplacian smoothing + UV-seam welding so
 * every Pet bends smoothly at 60 FPS with zero mesh tearing or cross-limb webbing.
 *
 * Usage:
 *   node scripts/autorig-pets-glb.mjs --type winged|beast|serpent --in unpacked.glb --out rigged.glb
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function getArg(flag, fallback = null) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const PET_TYPE = getArg('--type');
const IN_PATH = getArg('--in');
const OUT_PATH = getArg('--out');

if (!PET_TYPE || !IN_PATH || !OUT_PATH) {
  console.error('Usage: node scripts/autorig-pets-glb.mjs --type winged|beast|serpent --in <in.glb> --out <out.glb>');
  process.exit(1);
}

const rawBuf = Buffer.from(fs.readFileSync(path.resolve(IN_PATH)));
if (rawBuf.subarray(0, 4).toString('ascii') !== 'glTF') {
  throw new Error(`Not a valid GLB: ${IN_PATH}`);
}

const jsonLen = rawBuf.readUInt32LE(12);
const gltf = JSON.parse(rawBuf.subarray(20, 20 + jsonLen).toString('utf8'));
const binHeaderOff = 20 + jsonLen;
const binChunkLen = rawBuf.readUInt32LE(binHeaderOff);
const binOff = binHeaderOff + 8;
// Clone BIN so we can safely update aligned positions/normals in-place for `beast`
const origBin = Buffer.from(rawBuf.subarray(binOff, binOff + binChunkLen));
const prim = gltf.meshes[0].primitives[0];

function readVec3Attribute(accIdx) {
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const stride = bv.byteStride || 12;
  const baseOff = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const dv = new DataView(origBin.buffer, origBin.byteOffset, origBin.byteLength);
  const out = new Float32Array(acc.count * 3);
  for (let i = 0; i < acc.count; i++) {
    const o = baseOff + i * stride;
    out[i * 3] = dv.getFloat32(o, true);
    out[i * 3 + 1] = dv.getFloat32(o + 4, true);
    out[i * 3 + 2] = dv.getFloat32(o + 8, true);
  }
  return out;
}

function writeVec3Attribute(accIdx, data) {
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const stride = bv.byteStride || 12;
  const baseOff = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const dv = new DataView(origBin.buffer, origBin.byteOffset, origBin.byteLength);
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < acc.count; i++) {
    const o = baseOff + i * stride;
    const x = data[i * 3];
    const y = data[i * 3 + 1];
    const z = data[i * 3 + 2];
    dv.setFloat32(o, x, true);
    dv.setFloat32(o + 4, y, true);
    dv.setFloat32(o + 8, z, true);
    if (x < mn[0]) mn[0] = x;
    if (y < mn[1]) mn[1] = y;
    if (z < mn[2]) mn[2] = z;
    if (x > mx[0]) mx[0] = x;
    if (y > mx[1]) mx[1] = y;
    if (z > mx[2]) mx[2] = z;
  }
  acc.min = mn;
  acc.max = mx;
}

function readIndices(accIdx) {
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  if (acc.componentType === 5125) {
    return new Uint32Array(origBin.buffer, origBin.byteOffset + byteOffset, acc.count);
  }
  if (acc.componentType === 5123) {
    return new Uint16Array(origBin.buffer, origBin.byteOffset + byteOffset, acc.count);
  }
  return new Uint8Array(origBin.buffer, origBin.byteOffset + byteOffset, acc.count);
}

const pos = readVec3Attribute(prim.attributes.POSITION);
const norm = prim.attributes.NORMAL !== undefined ? readVec3Attribute(prim.attributes.NORMAL) : null;
const indices = prim.indices !== undefined ? readIndices(prim.indices) : null;
const vertCount = pos.length / 3;

// For Quadruped Beast (Raiju), align its principal horizontal tail->head axis cleanly to +Z forward!
if (PET_TYPE === 'beast') {
  let frontX = 0,
    frontZ = 0,
    frontN = 0;
  let rearX = 0,
    rearZ = 0,
    rearN = 0;
  for (let i = 0; i < vertCount; i++) {
    const x = pos[i * 3];
    const z = pos[i * 3 + 2];
    if (z > 0.14) {
      frontX += x;
      frontZ += z;
      frontN++;
    } else if (z < -0.14) {
      rearX += x;
      rearZ += z;
      rearN++;
    }
  }
  const dx = frontX / Math.max(1, frontN) - rearX / Math.max(1, rearN);
  const dz = frontZ / Math.max(1, frontN) - rearZ / Math.max(1, rearN);
  const currentYaw = Math.atan2(dx, dz); // angle from +Z toward +X
  const fixYaw = -currentYaw; // rotate back so head points exact +Z!
  const c = Math.cos(fixYaw);
  const s = Math.sin(fixYaw);
  for (let i = 0; i < vertCount; i++) {
    const x = pos[i * 3];
    const z = pos[i * 3 + 2];
    pos[i * 3] = x * c + z * s;
    pos[i * 3 + 2] = -x * s + z * c;
    if (norm) {
      const nx = norm[i * 3];
      const nz = norm[i * 3 + 2];
      norm[i * 3] = nx * c + nz * s;
      norm[i * 3 + 2] = -nx * s + nz * c;
    }
  }
  writeVec3Attribute(prim.attributes.POSITION, pos);
  if (norm) writeVec3Attribute(prim.attributes.NORMAL, norm);
  console.log(`[AUTORIG-PET] beast: aligned principal axis by ${(fixYaw * 180 / Math.PI).toFixed(1)} deg to +Z forward.`);
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

let JOINTS = [];
let wMatrix;
const lockedRigidMask = new Uint8Array(vertCount);

if (PET_TYPE === 'winged') {
  // 8-Bone Avian Skeleton (Phoenix / Aero / Lunar)
  JOINTS = [
    { name: 'PetBody', parent: -1, pos: [0, 0.02, 0.06] },
    { name: 'PetHead', parent: 0, pos: [0, 0.16, 0.08] },
    { name: 'PetTail', parent: 0, pos: [0, -0.14, -0.04] },
    { name: 'PetTalons', parent: 0, pos: [0, -0.15, 0.07] },
    { name: 'WingL_Inner', parent: 0, pos: [0.1, 0.08, 0.04] },
    { name: 'WingL_Outer', parent: 4, pos: [0.25, 0.14, -0.01] },
    { name: 'WingR_Inner', parent: 0, pos: [-0.1, 0.08, 0.04] },
    { name: 'WingR_Outer', parent: 6, pos: [-0.25, 0.14, -0.01] },
  ];
  const J = Object.fromEntries(JOINTS.map((j, idx) => [j.name, idx]));
  wMatrix = new Float32Array(vertCount * JOINTS.length);

  for (let i = 0; i < vertCount; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const ax = Math.abs(x);
    const base = i * JOINTS.length;

    // Articulated Wings (clearly outside central chest |x| > 0.105 and upper wing plane y > -0.09)
    if (ax > 0.105 && y > -0.09) {
      const isLeft = x >= 0;
      const jIn = isLeft ? J.WingL_Inner : J.WingR_Inner;
      const jOut = isLeft ? J.WingL_Outer : J.WingR_Outer;
      const rootBlend = smoothstep(0.095, 0.165, ax);
      const outerBlend = smoothstep(0.21, 0.31, ax);
      const bodyW = 1 - rootBlend;
      const inW = rootBlend * (1 - outerBlend);
      const outW = rootBlend * outerBlend;
      wMatrix[base + J.PetBody] = bodyW;
      wMatrix[base + jIn] = inW;
      wMatrix[base + jOut] = outW;
      continue;
    }

    // Head & Crown Crest
    if (y > 0.15) {
      const h = smoothstep(0.14, 0.2, y);
      wMatrix[base + J.PetBody] = 1 - h;
      wMatrix[base + J.PetHead] = h;
      if (h >= 0.98) lockedRigidMask[i] = 1;
      continue;
    }

    // Lower body: Rear Tail Feathers vs Front Talons
    if (y < -0.11) {
      const lower = smoothstep(-0.09, -0.18, y);
      const isTail = z < 0.025;
      const jLow = isTail ? J.PetTail : J.PetTalons;
      wMatrix[base + J.PetBody] = 1 - lower;
      wMatrix[base + jLow] = lower;
      continue;
    }

    wMatrix[base + J.PetBody] = 1.0;
  }
} else if (PET_TYPE === 'beast') {
  // 9-Bone Quadruped Beast Skeleton (Raiju / Terra / Solar / Lux)
  JOINTS = [
    { name: 'PetBody', parent: -1, pos: [0, 0.05, 0.0] },
    { name: 'PetChest', parent: 0, pos: [0, 0.07, 0.15] },
    { name: 'PetHead', parent: 1, pos: [0, 0.1, 0.28] },
    { name: 'PetTailBase', parent: 0, pos: [0, 0.06, -0.18] },
    { name: 'PetTailTip', parent: 3, pos: [0, 0.15, -0.35] },
    { name: 'FrontLegL', parent: 1, pos: [0.1, 0.0, 0.2] },
    { name: 'FrontLegR', parent: 1, pos: [-0.1, 0.0, 0.2] },
    { name: 'BackLegL', parent: 0, pos: [0.1, -0.01, -0.14] },
    { name: 'BackLegR', parent: 0, pos: [-0.1, -0.01, -0.14] },
  ];
  const J = Object.fromEntries(JOINTS.map((j, idx) => [j.name, idx]));
  wMatrix = new Float32Array(vertCount * JOINTS.length);

  for (let i = 0; i < vertCount; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const base = i * JOINTS.length;

    // 2-bone Whip Tail behind rear hips
    if (z < -0.22 && y > -0.03) {
      const tBase = smoothstep(-0.2, -0.28, z);
      const tTip = smoothstep(-0.31, -0.42, z);
      wMatrix[base + J.PetBody] = 1 - tBase;
      wMatrix[base + J.PetTailBase] = tBase * (1 - tTip);
      wMatrix[base + J.PetTailTip] = tBase * tTip;
      continue;
    }

    // 4 Articulated Legs (strictly partitioned Front/Back and Left/Right!)
    if (y < 0.01) {
      const legDepth = smoothstep(0.02, -0.07, y);
      const isFront = z >= 0.02;
      const isLeft = x >= 0;
      const jParent = isFront ? J.PetChest : J.PetBody;
      const jLeg = isFront
        ? isLeft
          ? J.FrontLegL
          : J.FrontLegR
        : isLeft
          ? J.BackLegL
          : J.BackLegR;
      wMatrix[base + jParent] = 1 - legDepth;
      wMatrix[base + jLeg] = legDepth;
      continue;
    }

    // Head + Golden Mane (rigid at snout/mane tips!)
    if (z > 0.22) {
      const h = smoothstep(0.2, 0.29, z);
      wMatrix[base + J.PetChest] = 1 - h;
      wMatrix[base + J.PetHead] = h;
      if (h >= 0.98) lockedRigidMask[i] = 1;
      continue;
    }

    // Spine -> Chest blend
    const chestT = smoothstep(-0.02, 0.14, z);
    wMatrix[base + J.PetBody] = 1 - chestT;
    wMatrix[base + J.PetChest] = chestT;
  }
} else if (PET_TYPE === 'serpent') {
  // 7-Bone Coiled Asian Dragon Skeleton (Leviathan / Flora / Umbra)
  JOINTS = [
    { name: 'PetBody', parent: -1, pos: [0, -0.02, 0.0] },
    { name: 'DragonNeck', parent: 0, pos: [0, 0.14, 0.09] },
    { name: 'PetHead', parent: 1, pos: [0, 0.28, 0.15] },
    { name: 'DragonLowerCoil', parent: 0, pos: [0.06, -0.22, -0.08] },
    { name: 'DragonTailMid', parent: 3, pos: [0.18, -0.34, -0.18] },
    { name: 'PetTailTip', parent: 4, pos: [0.34, -0.22, -0.18] },
    { name: 'DragonClaws', parent: 0, pos: [-0.22, -0.06, 0.1] },
  ];
  const J = Object.fromEntries(JOINTS.map((j, idx) => [j.name, idx]));
  wMatrix = new Float32Array(vertCount * JOINTS.length);

  for (let i = 0; i < vertCount; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const base = i * JOINTS.length;

    // Horned Dragon Head & Whiskers (top-front)
    if (y > 0.2) {
      const h = smoothstep(0.18, 0.27, y);
      wMatrix[base + J.DragonNeck] = 1 - h;
      wMatrix[base + J.PetHead] = h;
      if (h >= 0.98) lockedRigidMask[i] = 1;
      continue;
    }

    // Raking Front Claws protruding toward -X / +Z
    if (x < -0.18 && y > -0.22 && y < 0.12 && z > -0.02) {
      const claw = smoothstep(-0.16, -0.28, x);
      wMatrix[base + J.PetBody] = 1 - claw;
      wMatrix[base + J.DragonClaws] = claw;
      continue;
    }

    // Sweeping Rear Dragon Tail Tip (+X > 0.22 and lower/back)
    if (x > 0.22 && y < 0.02 && z < 0.0) {
      const tip = smoothstep(0.2, 0.34, x);
      wMatrix[base + J.DragonTailMid] = 1 - tip;
      wMatrix[base + J.PetTailTip] = tip;
      continue;
    }

    // Flowing vertical spine chain: TailMid -> LowerCoil -> PetBody -> DragonNeck
    if (y < -0.28) {
      const t = smoothstep(-0.26, -0.38, y);
      wMatrix[base + J.DragonLowerCoil] = 1 - t;
      wMatrix[base + J.DragonTailMid] = t;
    } else if (y < -0.08) {
      const t = smoothstep(-0.08, -0.24, y);
      wMatrix[base + J.PetBody] = 1 - t;
      wMatrix[base + J.DragonLowerCoil] = t;
    } else if (y > 0.06) {
      const t = smoothstep(0.05, 0.17, y);
      wMatrix[base + J.PetBody] = 1 - t;
      wMatrix[base + J.DragonNeck] = t;
    } else {
      wMatrix[base + J.PetBody] = 1.0;
    }
  }
} else {
  throw new Error(`Unknown pet type: ${PET_TYPE}`);
}

const numJoints = JOINTS.length;

// Topology-aware Laplacian weight smoothing + UV-seam welding (4 passes)
if (indices) {
  const neighbors = Array.from({ length: vertCount }, () => []);
  const addEdge = (a, b) => {
    if (!neighbors[a].includes(b)) neighbors[a].push(b);
    if (!neighbors[b].includes(a)) neighbors[b].push(a);
  };
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }

  const seamBuckets = new Map();
  for (let i = 0; i < vertCount; i++) {
    const key = `${Math.round(pos[i * 3] * 2000)},${Math.round(pos[i * 3 + 1] * 2000)},${Math.round(pos[i * 3 + 2] * 2000)}`;
    let list = seamBuckets.get(key);
    if (!list) {
      list = [];
      seamBuckets.set(key, list);
    }
    list.push(i);
  }
  const seamGroups = [];
  for (const list of seamBuckets.values()) {
    if (list.length > 1) seamGroups.push(list);
  }

  let nextW = new Float32Array(vertCount * numJoints);
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < vertCount; i++) {
      const base = i * numJoints;
      if (lockedRigidMask[i]) {
        for (let j = 0; j < numJoints; j++) nextW[base + j] = wMatrix[base + j];
        continue;
      }
      const nbrs = neighbors[i];
      if (!nbrs.length) {
        for (let j = 0; j < numJoints; j++) nextW[base + j] = wMatrix[base + j];
        continue;
      }
      const invN = 1 / nbrs.length;
      for (let j = 0; j < numJoints; j++) {
        let sum = 0;
        for (let k = 0; k < nbrs.length; k++) sum += wMatrix[nbrs[k] * numJoints + j];
        nextW[base + j] = wMatrix[base + j] * 0.56 + sum * invN * 0.44;
      }
    }
    for (let g = 0; g < seamGroups.length; g++) {
      const list = seamGroups[g];
      const invL = 1 / list.length;
      for (let j = 0; j < numJoints; j++) {
        let avg = 0;
        for (let k = 0; k < list.length; k++) avg += nextW[list[k] * numJoints + j];
        avg *= invL;
        for (let k = 0; k < list.length; k++) nextW[list[k] * numJoints + j] = avg;
      }
    }
    const tmp = wMatrix;
    wMatrix = nextW;
    nextW = tmp;
  }
}

// Pack top-4 weights per vertex
const jointsOut = new Uint16Array(vertCount * 4);
const weightsOut = new Float32Array(vertCount * 4);
for (let i = 0; i < vertCount; i++) {
  const base = i * numJoints;
  const topJ = [0, 0, 0, 0];
  const topW = [0, 0, 0, 0];
  for (let j = 0; j < numJoints; j++) {
    const w = wMatrix[base + j];
    if (w <= 1e-5) continue;
    let slot = -1;
    let minV = w;
    for (let s = 0; s < 4; s++) {
      if (topW[s] < minV) {
        minV = topW[s];
        slot = s;
      }
    }
    if (slot >= 0) {
      topW[slot] = w;
      topJ[slot] = j;
    }
  }
  let sum = topW[0] + topW[1] + topW[2] + topW[3];
  if (sum <= 1e-6) {
    topJ[0] = 0;
    topW[0] = 1.0;
    sum = 1.0;
  }
  const o = i * 4;
  for (let s = 0; s < 4; s++) {
    jointsOut[o + s] = topJ[s];
    weightsOut[o + s] = topW[s] / sum;
  }
}

// Inverse bind matrices
const ibmOut = new Float32Array(numJoints * 16);
for (let j = 0; j < numJoints; j++) {
  const [jx, jy, jz] = JOINTS[j].pos;
  const o = j * 16;
  ibmOut[o + 0] = 1;
  ibmOut[o + 5] = 1;
  ibmOut[o + 10] = 1;
  ibmOut[o + 15] = 1;
  ibmOut[o + 12] = -jx;
  ibmOut[o + 13] = -jy;
  ibmOut[o + 14] = -jz;
}

function pad4(n) {
  return (n + 3) & ~3;
}
const chunks = [origBin];
let curByteLen = origBin.length;
function appendBuffer(typedArray, target) {
  const padBytes = pad4(curByteLen) - curByteLen;
  if (padBytes > 0) {
    chunks.push(Buffer.alloc(padBytes));
    curByteLen += padBytes;
  }
  const byteOffset = curByteLen;
  const viewBuf = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  chunks.push(viewBuf);
  curByteLen += viewBuf.length;
  const bvIdx = gltf.bufferViews.length;
  const bv = { buffer: 0, byteOffset, byteLength: viewBuf.length };
  if (target) bv.target = target;
  gltf.bufferViews.push(bv);
  return bvIdx;
}

const jointsBv = appendBuffer(jointsOut, 34962);
const weightsBv = appendBuffer(weightsOut, 34962);
const ibmBv = appendBuffer(ibmOut, undefined);

const jointsAccIdx = gltf.accessors.length;
gltf.accessors.push({ bufferView: jointsBv, componentType: 5123, count: vertCount, type: 'VEC4' });
const weightsAccIdx = gltf.accessors.length;
gltf.accessors.push({ bufferView: weightsBv, componentType: 5126, count: vertCount, type: 'VEC4' });
const ibmAccIdx = gltf.accessors.length;
gltf.accessors.push({ bufferView: ibmBv, componentType: 5126, count: numJoints, type: 'MAT4' });

prim.attributes.JOINTS_0 = jointsAccIdx;
prim.attributes.WEIGHTS_0 = weightsAccIdx;

const meshNode = { name: `PetSkinned_${PET_TYPE}`, mesh: 0, skin: 0 };
const armatureNodeIdx = 1;
const jointBaseNodeIdx = 2;

const jointNodes = JOINTS.map((j, idx) => {
  const parentPos = j.parent >= 0 ? JOINTS[j.parent].pos : [0, 0, 0];
  const node = {
    name: j.name,
    translation: [j.pos[0] - parentPos[0], j.pos[1] - parentPos[1], j.pos[2] - parentPos[2]],
    rotation: [0, 0, 0, 1],
  };
  const children = [];
  for (let c = 0; c < JOINTS.length; c++) {
    if (JOINTS[c].parent === idx) children.push(jointBaseNodeIdx + c);
  }
  if (children.length > 0) node.children = children;
  return node;
});

gltf.nodes = [meshNode, { name: 'PetArmature', children: [jointBaseNodeIdx] }, ...jointNodes];
gltf.skins = [
  {
    name: `PetSkin_${PET_TYPE}`,
    inverseBindMatrices: ibmAccIdx,
    skeleton: jointBaseNodeIdx,
    joints: JOINTS.map((_, idx) => jointBaseNodeIdx + idx),
  },
];
gltf.scenes = [{ name: 'Scene', nodes: [0, armatureNodeIdx] }];
gltf.scene = 0;

const binPad = pad4(curByteLen) - curByteLen;
if (binPad > 0) {
  chunks.push(Buffer.alloc(binPad));
  curByteLen += binPad;
}
gltf.buffers[0].byteLength = curByteLen;

const jsonBufRaw = Buffer.from(JSON.stringify(gltf), 'utf8');
const jsonPad = pad4(jsonBufRaw.length) - jsonBufRaw.length;
const jsonBuf = jsonPad > 0 ? Buffer.concat([jsonBufRaw, Buffer.alloc(jsonPad, 0x20)]) : jsonBufRaw;
const binBuf = Buffer.concat(chunks);

const totalLength = 12 + 8 + jsonBuf.length + 8 + binBuf.length;
const outHeader = Buffer.alloc(12);
outHeader.write('glTF', 0, 'ascii');
outHeader.writeUInt32LE(2, 4);
outHeader.writeUInt32LE(totalLength, 8);
const jsonChunkHdr = Buffer.alloc(8);
jsonChunkHdr.writeUInt32LE(jsonBuf.length, 0);
jsonChunkHdr.writeUInt32LE(0x4e4f534a, 4);
const binChunkHdr = Buffer.alloc(8);
binChunkHdr.writeUInt32LE(binBuf.length, 0);
binChunkHdr.writeUInt32LE(0x004e4942, 4);

fs.writeFileSync(path.resolve(OUT_PATH), Buffer.concat([outHeader, jsonChunkHdr, jsonBuf, binChunkHdr, binBuf]));
console.log(`[AUTORIG-PET] ${PET_TYPE}: ${path.basename(IN_PATH)} -> ${path.basename(OUT_PATH)} | verts=${vertCount}, joints=${numJoints}`);
