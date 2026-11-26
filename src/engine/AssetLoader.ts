import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import {
  createFallbackPbrTextureSet,
  disposePbrTextureSet,
  type PbrTextureSet,
} from './PbrMaterialSystem';
import { computeNormalizedRigScale } from './SkeletalAnimator';

export type AssetKey =
  | 'rider_base'
  | 'weapon_pyro'
  | 'weapon_volt'
  | 'weapon_aqua'
  | 'pet_phoenix'
  | 'pet_raiju'
  | 'pet_leviathan'
  | 'enemy_grunt'
  | 'enemy_brute'
  | 'enemy_boss'
  | 'arena_props';

export const ASSET_MANIFEST: Readonly<Record<AssetKey, string>> = {
  rider_base: '/assets/models/rider_base.glb',
  weapon_pyro: '/assets/models/weapon_pyro.glb',
  weapon_volt: '/assets/models/weapon_volt.glb',
  weapon_aqua: '/assets/models/weapon_aqua.glb',
  pet_phoenix: '/assets/models/pet_phoenix.glb',
  pet_raiju: '/assets/models/pet_raiju.glb',
  pet_leviathan: '/assets/models/pet_leviathan.glb',
  enemy_grunt: '/assets/models/enemy_grunt.glb',
  enemy_brute: '/assets/models/enemy_brute.glb',
  enemy_boss: '/assets/models/enemy_boss.glb',
  arena_props: '/assets/models/arena_props.glb',
};

export const PBR_TEXTURE_PATHS = {
  skybox360: '/assets/textures/env_tokusatsu_360.jpg',
  floorAlbedo: '/assets/textures/floor_concrete_albedo.jpg',
  floorNormal: '/assets/textures/floor_concrete_normal.png',
  floorRoughness: '/assets/textures/floor_concrete_roughness.png',
  undersuitNormal: '/assets/textures/undersuit_ribbed_normal.png',
  compoundEyeNormal: '/assets/textures/compound_eye_hex_normal.png',
  armorWearRoughness: '/assets/textures/armor_wear_roughness.png',
  kaijinChitinNormal: '/assets/textures/kaijin_chitin_normal.png',
} as const;

export const CUSTOM_MANIFEST_URL = '/assets/models/custom/manifest.json';

export interface CustomRigSlotConfig {
  modelUrl: string | null;
  targetHeightMeters?: number;
  animationUrls?: Record<string, string | null>;
}

export interface CustomRigManifest {
  rider?: CustomRigSlotConfig;
  rider_super?: CustomRigSlotConfig;
  rider_ultimate?: CustomRigSlotConfig;
  enemy_grunt?: CustomRigSlotConfig;
  enemy_brute?: CustomRigSlotConfig;
  enemy_boss?: CustomRigSlotConfig;
  boss_magma?: CustomRigSlotConfig;
  boss_sylvan?: CustomRigSlotConfig;
  boss_chrono?: CustomRigSlotConfig;
  boss_cryo?: CustomRigSlotConfig;
  weapon_pyro?: CustomRigSlotConfig;
  weapon_volt?: CustomRigSlotConfig;
  weapon_aqua?: CustomRigSlotConfig;
  weapon_terra?: CustomRigSlotConfig;
  weapon_aero?: CustomRigSlotConfig;
  weapon_flora?: CustomRigSlotConfig;
  weapon_solar?: CustomRigSlotConfig;
  weapon_lunar?: CustomRigSlotConfig;
  weapon_umbra?: CustomRigSlotConfig;
  weapon_lux?: CustomRigSlotConfig;
  pet_phoenix?: CustomRigSlotConfig;
  pet_raiju?: CustomRigSlotConfig;
  pet_leviathan?: CustomRigSlotConfig;
}

