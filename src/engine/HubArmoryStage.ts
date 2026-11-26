import * as THREE from 'three';

const MOTE_COUNT = 72;
const PYLON_COUNT = 6;

/**
 * Procedural 3D Tokusatsu Cyber Armory Turntable & Holographic Showcase Stage.
 * Mounted at world (0, 0, 0) exclusively during HUB mode (hidden + lights muted in ARENA).
 * - Flush dark brushed-steel armored deck plate (top at y = 0.006 so Rider boots never clip!)
 * - 3 counter-rotating high-DPI holographic telemetry rings (ground compass, levitating hex drive, angled back halo)
 * - 6 perimeter emitter pylons projecting soft additive containment light beams
 * - 72 rising GPU point-sprite energy motes (zero per-frame heap allocations!)
 * - Reactive radial pulse wave + dynamic accent rim/underglow PointLights on Rider/Element switch
 */
export class HubArmoryStage {
  public readonly root = new THREE.Group();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];

  private readonly innerDeckMesh: THREE.Mesh;
  private readonly outerBevelRing: THREE.Mesh;
  private readonly neonConduitMat: THREE.MeshBasicMaterial;
  private readonly outerGlowRingMat: THREE.MeshBasicMaterial;

  private readonly holoCompassMesh: THREE.Mesh;
  private readonly holoCompassMat: THREE.MeshBasicMaterial;
  private readonly holoInnerArcMesh: THREE.Mesh;
  private readonly holoInnerArcMat: THREE.MeshBasicMaterial;
  private readonly holoBackHaloGroup: THREE.Group;
  private readonly holoBackHaloMesh: THREE.Mesh;
  private readonly holoBackHaloMat: THREE.MeshBasicMaterial;

  private readonly pylonLensMat: THREE.MeshBasicMaterial;
  private readonly beamMat: THREE.MeshBasicMaterial;
  private readonly beamMeshes: THREE.Mesh[] = [];

  private readonly pulseWaveMesh: THREE.Mesh;
  private readonly pulseWaveMat: THREE.MeshBasicMaterial;

  private readonly motesPoints: THREE.Points;
  private readonly motesMat: THREE.PointsMaterial;
  private readonly motePositions: Float32Array;
  private readonly moteAngles: Float32Array;
  private readonly moteRadii: Float32Array;
  private readonly moteSpeeds: Float32Array;
  private readonly motePhase: Float32Array;

  private readonly rimLight: THREE.PointLight;
  private readonly underGlowLight: THREE.PointLight;

  // Reusable scratch color objects (Zero-Allocation Hot Path)
  private readonly targetAccent = new THREE.Color('#f43f5e');
  private readonly currentAccent = new THREE.Color('#f43f5e');
  private readonly targetGlow = new THREE.Color('#fda4af');
  private readonly currentGlow = new THREE.Color('#fda4af');

  private elapsed = 0;
  private pulseTime = 0;
  private readonly pulseDuration = 0.68;
  private disposed = false;

  constructor() {
    this.root.name = 'HubArmoryStage';

    // 1. Flush Armored Inner Turntable Pad (top surface at y = 0.006 -> Rider feet stay cleanly grounded!)
    const padTex = this.createDeckPlateTexture();
    const padGeo = new THREE.CylinderGeometry(1.56, 1.62, 0.012, 36);
    const padMat = new THREE.MeshStandardMaterial({
      map: padTex,
      color: 0x162238,
      metalness: 0.78,
      roughness: 0.34,
    });
    this.geometries.push(padGeo);
    this.materials.push(padMat);
    this.innerDeckMesh = new THREE.Mesh(padGeo, padMat);
    this.innerDeckMesh.position.y = 0.0;
    this.innerDeckMesh.receiveShadow = true;
    this.root.add(this.innerDeckMesh);

    // 2. Outer Chamfered Octadecagon Collar Rim (sits outside r = 1.62m so feet never touch it)
    const rimGeo = new THREE.RingGeometry(1.58, 2.38, 12);
    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x0b1324,
      metalness: 0.88,
      roughness: 0.28,
      side: THREE.DoubleSide,
    });
    this.geometries.push(rimGeo);
    this.materials.push(rimMat);
    this.outerBevelRing = new THREE.Mesh(rimGeo, rimMat);
    this.outerBevelRing.rotation.x = -Math.PI / 2;
    this.outerBevelRing.position.y = 0.014;
    this.outerBevelRing.receiveShadow = true;
    this.root.add(this.outerBevelRing);

    // 3. Recessed Luminous Energy Conduit Ring + Outer Perimeter Accent Ring
    const conduitGeo = new THREE.RingGeometry(1.51, 1.61, 48);
    this.neonConduitMat = new THREE.MeshBasicMaterial({
      color: 0xfda4af,
      transparent: true,
      opacity: 0.88,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.geometries.push(conduitGeo);
    this.materials.push(this.neonConduitMat);
    const conduitMesh = new THREE.Mesh(conduitGeo, this.neonConduitMat);
    conduitMesh.rotation.x = -Math.PI / 2;
    conduitMesh.position.y = 0.022;
    this.root.add(conduitMesh);

    const outerGlowGeo = new THREE.RingGeometry(2.35, 2.42, 48);
    this.outerGlowRingMat = new THREE.MeshBasicMaterial({
      color: 0xf43f5e,
      transparent: true,
      opacity: 0.62,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.geometries.push(outerGlowGeo);
    this.materials.push(this.outerGlowRingMat);
    const outerGlowMesh = new THREE.Mesh(outerGlowGeo, this.outerGlowRingMat);
    outerGlowMesh.rotation.x = -Math.PI / 2;
    outerGlowMesh.position.y = 0.02;
    this.root.add(outerGlowMesh);

    // 4. Holographic Ring A: Ground Tactical Compass & Degree Ticks
    const compassTex = this.createHoloRingTexture('compass');
    const compassGeo = new THREE.PlaneGeometry(5.6, 5.6);
    this.holoCompassMat = new THREE.MeshBasicMaterial({
      map: compassTex,
      color: 0xfda4af,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.geometries.push(compassGeo);
    this.materials.push(this.holoCompassMat);
    this.holoCompassMesh = new THREE.Mesh(compassGeo, this.holoCompassMat);
    this.holoCompassMesh.rotation.x = -Math.PI / 2;
    this.holoCompassMesh.position.y = 0.035;
    this.root.add(this.holoCompassMesh);

    // 5. Holographic Ring B: Counter-Rotating Levitating Drive Arcs
    const driveTex = this.createHoloRingTexture('drive');
    const driveGeo = new THREE.PlaneGeometry(4.15, 4.15);
    this.holoInnerArcMat = new THREE.MeshBasicMaterial({
      map: driveTex,
      color: 0xf43f5e,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.geometries.push(driveGeo);
    this.materials.push(this.holoInnerArcMat);
    this.holoInnerArcMesh = new THREE.Mesh(driveGeo, this.holoInnerArcMat);
    this.holoInnerArcMesh.rotation.x = -Math.PI / 2;
    this.holoInnerArcMesh.position.y = 0.16;
    this.root.add(this.holoInnerArcMesh);

    // 6. Holographic Ring C: Subtle Tilted Orbital Telemetry Halo behind Rider silhouette
    const haloTex = this.createHoloRingTexture('halo');
    const haloGeo = new THREE.PlaneGeometry(3.4, 3.4);
    this.holoBackHaloMat = new THREE.MeshBasicMaterial({
      map: haloTex,
      color: 0xfda4af,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.geometries.push(haloGeo);
    this.materials.push(this.holoBackHaloMat);
    this.holoBackHaloGroup = new THREE.Group();
    this.holoBackHaloGroup.position.set(0, 1.32, -0.58);
    this.holoBackHaloGroup.rotation.x = 0.12;
    this.holoBackHaloMesh = new THREE.Mesh(haloGeo, this.holoBackHaloMat);
    this.holoBackHaloGroup.add(this.holoBackHaloMesh);
    this.root.add(this.holoBackHaloGroup);

    // 7. 6 Perimeter Holographic Projector Pylons + Soft Volumetric Containment Beams
    const pylonBodyGeo = new THREE.BoxGeometry(0.18, 0.11, 0.28);
    const pylonBodyMat = new THREE.MeshStandardMaterial({
      color: 0x111a2e,
      metalness: 0.9,
      roughness: 0.24,
    });
    const pylonLensGeo = new THREE.BoxGeometry(0.11, 0.025, 0.15);
    this.pylonLensMat = new THREE.MeshBasicMaterial({
      color: 0xfda4af,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const beamTex = this.createVerticalBeamTexture();
    const beamGeo = new THREE.CylinderGeometry(0.06, 0.22, 2.75, 10, 1, true);
    this.beamMat = new THREE.MeshBasicMaterial({
      map: beamTex,
      color: 0xf43f5e,
      transparent: true,
      opacity: 0.22,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.geometries.push(pylonBodyGeo, pylonLensGeo, beamGeo);
    this.materials.push(pylonBodyMat, this.pylonLensMat, this.beamMat);

    // Offset by 30 deg so no pylon sits directly on camera axis (0 deg)
    for (let i = 0; i < PYLON_COUNT; i++) {
      const angle = (i / PYLON_COUNT) * Math.PI * 2 + Math.PI / 6;
      const radius = 2.42;
      const px = Math.sin(angle) * radius;
      const pz = Math.cos(angle) * radius;

      const pylon = new THREE.Group();
      pylon.position.set(px, 0.055, pz);
      pylon.rotation.y = angle;

      const body = new THREE.Mesh(pylonBodyGeo, pylonBodyMat);
      const lens = new THREE.Mesh(pylonLensGeo, this.pylonLensMat);
      lens.position.y = 0.055;
      pylon.add(body, lens);

      const beam = new THREE.Mesh(beamGeo, this.beamMat);
      beam.position.y = 1.44;
      pylon.add(beam);
      this.beamMeshes.push(beam);

      this.root.add(pylon);
    }

    // 8. Expanding Holographic Pulse Ring (flares on Rider / Element / Upgrade trigger)
    const pulseGeo = new THREE.RingGeometry(0.86, 1.0, 48);
    this.pulseWaveMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.geometries.push(pulseGeo);
    this.materials.push(this.pulseWaveMat);
    this.pulseWaveMesh = new THREE.Mesh(pulseGeo, this.pulseWaveMat);
    this.pulseWaveMesh.rotation.x = -Math.PI / 2;
    this.pulseWaveMesh.position.y = 0.08;
    this.pulseWaveMesh.visible = false;
    this.root.add(this.pulseWaveMesh);

    // 9. Rising Additive Holo-Motes (72 particles, pre-allocated Float32Arrays)
    this.motePositions = new Float32Array(MOTE_COUNT * 3);
    this.moteAngles = new Float32Array(MOTE_COUNT);
    this.moteRadii = new Float32Array(MOTE_COUNT);
    this.moteSpeeds = new Float32Array(MOTE_COUNT);
    this.motePhase = new Float32Array(MOTE_COUNT);

    for (let i = 0; i < MOTE_COUNT; i++) {
      const a = (i / MOTE_COUNT) * Math.PI * 2 + (i % 7) * 0.37;
      const r = 1.12 + ((i * 0.6180339) % 1) * 1.55;
      const y = ((i * 0.381966) % 1) * 3.1 + 0.1;
      this.moteAngles[i] = a;
      this.moteRadii[i] = r;
      this.moteSpeeds[i] = 0.36 + ((i * 0.29) % 0.52);
      this.motePhase[i] = y;
      this.motePositions[i * 3] = Math.cos(a) * r;
      this.motePositions[i * 3 + 1] = y;
      this.motePositions[i * 3 + 2] = Math.sin(a) * r;
    }

    const motesGeo = new THREE.BufferGeometry();
    motesGeo.setAttribute('position', new THREE.BufferAttribute(this.motePositions, 3));
    const moteTex = this.createMoteTexture();
    this.motesMat = new THREE.PointsMaterial({
      map: moteTex,
      color: 0xfda4af,
      size: 0.14,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.geometries.push(motesGeo);
    this.materials.push(this.motesMat);
    this.motesPoints = new THREE.Points(motesGeo, this.motesMat);
    this.root.add(this.motesPoints);

    // 10. Dedicated Dramatic Armory Rim & Underglow Lights (automatically turned off in ARENA!)
    this.rimLight = new THREE.PointLight(0xf43f5e, 4.4, 9.0, 1.5);
    this.rimLight.position.set(-1.75, 2.35, -2.05);
    this.root.add(this.rimLight);

    this.underGlowLight = new THREE.PointLight(0xfda4af, 2.2, 5.8, 1.6);
    this.underGlowLight.position.set(0.15, 0.36, 0.65);
    this.root.add(this.underGlowLight);
  }

  public setThemeColors(accentHex: string, glowHex: string, triggerSurge = false): void {
    this.targetAccent.set(accentHex);
    this.targetGlow.set(glowHex);
    if (triggerSurge) {
      this.triggerPulse();
    }
  }

  public triggerPulse(): void {
    this.pulseTime = this.pulseDuration;
    this.pulseWaveMesh.visible = true;
  }

  public setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.rimLight.visible = visible;
    this.underGlowLight.visible = visible;
  }

  public update(dt: number): void {
    if (this.disposed || !this.root.visible) return;
    const safeDt = Math.min(0.05, Math.max(0.0001, dt));
    this.elapsed += safeDt;

    // Smooth color interpolation (zero allocations)
    const colorLerp = 1 - Math.exp(-7.5 * safeDt);
    this.currentAccent.lerp(this.targetAccent, colorLerp);
    this.currentGlow.lerp(this.targetGlow, colorLerp);

    // Surge energy multiplier during Rider / Element switch pulse
    let surge = 0;
    if (this.pulseTime > 0) {
      this.pulseTime = Math.max(0, this.pulseTime - safeDt);
      const t = 1 - this.pulseTime / this.pulseDuration;
      surge = Math.sin((1 - t) * Math.PI * 0.5);
      const waveScale = 1.05 + t * 2.55;
      this.pulseWaveMesh.scale.set(waveScale, waveScale, 1);
      this.pulseWaveMesh.position.y = 0.06 + t * 0.52;
      this.pulseWaveMat.opacity = (1 - t) * (1 - t) * 0.92;
      this.pulseWaveMat.color.copy(this.currentGlow);
      if (this.pulseTime <= 0) {
        this.pulseWaveMesh.visible = false;
      }
    }

    const breath = 0.5 + 0.5 * Math.sin(this.elapsed * 2.1);

    // Counter-rotating holographic rings + spin boost during switch surge
    const spinBoost = 1 + surge * 3.8;
    this.holoCompassMesh.rotation.z += safeDt * 0.16 * spinBoost;
    this.holoInnerArcMesh.rotation.z -= safeDt * 0.34 * spinBoost;
    this.holoInnerArcMesh.position.y = 0.15 + Math.sin(this.elapsed * 1.8) * 0.035 + surge * 0.06;
    this.holoBackHaloMesh.rotation.z += safeDt * 0.12 * spinBoost;
    this.holoBackHaloGroup.position.y = 1.32 + Math.sin(this.elapsed * 1.4) * 0.05;

    // Sync emissive tints across all holographic layers
    this.neonConduitMat.color.copy(this.currentGlow);
    this.neonConduitMat.opacity = 0.72 + breath * 0.18 + surge * 0.25;

    this.outerGlowRingMat.color.copy(this.currentAccent);
    this.outerGlowRingMat.opacity = 0.48 + breath * 0.18 + surge * 0.28;

    this.holoCompassMat.color.copy(this.currentGlow);
    this.holoCompassMat.opacity = 0.58 + breath * 0.14 + surge * 0.22;

    this.holoInnerArcMat.color.copy(this.currentAccent);
    this.holoInnerArcMat.opacity = 0.52 + breath * 0.16 + surge * 0.25;

    this.holoBackHaloMat.color.copy(this.currentGlow);
    this.holoBackHaloMat.opacity = 0.24 + breath * 0.1 + surge * 0.26;

    this.pylonLensMat.color.copy(this.currentGlow);
    this.beamMat.color.copy(this.currentAccent);
    this.beamMat.opacity = 0.14 + breath * 0.07 + surge * 0.22;

    for (let i = 0; i < this.beamMeshes.length; i++) {
      const bScaleY = 0.92 + 0.12 * Math.sin(this.elapsed * 2.4 + i * 1.05) + surge * 0.28;
      this.beamMeshes[i]!.scale.set(1, bScaleY, 1);
    }

    // Dynamic Rim & Underglow Lights
    this.rimLight.color.copy(this.currentAccent);
    this.rimLight.intensity = 4.2 + breath * 0.8 + surge * 4.5;
    this.underGlowLight.color.copy(this.currentGlow);
    this.underGlowLight.intensity = 2.0 + breath * 0.5 + surge * 2.8;

    // Update rising spiraling holo-motes in place (zero allocations)
    this.motesMat.color.copy(this.currentGlow);
    const posAttr = this.motesPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < MOTE_COUNT; i++) {
      let y = this.motePhase[i]! + safeDt * this.moteSpeeds[i]! * (1 + surge * 2.2);
      if (y > 3.25) {
        y -= 3.15;
      }
      this.motePhase[i] = y;
      const angle = this.moteAngles[i]! + this.elapsed * (0.28 + (i % 3) * 0.08);
      const rad = this.moteRadii[i]! * (1 - (y / 3.4) * 0.18);
      this.motePositions[i * 3] = Math.cos(angle) * rad;
      this.motePositions[i * 3 + 1] = y;
      this.motePositions[i * 3 + 2] = Math.sin(angle) * rad;
    }
    posAttr.needsUpdate = true;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = 0; i < this.geometries.length; i++) {
      this.geometries[i]!.dispose();
    }
    for (let i = 0; i < this.materials.length; i++) {
      this.materials[i]!.dispose();
    }
    for (let i = 0; i < this.textures.length; i++) {
      this.textures[i]!.dispose();
    }
    this.geometries.length = 0;
    this.materials.length = 0;
    this.textures.length = 0;
    this.beamMeshes.length = 0;
  }

  private createDeckPlateTexture(): THREE.CanvasTexture {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const cx = size / 2;
      const cy = size / 2;
      const bg = ctx.createRadialGradient(cx, cy, 20, cx, cy, cx);
      bg.addColorStop(0, '#1e2c44');
      bg.addColorStop(0.65, '#0f172a');
      bg.addColorStop(1, '#070c18');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, size, size);

      // Subtle machined radial grooves & hex grid etching
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.16)';
      ctx.lineWidth = 2;
      for (const r of [72, 138, 198, 238]) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * 72, cy + Math.sin(a) * 72);
        ctx.lineTo(cx + Math.cos(a) * 244, cy + Math.sin(a) * 244);
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(tex);
    return tex;
  }

  private createHoloRingTexture(variant: 'compass' | 'drive' | 'halo'): THREE.CanvasTexture {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const cx = size / 2;
      const cy = size / 2;
      ctx.clearRect(0, 0, size, size);
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = '#ffffff';

      if (variant === 'compass') {
        // Outer thin telemetry ring
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 232, 0, Math.PI * 2);
        ctx.stroke();

        // 4 heavy segmented tactical arcs
        ctx.globalAlpha = 0.95;
        ctx.lineWidth = 6;
        for (let i = 0; i < 4; i++) {
          const start = i * (Math.PI / 2) + 0.18;
          ctx.beginPath();
          ctx.arc(cx, cy, 218, start, start + 0.85);
          ctx.stroke();
        }

        // 72 fine vernier degree ticks
        for (let i = 0; i < 72; i++) {
          const a = (i / 72) * Math.PI * 2;
          const major = i % 6 === 0;
          ctx.globalAlpha = major ? 0.92 : 0.42;
          ctx.lineWidth = major ? 3 : 1.5;
          const r0 = major ? 186 : 196;
          const r1 = 207;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
          ctx.stroke();
        }
      } else if (variant === 'drive') {
        // Counter-rotating hex-drive inner segmented arcs + arrowheads
        ctx.lineWidth = 5;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx.globalAlpha = 0.82;
          ctx.beginPath();
          ctx.arc(cx, cy, 212, a + 0.08, a + 0.62);
          ctx.stroke();

          ctx.globalAlpha = 0.45;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx, cy, 184, a + 0.25, a + 0.92);
          ctx.stroke();
          ctx.lineWidth = 5;
        }
        // Dashed inner ring
        ctx.globalAlpha = 0.65;
        ctx.setLineDash([12, 14]);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, 162, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        // Opposing slim orbital bracket arcs (clean hero framing!)
        ctx.lineWidth = 6;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(cx, cy, 224, -0.55, 0.55);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, 224, Math.PI - 0.55, Math.PI + 0.55);
        ctx.stroke();

        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.48;
        ctx.beginPath();
        ctx.arc(cx, cy, 206, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.textures.push(tex);
    return tex;
  }

  private createVerticalBeamTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createLinearGradient(0, 256, 0, 0);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      grad.addColorStop(0.28, 'rgba(255, 255, 255, 0.42)');
      grad.addColorStop(0.75, 'rgba(255, 255, 255, 0.08)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 64, 256);
    }
    const tex = new THREE.CanvasTexture(canvas);
    this.textures.push(tex);
    return tex;
  }

  private createMoteTexture(): THREE.CanvasTexture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
      grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
      grad.addColorStop(0.35, 'rgba(255, 255, 255, 0.65)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);
    }
    const tex = new THREE.CanvasTexture(canvas);
    this.textures.push(tex);
    return tex;
  }
}
