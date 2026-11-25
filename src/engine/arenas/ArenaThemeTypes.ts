import * as THREE from 'three';
import type { LoadedPropPrototype } from '../AssetLoader';
import type { PbrTextureSet } from '../PbrMaterialSystem';

export interface ArenaThemePalette {
  readonly fogColor: number;
  readonly fogDensity: number;
  readonly backgroundTint: number;
  readonly deckColor: number;
  readonly skirtColor: number;
  readonly hazardRingColor: number;
  readonly hemiSkyColor: number;
  readonly hemiGroundColor: number;
  readonly hemiIntensity: number;
  readonly sunColor: number;
  readonly sunIntensity: number;
  readonly fillColor: number;
  readonly fillIntensity: number;
  readonly environmentIntensity?: number;
  readonly backgroundBlurriness?: number;
}

export interface ArenaFloorTextureUrls {
  readonly albedo: string;
  readonly normal: string;
  readonly roughness: string;
  readonly deckRepeat?: number;
  readonly skirtRepeat?: number;
}

export interface ArenaPropSpec {
  readonly url: string;
  readonly doubleSide?: boolean;
  readonly envMapIntensity?: number;
}

export interface MountedArenaTheme {
  readonly group: THREE.Group;
  readonly palette: ArenaThemePalette;
  readonly skyboxUrl?: string;
  readonly floorTextureUrls?: ArenaFloorTextureUrls;
  readonly propSpecs?: Readonly<Record<string, ArenaPropSpec>>;
  readonly hidesBaseSkirt?: boolean;
  /** Called once lazy PBR floor textures finish loading so custom terrain/props share them cleanly. */
  onFloorTexturesLoaded?: (
    albedo: THREE.Texture | null,
    normal: THREE.Texture | null,
    roughness: THREE.Texture | null,
    skirtAlbedo: THREE.Texture | null,
    skirtNormal: THREE.Texture | null
  ) => void;
  /** Called once lazy sculpted `.glb` arena prop prototypes finish loading for InstancedMesh mounting. */
  onPropsLoaded?: (props: Readonly<Record<string, LoadedPropPrototype | null>>) => void;
  /** Optional zero-allocation per-frame animation hook (lava shader flow, light flicker, rune pulse). */
  update?: (dt: number) => void;
  dispose(): void;
}

export type LazyArenaThemeBuilder = (
  pbrTextures: PbrTextureSet,
  arenaRadius: number
) => MountedArenaTheme;