export type OptionalCustomAssetKey =
  | 'rider_super'
  | 'rider_ultimate'
  | 'boss_magma'
  | 'boss_sylvan'
  | 'boss_chrono'
  | 'boss_cryo'
  | 'weapon_terra'
  | 'weapon_aero'
  | 'weapon_flora'
  | 'weapon_solar'
  | 'weapon_lunar'
  | 'weapon_umbra'
  | 'weapon_lux';

const OPTIONAL_CUSTOM_KEYS: readonly OptionalCustomAssetKey[] = [
  'rider_super',
  'rider_ultimate',
  'boss_magma',
  'boss_sylvan',
  'boss_chrono',
  'boss_cryo',
  'weapon_terra',
  'weapon_aero',
  'weapon_flora',
  'weapon_solar',
  'weapon_lunar',
  'weapon_umbra',
  'weapon_lux',
];

export interface LoadedAssetPrototype {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  isSkinned: boolean;
  isCustomExternal: boolean;
}

export interface ClonedAssetInstance {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  isSkinned: boolean;
  isCustomExternal: boolean;
}

export interface LoadedPropPrototype {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  size: THREE.Vector3;
}

export type AssetProgressCallback = (loaded: number, total: number, currentKey: string) => void;

const CUSTOM_SLOT_TO_ASSET_KEY: Readonly<
  Record<Exclude<keyof CustomRigManifest, OptionalCustomAssetKey>, AssetKey>
> = {
  rider: 'rider_base',
  enemy_grunt: 'enemy_grunt',
  enemy_brute: 'enemy_brute',
  enemy_boss: 'enemy_boss',
  weapon_pyro: 'weapon_pyro',
  weapon_volt: 'weapon_volt',
  weapon_aqua: 'weapon_aqua',
  pet_phoenix: 'pet_phoenix',
  pet_raiju: 'pet_raiju',
  pet_leviathan: 'pet_leviathan',
};

const DEFAULT_TARGET_HEIGHTS: Readonly<Record<keyof CustomRigManifest, number>> = {
  rider: 1.84,
  rider_super: 1.94,
  rider_ultimate: 2.02,
  enemy_grunt: 1.75,
  enemy_brute: 2.25,
  enemy_boss: 2.7,
  boss_magma: 2.85,
  boss_sylvan: 2.85,
  boss_chrono: 2.75,
  boss_cryo: 2.95,
  weapon_pyro: 2.1,
  weapon_volt: 1.28,
  weapon_aqua: 2.65,
  weapon_terra: 2.15,
  weapon_aero: 1.72,
  weapon_flora: 1.68,
  weapon_solar: 2.55,
  weapon_lunar: 2.45,
  weapon_umbra: 0.56,
  weapon_lux: 2.65,
  pet_phoenix: 1.45,
  pet_raiju: 1.25,
  pet_leviathan: 1.4,
};

/**
 * Centralized GLTF + Draco + PBR Texture + Custom Mixamo Skeletal Rig loader.
 * Uses SkeletonUtils.clone() for SkinnedMeshes so cloned enemies and stage replays never
 * corrupt shared skeleton bone matrices, while sharing immutable GPU BufferGeometries.
 */
export class AssetLoader {
  private readonly gltfLoader: GLTFLoader;
  private readonly dracoLoader: DRACOLoader;
  private readonly textureLoader: THREE.TextureLoader;
  private readonly cache = new Map<AssetKey, LoadedAssetPrototype>();
  private readonly optionalCache = new Map<OptionalCustomAssetKey, LoadedAssetPrototype>();
  private readonly propCache = new Map<string, LoadedPropPrototype>();
  private pbrTextures: PbrTextureSet | null = null;
  private skyboxTexture: THREE.Texture | null = null;
  private disposed = false;

  constructor(dracoDecoderPath = '/draco/') {
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath(dracoDecoderPath);

    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
    this.textureLoader = new THREE.TextureLoader();
  }

  public get loadedCount(): number {
    return this.cache.size;
  }

