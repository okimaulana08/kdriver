/**
 * Character-Space Skeletal Mocap Retargeter for Project K-DRIVER.
 *
 * Transfers all real 30fps Meshy mocap clips (Idle_5, Running, Walking, Roll_Dodge,
 * Thrust_Slash, Punch_Combo, Dead) from a source rigged Rider GLB (`rider_super.glb`)
 * onto any 20-bone auto-rigged humanoid Rider GLB (`rider_unit2.glb`, `rider_unit2_upgraded.glb`)
 * while preserving existing Draco mesh compression & WebP textures untouched!
 *
 * Uses exact bind-pose limb direction alignment (T-pose <-> A-pose swing correction)
 * so arms never clip into the ribcage and silhouettes match live-action suit-actor motion.
 *
 * Usage:
 *   node scripts/retarget-rider-mocap.mjs --src public/assets/models/custom/rider_super.glb --target public/assets/models/custom/rider_unit2.glb
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';

const args = process.argv.slice(2);
function getArg(flag, fallback = null) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const SRC_PATH = getArg('--src', 'public/assets/models/custom/rider_super.glb');
const TARGET_PATH = getArg('--target');
const OUT_PATH = getArg('--out', TARGET_PATH);

if (!TARGET_PATH) {
  console.error('Usage: node scripts/retarget-rider-mocap.mjs --src <source.glb> --target <target.glb> [--out <out.glb>]');
  process.exit(1);
}

function parseGlb(filePath) {
  const raw = Buffer.from(fs.readFileSync(path.resolve(filePath)));
  if (raw.subarray(0, 4).toString('ascii') !== 'glTF') {
    throw new Error(`Invalid GLB header: ${filePath}`);
  }
  const jsonLen = raw.readUInt32LE(12);
  const gltf = JSON.parse(raw.subarray(20, 20 + jsonLen).toString('utf8'));
  const binHeaderOff = 20 + jsonLen;
  const binChunkLen = raw.readUInt32LE(binHeaderOff);
  const binOff = binHeaderOff + 8;
  const bin = raw.subarray(binOff, binOff + binChunkLen);
  return { gltf, bin };
}

function readAccessor(gltf, bin, accIdx) {
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type];
  const elemSize = acc.componentType === 5126 ? 4 : acc.componentType === 5123 ? 2 : 1;
  const stride = bv.byteStride || comps * elemSize;
  const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const out = new Float32Array(acc.count * comps);
  for (let i = 0; i < acc.count; i++) {
    const o = base + i * stride;
    for (let c = 0; c < comps; c++) {
      if (acc.componentType === 5126) {
        out[i * comps + c] = dv.getFloat32(o + c * 4, true);
      } else if (acc.componentType === 5123) {
        out[i * comps + c] = dv.getUint16(o + c * 2, true);
      } else {
        out[i * comps + c] = dv.getUint8(o + c);
      }
    }
  }
  return out;
}

function buildHierarchy(gltf) {
  const n = gltf.nodes.length;
  const parentOf = new Int32Array(n).fill(-1);
  const nameToIdx = new Map();
  for (let i = 0; i < n; i++) {
    const node = gltf.nodes[i];
    if (node.name && !nameToIdx.has(node.name)) {
      nameToIdx.set(node.name, i);
    }
    if (node.children) {
      for (const ch of node.children) {
        parentOf[ch] = i;
      }
    }
  }
  const restPos = [];
  const restQuat = [];
  const restScale = [];
  for (let i = 0; i < n; i++) {
    const node = gltf.nodes[i];
    restPos.push(
      node.translation
        ? new THREE.Vector3(node.translation[0], node.translation[1], node.translation[2])
        : new THREE.Vector3(0, 0, 0)
    );
    restQuat.push(
      node.rotation
        ? new THREE.Quaternion(node.rotation[0], node.rotation[1], node.rotation[2], node.rotation[3]).normalize()
        : new THREE.Quaternion(0, 0, 0, 1)
    );
    restScale.push(
      node.scale
        ? new THREE.Vector3(node.scale[0], node.scale[1], node.scale[2])
        : new THREE.Vector3(1, 1, 1)
    );
  }

  // Topological order (parents always before children)
  const topo = [];
  const visited = new Uint8Array(n);
  function visit(i) {
    if (visited[i]) return;
    if (parentOf[i] >= 0) visit(parentOf[i]);
    visited[i] = 1;
    topo.push(i);
  }
  for (let i = 0; i < n; i++) visit(i);

  function computeWorld(localPos, localQuat, localScale) {
    const worldPos = Array.from({ length: n }, () => new THREE.Vector3());
    const worldQuat = Array.from({ length: n }, () => new THREE.Quaternion());
    const worldScale = Array.from({ length: n }, () => new THREE.Vector3(1, 1, 1));
    const tmp = new THREE.Vector3();
    for (const i of topo) {
      const p = parentOf[i];
      if (p < 0) {
        worldPos[i].copy(localPos[i]);
        worldQuat[i].copy(localQuat[i]);
        worldScale[i].copy(localScale[i]);
      } else {
        worldScale[i].copy(worldScale[p]).multiply(localScale[i]);
        worldQuat[i].copy(worldQuat[p]).multiply(localQuat[i]).normalize();
        tmp.copy(localPos[i]).multiply(worldScale[p]).applyQuaternion(worldQuat[p]);
        worldPos[i].copy(worldPos[p]).add(tmp);
      }
    }
    return { worldPos, worldQuat, worldScale };
  }

  const restWorld = computeWorld(restPos, restQuat, restScale);
  return { parentOf, nameToIdx, restPos, restQuat, restScale, topo, computeWorld, restWorld };
}

// Target (Mixamo/AutoHumanoidSkin) -> Source (Meshy rider_super.glb) bone map
const BONE_PAIRS = [
  ['Hips', 'Hips'],
  ['Spine', 'Spine02'],
  ['Spine1', 'Spine01'],
  ['Spine2', 'Spine'],
  ['Neck', 'neck'],
  ['Head', 'Head'],
  ['LeftShoulder', 'LeftShoulder'],
  ['LeftArm', 'LeftArm'],
  ['LeftForeArm', 'LeftForeArm'],
  ['LeftHand', 'LeftHand'],
  ['RightShoulder', 'RightShoulder'],
  ['RightArm', 'RightArm'],
  ['RightForeArm', 'RightForeArm'],
  ['RightHand', 'RightHand'],
  ['LeftUpLeg', 'LeftUpLeg'],
  ['LeftLeg', 'LeftLeg'],
  ['LeftFoot', 'LeftFoot'],
  ['RightUpLeg', 'RightUpLeg'],
  ['RightLeg', 'RightLeg'],
  ['RightFoot', 'RightFoot'],
];

// Primary anatomical limb segments used to align source T-pose/wide A-pose -> target A-pose cleanly
const LIMB_DIR_CHILD = {
  LeftArm: 'LeftForeArm',
  LeftForeArm: 'LeftHand',
  RightArm: 'RightForeArm',
  RightForeArm: 'RightHand',
  LeftUpLeg: 'LeftLeg',
  LeftLeg: 'LeftFoot',
  RightUpLeg: 'RightLeg',
  RightLeg: 'RightFoot',
};

const INHERIT_BIND_CORRECTION = {
  LeftHand: 'LeftForeArm',
  RightHand: 'RightForeArm',
  LeftFoot: 'LeftLeg',
  RightFoot: 'RightLeg',
};

const src = parseGlb(SRC_PATH);
const tgt = parseGlb(TARGET_PATH);

const srcHier = buildHierarchy(src.gltf);
const tgtHier = buildHierarchy(tgt.gltf);

// Verify all 20 mapped bones exist on both skeletons
const boneIndices = [];
for (const [tgtName, srcName] of BONE_PAIRS) {
  const tIdx = tgtHier.nameToIdx.get(tgtName);
  const sIdx = srcHier.nameToIdx.get(srcName);
  if (tIdx === undefined || sIdx === undefined) {
    throw new Error(`Missing mapped bone: target=${tgtName}(${tIdx}) source=${srcName}(${sIdx})`);
  }
  boneIndices.push({ tgtName, srcName, tIdx, sIdx });
}
const tgtNameToPair = new Map(boneIndices.map((p) => [p.tgtName, p]));

// Compute per-bone character-space T-pose -> A-pose alignment inverse C_inv[tgtName]
// C rotates source rest limb direction -> target rest limb direction; C_inv lifts target rest limb -> source rest limb!
const cInvByName = new Map();
for (const pair of boneIndices) {
  const childName = LIMB_DIR_CHILD[pair.tgtName];
  if (childName) {
    const childPair = tgtNameToPair.get(childName);
    const vS = srcHier.restWorld.worldPos[childPair.sIdx]
      .clone()
      .sub(srcHier.restWorld.worldPos[pair.sIdx])
      .normalize();
    const vT = tgtHier.restWorld.worldPos[childPair.tIdx]
      .clone()
      .sub(tgtHier.restWorld.worldPos[pair.tIdx])
      .normalize();
    const cQuat = new THREE.Quaternion().setFromUnitVectors(vS, vT);
    cInvByName.set(pair.tgtName, cQuat.clone().invert());
  } else {
    cInvByName.set(pair.tgtName, new THREE.Quaternion());
  }
}
for (const [leaf, parentSeg] of Object.entries(INHERIT_BIND_CORRECTION)) {
  cInvByName.set(leaf, cInvByName.get(parentSeg).clone());
}

// Compute exact leg-height scale ratio (Hips.y - LeftFoot.y) so Hips bounce/crouch/fall matches target rig proportions!
const srcHipsIdx = tgtNameToPair.get('Hips').sIdx;
const tgtHipsIdx = tgtNameToPair.get('Hips').tIdx;
const srcFootIdx = tgtNameToPair.get('LeftFoot').sIdx;
const tgtFootIdx = tgtNameToPair.get('LeftFoot').tIdx;

const srcLegHeight = Math.max(
  0.05,
  srcHier.restWorld.worldPos[srcHipsIdx].y - srcHier.restWorld.worldPos[srcFootIdx].y
);
const tgtLegHeight = Math.max(
  0.05,
  tgtHier.restWorld.worldPos[tgtHipsIdx].y - tgtHier.restWorld.worldPos[tgtFootIdx].y
);
const hipsScaleRatio = tgtLegHeight / srcLegHeight;

console.log(
  `[RETARGET] ${path.basename(SRC_PATH)} -> ${path.basename(TARGET_PATH)} | srcLegH=${srcLegHeight.toFixed(4)} tgtLegH=${tgtLegHeight.toFixed(4)} ratio=${hipsScaleRatio.toFixed(4)}`
);

function sampleVec3(times, values, t, out) {
  const count = times.length;
  if (count === 0) return out;
  if (t <= times[0] || count === 1) {
    return out.set(values[0], values[1], values[2]);
  }
  if (t >= times[count - 1]) {
    const o = (count - 1) * 3;
    return out.set(values[o], values[o + 1], values[o + 2]);
  }
  let lo = 0;
  let hi = count - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const span = Math.max(1e-6, times[hi] - times[lo]);
  const a = (t - times[lo]) / span;
  const o0 = lo * 3;
  const o1 = hi * 3;
  return out.set(
    values[o0] + (values[o1] - values[o0]) * a,
    values[o0 + 1] + (values[o1 + 1] - values[o0 + 1]) * a,
    values[o0 + 2] + (values[o1 + 2] - values[o0 + 2]) * a
  );
}

const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
function sampleQuat(times, values, t, out) {
  const count = times.length;
  if (count === 0) return out;
  if (t <= times[0] || count === 1) {
    return out.set(values[0], values[1], values[2], values[3]).normalize();
  }
  if (t >= times[count - 1]) {
    const o = (count - 1) * 4;
    return out.set(values[o], values[o + 1], values[o + 2], values[o + 3]).normalize();
  }
  let lo = 0;
  let hi = count - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const span = Math.max(1e-6, times[hi] - times[lo]);
  const a = (t - times[lo]) / span;
  const o0 = lo * 4;
  const o1 = hi * 4;
  _q0.set(values[o0], values[o0 + 1], values[o0 + 2], values[o0 + 3]).normalize();
  _q1.set(values[o1], values[o1 + 1], values[o1 + 2], values[o1 + 3]).normalize();
  return out.copy(_q0).slerp(_q1, a).normalize();
}

// Retarget every animation clip from source!
const retargetedClips = [];
const srcRestWorldQuatInv = srcHier.restWorld.worldQuat.map((q) => q.clone().invert());

for (const anim of src.gltf.animations || []) {
  // Decode all source channels
  const rotChannels = new Map();
  const posChannels = new Map();
  let primaryTimes = null;

  for (const ch of anim.channels || []) {
    const nodeIdx = ch.target.node;
    const sampler = anim.samplers[ch.sampler];
    const times = readAccessor(src.gltf, src.bin, sampler.input);
    const vals = readAccessor(src.gltf, src.bin, sampler.output);
    if (!primaryTimes || times.length > primaryTimes.length) {
      primaryTimes = times;
    }
    if (ch.target.path === 'rotation') {
      rotChannels.set(nodeIdx, { times, vals });
    } else if (ch.target.path === 'translation') {
      posChannels.set(nodeIdx, { times, vals });
    }
  }

  if (!primaryTimes || primaryTimes.length < 2) continue;
  const frameCount = primaryTimes.length;
  const timesOut = new Float32Array(primaryTimes);

  const rotOutByTgtIdx = new Map();
  for (const pair of boneIndices) {
    rotOutByTgtIdx.set(pair.tIdx, new Float32Array(frameCount * 4));
  }
  const hipsPosOut = new Float32Array(frameCount * 3);

  const isInPlaceMoveOrAttack = /run|walk|roll|dodge|thrust|slash|attack|punch|combo|idle/i.test(anim.name);
  const srcHipsRestWorld = srcHier.restWorld.worldPos[srcHipsIdx];
  const tgtHipsRestLocal = tgtHier.restPos[tgtHipsIdx];
  let firstFrameHipsX = 0;
  let firstFrameHipsZ = 0;

  // Reuse frame work arrays
  const srcLocalPos = srcHier.restPos.map((v) => v.clone());
  const srcLocalQuat = srcHier.restQuat.map((q) => q.clone());
  const tgtWorldQuat = tgtHier.restWorld.worldQuat.map((q) => q.clone());
  const prevLocalQuatByTgtIdx = new Map();
  const deltaS = new THREE.Quaternion();
  const desiredTgtWorld = new THREE.Quaternion();
  const localTgtQuat = new THREE.Quaternion();
  const parentInv = new THREE.Quaternion();

  // Order mapped target bones top-down so parent world rotation is always fresh
  const orderedPairs = [...boneIndices].sort(
    (a, b) => tgtHier.topo.indexOf(a.tIdx) - tgtHier.topo.indexOf(b.tIdx)
  );

  for (let f = 0; f < frameCount; f++) {
    const t = timesOut[f];

    // 1. Evaluate source local pose at timestamp t
    for (let i = 0; i < src.gltf.nodes.length; i++) {
      const pc = posChannels.get(i);
      if (pc) sampleVec3(pc.times, pc.vals, t, srcLocalPos[i]);
      else srcLocalPos[i].copy(srcHier.restPos[i]);

      const rc = rotChannels.get(i);
      if (rc) sampleQuat(rc.times, rc.vals, t, srcLocalQuat[i]);
      else srcLocalQuat[i].copy(srcHier.restQuat[i]);
    }
    const srcWorld = srcHier.computeWorld(srcLocalPos, srcLocalQuat, srcHier.restScale);

    // 2. Retarget Hips translation cleanly scaled to target rig height
    const srcHipsNow = srcWorld.worldPos[srcHipsIdx];
    const dX = srcHipsNow.x - srcHipsRestWorld.x;
    const dY = srcHipsNow.y - srcHipsRestWorld.y;
    const dZ = srcHipsNow.z - srcHipsRestWorld.z;
    if (f === 0) {
      firstFrameHipsX = dX;
      firstFrameHipsZ = dZ;
    }

    const outHipsX = isInPlaceMoveOrAttack
      ? tgtHipsRestLocal.x
      : tgtHipsRestLocal.x + (dX - firstFrameHipsX) * hipsScaleRatio;
    const outHipsY = tgtHipsRestLocal.y + dY * hipsScaleRatio;
    const outHipsZ = isInPlaceMoveOrAttack
      ? tgtHipsRestLocal.z
      : tgtHipsRestLocal.z + (dZ - firstFrameHipsZ) * hipsScaleRatio;

    hipsPosOut[f * 3] = outHipsX;
    hipsPosOut[f * 3 + 1] = outHipsY;
    hipsPosOut[f * 3 + 2] = outHipsZ;

    // 3. Retarget all 20 bone rotations top-down using exact bind-pose alignment C_inv!
    for (const pair of orderedPairs) {
      const sWorldQ = srcWorld.worldQuat[pair.sIdx];
      deltaS.copy(sWorldQ).multiply(srcRestWorldQuatInv[pair.sIdx]).normalize();
      const cInv = cInvByName.get(pair.tgtName);
      desiredTgtWorld
        .copy(deltaS)
        .multiply(cInv)
        .multiply(tgtHier.restWorld.worldQuat[pair.tIdx])
        .normalize();

      tgtWorldQuat[pair.tIdx].copy(desiredTgtWorld);

      const pIdx = tgtHier.parentOf[pair.tIdx];
      if (pIdx >= 0) {
        parentInv.copy(tgtWorldQuat[pIdx]).invert();
        localTgtQuat.copy(parentInv).multiply(desiredTgtWorld).normalize();
      } else {
        localTgtQuat.copy(desiredTgtWorld);
      }

      // Hemisphere sign continuity for smooth GPU/Three.js slerp interpolation
      const prevQ = prevLocalQuatByTgtIdx.get(pair.tIdx);
      if (prevQ && prevQ.dot(localTgtQuat) < 0) {
        localTgtQuat.set(-localTgtQuat.x, -localTgtQuat.y, -localTgtQuat.z, -localTgtQuat.w);
      }
      if (!prevQ) prevLocalQuatByTgtIdx.set(pair.tIdx, localTgtQuat.clone());
      else prevQ.copy(localTgtQuat);

      const arr = rotOutByTgtIdx.get(pair.tIdx);
      arr[f * 4] = localTgtQuat.x;
      arr[f * 4 + 1] = localTgtQuat.y;
      arr[f * 4 + 2] = localTgtQuat.z;
      arr[f * 4 + 3] = localTgtQuat.w;
    }
  }

  retargetedClips.push({
    name: anim.name,
    timesOut,
    hipsPosOut,
    rotOutByTgtIdx,
  });
  console.log(
    `  + Retargeted "${anim.name}" (${frameCount} frames, ${timesOut[frameCount - 1].toFixed(2)}s)`
  );
}

// Append animation buffers cleanly onto target GLB (preserves Draco mesh & WebP textures untouched!)
function pad4(n) {
  return (n + 3) & ~3;
}

const chunks = [tgt.bin];
let curByteLen = tgt.bin.length;

function appendFloatAccessor(typedArray, type, computeMinMax = false) {
  const padBytes = pad4(curByteLen) - curByteLen;
  if (padBytes > 0) {
    chunks.push(Buffer.alloc(padBytes));
    curByteLen += padBytes;
  }
  const byteOffset = curByteLen;
  const viewBuf = Buffer.from(typedArray.buffer, typedArray.byteOffset, typedArray.byteLength);
  chunks.push(viewBuf);
  curByteLen += viewBuf.length;

  const bvIdx = tgt.gltf.bufferViews.length;
  tgt.gltf.bufferViews.push({
    buffer: 0,
    byteOffset,
    byteLength: viewBuf.length,
  });

  const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
  const acc = {
    bufferView: bvIdx,
    componentType: 5126, // FLOAT
    count: typedArray.length / comps,
    type,
  };
  if (computeMinMax && type === 'SCALAR') {
    let mn = Infinity;
    let mx = -Infinity;
    for (let i = 0; i < typedArray.length; i++) {
      if (typedArray[i] < mn) mn = typedArray[i];
      if (typedArray[i] > mx) mx = typedArray[i];
    }
    acc.min = [mn];
    acc.max = [mx];
  }
  const accIdx = tgt.gltf.accessors.length;
  tgt.gltf.accessors.push(acc);
  return accIdx;
}

tgt.gltf.animations = [];
for (const clip of retargetedClips) {
  const timeAcc = appendFloatAccessor(clip.timesOut, 'SCALAR', true);
  const samplers = [];
  const channels = [];

  // Hips translation channel
  const hipsPosAcc = appendFloatAccessor(clip.hipsPosOut, 'VEC3');
  samplers.push({ input: timeAcc, interpolation: 'LINEAR', output: hipsPosAcc });
  channels.push({
    sampler: samplers.length - 1,
    target: { node: tgtHipsIdx, path: 'translation' },
  });

  // All 20 bone rotation channels
  for (const [nodeIdx, rotArr] of clip.rotOutByTgtIdx.entries()) {
    const rotAcc = appendFloatAccessor(rotArr, 'VEC4');
    samplers.push({ input: timeAcc, interpolation: 'LINEAR', output: rotAcc });
    channels.push({
      sampler: samplers.length - 1,
      target: { node: nodeIdx, path: 'rotation' },
    });
  }

  tgt.gltf.animations.push({
    name: clip.name,
    channels,
    samplers,
  });
}

const binPad = pad4(curByteLen) - curByteLen;
if (binPad > 0) {
  chunks.push(Buffer.alloc(binPad));
  curByteLen += binPad;
}
tgt.gltf.buffers[0].byteLength = curByteLen;

const jsonBufRaw = Buffer.from(JSON.stringify(tgt.gltf), 'utf8');
const jsonPad = pad4(jsonBufRaw.length) - jsonBufRaw.length;
const jsonBuf =
  jsonPad > 0 ? Buffer.concat([jsonBufRaw, Buffer.alloc(jsonPad, 0x20)]) : jsonBufRaw;
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

const finalBuf = Buffer.concat([outHeader, jsonChunkHdr, jsonBuf, binChunkHdr, binBuf]);
fs.writeFileSync(path.resolve(OUT_PATH), finalBuf);
console.log(
  `[RETARGET] Saved ${retargetedClips.length} clips -> ${OUT_PATH} (${(finalBuf.length / 1024).toFixed(1)} KB)`
);
