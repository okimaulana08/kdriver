import * as THREE from 'three';
import type { ArenaThemeId } from '../game/types/schema';
import type { AssetLoader, LoadedPropPrototype } from './AssetLoader';
import type { PbrTextureSet } from './PbrMaterialSystem';
import type {
  ArenaFloorTextureUrls,
  ArenaThemePalette,
  MountedArenaTheme,
} from './arenas/ArenaThemeTypes';

export const COASTAL_QUARRY_PALETTE: ArenaThemePalette = {
  fogColor: 0xa9b6c2,
  fogDensity: 0.0064,
  backgroundTint: 0x8ea7be,
  deckColor: 0xd6d3ce,
  skirtColor: 0xbcb6ad,
  hazardRingColor: 0xd97706,
  hemiSkyColor: 0xc2dcf5,
  hemiGroundColor: 0x6f6559,
  hemiIntensity: 0.78,
  sunColor: 0xfff1d6,
  sunIntensity: 2.7,
  fillColor: 0x93c5fd,
  fillIntensity: 0.58,
  environmentIntensity: 1.22,
  backgroundBlurriness: 0.02,
};

export interface DefaultFloorTextures {
  albedo: THREE.Texture;
  normal: THREE.Texture;
  roughness: THREE.Texture;
  skirtAlbedo: THREE.Texture;
  skirtNormal: THREE.Texture;
}

export interface ArenaSceneRefs {
  scene: THREE.Scene;
  renderer?: THREE.WebGLRenderer;
  assetLoader?: AssetLoader;
  hemiLight: THREE.HemisphereLight;
  sunLight: THREE.DirectionalLight;
  fillLight: THREE.DirectionalLight;
  deckMat: THREE.MeshStandardMaterial;
  skirtMat: THREE.MeshStandardMaterial;
  skirtMesh?: THREE.Object3D;
  hazardRingMat: THREE.MeshStandardMaterial;
  defaultPropsGroup: THREE.Object3D;
  skyboxTexture: THREE.Texture | null;
  defaultEnvMap?: THREE.Texture | null;
  defaultFloorTextures?: DefaultFloorTextures;
}

interface CachedThemeGpuAssets {
  skyboxTexture: THREE.Texture | null;
  pmremTarget: THREE.WebGLRenderTarget | null;
  deckAlbedo: THREE.Texture | null;
  deckNormal: THREE.Texture | null;
  deckRoughness: THREE.Texture | null;
  skirtAlbedo: THREE.Texture | null;
  skirtNormal: THREE.Texture | null;
}

/**
 * Dynamic Lazy-Loading Arena Theme Manager (Phase 5 + Tier 1 Photorealism Upgrade).
 * Loads Stage 2 (`volcanic_crater`) and Stage 3 (`forest_ruins`) via ES dynamic `import()`
 * only when requested, lazy-loading dedicated 360° panoramic skyboxes, PMREM IBL reflections,
 * per-arena PBR floor textures, and animated GLSL environment shaders with full GPU disposal.
 */
export class ArenaThemeManager {
  private currentThemeId: ArenaThemeId = 'coastal_quarry';
  private mountedTheme: MountedArenaTheme | null = null;
  private loadGeneration = 0;
  private disposed = false;

  private readonly textureLoader = new THREE.TextureLoader();
  private readonly gpuAssetCache = new Map<ArenaThemeId, CachedThemeGpuAssets>();

  public get activeThemeId(): ArenaThemeId {
    return this.currentThemeId;
  }

  public update(dt: number): void {
    if (this.disposed || dt <= 0) return;
    this.mountedTheme?.update?.(dt);
  }