  public get isRiderCustomSkeletal(): boolean {
    const proto = this.cache.get('rider_base');
    return Boolean(proto && (proto.isCustomExternal || (proto.isSkinned && proto.animations.length > 0)));
  }

  public has(key: AssetKey): boolean {
    return this.cache.has(key);
  }

  public hasOptional(key: OptionalCustomAssetKey): boolean {
    return this.optionalCache.has(key);
  }

  public cloneOptionalRig(key: OptionalCustomAssetKey): ClonedAssetInstance | null {
    const prototype = this.optionalCache.get(key);
    if (!prototype) return null;

    const clonedObj = prototype.isSkinned
      ? SkeletonUtils.clone(prototype.scene)
      : prototype.scene.clone(true);

    let sceneGroup: THREE.Group;
    if (clonedObj instanceof THREE.Group) {
      sceneGroup = clonedObj;
    } else {
      sceneGroup = new THREE.Group();
      sceneGroup.add(clonedObj);
    }

    return {
      scene: sceneGroup,
      animations: prototype.animations,
      isSkinned: prototype.isSkinned,
      isCustomExternal: prototype.isCustomExternal,
    };
  }

  public getPbrTextures(): PbrTextureSet {
    if (!this.pbrTextures) {
      this.pbrTextures = createFallbackPbrTextureSet();
    }
    return this.pbrTextures;
  }

  public getSkyboxTexture(): THREE.Texture | null {
    return this.skyboxTexture;
  }

  public async load(key: AssetKey): Promise<THREE.Group> {
    const cached = this.cache.get(key);
    if (cached) return cached.scene;

    const url = ASSET_MANIFEST[key];
    const proto = await this.loadGltfPrototype(url, false);
    if (this.disposed) {
      this.disposeHierarchy(proto.scene);
      return proto.scene;
    }

    this.cache.set(key, proto);
    return proto.scene;
  }

  public async preloadAll(onProgress?: AssetProgressCallback): Promise<void> {
    const customManifest = await this.fetchCustomManifest();
    const keys = Object.keys(ASSET_MANIFEST) as AssetKey[];
    const total = keys.length + 2; // 11 models + PBR texture pack + 360 skybox
    let completed = 0;

    const tick = (label: string) => {
      completed++;
      if (!this.disposed) {
        onProgress?.(completed, total, label);
      }
    };

    const customByAssetKey = new Map<
      AssetKey,
      { config: CustomRigSlotConfig; defaultHeight: number }
    >();
    if (customManifest) {
      const slotNames = Object.keys(CUSTOM_SLOT_TO_ASSET_KEY) as Array<
        Exclude<keyof CustomRigManifest, OptionalCustomAssetKey>
      >;
      for (let i = 0; i < slotNames.length; i++) {
        const slotName = slotNames[i]!;
        const slotCfg = customManifest[slotName];
        if (slotCfg?.modelUrl) {
          customByAssetKey.set(CUSTOM_SLOT_TO_ASSET_KEY[slotName], {
            config: slotCfg,
            defaultHeight: DEFAULT_TARGET_HEIGHTS[slotName],
          });
        }
      }
    }

    const loadOptionalSlot = async (optKey: OptionalCustomAssetKey): Promise<void> => {
      const cfg = customManifest?.[optKey];
      if (!cfg?.modelUrl) return;
      try {
        const proto = await this.loadCustomRigPrototype(cfg, DEFAULT_TARGET_HEIGHTS[optKey]);
        if (!this.disposed) {
          this.optionalCache.set(optKey, proto);
        }
      } catch (err) {
        console.warn(`[AssetLoader] Optional "${optKey}" ("${cfg.modelUrl}") skipped:`, err);
      }
    };

    await Promise.all([
      ...keys.map(async (key) => {
        const customEntry = customByAssetKey.get(key);
        if (customEntry && customEntry.config.modelUrl) {
          try {
            const customProto = await this.loadCustomRigPrototype(
              customEntry.config,
              customEntry.defaultHeight
            );
            if (!this.disposed) {
              this.cache.set(key, customProto);
              tick(`${key} (custom)`);
              return;
            }
          } catch (err) {
            console.warn(
              `[AssetLoader] Custom rig "${customEntry.config.modelUrl}" failed to load; falling back to default "${key}.glb".`,
              err
            );
          }
        }
        await this.load(key);
        tick(`${key}.glb`);
      }),
      ...OPTIONAL_CUSTOM_KEYS.map((optKey) => loadOptionalSlot(optKey)),
      this.loadPbrTexturePack().then(() => tick('PBR textures')),
      this.loadEnvironmentSkybox().then(() => tick('360° skybox')),
    ]);
  }

