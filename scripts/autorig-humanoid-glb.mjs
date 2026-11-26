/**
 * Anatomical Humanoid Auto-Rigger for symmetrical front-facing (+Z) A-pose GLB characters.
 * Measures exact crotch, torso-to-arm air gap, armpit, neck, shoulder, elbow, wrist, knee, and ankle
 * landmarks directly from the mesh geometry, constructs a 20-bone Mixamo/Humanoid glTF 2.0 Skin
 * compatible with HumanoidBoneDriver, computes zero-webbing region-partitioned capsule weights,
 * and applies 4 passes of mesh-topology Laplacian weight smoothing.
 *
 * Usage:
 *   node scripts/autorig-humanoid-glb.mjs --in input_raw.glb --out output_rigged.glb
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
function getArg(flag, fallback = null) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const IN_PATH = getArg('--in');
const OUT_PATH = getArg('--out');
if (!IN_PATH || !OUT_PATH) {
  console.error('Usage: node scripts/autorig-humanoid-glb.mjs --in <raw.glb> --out <rigged.glb>');
  process.exit(1);
}

const rawBuf = Buffer.from(fs.readFileSync(path.resolve(IN_PATH)));
if (rawBuf.subarray(0, 4).toString('ascii') !== 'glTF') {
  throw new Error(`Not a valid GLB file: ${IN_PATH}`);
}

const jsonLen = rawBuf.readUInt32LE(12);
const gltf = JSON.parse(rawBuf.subarray(20, 20 + jsonLen).toString('utf8'));
const binHeaderOff = 20 + jsonLen;
const binChunkLen = rawBuf.readUInt32LE(binHeaderOff);
const binOff = binHeaderOff + 8;
const origBin = rawBuf.subarray(binOff, binOff + binChunkLen);

if (!gltf.meshes?.length || !gltf.meshes[0].primitives?.length) {
  throw new Error('GLB contains no mesh primitives.');
}
const prim = gltf.meshes[0].primitives[0];

function readAccessor(accIdx) {
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const byteOffset = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type];
  const byteStride = bv.byteStride || 0;
  if (byteStride && byteStride !== comps * 4) {
    throw new Error(`Interleaved accessor stride ${byteStride} not supported directly.`);
  }
  if (acc.componentType === 5126) {
    return new Float32Array(origBin.buffer, origBin.byteOffset + byteOffset, acc.count * comps);
  }
  if (acc.componentType === 5125) {
    return new Uint32Array(origBin.buffer, origBin.byteOffset + byteOffset, acc.count * comps);
  }
  if (acc.componentType === 5123) {
    return new Uint16Array(origBin.buffer, origBin.byteOffset + byteOffset, acc.count * comps);
  }
  return new Uint8Array(origBin.buffer, origBin.byteOffset + byteOffset, acc.count * comps);
}

const pos = readAccessor(prim.attributes.POSITION);
const indices = prim.indices !== undefined ? readAccessor(prim.indices) : null;
const vertCount = pos.length / 3;

// 1. Measure bounding box
let minX = Infinity,
  maxX = -Infinity,
  minY = Infinity,
  maxY = -Infinity,
  minZ = Infinity,
  maxZ = -Infinity;
for (let i = 0; i < vertCount; i++) {
  const x = pos[i * 3];
  const y = pos[i * 3 + 1];
  const z = pos[i * 3 + 2];
  if (x < minX) minX = x;
  if (x > maxX) maxX = x;
  if (y < minY) minY = y;
  if (y > maxY) maxY = y;
  if (z < minZ) minZ = z;
  if (z > maxZ) maxZ = z;
}
const H = maxY - minY;
const nyOf = (y) => (y - minY) / H;
const yAt = (ny) => minY + ny * H;

// 2. Measure exact crotch height (lowest normalized Y where center |x| < 0.015*H has vertices)
let nyCrotch = 0.39;
for (let pct = 28; pct <= 50; pct += 1) {
  const y0 = yAt(pct / 100);
  const y1 = yAt((pct + 1.5) / 100);
  let minAbsX = Infinity;
  for (let i = 0; i < vertCount; i++) {
    const y = pos[i * 3 + 1];
    if (y >= y0 && y < y1) {
      const ax = Math.abs(pos[i * 3]);
      if (ax < minAbsX) minAbsX = ax;
    }
  }
  if (minAbsX < 0.015 * H) {
    nyCrotch = pct / 100;
    break;
  }
}

// 3. Build torso-vs-arm air gap curve across height slices [nyCrotch - 0.04 .. 0.72]
const gapSamples = [];
for (let pct = Math.round(nyCrotch * 100) - 4; pct <= 72; pct += 2) {
  const ny = pct / 100;
  const y0 = yAt(ny - 0.015);
  const y1 = yAt(ny + 0.015);
  const xs = [];
  for (let i = 0; i < vertCount; i++) {
    const y = pos[i * 3 + 1];
    if (y >= y0 && y < y1 && pos[i * 3] >= 0) {
      xs.push(pos[i * 3]);
    }
  }
  xs.sort((a, b) => a - b);
  let bestGap = 0;
  let bestMid = 0.12 * H;
  let bestLow = 0.09 * H;
  let bestHigh = 0.14 * H;
  for (let k = 1; k < xs.length; k++) {
    const gap = xs[k] - xs[k - 1];
    // Only consider gaps clearly outside the torso centerline (> 0.055 * H)
    if (gap > bestGap && xs[k - 1] > 0.055 * H) {
      bestGap = gap;
      bestLow = xs[k - 1];
      bestHigh = xs[k];
      bestMid = 0.5 * (bestLow + bestHigh);
    }
  }
  if (bestGap > 0.016 * H) {
    gapSamples.push({ ny, gap: bestGap, low: bestLow, high: bestHigh, mid: bestMid });
  }
}

const nyArmpit =
  gapSamples.length > 0 ? Math.min(0.68, gapSamples[gapSamples.length - 1].ny + 0.025) : 0.65;
const armpitSeamX =
  gapSamples.length > 0 ? gapSamples[gapSamples.length - 1].mid : 0.105 * H;

function getTorsoArmSplitX(ny) {
  if (gapSamples.length === 0) return 0.11 * H;
  if (ny <= gapSamples[0].ny) return gapSamples[0].mid;
  if (ny >= gapSamples[gapSamples.length - 1].ny) {
    // Slightly widen inward->outward above armpit toward shoulder socket
    const t = Math.min(1, (ny - gapSamples[gapSamples.length - 1].ny) / 0.16);
    return armpitSeamX * (1 - 0.12 * t);
  }
  for (let i = 0; i < gapSamples.length - 1; i++) {
    const a = gapSamples[i];
    const b = gapSamples[i + 1];
    if (ny >= a.ny && ny <= b.ny) {
      const t = (ny - a.ny) / Math.max(1e-5, b.ny - a.ny);
      return a.mid + (b.mid - a.mid) * t;
    }
  }
  return armpitSeamX;
}

// 4. Find exact neck pinch height between 78% and 89% (minimum outer spanX above shoulder pauldrons)
let nyNeck = 0.835;
let minNeckSpan = Infinity;
for (let pct = 79; pct <= 88; pct += 1) {
  const ny = pct / 100;
  const y0 = yAt(ny - 0.01);
  const y1 = yAt(ny + 0.01);
  let maxAbsX = 0;
  let count = 0;
  for (let i = 0; i < vertCount; i++) {
    const y = pos[i * 3 + 1];
    if (y >= y0 && y < y1) {
      const ax = Math.abs(pos[i * 3]);
      if (ax > maxAbsX) maxAbsX = ax;
      count++;
    }
  }
  // Ignore antler/horn tips at top; look for genuine neck narrowing below head/antlers
  if (count > 20 && maxAbsX < minNeckSpan) {
    minNeckSpan = maxAbsX;
    nyNeck = ny;
  }
}
nyNeck = Math.max(0.81, Math.min(0.865, nyNeck));

// Helper: compute vertex centroid inside a filtered slice
function sliceCentroid(nyMin, nyMax, xFilterFn) {
  const y0 = yAt(nyMin);
  const y1 = yAt(nyMax);
  let sx = 0,
    sy = 0,
    sz = 0,
    n = 0;
  for (let i = 0; i < vertCount; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    if (y >= y0 && y <= y1 && xFilterFn(x, y)) {
      sx += x;
      sy += y;
      sz += z;
      n++;
    }
  }
  if (n === 0) return null;
  return [sx / n, sy / n, sz / n];
}

// Measure exact Left-side (+X) limb landmarks from real geometry
const leftArmUpper =
  sliceCentroid(nyArmpit + 0.04, nyArmpit + 0.1, (x) => x > armpitSeamX * 0.92) ?? [
    0.135 * H,
    yAt(0.73),
    0,
  ];
const leftElbow =
  sliceCentroid(0.55, 0.6, (x, y) => x > getTorsoArmSplitX(nyOf(y))) ?? [
    0.175 * H,
    yAt(0.575),
    0,
  ];
const leftWrist =
  sliceCentroid(0.43, 0.48, (x, y) => x > getTorsoArmSplitX(nyOf(y))) ?? [
    0.205 * H,
    yAt(0.455),
    0.02 * H,
  ];
const leftHandTip =
  sliceCentroid(0.36, 0.42, (x, y) => x > getTorsoArmSplitX(nyOf(y))) ?? [
    0.215 * H,
    yAt(0.39),
    0.03 * H,
  ];

const leftThighTop =
  sliceCentroid(nyCrotch - 0.04, nyCrotch + 0.01, (x, y) => x > 0 && x < getTorsoArmSplitX(nyOf(y))) ?? [
    0.072 * H,
    yAt(nyCrotch),
    0,
  ];
const leftKnee =
  sliceCentroid(0.2, 0.25, (x) => x > 0) ?? [0.095 * H, yAt(0.225), 0];
const leftAnkle =
  sliceCentroid(0.05, 0.09, (x) => x > 0) ?? [0.125 * H, yAt(0.07), -0.015 * H];
const leftFootCenter =
  sliceCentroid(0.0, 0.04, (x) => x > 0) ?? [0.135 * H, yAt(0.02), 0.02 * H];

const torsoMid =
  sliceCentroid(nyCrotch + 0.12, nyArmpit, (x, y) => Math.abs(x) < getTorsoArmSplitX(nyOf(y))) ?? [
    0,
    yAt(0.55),
    0,
  ];
const torsoZ = torsoMid[2];

// 5. Define exact 20-bone Mixamo/Humanoid skeleton in mesh world coordinates (identity bind orientations!)
const yHips = yAt(nyCrotch + 0.065);
const ySpine = yAt(nyCrotch + 0.135);
const ySpine1 = yAt(nyCrotch + 0.225);
const ySpine2 = yAt(Math.min(nyNeck - 0.06, nyArmpit + 0.075));
const yNeckAbs = yAt(nyNeck);
const yHeadAbs = yAt(Math.min(0.92, nyNeck + 0.045));

const shoulderY = Math.min(yNeckAbs - 0.035 * H, Math.max(ySpine2, leftArmUpper[1] - 0.015 * H));
const armJointX = Math.max(armpitSeamX * 1.05, Math.min(leftArmUpper[0] * 0.88, 0.145 * H));
const clavicleX = armJointX * 0.48;
const shoulderZ = leftArmUpper[2] * 0.65 + torsoZ * 0.35;

const hipJointX = Math.max(0.058 * H, Math.min(0.092 * H, leftThighTop[0]));
const hipJointY = yAt(nyCrotch + 0.028);
const hipJointZ = leftThighTop[2] * 0.5 + torsoZ * 0.5;

const JOINTS = [
  { name: 'Hips', parent: -1, pos: [0, yHips, torsoZ] },
  { name: 'Spine', parent: 0, pos: [0, ySpine, torsoZ] },
  { name: 'Spine1', parent: 1, pos: [0, ySpine1, torsoZ] },
  { name: 'Spine2', parent: 2, pos: [0, ySpine2, torsoZ] },
  { name: 'Neck', parent: 3, pos: [0, yNeckAbs, torsoZ] },
  { name: 'Head', parent: 4, pos: [0, yHeadAbs, torsoZ] },

  // Left Arm (+X)
  { name: 'LeftShoulder', parent: 3, pos: [clavicleX, shoulderY + 0.005 * H, shoulderZ] },
  { name: 'LeftArm', parent: 6, pos: [armJointX, shoulderY, shoulderZ] },
  { name: 'LeftForeArm', parent: 7, pos: [leftElbow[0], leftElbow[1], leftElbow[2]] },
  { name: 'LeftHand', parent: 8, pos: [leftWrist[0], leftWrist[1], leftWrist[2]] },

  // Right Arm (-X, exact mirror)
  { name: 'RightShoulder', parent: 3, pos: [-clavicleX, shoulderY + 0.005 * H, shoulderZ] },
  { name: 'RightArm', parent: 10, pos: [-armJointX, shoulderY, shoulderZ] },
  { name: 'RightForeArm', parent: 11, pos: [-leftElbow[0], leftElbow[1], leftElbow[2]] },
  { name: 'RightHand', parent: 12, pos: [-leftWrist[0], leftWrist[1], leftWrist[2]] },

  // Left Leg (+X)
  { name: 'LeftUpLeg', parent: 0, pos: [hipJointX, hipJointY, hipJointZ] },
  { name: 'LeftLeg', parent: 14, pos: [leftKnee[0], leftKnee[1], leftKnee[2]] },
  { name: 'LeftFoot', parent: 15, pos: [leftAnkle[0], leftAnkle[1], leftAnkle[2]] },

  // Right Leg (-X, exact mirror)
  { name: 'RightUpLeg', parent: 0, pos: [-hipJointX, hipJointY, hipJointZ] },
  { name: 'RightLeg', parent: 17, pos: [-leftKnee[0], leftKnee[1], leftKnee[2]] },
  { name: 'RightFoot', parent: 18, pos: [-leftAnkle[0], leftAnkle[1], leftAnkle[2]] },
];

const J = Object.fromEntries(JOINTS.map((j, idx) => [j.name, idx]));

// 6. Compute anatomically-partitioned, zero-webbing smooth skin weights per vertex
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function projectOntoSegment(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax,
    aby = by - ay,
    abz = bz - az;
  const apx = px - ax,
    apy = py - ay,
    apz = pz - az;
  const lenSq = abx * abx + aby * aby + abz * abz;
  const t = lenSq > 1e-8 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / lenSq)) : 0;
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const cz = az + abz * t;
  const dx = px - cx,
    dy = py - cy,
    dz = pz - cz;
  return { t, distSq: dx * dx + dy * dy + dz * dz };
}

// Sparse weight array per vertex: Float32Array(vertCount * 20)
const numJoints = JOINTS.length;
let wMatrix = new Float32Array(vertCount * numJoints);
const lockedHeadMask = new Uint8Array(vertCount);

const regionCounts = { head: 0, torso: 0, leftArm: 0, rightArm: 0, leftLeg: 0, rightLeg: 0 };

for (let i = 0; i < vertCount; i++) {
  const x = pos[i * 3];
  const y = pos[i * 3 + 1];
  const z = pos[i * 3 + 2];
  const ny = nyOf(y);
  const ax = Math.abs(x);
  const splitX = getTorsoArmSplitX(ny);
  const base = i * numJoints;

  // A. Head + Helmet + Horns/Antlers (rigidly driven by Head above neck so horns/antlers NEVER deform!)
  if (y >= yNeckAbs + 0.012 * H) {
    const headBlend = smoothstep(yNeckAbs + 0.012 * H, yNeckAbs + 0.042 * H, y);
    wMatrix[base + J.Neck] = 1 - headBlend;
    wMatrix[base + J.Head] = headBlend;
    if (headBlend >= 0.99) lockedHeadMask[i] = 1;
    regionCounts.head++;
    continue;
  }

  // B. Arms & Pauldrons (strictly separated from torso via air gap below armpit, and outside shoulder seam above armpit!)
  const isLowerArm = ny >= 0.32 && ny <= nyArmpit + 0.02 && ax >= splitX;
  const isUpperArmOrPauldron =
    ny > nyArmpit + 0.02 && ny < nyNeck + 0.01 && ax >= armpitSeamX * 0.84;

  if (isLowerArm || isUpperArmOrPauldron) {
    const isLeft = x >= 0;
    const jSh = isLeft ? J.LeftShoulder : J.RightShoulder;
    const jArm = isLeft ? J.LeftArm : J.RightArm;
    const jFore = isLeft ? J.LeftForeArm : J.RightForeArm;
    const jHand = isLeft ? J.LeftHand : J.RightHand;

    const pArm = JOINTS[jArm].pos;
    const pFore = JOINTS[jFore].pos;
    const pHand = JOINTS[jHand].pos;
    const pTip = [isLeft ? leftHandTip[0] : -leftHandTip[0], leftHandTip[1], leftHandTip[2]];

    if (isLeft) regionCounts.leftArm++;
    else regionCounts.rightArm++;

    // Distance along upper arm, forearm, hand segments
    const segUp = projectOntoSegment(x, y, z, pArm[0], pArm[1], pArm[2], pFore[0], pFore[1], pFore[2]);
    const segFore = projectOntoSegment(x, y, z, pFore[0], pFore[1], pFore[2], pHand[0], pHand[1], pHand[2]);
    const segHand = projectOntoSegment(x, y, z, pHand[0], pHand[1], pHand[2], pTip[0], pTip[1], pTip[2]);

    if (y >= pFore[1] - 0.02 * H) {
      // Shoulder pauldron & upper arm
      const elbowFade = smoothstep(pFore[1] + 0.035 * H, pFore[1] - 0.02 * H, y);
      const shoulderCore = smoothstep(armJointX * 1.15, armpitSeamX * 0.82, ax);
      const armW = (1 - elbowFade * 0.45) * (1 - shoulderCore * 0.65);
      const shW = shoulderCore * 0.42;
      const chestW = shoulderCore * 0.23;
      const foreW = elbowFade * 0.45;
      const sum = armW + shW + chestW + foreW || 1;
      wMatrix[base + jArm] = armW / sum;
      wMatrix[base + jSh] = shW / sum;
      wMatrix[base + J.Spine2] = chestW / sum;
      wMatrix[base + jFore] = foreW / sum;
    } else if (y >= pHand[1] + 0.015 * H) {
      // Forearm (with smooth elbow & wrist transitions)
      const fromElbow = smoothstep(pFore[1] - 0.05 * H, pFore[1] + 0.025 * H, y);
      const toWrist = smoothstep(pHand[1] + 0.045 * H, pHand[1] - 0.01 * H, y);
      const armW = fromElbow * 0.4;
      const handW = toWrist * 0.35;
      const foreW = Math.max(0.25, 1 - armW - handW);
      const sum = armW + foreW + handW;
      wMatrix[base + jArm] = armW / sum;
      wMatrix[base + jFore] = foreW / sum;
      wMatrix[base + jHand] = handW / sum;
    } else {
      // Gauntlet & Clawed Hand
      const wristFade = smoothstep(pHand[1] - 0.025 * H, pHand[1] + 0.02 * H, y);
      const handW = Math.max(0.65, 1 - wristFade * 0.35);
      const foreW = 1 - handW;
      // Sanity check using seg distances so fingertips stay 100% Hand
      if (segHand.distSq <= segFore.distSq && y < pHand[1] - 0.02 * H) {
        wMatrix[base + jHand] = 1.0;
      } else {
        wMatrix[base + jHand] = handW;
        wMatrix[base + jFore] = foreW;
      }
      // silence unused lint on segUp
      void segUp;
    }
    continue;
  }

  // C. Legs (strictly partitioned by X >= 0 vs X < 0 so left & right thighs NEVER cross-web!)
  if (y < yHips - 0.01 * H) {
    const isLeft = x >= 0;
    const jUp = isLeft ? J.LeftUpLeg : J.RightUpLeg;
    const jKnee = isLeft ? J.LeftLeg : J.RightLeg;
    const jFoot = isLeft ? J.LeftFoot : J.RightFoot;
    if (isLeft) regionCounts.leftLeg++;
    else regionCounts.rightLeg++;

    const yKnee = leftKnee[1];
    const yAnkle = leftAnkle[1];
    const pFoot = leftFootCenter;
    void pFoot;

    if (y >= yKnee) {
      // Upper thigh + hip blend near crotch/pelvis
      const pelvisBlend = smoothstep(hipJointY - 0.035 * H, yHips - 0.005 * H, y) * 0.65;
      const kneeBlend = smoothstep(yKnee + 0.05 * H, yKnee - 0.015 * H, y) * 0.45;
      const thighW = Math.max(0.2, 1 - pelvisBlend - kneeBlend);
      const sum = pelvisBlend + thighW + kneeBlend;
      wMatrix[base + J.Hips] = pelvisBlend / sum;
      wMatrix[base + jUp] = thighW / sum;
      wMatrix[base + jKnee] = kneeBlend / sum;
    } else if (y >= yAnkle) {
      // Shin / greave with smooth knee & ankle transitions
      const toKnee = smoothstep(yKnee - 0.045 * H, yKnee + 0.015 * H, y) * 0.45;
      const toAnkle = smoothstep(yAnkle + 0.04 * H, yAnkle - 0.01 * H, y) * 0.45;
      const shinW = Math.max(0.25, 1 - toKnee - toAnkle);
      const sum = toKnee + shinW + toAnkle;
      wMatrix[base + jUp] = toKnee / sum;
      wMatrix[base + jKnee] = shinW / sum;
      wMatrix[base + jFoot] = toAnkle / sum;
    } else {
      // Boot & Claws
      const ankleFade = smoothstep(yAnkle - 0.025 * H, yAnkle + 0.015 * H, y) * 0.25;
      wMatrix[base + jKnee] = ankleFade;
      wMatrix[base + jFoot] = 1 - ankleFade;
    }
    continue;
  }

  // D. Torso (Pelvis -> Spine -> Spine1 -> Spine2 -> Neck)
  regionCounts.torso++;
  const spineNodes = [
    { j: J.Hips, y: yHips },
    { j: J.Spine, y: ySpine },
    { j: J.Spine1, y: ySpine1 },
    { j: J.Spine2, y: ySpine2 },
    { j: J.Neck, y: yNeckAbs },
  ];
  // Piecewise smooth interpolation between adjacent spine bones
  if (y <= spineNodes[0].y) {
    wMatrix[base + J.Hips] = 1.0;
  } else if (y >= spineNodes[spineNodes.length - 1].y) {
    wMatrix[base + J.Neck] = 1.0;
  } else {
    for (let s = 0; s < spineNodes.length - 1; s++) {
      const a = spineNodes[s];
      const b = spineNodes[s + 1];
      if (y >= a.y && y <= b.y) {
        const t = smoothstep(a.y, b.y, y);
        wMatrix[base + a.j] = 1 - t;
        wMatrix[base + b.j] = t;
        break;
      }
    }
  }
}

// 7. Build vertex adjacency from triangles & run 4 iterations of topology-aware Laplacian smoothing
//    (eliminates sharp creases at knees, elbows, shoulders, and hips while preventing any cross-limb bleed!)
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

  // Also merge spatially-coincident UV-seam vertices so seams NEVER crack during bending!
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
  const SMOOTH_PASSES = 4;
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    for (let i = 0; i < vertCount; i++) {
      const base = i * numJoints;
      if (lockedHeadMask[i]) {
        for (let j = 0; j < numJoints; j++) nextW[base + j] = wMatrix[base + j];
        continue;
      }
      const nbrs = neighbors[i];
      if (nbrs.length === 0) {
        for (let j = 0; j < numJoints; j++) nextW[base + j] = wMatrix[base + j];
        continue;
      }
      const invN = 1 / nbrs.length;
      for (let j = 0; j < numJoints; j++) {
        let sumNbr = 0;
        for (let k = 0; k < nbrs.length; k++) {
          sumNbr += wMatrix[nbrs[k] * numJoints + j];
        }
        nextW[base + j] = wMatrix[base + j] * 0.56 + sumNbr * invN * 0.44;
      }
    }
    // Enforce exact identical weights on UV-seam duplicates so seams never split!
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

// 8. Pack top-4 influences per vertex into glTF JOINTS_0 (Uint16 VEC4) and WEIGHTS_0 (Float32 VEC4)
const jointsOut = new Uint16Array(vertCount * 4);
const weightsOut = new Float32Array(vertCount * 4);

for (let i = 0; i < vertCount; i++) {
  const base = i * numJoints;
  // Pick top 4 weights
  const topJ = [0, 0, 0, 0];
  const topW = [0, 0, 0, 0];
  for (let j = 0; j < numJoints; j++) {
    const w = wMatrix[base + j];
    if (w <= 1e-5) continue;
    let slot = -1;
    let minVal = w;
    for (let s = 0; s < 4; s++) {
      if (topW[s] < minVal) {
        minVal = topW[s];
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
    topJ[0] = J.Hips;
    topW[0] = 1.0;
    sum = 1.0;
  }
  const o = i * 4;
  for (let s = 0; s < 4; s++) {
    jointsOut[o + s] = topJ[s];
    weightsOut[o + s] = topW[s] / sum;
  }
}

// 9. Build Inverse Bind Matrices (column-major 4x4 translation matrices T(-jointWorldPos))
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

// 10. Serialize updated glTF JSON + appended BIN buffers (strict 4-byte alignment)
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
gltf.accessors.push({
  bufferView: jointsBv,
  componentType: 5123, // UNSIGNED_SHORT
  count: vertCount,
  type: 'VEC4',
});

const weightsAccIdx = gltf.accessors.length;
gltf.accessors.push({
  bufferView: weightsBv,
  componentType: 5126, // FLOAT
  count: vertCount,
  type: 'VEC4',
});

const ibmAccIdx = gltf.accessors.length;
gltf.accessors.push({
  bufferView: ibmBv,
  componentType: 5126, // FLOAT
  count: numJoints,
  type: 'MAT4',
});

prim.attributes.JOINTS_0 = jointsAccIdx;
prim.attributes.WEIGHTS_0 = weightsAccIdx;

// Rebuild node hierarchy: node 0 = SkinnedMesh, node 1 = Armature, nodes 2..21 = 20 humanoid joints
const origMeshNode = gltf.nodes[0] || { mesh: 0 };
const meshNode = { name: origMeshNode.name || 'BossSkinnedMesh', mesh: origMeshNode.mesh ?? 0, skin: 0 };
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

gltf.nodes = [meshNode, { name: 'Armature', children: [jointBaseNodeIdx] }, ...jointNodes];
gltf.skins = [
  {
    name: 'AutoHumanoidSkin',
    inverseBindMatrices: ibmAccIdx,
    skeleton: jointBaseNodeIdx,
    joints: JOINTS.map((_, idx) => jointBaseNodeIdx + idx),
  },
];
gltf.scenes = [{ name: 'Scene', nodes: [0, armatureNodeIdx] }];
gltf.scene = 0;

// Pad final BIN buffer to 4-byte boundary
const binPad = pad4(curByteLen) - curByteLen;
if (binPad > 0) {
  chunks.push(Buffer.alloc(binPad));
  curByteLen += binPad;
}
gltf.buffers[0].byteLength = curByteLen;

let jsonStr = JSON.stringify(gltf);
const jsonBufRaw = Buffer.from(jsonStr, 'utf8');
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
jsonChunkHdr.writeUInt32LE(0x4e4f534a, 4); // JSON

const binChunkHdr = Buffer.alloc(8);
binChunkHdr.writeUInt32LE(binBuf.length, 0);
binChunkHdr.writeUInt32LE(0x004e4942, 4); // BIN

const finalGlb = Buffer.concat([outHeader, jsonChunkHdr, jsonBuf, binChunkHdr, binBuf]);
fs.writeFileSync(path.resolve(OUT_PATH), finalGlb);

console.log(
  `[AUTORIG] ${path.basename(IN_PATH)} -> ${path.basename(OUT_PATH)} | verts=${vertCount}, joints=${numJoints}, nyCrotch=${(nyCrotch * 100).toFixed(1)}%, nyArmpit=${(nyArmpit * 100).toFixed(1)}%, nyNeck=${(nyNeck * 100).toFixed(1)}%`
);
console.log('[AUTORIG] Region distribution:', regionCounts);
