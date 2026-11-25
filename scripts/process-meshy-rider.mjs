/**
 * Processes Meshy's rigged & animated Kamen Rider GLB (`Meshy_AI_Meshy_Merged_Animations.glb`):
 * 1. Curls both RightHand and LeftHand into smooth, volume-preserving clenched fists
 *    around a cylindrical sword-grip cavity (recomputing rotated vertex normals).
 * 2. Strips horizontal root-motion X/Z drift from Hips translation channels on Roll_Dodge
 *    and Thrust_Slash (preserving full vertical Y dive/bounce!) and centers Dead start X/Z
 *    at (0, 0) so every mocap clip stays 100% synced with the Rapier3D physics collider.
 * 3. Writes the processed uncompressed GLB ready for Draco + 1024px WebP optimization.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';

const args = process.argv.slice(2);
function getArg(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}
const SKIP_FIST_CURL = args.includes('--skip-fist-curl');

const IN_PATH = path.resolve(
  process.cwd(),
  getArg(
    '--in',
    'docs/raw-models/Meshy_models_20261125_185811/Meshy_AI_Kamen_Rider_Rigged_20261125_animate_2e13f73b/Meshy_AI_Meshy_Merged_Animations.glb'
  )
);
const OUT_PATH = path.resolve(
  process.cwd(),
  getArg('--out', 'docs/raw-models/.rider_mocap_fists_temp.glb')
);

const buf = Buffer.from(fs.readFileSync(IN_PATH));
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
const binOff = 20 + jsonLen + 8;

const prim = gltf.meshes[0].primitives[0];
const skin = gltf.skins[0];

function viewAccessor(accIdx) {
  const acc = gltf.accessors[accIdx];
  const bv = gltf.bufferViews[acc.bufferView];
  const byteOffset = binOff + (bv.byteOffset || 0) + (acc.byteOffset || 0);
  const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type];
  if (acc.componentType === 5126) {
    return new Float32Array(buf.buffer, buf.byteOffset + byteOffset, acc.count * comps);
  }
  if (acc.componentType === 5123) {
    return new Uint16Array(buf.buffer, buf.byteOffset + byteOffset, acc.count * comps);
  }
  return new Uint8Array(buf.buffer, buf.byteOffset + byteOffset, acc.count * comps);
}

const pos = viewAccessor(prim.attributes.POSITION);
const norm = prim.attributes.NORMAL !== undefined ? viewAccessor(prim.attributes.NORMAL) : null;
const joints = viewAccessor(prim.attributes.JOINTS_0);
const weights = viewAccessor(prim.attributes.WEIGHTS_0);
const ibmData = viewAccessor(skin.inverseBindMatrices);

function curlHandFist(boneName, thumbSideSign) {
  const jointIdx = skin.joints.findIndex((ni) => gltf.nodes[ni].name === boneName);
  if (jointIdx < 0) {
    throw new Error(`Bone "${boneName}" not found in skin joints.`);
  }

  const ibmMat = new THREE.Matrix4().fromArray(ibmData, jointIdx * 16);
  const bindMat = ibmMat.clone().invert();
  const ibmNormalMat = new THREE.Matrix3().setFromMatrix4(ibmMat);
  const bindNormalMat = new THREE.Matrix3().setFromMatrix4(bindMat);

  const vWorld = new THREE.Vector3();
  const vLocal = new THREE.Vector3();
  const nWorld = new THREE.Vector3();
  const nLocal = new THREE.Vector3();

  const knuckleY = 8.4;
  const gripCenterZ = 3.15;
  const gripRadius = 2.65;

  let curledFingers = 0;
  let curledThumb = 0;

  const vertCount = pos.length / 3;
  for (let i = 0; i < vertCount; i++) {
    let wHand = 0;
    for (let k = 0; k < 4; k++) {
      if (joints[i * 4 + k] === jointIdx) {
        wHand += weights[i * 4 + k];
      }
    }
    if (wHand < 0.35) continue;

    vWorld.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    vLocal.copy(vWorld).applyMatrix4(ibmMat);

    const lx = vLocal.x;
    const ly = vLocal.y;
    const lz = vLocal.z;
    const sideX = lx * thumbSideSign;

    if (ly >= 3.6 && ly <= 13.8 && sideX > 2.1 && lz > 0.6) {
      const tThumb = Math.min(1, Math.max(0, (sideX - 2.1) / 4.8));
      const smooth = tThumb * tThumb * (3 - 2 * tThumb);
      const curlAngle = smooth * 1.18;
      const dx = sideX - 2.1;
      const dz = lz - 1.6;
      const newSideX =
        2.1 + dx * Math.cos(curlAngle) - dz * Math.sin(curlAngle) * 0.55 - smooth * 2.4;
      const newZ = 1.6 + dx * Math.sin(curlAngle) * 0.72 + dz * Math.cos(curlAngle) + smooth * 2.4;
      const newY = ly + smooth * 1.35;

      vLocal.set(newSideX * thumbSideSign, newY, newZ);
      vWorld.copy(vLocal).applyMatrix4(bindMat);
      pos[i * 3] = vWorld.x;
      pos[i * 3 + 1] = vWorld.y;
      pos[i * 3 + 2] = vWorld.z;

      if (norm) {
        nWorld.set(norm[i * 3], norm[i * 3 + 1], norm[i * 3 + 2]);
        nLocal.copy(nWorld).applyMatrix3(ibmNormalMat).normalize();
        const nx = nLocal.x * thumbSideSign;
        const nz = nLocal.z;
        const rnx = nx * Math.cos(curlAngle) - nz * Math.sin(curlAngle);
        const rnz = nx * Math.sin(curlAngle) + nz * Math.cos(curlAngle);
        nLocal.set(rnx * thumbSideSign, nLocal.y, rnz).normalize();
        nWorld.copy(nLocal).applyMatrix3(bindNormalMat).normalize();
        norm[i * 3] = nWorld.x;
        norm[i * 3 + 1] = nWorld.y;
        norm[i * 3 + 2] = nWorld.z;
      }
      curledThumb++;
      continue;
    }

    if (ly > knuckleY) {
      const d = ly - knuckleY;
      const theta = (d / gripRadius) * 0.94;
      const distFromAxis = Math.max(1.35, gripCenterZ - lz);

      const newY = knuckleY + distFromAxis * Math.sin(theta);
      const newZ = gripCenterZ - distFromAxis * Math.cos(theta);
      const closeFactor = 1 - 0.19 * Math.min(1, d / 9.0);
      const newX = lx * closeFactor;

      vLocal.set(newX, newY, newZ);
      vWorld.copy(vLocal).applyMatrix4(bindMat);
      pos[i * 3] = vWorld.x;
      pos[i * 3 + 1] = vWorld.y;
      pos[i * 3 + 2] = vWorld.z;

      if (norm) {
        nWorld.set(norm[i * 3], norm[i * 3 + 1], norm[i * 3 + 2]);
        nLocal.copy(nWorld).applyMatrix3(ibmNormalMat).normalize();
        const ny = nLocal.y;
        const nz = nLocal.z;
        const c = Math.cos(theta);
        const s = Math.sin(theta);
        nLocal.set(nLocal.x, ny * c + nz * s, -ny * s + nz * c).normalize();
        nWorld.copy(nLocal).applyMatrix3(bindNormalMat).normalize();
        norm[i * 3] = nWorld.x;
        norm[i * 3 + 1] = nWorld.y;
        norm[i * 3 + 2] = nWorld.z;
      }
      curledFingers++;
    }
  }

  console.log(`[MOCAP-RIDER] ${boneName}: curled ${curledFingers} finger verts + ${curledThumb} thumb verts.`);
}

if (!SKIP_FIST_CURL) {
  curlHandFist('RightHand', +1);
  curlHandFist('LeftHand', -1);
} else {
  console.log('[MOCAP-RIDER] Skipped fist curl (--skip-fist-curl: gauntlet fists already sculpted).');
}

// Strip horizontal root motion (X/Z) on in-place combat animations while preserving vertical Y motion!
for (const anim of gltf.animations || []) {
  const isRollOrAttack = /roll|dodge|thrust|slash|attack|punch|combo/i.test(anim.name);
  const isDead = /dead|death/i.test(anim.name);
  if (!isRollOrAttack && !isDead) continue;

  for (const ch of anim.channels || []) {
    const nodeName = gltf.nodes[ch.target.node]?.name || '';
    if (nodeName !== 'Hips' || ch.target.path !== 'translation') continue;

    const sampler = anim.samplers[ch.sampler];
    const data = viewAccessor(sampler.output);
    const count = data.length / 3;
    const baseX = data[0];
    const baseZ = data[2];

    for (let i = 0; i < count; i++) {
      if (isRollOrAttack) {
        // Pure in-place combat roll & slash: zero out X/Z root drift while keeping full Y dive/bob!
        data[i * 3] = 0;
        data[i * 3 + 2] = 0;
      } else if (isDead) {
        // Keep natural collapse fall distance but anchor start position at exact (0, y, 0)
        data[i * 3] -= baseX;
        data[i * 3 + 2] -= baseZ;
      }
    }
    console.log(
      `[MOCAP-RIDER] Root-motion cleaned for "${anim.name}" (${count} keys, mode=${isRollOrAttack ? 'IN_PLACE_XZ_ZERO' : 'CENTERED_COLLAPSE'}).`
    );
  }
}

fs.writeFileSync(OUT_PATH, buf);
console.log(`[MOCAP-RIDER] Wrote clenched-fist + in-place mocap GLB -> ${OUT_PATH}`);