  /**
   * Returns a lightweight scene-graph clone sharing cached GPU geometries.
   * Automatically uses SkeletonUtils.clone() for rigged/skinned Mixamo characters.
   */
  public cloneModel(key: AssetKey): THREE.Group {
    return this.cloneRig(key).scene;
  }

  public cloneRig(key: AssetKey): ClonedAssetInstance {
    const prototype = this.cache.get(key);
    if (!prototype) {
      throw new Error(`Asset "${key}" requested before preloadAll() completed.`);
    }

    const clonedObj = prototype.isSkinned
      ? SkeletonUtils.clone(prototype.scene)
      : prototype.scene.clone(true);

    let sceneGroup: THREE.Group;
    if (clonedObj instanceof THREE.Group) {
      sceneGroup = clonedObj;
    } else {
      sceneGroup = new THREE.Group();
      sceneGroup.add(clonedObj);
    }

    return {
      scene: sceneGroup,
      animations: prototype.animations,
      isSkinned: prototype.isSkinned,
      isCustomExternal: prototype.isCustomExternal,
    };
  }

  public findSocket(root: THREE.Object3D, socketName: string): THREE.Object3D | null {
    return root.getObjectByName(socketName) ?? null;
  }

  /**
   * Lazy-loads a single-mesh sculpted environment prop `.glb` (Draco + WebP), centers X/Z and grounds
   * its base cleanly at y = 0, and caches its GPU geometry & PBR material for zero-overhead `THREE.InstancedMesh` rendering.
   */
  public async loadPropPrototype(
    url: string,
    options?: { doubleSide?: boolean; envMapIntensity?: number }
  ): Promise<LoadedPropPrototype | null> {
    const cached = this.propCache.get(url);
    if (cached) return cached;

    try {
      const gltf = await this.gltfLoader.loadAsync(url);
      if (this.disposed) {
        this.disposeHierarchy(gltf.scene);
        return null;
      }

      gltf.scene.updateMatrixWorld(true);
      let foundMesh: THREE.Mesh | null = null;
      gltf.scene.traverse((obj) => {
        if (!foundMesh && obj instanceof THREE.Mesh && obj.geometry) {
          foundMesh = obj;
        }
      });

      if (!foundMesh) {
        this.disposeHierarchy(gltf.scene);
        return null;
      }

      const mesh = foundMesh as THREE.Mesh;
      const geo = mesh.geometry.clone();
      geo.applyMatrix4(mesh.matrixWorld);
      geo.computeBoundingBox();
      const box = geo.boundingBox ?? new THREE.Box3();
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      // Ground base cleanly at y = 0 and center X/Z so InstancedMesh placement sits flush on terrain
      geo.translate(-center.x, -box.min.y, -center.z);
      geo.computeBoundingBox();
      geo.computeBoundingSphere();
      geo.userData.sharedAssetGeometry = true;

      const rawMat = Array.isArray(mesh.material) ? mesh.material[0]! : mesh.material;
      const mat = rawMat.clone();
      if (mat instanceof THREE.MeshStandardMaterial) {
        mat.envMapIntensity = options?.envMapIntensity ?? 1.15;
        if (options?.doubleSide) {
          mat.side = THREE.DoubleSide;
        }
        mat.needsUpdate = true;
      }

      this.disposeHierarchy(gltf.scene);

      const proto: LoadedPropPrototype = { geometry: geo, material: mat, size };
      this.propCache.set(url, proto);
      return proto;
    } catch (err) {
      console.warn(`[AssetLoader] Optional arena prop "${url}" failed to load:`, err);
      return null;
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const proto of this.cache.values()) {
      this.disposeHierarchy(proto.scene);
    }
    this.cache.clear();
    for (const proto of this.optionalCache.values()) {
      this.disposeHierarchy(proto.scene);
    }
    this.optionalCache.clear();
    for (const prop of this.propCache.values()) {
      prop.geometry.dispose();
      prop.material.dispose();
    }
    this.propCache.clear();

    if (this.pbrTextures) {
      disposePbrTextureSet(this.pbrTextures);
      this.pbrTextures = null;
    }
    if (this.skyboxTexture) {
      this.skyboxTexture.dispose();
      this.skyboxTexture = null;
    }

    this.dracoLoader.dispose();
  }

