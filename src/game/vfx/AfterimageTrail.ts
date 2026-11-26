import * as THREE from 'three';

const POOL_SIZE = 8;

interface GhostSlot {
  active: boolean;
  elapsed: number;
  duration: number;
  baseScale: number;
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  uniforms: {
    uProgress: { value: number };
    uTime: { value: number };
    uColor: { value: THREE.Color };
  };
}

/**
 * Builds a sleek, organic sculpted Rider silhouette mesh (smooth LatheGeometry body + tapered swept scarf wing)
 * for high-speed holographic Tokusatsu Afterimage Ghosts (zero Box/Cylinder primitives!).
 */
function buildRiderSilhouetteGeometry(): THREE.BufferGeometry {
  // Heroic stylized Rider upper/lower body profile via LatheGeometry (smooth continuous silhouette)
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(0.08, 0.0),
    new THREE.Vector2(0.24, 0.08),
    new THREE.Vector2(0.2, 0.52),
    new THREE.Vector2(0.26, 0.92), // Hips / K-Driver belt flare
    new THREE.Vector2(0.21, 1.08), // Tapered waist
    new THREE.Vector2(0.36, 1.38), // Broad armored shoulders
    new THREE.Vector2(0.14, 1.54), // Neck collar
    new THREE.Vector2(0.18, 1.66), // Helmet visor ridge
    new THREE.Vector2(0.15, 1.82), // Helmet crown
    new THREE.Vector2(0.02, 1.92), // Crest tip
  ];
  const geo = new THREE.LatheGeometry(pts, 16);
  // Subtle athletic chest-front oval flattening (wider across shoulders X, sleeker front-to-back Z)
  geo.scale(1.12, 1.0, 0.72);
  geo.computeVertexNormals();
  return geo;
}

const GHOST_VERTEX_SHADER = /* glsl */ `
  uniform float uProgress;
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying float vHeightNorm;

  void main() {
    vUv = uv;
    vHeightNorm = clamp(position.y / 1.92, 0.0, 1.0);
    // Subtle backward wind-stretch as the afterimage dissipates
    vec3 pos = position;
    pos.z -= uProgress * 0.42 * (0.35 + vHeightNorm * 0.65);
    pos.x *= 1.0 + uProgress * 0.14;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    vNormalView = normalize(normalMatrix * normal);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const GHOST_FRAGMENT_SHADER = /* glsl */ `
  uniform float uProgress;
  uniform float uTime;
  uniform vec3 uColor;

  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewDir;
  varying float vHeightNorm;

  void main() {
    float ndv = abs(dot(normalize(vNormalView), normalize(vViewDir)));
    float fresnel = pow(1.0 - ndv, 2.05);
    float scanlines = 0.72 + 0.28 * sin(vHeightNorm * 46.0 - uTime * 22.0);
    float verticalFade = smoothstep(0.0, 0.16, vHeightNorm) * smoothstep(1.02, 0.86, vHeightNorm);

    float fade = pow(1.0 - clamp(uProgress, 0.0, 1.0), 1.45);
    float intensity = (fresnel * 1.35 + 0.24) * scanlines * verticalFade;
    float alpha = clamp(intensity * fade * 0.82, 0.0, 0.9);
    if (alpha < 0.02) discard;

    vec3 col = mix(uColor * 1.45, vec3(0.96, 0.99, 1.0) * 2.2, pow(fresnel, 2.2) * 0.68);
    gl_FragColor = vec4(col, alpha);
  }
`;

/**
 * Zero-allocation, object-pooled 3D Holographic Rider Afterimage Trail for:
 * - Dodge / Perfect Dodge high-speed bursts
 * - Warp Counter instant teleport line
 * - Flying Rider Kick & Hyper Rider Kick aerial dives
 * - Super / Ultimate Form sprint & lunge accents
 */
export class AfterimageTrail {
  public readonly root = new THREE.Group();

  private readonly sharedGeo: THREE.BufferGeometry;
  private readonly slots: GhostSlot[] = [];
  private cursor = 0;
  private elapsedClock = 0;

  constructor() {
    this.root.name = 'RiderAfterimageTrailRoot';
    this.sharedGeo = buildRiderSilhouetteGeometry();

    for (let i = 0; i < POOL_SIZE; i++) {
      const uniforms = {
        uProgress: { value: 1 },
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0x38bdf8) },
      };
      const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: GHOST_VERTEX_SHADER,
        fragmentShader: GHOST_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.FrontSide,
      });
      const mesh = new THREE.Mesh(this.sharedGeo, material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      this.root.add(mesh);

      this.slots.push({
        active: false,
        elapsed: 0,
        duration: 0.34,
        baseScale: 1.0,
        mesh,
        material,
        uniforms,
      });
    }
  }

  public setWarmupVisible(visible: boolean): void {
    const slot = this.slots[0];
    if (!slot) return;
    slot.mesh.visible = visible;
    if (visible) {
      slot.mesh.position.set(0, -45, 0);
      slot.uniforms.uProgress.value = 0.2;
    }
  }

  public spawnGhost(
    x: number,
    y: number,
    z: number,
    yaw: number,
    colorHex: number,
    leanPitch = 0.24,
    duration = 0.34,
    scale = 1.0
  ): void {
    const slot = this.slots[this.cursor % this.slots.length]!;
    this.cursor++;

    slot.active = true;
    slot.elapsed = 0;
    slot.duration = Math.max(0.14, duration);
    slot.baseScale = scale;
    slot.uniforms.uProgress.value = 0;
    slot.uniforms.uTime.value = this.elapsedClock;
    slot.uniforms.uColor.value.setHex(colorHex);

    slot.mesh.position.set(x, Math.max(0.02, y - 0.92), z);
    slot.mesh.rotation.set(leanPitch, yaw, 0, 'YXZ');
    slot.mesh.scale.setScalar(scale);
    slot.mesh.visible = true;
  }

  /**
   * Drops 3 staggered luminous afterimage silhouettes along a Warp Counter teleport vector!
   */
  public spawnWarpTrail(
    fromX: number,
    fromY: number,
    fromZ: number,
    toX: number,
    toY: number,
    toZ: number,
    yaw: number,
    colorHex: number
  ): void {
    for (let i = 0; i < 3; i++) {
      const f = i / 2.5;
      this.spawnGhost(
        fromX + (toX - fromX) * f,
        fromY + (toY - fromY) * f,
        fromZ + (toZ - fromZ) * f,
        yaw,
        colorHex,
        0.38,
        0.32 + i * 0.06,
        1.02 + i * 0.04
      );
    }
  }

  public update(dt: number): void {
    if (dt <= 0) return;
    this.elapsedClock += dt;

    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      if (!slot.active) continue;

      slot.elapsed += dt;
      if (slot.elapsed >= slot.duration) {
        slot.active = false;
        slot.mesh.visible = false;
        continue;
      }

      const p = slot.elapsed / slot.duration;
      slot.uniforms.uProgress.value = p;
      slot.uniforms.uTime.value = this.elapsedClock;
      slot.mesh.scale.setScalar(slot.baseScale * (1.0 + p * 0.08));
    }
  }

  public clearAll(): void {
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i]!.active = false;
      this.slots[i]!.mesh.visible = false;
    }
  }

  public dispose(): void {
    this.clearAll();
    this.sharedGeo.dispose();
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i]!.material.dispose();
    }
  }
}
