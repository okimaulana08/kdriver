import * as THREE from 'three';

const MAX_SAMPLES = 16;

/**
 * Zero-allocation 3D ribbon mesh trail that samples weapon base & tip positions
 * during active attack swings to render stylized Tokusatsu energy arcs.
 */
export class SlashTrail {
  public readonly mesh: THREE.Mesh;

  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;

  // Ring-shifted sample coordinates: [x, y, z] * MAX_SAMPLES
  private readonly baseSamples = new Float32Array(MAX_SAMPLES * 3);
  private readonly tipSamples = new Float32Array(MAX_SAMPLES * 3);

  private sampleCount = 0;
  private emitting = false;
  private fadeAlpha = 0;

  private readonly primaryColor = new THREE.Color(0xff5722);
  private readonly coreColor = new THREE.Color(0xfff7ed);

  constructor() {
    const vertexCount = MAX_SAMPLES * 2;
    this.positions = new Float32Array(vertexCount * 3);
    this.colors = new Float32Array(vertexCount * 3);

    const indices: number[] = [];
    for (let i = 0; i < MAX_SAMPLES - 1; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setIndex(indices);
    this.geometry.setDrawRange(0, 0);

    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  public beginSwing(colorHex: number): void {
    this.primaryColor.setHex(colorHex);
    this.sampleCount = 0;
    this.emitting = true;
    this.fadeAlpha = 1.0;
    this.mesh.visible = false;
    this.geometry.setDrawRange(0, 0);
  }

  public endSwing(): void {
    this.emitting = false;
  }

  public sample(baseWorld: THREE.Vector3, tipWorld: THREE.Vector3): void {
    if (!this.emitting) return;

    // Shift existing samples back by 1 slot (newest sample at index 0)
    const countToShift = Math.min(this.sampleCount, MAX_SAMPLES - 1);
    for (let i = countToShift; i > 0; i--) {
      const dst = i * 3;
      const src = (i - 1) * 3;
      this.baseSamples[dst] = this.baseSamples[src]!;
      this.baseSamples[dst + 1] = this.baseSamples[src + 1]!;
      this.baseSamples[dst + 2] = this.baseSamples[src + 2]!;
      this.tipSamples[dst] = this.tipSamples[src]!;
      this.tipSamples[dst + 1] = this.tipSamples[src + 1]!;
      this.tipSamples[dst + 2] = this.tipSamples[src + 2]!;
    }

    this.baseSamples[0] = baseWorld.x;
    this.baseSamples[1] = baseWorld.y;
    this.baseSamples[2] = baseWorld.z;
    this.tipSamples[0] = tipWorld.x;
    this.tipSamples[1] = tipWorld.y;
    this.tipSamples[2] = tipWorld.z;

    if (this.sampleCount < MAX_SAMPLES) {
      this.sampleCount++;
    }
    this.fadeAlpha = 1.0;
    this.rebuildGeometry();
  }

  public update(dt: number): void {
    if (this.sampleCount < 2) {
      this.mesh.visible = false;
      return;
    }

    if (!this.emitting) {
      this.fadeAlpha = Math.max(0, this.fadeAlpha - dt * 6.5);
      if (this.fadeAlpha <= 0.01) {
        this.sampleCount = 0;
        this.mesh.visible = false;
        this.geometry.setDrawRange(0, 0);
        return;
      }
      this.rebuildGeometry();
    }
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  private rebuildGeometry(): void {
    if (this.sampleCount < 2) {
      this.mesh.visible = false;
      return;
    }

    const pr = this.primaryColor.r;
    const pg = this.primaryColor.g;
    const pb = this.primaryColor.b;
    const cr = this.coreColor.r;
    const cg = this.coreColor.g;
    const cb = this.coreColor.b;

    const denom = Math.max(1, this.sampleCount - 1);

    for (let i = 0; i < this.sampleCount; i++) {
      const s = i * 3;
      const vBase = i * 6;
      const vTip = vBase + 3;

      this.positions[vBase] = this.baseSamples[s]!;
      this.positions[vBase + 1] = this.baseSamples[s + 1]!;
      this.positions[vBase + 2] = this.baseSamples[s + 2]!;

      this.positions[vTip] = this.tipSamples[s]!;
      this.positions[vTip + 1] = this.tipSamples[s + 1]!;
      this.positions[vTip + 2] = this.tipSamples[s + 2]!;

      // Smooth fade from bright blade leading edge (i=0) to invisible tail (i=sampleCount-1)
      const tailFactor = Math.pow(1 - i / denom, 1.45) * this.fadeAlpha;
      const baseIntensity = tailFactor * 0.45;
      const tipIntensity = tailFactor * 1.0;

      // Inner base uses elemental primary hue
      this.colors[vBase] = pr * baseIntensity;
      this.colors[vBase + 1] = pg * baseIntensity;
      this.colors[vBase + 2] = pb * baseIntensity;

      // Outer tip blends hot bright core + elemental hue
      this.colors[vTip] = (pr * 0.65 + cr * 0.35) * tipIntensity;
      this.colors[vTip + 1] = (pg * 0.65 + cg * 0.35) * tipIntensity;
      this.colors[vTip + 2] = (pb * 0.65 + cb * 0.35) * tipIntensity;
    }

    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    this.geometry.setDrawRange(0, (this.sampleCount - 1) * 6);
    this.mesh.visible = true;
  }
}