  private async fetchCustomManifest(): Promise<CustomRigManifest | null> {
    if (typeof fetch === 'undefined') return null;
    try {
      const res = await fetch(CUSTOM_MANIFEST_URL, { cache: 'no-cache' });
      if (!res.ok) return null;
      return (await res.json()) as CustomRigManifest;
    } catch {
      return null;
    }
  }

  private async loadGltfPrototype(
    url: string,
    isCustomExternal: boolean
  ): Promise<LoadedAssetPrototype> {
    const gltf = await this.gltfLoader.loadAsync(url);
    let isSkinned = false;

    gltf.scene.traverse((obj) => {
      if (obj instanceof THREE.SkinnedMesh) {
        isSkinned = true;
      }
      if (obj instanceof THREE.Mesh && obj.geometry) {
        obj.geometry.userData.sharedAssetGeometry = true;
      }
    });

    return {
      scene: gltf.scene,
      animations: gltf.animations ?? [],
      isSkinned,
      isCustomExternal,
    };
  }

  private async loadCustomRigPrototype(
    config: CustomRigSlotConfig,
    defaultHeightMeters: number
  ): Promise<LoadedAssetPrototype> {
    const baseProto = await this.loadGltfPrototype(config.modelUrl!, true);

    // Normalize bounding-box height & ground feet cleanly at y = 0 regardless of cm/m export scale
    const wrapper = new THREE.Group();
    wrapper.name = 'CustomNormalizedRig';
    wrapper.add(baseProto.scene);

    baseProto.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(baseProto.scene);
    const size = new THREE.Vector3();
    box.getSize(size);

    const targetHeight = config.targetHeightMeters ?? defaultHeightMeters;
    const uniformScale = computeNormalizedRigScale(size.y, targetHeight);
    baseProto.scene.scale.multiplyScalar(uniformScale);
    baseProto.scene.updateMatrixWorld(true);

    const scaledBox = new THREE.Box3().setFromObject(baseProto.scene);
    baseProto.scene.position.y -= scaledBox.min.y;

    const mergedClips: THREE.AnimationClip[] = [...baseProto.animations];

    // Load any separate external Mixamo animation .glb clip files declared in manifest.json
    if (config.animationUrls) {
      const entries = Object.entries(config.animationUrls).filter(
        (pair): pair is [string, string] => typeof pair[1] === 'string' && pair[1].length > 0
      );

      await Promise.all(
        entries.map(async ([stateKey, clipUrl]) => {
          try {
            const animGltf = await this.gltfLoader.loadAsync(clipUrl);
            for (let i = 0; i < animGltf.animations.length; i++) {
              const clip = animGltf.animations[i]!.clone();
              // Tag with manifest state key so SkeletalAnimator matches it unambiguously
              clip.name = i === 0 ? `${stateKey}_${clip.name}` : clip.name;
              mergedClips.push(clip);
            }
            this.disposeHierarchy(animGltf.scene);
          } catch (err) {
            console.warn(`[AssetLoader] Optional custom animation "${clipUrl}" skipped:`, err);
          }
        })
      );
    }

    return {
      scene: wrapper,
      animations: mergedClips,
      isSkinned: baseProto.isSkinned,
      isCustomExternal: true,
    };
  }

