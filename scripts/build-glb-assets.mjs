/**
 * Procedural Stylized Low-Poly 3D Asset Builder -> Binary .glb Exporter
 * Generates all Phase 4 sculpted Tokusatsu models with named sockets & semantic material roles,
 * asserting every triangle budget from GAME_DESIGN_AND_PLAN.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

// Lightweight FileReader polyfill for Node.js binary GLB export
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class NodeFileReader {
    onloadend = null;
    onerror = null;
    result = null;
    readAsArrayBuffer(blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          this.result = buf;
          if (this.onloadend) this.onloadend();
        })
        .catch((err) => {
          if (this.onerror) this.onerror(err);
        });
    }
    readAsDataURL(blob) {
      blob
        .arrayBuffer()
        .then((buf) => {
          const b64 = Buffer.from(buf).toString('base64');
          this.result = `data:${blob.type || 'application/octet-stream'};base64,${b64}`;
          if (this.onloadend) this.onloadend();
        })
        .catch((err) => {
          if (this.onerror) this.onerror(err);
        });
    }
  };
}

const OUT_DIR = path.resolve(process.cwd(), 'public/assets/models');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Semantic materials tagged by name so CelShader.ts rebinds them to dynamic cel-shaded/emissive materials on load
function makeRoleMat(role, colorHex, emissiveHex = 0x000000, metalness = 0.2, roughness = 0.6) {
  const mat = new THREE.MeshStandardMaterial({
    name: `role:${role}`,
    color: colorHex,
    emissive: emissiveHex,
    emissiveIntensity: emissiveHex ? 1.8 : 0,
    metalness,
    roughness,
  });
  return mat;
}

function makeMesh(geo, mat, name, outline = true) {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  m.userData.outline = outline;
  return m;
}

function countTriangles(root) {
  let tris = 0;
  root.traverse((obj) => {
    if (obj.isMesh && obj.geometry) {
      const idx = obj.geometry.index;
      if (idx) {
        tris += idx.count / 3;
      } else {
        const pos = obj.geometry.attributes.position;
        if (pos) tris += pos.count / 3;
      }
    }
  });
  return Math.round(tris);
}

// ---------- Helper Sculpted Geometry Builders ----------

function createBeveledPlate(points2D, depth = 0.08, bevel = 0.022) {
  const shape = new THREE.Shape();
  shape.moveTo(points2D[0][0], points2D[0][1]);
  for (let i = 1; i < points2D.length; i++) {
    shape.lineTo(points2D[i][0], points2D[i][1]);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geo.center();
  return geo;
}

function createLatheLimb(profile, segments = 10) {
  const pts = profile.map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(pts, segments);
}

// =======================================================
// 1. SHARED RIG KAMEN RIDER (rider_base.glb)
// Named Sockets: RightHand, LeftHand, ChestArmor, ShoulderL, ShoulderR, BackWing
// =======================================================
function buildRiderBase() {
  const root = new THREE.Group();
  root.name = 'RiderRoot';

  const matUndersuit = makeRoleMat('undersuit', 0x111827, 0x000000, 0.25, 0.72);
  const matArmor = makeRoleMat('armor', 0xe11d48, 0x000000, 0.35, 0.42);
  const matAccent = makeRoleMat('accent', 0xe2e8f0, 0x000000, 0.55, 0.35);
  const matMetal = makeRoleMat('metallic', 0xcbd5e1, 0x000000, 0.85, 0.22);
  const matEmissive = makeRoleMat('emissive', 0xff5722, 0xff5722, 0.1, 0.2);
  const matScarf = makeRoleMat('scarf', 0xe11d48, 0x000000, 0.1, 0.75);
  const matSuperGold = makeRoleMat('super_gold', 0xfacc15, 0xd97706, 0.85, 0.2);
  const matSuperWing = makeRoleMat('super_wing', 0xff5722, 0xff5722, 0.1, 0.15);

  const bodyPivot = new THREE.Group();
  bodyPivot.name = 'BodyPivot';
  root.add(bodyPivot);

  // Sculpted Pelvis & K-DRIVER Transformation Belt
  const pelvisGeo = createBeveledPlate(
    [
      [-0.2, 0.11],
      [0.2, 0.11],
      [0.14, -0.1],
      [0, -0.15],
      [-0.14, -0.1],
    ],
    0.2,
    0.03
  );
  const pelvis = makeMesh(pelvisGeo, matUndersuit, 'Pelvis');
  pelvis.position.set(0, -0.05, 0);
  bodyPivot.add(pelvis);

  const codpiece = makeMesh(
    createBeveledPlate(
      [
        [-0.08, 0.08],
        [0.08, 0.08],
        [0.04, -0.11],
        [-0.04, -0.11],
      ],
      0.08,
      0.015
    ),
    matArmor,
    'PelvisGuard'
  );
  codpiece.position.set(0, -0.07, 0.12);
  bodyPivot.add(codpiece);

  // K-DRIVER Mechanical Belt Ring + Side Buckles + Turbine Core
  const beltStrap = makeMesh(
    new THREE.TorusGeometry(0.22, 0.052, 8, 16),
    matMetal,
    'KDriverBeltStrap'
  );
  beltStrap.rotation.x = Math.PI / 2;
  beltStrap.scale.set(1.12, 0.85, 1);
  beltStrap.position.set(0, 0.01, 0);
  bodyPivot.add(beltStrap);

  const buckleHousing = makeMesh(
    createBeveledPlate(
      [
        [-0.17, 0.07],
        [-0.1, 0.1],
        [0.1, 0.1],
        [0.17, 0.07],
        [0.14, -0.08],
        [-0.14, -0.08],
      ],
      0.09,
      0.018
    ),
    matMetal,
    'KDriverBuckle'
  );
  buckleHousing.position.set(0, 0.01, 0.21);
  bodyPivot.add(buckleHousing);

  const turbineRing = makeMesh(
    new THREE.TorusGeometry(0.068, 0.018, 6, 12),
    matAccent,
    'KDriverTurbineRing',
    false
  );
  turbineRing.position.set(0, 0.01, 0.265);
  bodyPivot.add(turbineRing);

  const coreGem = makeMesh(
    new THREE.OctahedronGeometry(0.062, 0),
    matEmissive,
    'KDriverCoreGem',
    false
  );
  coreGem.position.set(0, 0.01, 0.275);
  coreGem.scale.set(1.15, 0.9, 0.65);
  bodyPivot.add(coreGem);

  // Articulated Sculpted Legs (smooth 16-seg anatomical thighs, contoured knee guards, Rider greaves & boots)
  const buildLeg = (name, xOffset) => {
    const legPivot = new THREE.Group();
    legPivot.name = name;
    legPivot.position.set(xOffset, -0.14, 0);

    const thighGeo = createLatheLimb(
      [
        [0.01, 0.0],
        [0.122, -0.05],
        [0.118, -0.15],
        [0.105, -0.27],
        [0.088, -0.38],
        [0.01, -0.4],
      ],
      16
    );
    const thigh = makeMesh(thighGeo, matUndersuit, `${name}_Thigh`);
    legPivot.add(thigh);

    // Smooth curved thigh armor shell (contoured cylinder segment instead of flat block)
    const thighArmorGeo = new THREE.CylinderGeometry(0.112, 0.094, 0.24, 16, 1, false, -Math.PI * 0.45, Math.PI * 0.9);
    const thighArmor = makeMesh(thighArmorGeo, matArmor, `${name}_ThighPlate`);
    thighArmor.position.set(Math.sign(xOffset) * 0.018, -0.19, 0.02);
    thighArmor.rotation.y = Math.sign(xOffset) * 0.35;
    legPivot.add(thighArmor);

    const kneeGuard = makeMesh(
      new THREE.SphereGeometry(0.082, 14, 10),
      matAccent,
      `${name}_KneeGuard`
    );
    kneeGuard.scale.set(0.95, 1.15, 0.72);
    kneeGuard.position.set(0, -0.39, 0.072);
    legPivot.add(kneeGuard);

    const greaveGeo = createLatheLimb(
      [
        [0.01, -0.38],
        [0.098, -0.42],
        [0.112, -0.52],
        [0.104, -0.63],
        [0.08, -0.74],
        [0.01, -0.76],
      ],
      16
    );
    const greave = makeMesh(greaveGeo, matArmor, `${name}_Greave`);
    legPivot.add(greave);

    const boot = makeMesh(new THREE.CapsuleGeometry(0.075, 0.14, 8, 14), matUndersuit, `${name}_Boot`);
    boot.rotation.x = Math.PI / 2;
    boot.scale.set(1.12, 1.0, 0.78);
    boot.position.set(0, -0.78, 0.06);
    legPivot.add(boot);

    const bootToe = makeMesh(new THREE.SphereGeometry(0.078, 12, 10), matMetal, `${name}_BootToe`, false);
    bootToe.scale.set(1.05, 0.72, 1.25);
    bootToe.position.set(0, -0.79, 0.17);
    legPivot.add(bootToe);

    return legPivot;
  };
  bodyPivot.add(buildLeg('LeftLegPivot', -0.15), buildLeg('RightLegPivot', 0.15));

  // Upper Torso Pivot + ChestArmor Socket
  const torsoPivot = new THREE.Group();
  torsoPivot.name = 'TorsoPivot';
  torsoPivot.position.set(0, 0.05, 0);
  bodyPivot.add(torsoPivot);

  const absGeo = createLatheLimb(
    [
      [0.01, 0.0],
      [0.168, 0.03],
      [0.185, 0.15],
      [0.215, 0.28],
      [0.255, 0.42],
      [0.242, 0.52],
      [0.13, 0.58],
      [0.01, 0.6],
    ],
    18
  );
  const torsoCore = makeMesh(absGeo, matUndersuit, 'TorsoUndersuit');
  torsoCore.scale.set(1.08, 1.0, 0.74);
  torsoPivot.add(torsoCore);

  // ChestArmor Socket (sculpted curved Heisei Kuuga pectoral shells + gold sternum trim + neck collar)
  const chestSocket = new THREE.Group();
  chestSocket.name = 'ChestArmor';
  torsoPivot.add(chestSocket);

  const pecGeo = new THREE.SphereGeometry(0.165, 16, 12);
  const leftPec = makeMesh(pecGeo, matArmor, 'RiderChestLeftPec');
  leftPec.scale.set(1.12, 0.88, 0.62);
  leftPec.position.set(-0.115, 0.41, 0.145);
  leftPec.rotation.set(-0.08, -0.22, 0.12);
  const rightPec = makeMesh(pecGeo, matArmor, 'RiderChestRightPec');
  rightPec.scale.set(1.12, 0.88, 0.62);
  rightPec.position.set(0.115, 0.41, 0.145);
  rightPec.rotation.set(-0.08, 0.22, -0.12);
  chestSocket.add(leftPec, rightPec);

  const upperChestShell = makeMesh(
    new THREE.CylinderGeometry(0.245, 0.22, 0.24, 18, 1, false, -Math.PI * 0.55, Math.PI * 1.1),
    matArmor,
    'RiderChestShell'
  );
  upperChestShell.scale.set(1.08, 1.0, 0.78);
  upperChestShell.position.set(0, 0.39, 0.02);
  chestSocket.add(upperChestShell);

  const sternumCrest = makeMesh(new THREE.OctahedronGeometry(0.068, 1), matSuperGold, 'SternumAccent');
  sternumCrest.scale.set(0.85, 1.45, 0.45);
  sternumCrest.position.set(0, 0.4, 0.215);
  chestSocket.add(sternumCrest);

  const chestCoreLine = makeMesh(new THREE.SphereGeometry(0.042, 12, 10), matEmissive, 'ChestSignalCore', false);
  chestCoreLine.scale.set(0.85, 1.25, 0.48);
  chestCoreLine.position.set(0, 0.41, 0.245);
  chestSocket.add(chestCoreLine);

  const backJetPack = makeMesh(new THREE.SphereGeometry(0.19, 14, 12), matArmor, 'BackArmorPlate');
  backJetPack.scale.set(1.15, 1.05, 0.52);
  backJetPack.position.set(0, 0.4, -0.135);
  chestSocket.add(backJetPack);

  const collarGeo = new THREE.CylinderGeometry(0.125, 0.19, 0.11, 16, 1, false);
  const collar = makeMesh(collarGeo, matSuperGold, 'ArmoredCollar');
  collar.position.set(0, 0.56, 0.01);
  chestSocket.add(collar);

  // BackWing Socket (Modular Super / Ultimate Form Armor Pieces: Golden Winged Pauldrons, Crest & Feathered Energy Wings!)
  const backWingSocket = new THREE.Group();
  backWingSocket.name = 'BackWing';
  torsoPivot.add(backWingSocket);

  const superChestEmblem = makeMesh(
    createBeveledPlate(
      [
        [0, 0.18],
        [0.24, 0.07],
        [0.14, -0.05],
        [0, -0.16],
        [-0.14, -0.05],
        [-0.24, 0.07],
      ],
      0.05,
      0.014
    ),
    matSuperGold,
    'SuperChestEmblem'
  );
  superChestEmblem.position.set(0, 0.42, 0.24);
  backWingSocket.add(superChestEmblem);

  const superWingBladeGeo = createBeveledPlate(
    [
      [0, 0.08],
      [0.52, 0.34],
      [1.08, 0.22],
      [0.85, -0.06],
      [0.42, -0.16],
      [0, -0.08],
    ],
    0.035,
    0.01
  );
  const superLeftWingPivot = new THREE.Group();
  superLeftWingPivot.name = 'SuperLeftWingPivot';
  superLeftWingPivot.position.set(-0.18, 0.48, -0.22);
  const leftWingPrimary = makeMesh(superWingBladeGeo, matSuperWing, 'SuperWingLeftMain', false);
  leftWingPrimary.position.set(-0.56, 0.14, -0.06);
  leftWingPrimary.scale.x = -1;
  const leftWingSub = makeMesh(superWingBladeGeo, matSuperGold, 'SuperWingLeftSub', false);
  leftWingSub.position.set(-0.38, -0.04, -0.02);
  leftWingSub.scale.set(-0.68, 0.55, 1);
  leftWingSub.rotation.z = 0.28;
  superLeftWingPivot.add(leftWingPrimary, leftWingSub);

  const superRightWingPivot = new THREE.Group();
  superRightWingPivot.name = 'SuperRightWingPivot';
  superRightWingPivot.position.set(0.18, 0.48, -0.22);
  const rightWingPrimary = makeMesh(superWingBladeGeo, matSuperWing, 'SuperWingRightMain', false);
  rightWingPrimary.position.set(0.56, 0.14, -0.06);
  const rightWingSub = makeMesh(superWingBladeGeo, matSuperGold, 'SuperWingRightSub', false);
  rightWingSub.position.set(0.38, -0.04, -0.02);
  rightWingSub.scale.set(0.68, 0.55, 1);
  rightWingSub.rotation.z = -0.28;
  superRightWingPivot.add(rightWingPrimary, rightWingSub);

  const superShoulderBladeGeo = createBeveledPlate(
    [
      [0, 0],
      [0.34, 0.32],
      [0.24, 0.06],
      [0.08, -0.12],
    ],
    0.09,
    0.015
  );
  const superLShoulder = makeMesh(superShoulderBladeGeo, matSuperGold, 'SuperShoulderLeft');
  superLShoulder.position.set(-0.48, 0.62, 0);
  superLShoulder.scale.x = -1;
  const superRShoulder = makeMesh(superShoulderBladeGeo, matSuperGold, 'SuperShoulderRight');
  superRShoulder.position.set(0.48, 0.62, 0);

  backWingSocket.add(superLeftWingPivot, superRightWingPivot, superLShoulder, superRShoulder);

  // Sweeping Sculpted Tokusatsu Scarf
  const scarfUpperPivot = new THREE.Group();
  scarfUpperPivot.name = 'ScarfUpperPivot';
  scarfUpperPivot.position.set(0, 0.53, -0.15);
  torsoPivot.add(scarfUpperPivot);

  const scarfGeo1 = createBeveledPlate(
    [
      [-0.1, 0.28],
      [0.1, 0.28],
      [0.14, -0.28],
      [-0.14, -0.28],
    ],
    0.025,
    0.008
  );
  const scarfSeg1 = makeMesh(scarfGeo1, matScarf, 'ScarfSeg1');
  scarfSeg1.rotation.x = Math.PI / 2;
  scarfSeg1.position.set(0, 0, -0.27);
  scarfUpperPivot.add(scarfSeg1);

  const scarfLowerPivot = new THREE.Group();
  scarfLowerPivot.name = 'ScarfLowerPivot';
  scarfLowerPivot.position.set(0, 0, -0.53);
  scarfUpperPivot.add(scarfLowerPivot);

  const scarfGeo2 = createBeveledPlate(
    [
      [-0.13, 0.25],
      [0.13, 0.25],
      [0.06, -0.26],
      [0, -0.18],
      [-0.08, -0.28],
    ],
    0.02,
    0.006
  );
  const scarfSeg2 = makeMesh(scarfGeo2, matScarf, 'ScarfSeg2');
  scarfSeg2.rotation.x = Math.PI / 2;
  scarfSeg2.position.set(0, 0, -0.24);
  scarfLowerPivot.add(scarfSeg2);

  // Smooth Sculpted Heisei Kamen Rider Helmet (Kuuga-inspired aerodynamic dome, convex compound eyes, curved stag horns!)
  const headPivot = new THREE.Group();
  headPivot.name = 'HeadPivot';
  headPivot.position.set(0, 0.61, 0);
  torsoPivot.add(headPivot);

  const helmetLathe = createLatheLimb(
    [
      [0.01, 0.0],
      [0.125, 0.03],
      [0.178, 0.1],
      [0.205, 0.19],
      [0.202, 0.28],
      [0.155, 0.35],
      [0.08, 0.39],
      [0.01, 0.4],
    ],
    22
  );
  const helmetDome = makeMesh(helmetLathe, matArmor, 'HelmetDome');
  helmetDome.scale.set(0.94, 1.0, 1.14);
  headPivot.add(helmetDome);

  // Smooth contoured silver-gunmetal Crusher Jaw / Chin Guard
  const jawGuard = makeMesh(new THREE.SphereGeometry(0.135, 16, 12), matAccent, 'HelmetCrusherJaw');
  jawGuard.scale.set(0.95, 0.85, 1.05);
  jawGuard.position.set(0, 0.11, 0.105);
  headPivot.add(jawGuard);

  const mouthVent = makeMesh(new THREE.CapsuleGeometry(0.032, 0.06, 6, 10), matUndersuit, 'HelmetMouthVent');
  mouthVent.position.set(0, 0.085, 0.215);
  mouthVent.rotation.x = 0.22;
  headPivot.add(mouthVent);

  // Twin Large Convex Compound Eyes (catch hexagonal normal map + clearcoat sky reflections!)
  const eyeGeo = new THREE.SphereGeometry(0.088, 16, 12);
  const leftEye = makeMesh(eyeGeo, matEmissive, 'CompoundEyeLeft', false);
  leftEye.scale.set(1.08, 0.82, 0.68);
  leftEye.position.set(-0.086, 0.215, 0.178);
  leftEye.rotation.set(-0.1, -0.42, -0.22);
  const rightEye = makeMesh(eyeGeo, matEmissive, 'CompoundEyeRight', false);
  rightEye.scale.set(1.08, 0.82, 0.68);
  rightEye.position.set(0.086, 0.215, 0.178);
  rightEye.rotation.set(-0.1, 0.42, 0.22);
  headPivot.add(leftEye, rightEye);

  // Curved Kuuga-style Golden Forehead Crest & Swept Stag Horns (TubeGeometry along smooth Bezier curves!)
  const foreheadCrest = makeMesh(new THREE.SphereGeometry(0.042, 12, 10), matSuperGold, 'ForeheadCrest');
  foreheadCrest.scale.set(0.75, 1.75, 0.72);
  foreheadCrest.position.set(0, 0.295, 0.205);
  foreheadCrest.rotation.x = -0.25;
  headPivot.add(foreheadCrest);

  const foreheadGem = makeMesh(new THREE.SphereGeometry(0.028, 10, 8), matEmissive, 'ForeheadSignalGem', false);
  foreheadGem.scale.set(0.85, 1.2, 0.6);
  foreheadGem.position.set(0, 0.285, 0.232);
  headPivot.add(foreheadGem);

  const makeCurvedHorn = (side) => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(side * 0.03, 0.29, 0.21),
      new THREE.Vector3(side * 0.15, 0.35, 0.19),
      new THREE.Vector3(side * 0.21, 0.49, 0.11),
      new THREE.Vector3(side * 0.14, 0.62, 0.04),
    ]);
    return new THREE.TubeGeometry(curve, 14, 0.022, 8, false);
  };
  const leftAntenna = makeMesh(makeCurvedHorn(-1), matSuperGold, 'AntennaLeft');
  const rightAntenna = makeMesh(makeCurvedHorn(1), matSuperGold, 'AntennaRight');
  headPivot.add(leftAntenna, rightAntenna);

  // Articulated Smooth Arms with Rounded Deltoid Pauldrons, ShoulderL / ShoulderR & LeftHand / RightHand Sockets
  const buildArm = (armName, shoulderName, handName, side) => {
    const armPivot = new THREE.Group();
    armPivot.name = armName;
    armPivot.position.set(side * 0.32, 0.47, 0);

    const shoulderSocket = new THREE.Group();
    shoulderSocket.name = shoulderName;
    armPivot.add(shoulderSocket);

    const pauldronGeo = new THREE.SphereGeometry(0.135, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const pauldron = makeMesh(pauldronGeo, matArmor, `${shoulderName}_Pauldron`);
    pauldron.scale.set(1.18, 0.92, 1.05);
    pauldron.position.set(side * 0.03, 0.03, 0);
    pauldron.rotation.z = -side * 0.45;
    shoulderSocket.add(pauldron);

    const bicep = makeMesh(
      createLatheLimb(
        [
          [0.01, 0.0],
          [0.082, -0.04],
          [0.088, -0.14],
          [0.072, -0.26],
          [0.01, -0.28],
        ],
        14
      ),
      matUndersuit,
      `${armName}_Bicep`
    );
    armPivot.add(bicep);

    const gauntlet = makeMesh(
      createLatheLimb(
        [
          [0.01, -0.26],
          [0.086, -0.3],
          [0.095, -0.42],
          [0.082, -0.52],
          [0.068, -0.57],
          [0.01, -0.59],
        ],
        14
      ),
      matArmor,
      `${armName}_Gauntlet`
    );
    armPivot.add(gauntlet);

    const handSocket = new THREE.Group();
    handSocket.name = handName;
    handSocket.position.set(0, -0.58, 0.05);
    armPivot.add(handSocket);

    return armPivot;
  };

  torsoPivot.add(
    buildArm('LeftArmPivot', 'ShoulderL', 'LeftHand', -1),
    buildArm('RightArmPivot', 'ShoulderR', 'RightHand', 1)
  );

  return root;
}

// =======================================================
// 2. THREE SCULPTED WEAPONS (weapon_pyro / volt / aqua.glb)
// =======================================================
function buildPyroGreatsword() {
  const root = new THREE.Group();
  root.name = 'WeaponPyro';
  const matMetal = makeRoleMat('metallic', 0xcbd5e1, 0x000000, 0.85, 0.22);
  const matCore = makeRoleMat('blade_core', 0x1e293b, 0x000000, 0.55, 0.35);
  const matEdge = makeRoleMat('blade_edge', 0xff5722, 0xff5722, 0.15, 0.15);

  const grip = makeMesh(new THREE.CylinderGeometry(0.03, 0.036, 0.38, 8), matMetal, 'Grip');
  grip.position.set(0, -0.05, 0);
  const pommel = makeMesh(new THREE.OctahedronGeometry(0.065, 0), matEdge, 'Pommel', false);
  pommel.position.set(0, -0.26, 0);

  // Dragon-wing beveled crossguard
  const guard = makeMesh(
    createBeveledPlate(
      [
        [-0.28, 0.06],
        [-0.12, -0.05],
        [0.12, -0.05],
        [0.28, 0.06],
        [0.16, 0.14],
        [0, 0.06],
        [-0.16, 0.14],
      ],
      0.1,
      0.018
    ),
    matMetal,
    'Crossguard'
  );
  guard.position.set(0, 0.16, 0);

  // Heavy beveled Ignis Claymore blade
  const core = makeMesh(
    createBeveledPlate(
      [
        [-0.075, -0.78],
        [0.075, -0.78],
        [0.09, 0.56],
        [0, 0.82],
        [-0.09, 0.56],
      ],
      0.05,
      0.014
    ),
    matCore,
    'BladeCore'
  );
  core.position.set(0, 0.98, 0);

  const edge = makeMesh(
    createBeveledPlate(
      [
        [-0.12, -0.75],
        [0.12, -0.75],
        [0.14, 0.56],
        [0, 0.94],
        [-0.14, 0.56],
      ],
      0.018,
      0.008
    ),
    matEdge,
    'BladePlasmaEdge',
    false
  );
  edge.position.set(0, 1.0, 0);

  root.add(grip, pommel, guard, core, edge);
  return root;
}

function buildVoltDagger() {
  const root = new THREE.Group();
  root.name = 'WeaponVolt';
  const matMetal = makeRoleMat('metallic', 0xcbd5e1, 0x000000, 0.85, 0.22);
  const matCore = makeRoleMat('blade_core', 0x1e293b, 0x000000, 0.55, 0.35);
  const matEdge = makeRoleMat('blade_edge', 0x38bdf8, 0x38bdf8, 0.15, 0.15);

  const grip = makeMesh(new THREE.CylinderGeometry(0.025, 0.028, 0.26, 8), matMetal, 'DaggerGrip');
  const ring = makeMesh(new THREE.TorusGeometry(0.055, 0.014, 6, 10), matEdge, 'RingPommel', false);
  ring.position.set(0, -0.17, 0);

  const guard = makeMesh(
    createBeveledPlate(
      [
        [-0.12, 0.03],
        [0.12, 0.03],
        [0.07, -0.04],
        [-0.07, -0.04],
      ],
      0.06,
      0.01
    ),
    matMetal,
    'DaggerGuard'
  );
  guard.position.set(0, 0.12, 0);

  // Serrated Lightning-Fang Blade
  const fang = makeMesh(
    createBeveledPlate(
      [
        [-0.045, -0.38],
        [0.055, -0.38],
        [0.085, -0.1],
        [0.035, 0.02],
        [0.09, 0.16],
        [0, 0.48],
        [-0.065, 0.12],
      ],
      0.026,
      0.008
    ),
    matEdge,
    'LightningFangBlade',
    false
  );
  fang.position.set(0, 0.54, 0);

  const spine = makeMesh(new THREE.BoxGeometry(0.038, 0.62, 0.042), matCore, 'DaggerSpine');
  spine.position.set(0, 0.45, 0);

  root.add(grip, ring, guard, spine, fang);
  return root;
}

function buildAquaTrident() {
  const root = new THREE.Group();
  root.name = 'WeaponAqua';
  const matMetal = makeRoleMat('metallic', 0xcbd5e1, 0x000000, 0.85, 0.22);
  const matEdge = makeRoleMat('blade_edge', 0x22d3ee, 0x22d3ee, 0.15, 0.15);

  const shaft = makeMesh(new THREE.CylinderGeometry(0.028, 0.032, 2.05, 10), matMetal, 'TridentShaft');
  shaft.position.set(0, 0.72, 0);

  const collar = makeMesh(
    createBeveledPlate(
      [
        [-0.26, 0.06],
        [-0.1, -0.08],
        [0.1, -0.08],
        [0.26, 0.06],
        [0.22, 0.14],
        [0, 0.05],
        [-0.22, 0.14],
      ],
      0.07,
      0.015
    ),
    matMetal,
    'TridentCrosshead'
  );
  collar.position.set(0, 1.72, 0);

  const centerProng = makeMesh(
    createBeveledPlate(
      [
        [-0.045, -0.28],
        [0.045, -0.28],
        [0.07, 0.02],
        [0, 0.36],
        [-0.07, 0.02],
      ],
      0.032,
      0.01
    ),
    matEdge,
    'CenterProng',
    false
  );
  centerProng.position.set(0, 2.04, 0);

  const sideProngGeo = createBeveledPlate(
    [
      [-0.03, -0.2],
      [0.03, -0.2],
      [0.075, 0.08],
      [0.02, 0.28],
      [-0.04, 0.06],
    ],
    0.026,
    0.008
  );
  const leftProng = makeMesh(sideProngGeo, matEdge, 'LeftProng', false);
  leftProng.position.set(-0.22, 1.98, 0);
  leftProng.scale.x = -1;

  const rightProng = makeMesh(sideProngGeo, matEdge, 'RightProng', false);
  rightProng.position.set(0.22, 1.98, 0);

  root.add(shaft, collar, centerProng, leftProng, rightProng);
  return root;
}

// =======================================================
// 3. THREE SCULPTED ELEMENTAL PETS (< 5k tris each!)
// =======================================================
function buildPetPhoenix() {
  const root = new THREE.Group();
  root.name = 'PetPhoenix';
  const matBody = makeRoleMat('armor', 0xe11d48, 0x000000, 0.3, 0.45);
  const matGlow = makeRoleMat('emissive', 0xfde047, 0xff5722, 0.1, 0.2);

  const body = makeMesh(
    createLatheLimb(
      [
        [0.01, -0.58],
        [0.14, -0.35],
        [0.26, 0.0],
        [0.2, 0.35],
        [0.08, 0.58],
        [0.01, 0.68],
      ],
      10
    ),
    matBody,
    'PhoenixBody'
  );
  body.rotation.x = Math.PI / 2;
  root.add(body);

  const crest = makeMesh(
    createBeveledPlate(
      [
        [0, 0],
        [0.06, 0.22],
        [-0.05, 0.36],
        [-0.14, 0.14],
      ],
      0.05,
      0.012
    ),
    matGlow,
    'PhoenixCrest',
    false
  );
  crest.rotation.y = Math.PI / 2;
  crest.position.set(0, 0.22, 0.38);
  root.add(crest);

  const wingShape = createBeveledPlate(
    [
      [0, 0.16],
      [0.65, 0.28],
      [1.32, 0.08],
      [1.08, -0.14],
      [0.72, -0.26],
      [0.32, -0.2],
      [0, -0.14],
    ],
    0.04,
    0.012
  );
  const wingLeft = new THREE.Group();
  wingLeft.name = 'WingLeft';
  const wl = makeMesh(wingShape, matGlow, 'PhoenixWingL', false);
  wl.rotation.x = Math.PI / 2;
  wl.position.set(-0.66, 0, -0.05);
  wl.scale.x = -1;
  wingLeft.add(wl);

  const wingRight = new THREE.Group();
  wingRight.name = 'WingRight';
  const wr = makeMesh(wingShape, matGlow, 'PhoenixWingR', false);
  wr.rotation.x = Math.PI / 2;
  wr.position.set(0.66, 0, -0.05);
  wingRight.add(wr);

  const tail = makeMesh(
    createBeveledPlate(
      [
        [-0.08, 0.35],
        [0.08, 0.35],
        [0.24, -0.4],
        [0, -0.58],
        [-0.24, -0.4],
      ],
      0.03,
      0.01
    ),
    matGlow,
    'PhoenixTail',
    false
  );
  tail.rotation.x = Math.PI / 2;
  tail.position.set(0, 0.04, -0.78);

  root.add(wingLeft, wingRight, tail);
  return root;
}

function buildPetRaiju() {
  const root = new THREE.Group();
  root.name = 'PetRaiju';
  const matFur = makeRoleMat('armor', 0xfacc15, 0x000000, 0.35, 0.4);
  const matDark = makeRoleMat('undersuit', 0x1e293b, 0x000000, 0.3, 0.65);
  const matSpark = makeRoleMat('emissive', 0x38bdf8, 0x38bdf8, 0.1, 0.15);

  const torso = makeMesh(
    createLatheLimb(
      [
        [0.01, -0.58],
        [0.19, -0.45],
        [0.22, -0.05],
        [0.27, 0.32],
        [0.16, 0.56],
        [0.01, 0.6],
      ],
      10
    ),
    matFur,
    'RaijuTorso'
  );
  torso.rotation.x = Math.PI / 2;
  torso.scale.set(0.95, 1.0, 1.08);
  root.add(torso);

  const snout = makeMesh(
    new THREE.ConeGeometry(0.22, 0.54, 6),
    matFur,
    'RaijuHead'
  );
  snout.rotation.x = Math.PI / 2;
  snout.position.set(0, 0.18, 0.72);
  root.add(snout);

  const earGeo = new THREE.ConeGeometry(0.06, 0.28, 4);
  const earL = makeMesh(earGeo, matSpark, 'RaijuEarL', false);
  earL.position.set(-0.12, 0.38, 0.55);
  earL.rotation.set(-0.25, 0, 0.25);
  const earR = makeMesh(earGeo, matSpark, 'RaijuEarR', false);
  earR.position.set(0.12, 0.38, 0.55);
  earR.rotation.set(-0.25, 0, -0.25);
  root.add(earL, earR);

  // Dorsal Lightning Crest
  const mane = makeMesh(
    createBeveledPlate(
      [
        [-0.3, 0],
        [-0.1, 0.26],
        [0.02, 0.14],
        [0.22, 0.34],
        [0.32, 0.02],
      ],
      0.06,
      0.015
    ),
    matSpark,
    'RaijuLightningMane',
    false
  );
  mane.rotation.y = Math.PI / 2;
  mane.position.set(0, 0.3, 0.15);
  root.add(mane);

  // 4 Leaping Wolf Legs
  const legGeo = new THREE.CylinderGeometry(0.055, 0.04, 0.48, 6);
  const positions = [
    [-0.2, -0.22, 0.36, -0.45],
    [0.2, -0.22, 0.36, -0.45],
    [-0.2, -0.22, -0.36, 0.55],
    [0.2, -0.22, -0.36, 0.55],
  ];
  for (let i = 0; i < positions.length; i++) {
    const [x, y, z, rx] = positions[i];
    const leg = makeMesh(legGeo, matDark, `RaijuLeg${i}`);
    leg.position.set(x, y, z);
    leg.rotation.x = rx;
    root.add(leg);
  }

  const tailPivot = new THREE.Group();
  tailPivot.name = 'TailPivot';
  tailPivot.position.set(0, 0.08, -0.55);
  const boltTail = makeMesh(
    createBeveledPlate(
      [
        [0, 0],
        [0.14, 0.32],
        [0.04, 0.38],
        [0.24, 0.72],
        [0.05, 0.56],
        [-0.08, 0.34],
      ],
      0.05,
      0.012
    ),
    matSpark,
    'RaijuBoltTail',
    false
  );
  boltTail.rotation.set(-Math.PI / 2.2, Math.PI / 2, 0);
  boltTail.position.set(0, 0.15, -0.32);
  tailPivot.add(boltTail);
  root.add(tailPivot);

  return root;
}

function buildPetLeviathan() {
  const root = new THREE.Group();
  root.name = 'PetLeviathan';
  const matScale = makeRoleMat('armor', 0x0284c7, 0x000000, 0.4, 0.35);
  const matFin = makeRoleMat('emissive', 0x22d3ee, 0x22d3ee, 0.1, 0.15);

  const head = makeMesh(
    createLatheLimb(
      [
        [0.01, -0.25],
        [0.24, -0.15],
        [0.22, 0.15],
        [0.1, 0.44],
        [0.01, 0.5],
      ],
      8
    ),
    matScale,
    'LeviathanHead'
  );
  head.rotation.x = Math.PI / 2;
  head.position.set(0, 0.06, 0.56);
  root.add(head);

  const body = makeMesh(
    createLatheLimb(
      [
        [0.01, -0.55],
        [0.2, -0.45],
        [0.24, 0.0],
        [0.22, 0.45],
        [0.01, 0.52],
      ],
      10
    ),
    matScale,
    'LeviathanBody'
  );
  body.rotation.x = Math.PI / 2;
  root.add(body);

  const dorsalFin = makeMesh(
    createBeveledPlate(
      [
        [-0.45, 0],
        [-0.2, 0.38],
        [0.25, 0.42],
        [0.45, 0.06],
      ],
      0.04,
      0.01
    ),
    matFin,
    'LeviathanFin',
    false
  );
  dorsalFin.rotation.y = Math.PI / 2;
  dorsalFin.position.set(0, 0.28, 0.08);
  root.add(dorsalFin);

  const tailPivot = new THREE.Group();
  tailPivot.name = 'TailPivot';
  tailPivot.position.set(0, 0, -0.46);
  const tailBody = makeMesh(new THREE.ConeGeometry(0.19, 1.15, 8), matScale, 'LeviathanTail');
  tailBody.rotation.x = -Math.PI / 2;
  tailBody.position.set(0, 0, -0.52);
  const tailFluke = makeMesh(
    createBeveledPlate(
      [
        [0, 0.15],
        [0.36, -0.22],
        [0.08, -0.12],
        [0, -0.32],
        [-0.08, -0.12],
        [-0.36, -0.22],
      ],
      0.03,
      0.008
    ),
    matFin,
    'LeviathanFluke',
    false
  );
  tailFluke.rotation.x = Math.PI / 2;
  tailFluke.position.set(0, 0, -1.06);
  tailPivot.add(tailBody, tailFluke);
  root.add(tailPivot);

  return root;
}

// =======================================================
// 4. THREE TIERS OF SCULPTED KAIJIN ENEMIES
// =======================================================
function buildEnemyGrunt() {
  const root = new THREE.Group();
  root.name = 'EnemyGrunt';
  const matBody = makeRoleMat('enemy_body', 0x475569, 0x000000, 0.35, 0.55);
  const matTrim = makeRoleMat('enemy_trim', 0x0f172a, 0x000000, 0.3, 0.7);
  const matEye = makeRoleMat('enemy_eye', 0xf43f5e, 0xf43f5e, 0.1, 0.2);

  // Tapered insectoid legs
  const legGeo = createLatheLimb(
    [
      [0.01, 0],
      [0.07, 0.04],
      [0.09, 0.42],
      [0.11, 0.72],
      [0.01, 0.76],
    ],
    8
  );
  const lLeg = makeMesh(legGeo, matTrim, 'GruntLegL');
  lLeg.position.set(-0.18, 0, 0);
  const rLeg = makeMesh(legGeo, matTrim, 'GruntLegR');
  rLeg.position.set(0.18, 0, 0);
  root.add(lLeg, rLeg);

  const torso = makeMesh(
    createBeveledPlate(
      [
        [-0.28, 0.34],
        [0.28, 0.34],
        [0.18, -0.34],
        [-0.18, -0.34],
      ],
      0.34,
      0.04
    ),
    matBody,
    'GruntTorso'
  );
  torso.position.set(0, 1.08, 0);
  root.add(torso);

  const core = makeMesh(new THREE.OctahedronGeometry(0.14, 0), matEye, 'GruntCore', false);
  core.position.set(0, 1.12, 0.24);
  root.add(core);

  // Insectoid horned head
  const head = makeMesh(new THREE.OctahedronGeometry(0.24, 1), matTrim, 'GruntHead');
  head.position.set(0, 1.62, 0.06);
  head.scale.set(0.95, 0.9, 1.15);
  const visor = makeMesh(new THREE.BoxGeometry(0.32, 0.09, 0.12), matEye, 'GruntVisor', false);
  visor.position.set(0, 1.64, 0.24);
  root.add(head, visor);

  // Scythe Mantis Forearm Blades
  const bladeGeo = createBeveledPlate(
    [
      [-0.04, 0],
      [0.06, 0.04],
      [0.14, 0.65],
      [0, 0.8],
      [-0.05, 0.35],
    ],
    0.04,
    0.01
  );
  const lArm = makeMesh(bladeGeo, matEye, 'GruntClawL', false);
  lArm.position.set(-0.42, 0.9, 0.28);
  lArm.rotation.x = Math.PI / 2.2;
  const rArm = makeMesh(bladeGeo, matEye, 'GruntClawR', false);
  rArm.position.set(0.42, 0.9, 0.28);
  rArm.rotation.x = Math.PI / 2.2;
  root.add(lArm, rArm);

  return root;
}

function buildEnemyBrute() {
  const root = new THREE.Group();
  root.name = 'EnemyBrute';
  const matBody = makeRoleMat('enemy_body', 0x7c3aed, 0x000000, 0.45, 0.42);
  const matTrim = makeRoleMat('enemy_trim', 0x1e1b4b, 0x000000, 0.35, 0.65);
  const matEye = makeRoleMat('enemy_eye', 0xf43f5e, 0xf43f5e, 0.1, 0.2);

  // Heavy pillar legs
  const legGeo = createLatheLimb(
    [
      [0.01, 0],
      [0.16, 0.05],
      [0.14, 0.38],
      [0.18, 0.72],
      [0.01, 0.76],
    ],
    8
  );
  const lLeg = makeMesh(legGeo, matTrim, 'BruteLegL');
  lLeg.position.set(-0.26, 0, 0);
  const rLeg = makeMesh(legGeo, matTrim, 'BruteLegR');
  rLeg.position.set(0.26, 0, 0);
  root.add(lLeg, rLeg);

  // Armored Juggernaut Hex Torso
  const torso = makeMesh(
    createBeveledPlate(
      [
        [-0.48, 0.38],
        [0.48, 0.38],
        [0.36, -0.36],
        [-0.36, -0.36],
      ],
      0.52,
      0.06
    ),
    matBody,
    'BruteTorso'
  );
  torso.position.set(0, 1.12, 0);
  root.add(torso);

  const core = makeMesh(new THREE.OctahedronGeometry(0.2, 0), matEye, 'BruteCore', false);
  core.position.set(0, 1.16, 0.34);
  root.add(core);

  // Towering Spiked Juggernaut Pauldrons
  const pauldronGeo = createBeveledPlate(
    [
      [-0.2, -0.18],
      [0.24, -0.14],
      [0.34, 0.26],
      [-0.08, 0.32],
    ],
    0.36,
    0.04
  );
  const lp = makeMesh(pauldronGeo, matBody, 'BrutePauldronL');
  lp.position.set(-0.62, 1.48, 0);
  lp.scale.x = -1;
  const rp = makeMesh(pauldronGeo, matBody, 'BrutePauldronR');
  rp.position.set(0.62, 1.48, 0);
  root.add(lp, rp);

  const head = makeMesh(new THREE.CylinderGeometry(0.2, 0.24, 0.36, 6), matTrim, 'BruteHelm');
  head.position.set(0, 1.66, 0.06);
  const visor = makeMesh(new THREE.BoxGeometry(0.34, 0.1, 0.14), matEye, 'BruteVisor', false);
  visor.position.set(0, 1.68, 0.24);
  root.add(head, visor);

  // Colossal Crimson War-Mace in right arm
  const armGeo = new THREE.CylinderGeometry(0.13, 0.15, 0.72, 8);
  const lArm = makeMesh(armGeo, matTrim, 'BruteArmL');
  lArm.position.set(-0.62, 0.96, 0.12);
  const rArm = makeMesh(armGeo, matTrim, 'BruteArmR');
  rArm.position.set(0.62, 0.96, 0.16);
  rArm.rotation.x = -0.45;
  const maceHead = makeMesh(new THREE.DodecahedronGeometry(0.32, 0), matEye, 'BruteMace', false);
  maceHead.position.set(0.64, 0.74, 0.56);
  root.add(lArm, rArm, maceHead);

  return root;
}

function buildEnemyBoss() {
  const root = new THREE.Group();
  root.name = 'EnemyBossObsidian';
  const matBody = makeRoleMat('enemy_body', 0xbe123c, 0x000000, 0.5, 0.35);
  const matTrim = makeRoleMat('enemy_trim', 0x0f172a, 0x000000, 0.65, 0.32);
  const matEye = makeRoleMat('enemy_eye', 0xf43f5e, 0xf43f5e, 0.15, 0.15);

  // Regal Armored Warlord Legs
  const legGeo = createLatheLimb(
    [
      [0.01, 0],
      [0.14, 0.04],
      [0.12, 0.42],
      [0.16, 0.76],
      [0.01, 0.8],
    ],
    10
  );
  const lLeg = makeMesh(legGeo, matTrim, 'BossLegL');
  lLeg.position.set(-0.24, 0, 0);
  const rLeg = makeMesh(legGeo, matTrim, 'BossLegR');
  rLeg.position.set(0.24, 0, 0);
  root.add(lLeg, rLeg);

  // Sculpted Demon-Samurai Torso & Rib-Crest
  const torso = makeMesh(
    createBeveledPlate(
      [
        [-0.44, 0.4],
        [0.44, 0.4],
        [0.26, -0.36],
        [-0.26, -0.36],
      ],
      0.42,
      0.05
    ),
    matBody,
    'BossTorso'
  );
  torso.position.set(0, 1.15, 0);
  root.add(torso);

  const chestCore = makeMesh(new THREE.OctahedronGeometry(0.22, 0), matEye, 'BossCore', false);
  chestCore.position.set(0, 1.2, 0.28);
  chestCore.scale.set(1.1, 1.35, 0.6);
  root.add(chestCore);

  // Demon Crowned Head & Giant Swept Obsidian Horns
  const head = makeMesh(new THREE.OctahedronGeometry(0.26, 1), matTrim, 'BossHead');
  head.position.set(0, 1.72, 0.04);
  head.scale.set(0.95, 1.1, 1.05);
  const visor = makeMesh(
    createBeveledPlate(
      [
        [-0.18, 0.06],
        [0, 0.02],
        [0.18, 0.06],
        [0.14, -0.05],
        [0, -0.02],
        [-0.14, -0.05],
      ],
      0.08,
      0.01
    ),
    matEye,
    'BossVisor',
    false
  );
  visor.position.set(0, 1.74, 0.24);
  root.add(head, visor);

  const hornGeo = createBeveledPlate(
    [
      [0, 0],
      [0.07, 0.05],
      [0.28, 0.72],
      [0.16, 0.68],
    ],
    0.05,
    0.015
  );
  const hornL = makeMesh(hornGeo, matEye, 'BossHornL', false);
  hornL.position.set(-0.22, 2.02, 0.05);
  hornL.scale.x = -1;
  const hornR = makeMesh(hornGeo, matEye, 'BossHornR', false);
  hornR.position.set(0.22, 2.02, 0.05);
  root.add(hornL, hornR);

  // Floating Swept Demon Shoulder Mantles
  const mantleGeo = createBeveledPlate(
    [
      [0, -0.14],
      [0.48, 0.28],
      [0.42, 0.02],
      [0.14, -0.22],
    ],
    0.18,
    0.03
  );
  const mL = makeMesh(mantleGeo, matBody, 'BossMantleL');
  mL.position.set(-0.58, 1.56, -0.04);
  mL.scale.x = -1;
  const mR = makeMesh(mantleGeo, matBody, 'BossMantleR');
  mR.position.set(0.58, 1.56, -0.04);
  root.add(mL, mR);

  // Twin Curved Crimson Obsidian Plasma Blades
  const bladeGeo = createBeveledPlate(
    [
      [-0.06, -0.45],
      [0.06, -0.45],
      [0.14, 0.35],
      [0.02, 0.78],
      [-0.08, 0.42],
    ],
    0.045,
    0.012
  );
  const bL = makeMesh(bladeGeo, matEye, 'BossBladeL', false);
  bL.position.set(-0.62, 0.85, 0.56);
  bL.rotation.x = Math.PI / 2.2;
  const bR = makeMesh(bladeGeo, matEye, 'BossBladeR', false);
  bR.position.set(0.62, 0.85, 0.56);
  bR.rotation.x = Math.PI / 2.2;
  root.add(bL, bR);

  return root;
}

// =======================================================
// 5. REALISTIC JAPANESE INDUSTRIAL / QUARRY ARENA PROPS (arena_props.glb)
// =======================================================
function buildArenaProps() {
  const root = new THREE.Group();
  root.name = 'ArenaIndustrialProps';

  const matConcrete = makeRoleMat('arena_concrete', 0x9ca3af, 0x000000, 0.05, 0.9);
  const matSteel = makeRoleMat('arena_steel', 0x475569, 0x000000, 0.78, 0.42);
  const matLamp = makeRoleMat('arena_lamp', 0xfff3d6, 0xffe0a3, 0.1, 0.15);
  const matContainerA = makeRoleMat('arena_container_a', 0x7c2d12, 0x000000, 0.35, 0.65);
  const matContainerB = makeRoleMat('arena_container_b', 0x1e3a5f, 0x000000, 0.35, 0.65);
  const matRock = makeRoleMat('arena_rock', 0x78716c, 0x000000, 0.04, 0.94);

  const ARENA_RADIUS = 16;
  const SIDES = 8;
  const edgeLength = 2 * ARENA_RADIUS * Math.tan(Math.PI / SIDES);

  // 1. Grounded Poured-Concrete Jersey Barriers & Galvanized Guardrails along the 8 Octagon Edges
  const jerseyProfile = new THREE.Shape();
  jerseyProfile.moveTo(-0.34, 0);
  jerseyProfile.lineTo(0.34, 0);
  jerseyProfile.lineTo(0.28, 0.22);
  jerseyProfile.lineTo(0.14, 0.88);
  jerseyProfile.lineTo(-0.14, 0.88);
  jerseyProfile.lineTo(-0.28, 0.22);
  jerseyProfile.closePath();

  const barrierGeo = new THREE.ExtrudeGeometry(jerseyProfile, {
    depth: 3.4,
    bevelEnabled: true,
    bevelThickness: 0.03,
    bevelSize: 0.025,
    bevelSegments: 2,
  });
  barrierGeo.center();
  barrierGeo.rotateY(Math.PI / 2);

  const postGeo = new THREE.CylinderGeometry(0.06, 0.075, 1.35, 8);
  const railGeo = new THREE.BoxGeometry(edgeLength - 1.2, 0.07, 0.05);

  for (let i = 0; i < SIDES; i++) {
    const wallAngle = (i * Math.PI * 2) / SIDES;
    const dist = ARENA_RADIUS + 0.55;
    const cx = Math.sin(wallAngle) * dist;
    const cz = Math.cos(wallAngle) * dist;

    // 3 weathered Jersey barriers per side with natural realistic gaps
    for (let seg = -1; seg <= 1; seg++) {
      const barrier = makeMesh(barrierGeo, matConcrete, `JerseyBarrier_${i}_${seg + 1}`, false);
      const tangentX = Math.cos(wallAngle);
      const tangentZ = -Math.sin(wallAngle);
      barrier.position.set(cx + tangentX * seg * 3.8, 0.44, cz + tangentZ * seg * 3.8);
      barrier.rotation.y = wallAngle;
      root.add(barrier);
    }

    // Steel industrial safety rail mounted behind concrete barriers
    const upperRail = makeMesh(railGeo, matSteel, `GuardRail_${i}`, false);
    upperRail.position.set(
      Math.sin(wallAngle) * (ARENA_RADIUS + 0.92),
      1.18,
      Math.cos(wallAngle) * (ARENA_RADIUS + 0.92)
    );
    upperRail.rotation.y = wallAngle;
    root.add(upperRail);

    // Corner steel bollard posts
    const cornerAngle = ((i + 0.5) * Math.PI * 2) / SIDES;
    const cornerDist = ARENA_RADIUS / Math.cos(Math.PI / SIDES) + 0.65;
    const post = makeMesh(postGeo, matSteel, `CornerBollard_${i}`, false);
    post.position.set(Math.sin(cornerAngle) * cornerDist, 0.675, Math.cos(cornerAngle) * cornerDist);
    root.add(post);
  }

  // 2. Four Tall Industrial Japanese Construction / Waterfront Floodlight Towers (outside perimeter)
  const mastGeo = new THREE.CylinderGeometry(0.14, 0.28, 11.5, 10);
  const crossArmGeo = new THREE.BoxGeometry(2.6, 0.18, 0.22);
  const lampHeadGeo = new THREE.BoxGeometry(0.55, 0.28, 0.26);

  for (let i = 0; i < 4; i++) {
    const angle = (i * Math.PI) / 2 + Math.PI / 4;
    const towerDist = 21.5;
    const tx = Math.sin(angle) * towerDist;
    const tz = Math.cos(angle) * towerDist;

    const towerGroup = new THREE.Group();
    towerGroup.position.set(tx, 0, tz);
    towerGroup.rotation.y = angle + Math.PI;

    const baseBlock = makeMesh(new THREE.BoxGeometry(1.4, 0.9, 1.4), matConcrete, `LightBase_${i}`, false);
    baseBlock.position.y = 0.45;
    const mast = makeMesh(mastGeo, matSteel, `LightMast_${i}`, false);
    mast.position.y = 6.1;
    const crossArm = makeMesh(crossArmGeo, matSteel, `LightCrossArm_${i}`, false);
    crossArm.position.set(0, 11.5, 0.25);

    towerGroup.add(baseBlock, mast, crossArm);
    for (let l = -1; l <= 1; l++) {
      const lamp = makeMesh(lampHeadGeo, matLamp, `FloodLamp_${i}_${l + 1}`, false);
      lamp.position.set(l * 0.85, 11.55, 0.42);
      lamp.rotation.x = 0.35;
      towerGroup.add(lamp);
    }
    root.add(towerGroup);
  }

  // Keep horizon cleanly open beyond the concrete barriers & floodlight towers so the photographic
  // 360° Japanese mountains, harbor gantry cranes, and quarry cliffs show unobstructed without blocky primitives!
  return root;
}

// =======================================================
// Export All 11 Assets & Verify Budgets
// =======================================================
const ASSETS = [
  { file: 'rider_base.glb', builder: buildRiderBase, maxTris: 12000 },
  { file: 'weapon_pyro.glb', builder: buildPyroGreatsword, maxTris: 3000 },
  { file: 'weapon_volt.glb', builder: buildVoltDagger, maxTris: 2000 },
  { file: 'weapon_aqua.glb', builder: buildAquaTrident, maxTris: 3000 },
  { file: 'pet_phoenix.glb', builder: buildPetPhoenix, maxTris: 5000 },
  { file: 'pet_raiju.glb', builder: buildPetRaiju, maxTris: 5000 },
  { file: 'pet_leviathan.glb', builder: buildPetLeviathan, maxTris: 5000 },
  { file: 'enemy_grunt.glb', builder: buildEnemyGrunt, maxTris: 4000 },
  { file: 'enemy_brute.glb', builder: buildEnemyBrute, maxTris: 8000 },
  { file: 'enemy_boss.glb', builder: buildEnemyBoss, maxTris: 15000 },
  { file: 'arena_props.glb', builder: buildArenaProps, maxTris: 10000 },
];

async function run() {
  const exporter = new GLTFExporter();
  let totalBytes = 0;

  for (const spec of ASSETS) {
    const model = spec.builder();
    const tris = countTriangles(model);
    if (tris > spec.maxTris) {
      throw new Error(`Triangle budget exceeded for ${spec.file}: ${tris} > ${spec.maxTris}`);
    }

    const arrayBuffer = await exporter.parseAsync(model, { binary: true });
    const buf = Buffer.from(arrayBuffer);
    const outPath = path.join(OUT_DIR, spec.file);
    fs.writeFileSync(outPath, buf);
    totalBytes += buf.length;
    console.log(
      `[GLB] ${spec.file.padEnd(20)} | ${String(tris).padStart(5)} tris (limit ${spec.maxTris}) | ${(buf.length / 1024).toFixed(1)} KB`
    );
  }

  console.log(`\nTotal GLB payload: ${(totalBytes / 1024).toFixed(1)} KB (budget < 25,600 KB)`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
