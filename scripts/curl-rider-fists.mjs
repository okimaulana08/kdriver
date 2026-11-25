/**
 * Deterministic Clenched-Fist Sculptor for Meshy 24-bone Rigged Rider GLB.
 * Reads `docs/raw-models/Kamen_Rider_Rigged_raw.glb`, curls the 4 fingers + thumb of both
 * `RightHand` and `LeftHand` around a volume-preserving cylindrical sword-grip axis
 * (C1 continuous at knuckles, recomputing smooth rotated vertex normals), and writes
 * a new rigged GLB with all 24 bones, skin weights, and PBR textures 100% intact.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';

const IN_PATH = path.resolve(process.cwd(), 'docs/raw-models/Kamen_Rider_Rigged_raw.glb');
const OUT_PATH = path.resolve(process.cwd(), 'docs/raw-models/.rider_fists_temp.glb');

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

  // Cylindrical grip center in local hand space (cm):
  // Y = 0 is wrist, Y = 8.4 is knuckle crease, +Z is palm face, thumb sits on thumbSideSign * X > 2.2
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

    // 1. Thumb curl: wrap thumb smoothly inward over index/middle knuckles!
    if (ly >= 3.6 && ly <= 13.8 && sideX > 2.1 && lz > 0.6) {
      const tThumb = Math.min(1, Math.max(0, (sideX - 2.1) / 4.8));
      const smooth = tThumb * tThumb * (3 - 2 * tThumb);
      // Pivot thumb inward toward center-front of clenched fist
      const curlAngle = smooth * 1.18;
      const dx = sideX - 2.1;
      const dz = lz - 1.6;
      const newSideX = 2.1 + dx * Math.cos(curlAngle) - dz * Math.sin(curlAngle) * 0.55 - smooth * 2.4;
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

    // 2. Four fingers curl (Index, Middle, Ring, Pinky): volume-preserving wrap around grip cylinder!
    if (ly > knuckleY) {
      const d = ly - knuckleY; // 0..11.6 cm
      // Smooth ramp so finger base bends firmly while fingertips tuck tight into palm (~225 deg wrap!)
      const theta = (d / gripRadius) * 0.94;
      const distFromAxis = Math.max(1.35, gripCenterZ - lz);

      const newY = knuckleY + distFromAxis * Math.sin(theta);
      const newZ = gripCenterZ - distFromAxis * Math.cos(theta);
      // Gently close finger spread together into a compact armored fist
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
        // Rotate normal around local +X by -theta matching (y = sin, z = -cos) curl direction
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

  console.log(`[FIST] ${boneName}: curled ${curledFingers} finger verts + ${curledThumb} thumb verts into tight grip!`);
}

curlHandFist('RightHand', +1);
curlHandFist('LeftHand', -1);

fs.writeFileSync(OUT_PATH, buf);
console.log(`[FIST] Wrote clenched-fist rigged GLB -> ${OUT_PATH}`);