  public async loadTheme(
    themeId: ArenaThemeId,
    refs: ArenaSceneRefs,
    pbrTextures: PbrTextureSet,
    arenaRadius: number
  ): Promise<void> {
    if (this.disposed) return;
    if (themeId === this.currentThemeId && (themeId === 'coastal_quarry' || this.mountedTheme)) {
      return;
    }

    const gen = ++this.loadGeneration;
    this.unmountCurrentTheme(refs.scene);

    if (themeId === 'coastal_quarry') {
      refs.defaultPropsGroup.visible = true;
      if (refs.skirtMesh) refs.skirtMesh.visible = true;
      this.restoreDefaultFloorTextures(refs);
      this.applyPaletteAndEnvironment(refs, COASTAL_QUARRY_PALETTE, refs.skyboxTexture, refs.defaultEnvMap ?? null);
      this.currentThemeId = themeId;
      return;
    }

    let built: MountedArenaTheme;
    if (themeId === 'volcanic_crater') {
      const mod = await import('./arenas/volcanicArena');
      built = mod.buildVolcanicArenaTheme(pbrTextures, arenaRadius);
    } else {
      const mod = await import('./arenas/forestArena');
      built = mod.buildForestRuinsArenaTheme(pbrTextures, arenaRadius);
    }

    if (this.disposed || gen !== this.loadGeneration) {
      built.dispose();
      return;
    }

    // Lazy-load dedicated 360° skybox + PMREM IBL + PBR floor textures + sculpted 3D GLB props in parallel!
    const loadPropsPromise = (async (): Promise<Record<string, LoadedPropPrototype | null>> => {
      const out: Record<string, LoadedPropPrototype | null> = {};
      if (!built.propSpecs || !refs.assetLoader) return out;
      const entries = Object.entries(built.propSpecs);
      await Promise.all(
        entries.map(async ([key, spec]) => {
          out[key] = await refs.assetLoader!.loadPropPrototype(spec.url, {
            doubleSide: spec.doubleSide,
            envMapIntensity: spec.envMapIntensity,
          });
        })
      );
      return out;
    })();

    const [gpuAssets, loadedProps] = await Promise.all([
      this.loadThemeGpuAssets(themeId, built.skyboxUrl, built.floorTextureUrls, refs.renderer),
      loadPropsPromise,
    ]);

    if (this.disposed || gen !== this.loadGeneration) {
      built.dispose();
      return;
    }

    refs.defaultPropsGroup.visible = false;
    if (refs.skirtMesh) refs.skirtMesh.visible = !built.hidesBaseSkirt;
    refs.scene.add(built.group);
    this.mountedTheme = built;
    this.currentThemeId = themeId;

    this.applyThemeFloorTextures(refs, gpuAssets);
    built.onFloorTexturesLoaded?.(
      gpuAssets.deckAlbedo,
      gpuAssets.deckNormal,
      gpuAssets.deckRoughness,
      gpuAssets.skirtAlbedo,
      gpuAssets.skirtNormal
    );
    if (built.onPropsLoaded) {
      built.onPropsLoaded(loadedProps);
    }
    this.applyPaletteAndEnvironment(
      refs,
      built.palette,
      gpuAssets.skyboxTexture,
      gpuAssets.pmremTarget?.texture ?? refs.defaultEnvMap ?? null
    );
  }

  public dispose(scene: THREE.Scene): void {
    this.disposed = true;
    this.loadGeneration++;
    this.unmountCurrentTheme(scene);

    for (const assets of this.gpuAssetCache.values()) {
      assets.skyboxTexture?.dispose();
      assets.pmremTarget?.dispose();
      assets.deckAlbedo?.dispose();
      assets.deckNormal?.dispose();
      assets.deckRoughness?.dispose();
      assets.skirtAlbedo?.dispose();
      assets.skirtNormal?.dispose();
    }
    this.gpuAssetCache.clear();
  }

  private unmountCurrentTheme(scene: THREE.Scene): void {
    if (!this.mountedTheme) return;
    scene.remove(this.mountedTheme.group);
    this.mountedTheme.dispose();
    this.mountedTheme = null;
  }