  private async loadPbrTexturePack(): Promise<void> {
    const loadTex = async (
      url: string,
      isColor: boolean,
      repeatX: number,
      repeatY: number
    ): Promise<THREE.Texture | null> => {
      try {
        const tex = await this.textureLoader.loadAsync(url);
        if (this.disposed) {
          tex.dispose();
          return null;
        }
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeatX, repeatY);
        tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.anisotropy = 4;
        tex.needsUpdate = true;
        return tex;
      } catch {
        return null;
      }
    };

    const fallback = createFallbackPbrTextureSet();
    const [
      floorAlbedo,
      floorNormal,
      floorRoughness,
      undersuitNormal,
      compoundEyeNormal,
      armorWearRoughness,
      kaijinChitinNormal,
    ] = await Promise.all([
      loadTex(PBR_TEXTURE_PATHS.floorAlbedo, true, 6, 6),
      loadTex(PBR_TEXTURE_PATHS.floorNormal, false, 6, 6),
      loadTex(PBR_TEXTURE_PATHS.floorRoughness, false, 6, 6),
      loadTex(PBR_TEXTURE_PATHS.undersuitNormal, false, 5, 5),
      loadTex(PBR_TEXTURE_PATHS.compoundEyeNormal, false, 4, 4),
      loadTex(PBR_TEXTURE_PATHS.armorWearRoughness, false, 2, 2),
      loadTex(PBR_TEXTURE_PATHS.kaijinChitinNormal, false, 4, 4),
    ]);

    if (this.disposed) {
      disposePbrTextureSet(fallback);
      floorAlbedo?.dispose();
      floorNormal?.dispose();
      floorRoughness?.dispose();
      undersuitNormal?.dispose();
      compoundEyeNormal?.dispose();
      armorWearRoughness?.dispose();
      kaijinChitinNormal?.dispose();
      return;
    }

    const pick = (loaded: THREE.Texture | null, fb: THREE.Texture): THREE.Texture => {
      if (loaded) {
        fb.dispose();
        return loaded;
      }
      return fb;
    };

    this.pbrTextures = {
      floorAlbedo: pick(floorAlbedo, fallback.floorAlbedo),
      floorNormal: pick(floorNormal, fallback.floorNormal),
      floorRoughness: pick(floorRoughness, fallback.floorRoughness),
      undersuitNormal: pick(undersuitNormal, fallback.undersuitNormal),
      compoundEyeNormal: pick(compoundEyeNormal, fallback.compoundEyeNormal),
      armorWearRoughness: pick(armorWearRoughness, fallback.armorWearRoughness),
      kaijinChitinNormal: pick(kaijinChitinNormal, fallback.kaijinChitinNormal),
    };
  }

  private async loadEnvironmentSkybox(): Promise<void> {
    try {
      const tex = await this.textureLoader.loadAsync(PBR_TEXTURE_PATHS.skybox360);
      if (this.disposed) {
        tex.dispose();
        return;
      }
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      this.skyboxTexture = tex;
    } catch {
      this.skyboxTexture = null;
    }
  }

  private disposeHierarchy(root: THREE.Object3D): void {
    root.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) {
          for (let i = 0; i < mat.length; i++) {
            mat[i]?.dispose();
          }
        } else {
          mat.dispose();
        }
      }
    });
  }
}

export function countTrianglesInObject(root: THREE.Object3D): number {
  let tris = 0;
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry && !obj.userData.isOutlineMesh) {
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