  private async loadThemeGpuAssets(
    themeId: ArenaThemeId,
    skyboxUrl?: string,
    floorUrls?: ArenaFloorTextureUrls,
    renderer?: THREE.WebGLRenderer
  ): Promise<CachedThemeGpuAssets> {
    const existing = this.gpuAssetCache.get(themeId);
    if (existing) return existing;

    const loadTex = async (
      url: string | undefined,
      isColor: boolean,
      repeat: number
    ): Promise<THREE.Texture | null> => {
      if (!url) return null;
      try {
        const tex = await this.textureLoader.loadAsync(url);
        if (this.disposed) {
          tex.dispose();
          return null;
        }
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set(repeat, repeat);
        tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        tex.anisotropy = 4;
        tex.needsUpdate = true;
        return tex;
      } catch {
        return null;
      }
    };

    const loadSky = async (url: string | undefined): Promise<THREE.Texture | null> => {
      if (!url) return null;
      try {
        const tex = await this.textureLoader.loadAsync(url);
        if (this.disposed) {
          tex.dispose();
          return null;
        }
        tex.mapping = THREE.EquirectangularReflectionMapping;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        return tex;
      } catch {
        return null;
      }
    };

    const deckRep = floorUrls?.deckRepeat ?? 6;
    const skirtRep = floorUrls?.skirtRepeat ?? 24;

    const [skyboxTexture, deckAlbedo, deckNormal, deckRoughness] = await Promise.all([
      loadSky(skyboxUrl),
      loadTex(floorUrls?.albedo, true, deckRep),
      loadTex(floorUrls?.normal, false, deckRep),
      loadTex(floorUrls?.roughness, false, deckRep),
    ]);

    let skirtAlbedo: THREE.Texture | null = null;
    let skirtNormal: THREE.Texture | null = null;
    if (deckAlbedo) {
      skirtAlbedo = deckAlbedo.clone();
      skirtAlbedo.repeat.set(skirtRep, skirtRep);
      skirtAlbedo.needsUpdate = true;
    }
    if (deckNormal) {
      skirtNormal = deckNormal.clone();
      skirtNormal.repeat.set(skirtRep, skirtRep);
      skirtNormal.needsUpdate = true;
    }

    let pmremTarget: THREE.WebGLRenderTarget | null = null;
    if (skyboxTexture && renderer && !this.disposed) {
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      pmremTarget = pmrem.fromEquirectangular(skyboxTexture);
      pmrem.dispose();
    }

    const bundle: CachedThemeGpuAssets = {
      skyboxTexture,
      pmremTarget,
      deckAlbedo,
      deckNormal,
      deckRoughness,
      skirtAlbedo,
      skirtNormal,
    };

    if (this.disposed) {
      skyboxTexture?.dispose();
      pmremTarget?.dispose();
      deckAlbedo?.dispose();
      deckNormal?.dispose();
      deckRoughness?.dispose();
      skirtAlbedo?.dispose();
      skirtNormal?.dispose();
      return bundle;
    }

    this.gpuAssetCache.set(themeId, bundle);
    return bundle;
  }

  private applyThemeFloorTextures(refs: ArenaSceneRefs, assets: CachedThemeGpuAssets): void {
    if (assets.deckAlbedo) refs.deckMat.map = assets.deckAlbedo;
    if (assets.deckNormal) refs.deckMat.normalMap = assets.deckNormal;
    if (assets.deckRoughness) refs.deckMat.roughnessMap = assets.deckRoughness;
    refs.deckMat.needsUpdate = true;

    if (assets.skirtAlbedo) refs.skirtMat.map = assets.skirtAlbedo;
    if (assets.skirtNormal) refs.skirtMat.normalMap = assets.skirtNormal;
    refs.skirtMat.needsUpdate = true;
  }

  private restoreDefaultFloorTextures(refs: ArenaSceneRefs): void {
    const def = refs.defaultFloorTextures;
    if (!def) return;
    refs.deckMat.map = def.albedo;
    refs.deckMat.normalMap = def.normal;
    refs.deckMat.roughnessMap = def.roughness;
    refs.deckMat.needsUpdate = true;

    refs.skirtMat.map = def.skirtAlbedo;
    refs.skirtMat.normalMap = def.skirtNormal;
    refs.skirtMat.needsUpdate = true;
  }

  private applyPaletteAndEnvironment(
    refs: ArenaSceneRefs,
    palette: ArenaThemePalette,
    skyboxTexture: THREE.Texture | null,
    envMap: THREE.Texture | null
  ): void {
    if (skyboxTexture) {
      refs.scene.background = skyboxTexture;
      refs.scene.backgroundBlurriness = palette.backgroundBlurriness ?? 0.025;
    } else {
      refs.scene.background = new THREE.Color(palette.backgroundTint);
    }

    if (envMap) {
      refs.scene.environment = envMap;
      refs.scene.environmentIntensity = palette.environmentIntensity ?? 1.15;
    }

    if (refs.scene.fog instanceof THREE.FogExp2) {
      refs.scene.fog.color.setHex(palette.fogColor);
      refs.scene.fog.density = palette.fogDensity;
    } else {
      refs.scene.fog = new THREE.FogExp2(palette.fogColor, palette.fogDensity);
    }

    refs.hemiLight.color.setHex(palette.hemiSkyColor);
    refs.hemiLight.groundColor.setHex(palette.hemiGroundColor);
    refs.hemiLight.intensity = palette.hemiIntensity;

    refs.sunLight.color.setHex(palette.sunColor);
    refs.sunLight.intensity = palette.sunIntensity;

    refs.fillLight.color.setHex(palette.fillColor);
    refs.fillLight.intensity = palette.fillIntensity;

    refs.deckMat.color.setHex(palette.deckColor);
    refs.skirtMat.color.setHex(palette.skirtColor);
    refs.hazardRingMat.color.setHex(palette.hazardRingColor);
  }
}
