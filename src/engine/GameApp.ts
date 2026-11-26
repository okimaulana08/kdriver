import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ArenaThemeManager, type ArenaSceneRefs } from './ArenaThemeManager';
import {
  createAmbientParticleField,
  createContactShadowDiscs,
  type ContactShadowPlacement,
  type DisposableAtmospherePart,
} from './arenas/ArenaAtmosphere';
import { AssetLoader } from './AssetLoader';
import { AudioManager, type BgmIntensity } from './AudioManager';
import { CameraRig } from './CameraRig';
import { InputManager, type LookDelta2D } from './InputManager';
import { Loop } from './Loop';
import { bindPbrMaterials, type PbrTextureSet } from './PbrMaterialSystem';
import {
  ARENA_RADIUS,
  ARENA_SIDES,
  PLAYER_SPAWN_Y,
  PhysicsWorld,
} from './PhysicsWorld';
import { StageManager } from '../game/StageManager';
import {
  PERFECT_DODGE_GAUGE_BONUS,
  calculateDamage,
  calculateHitGaugeGain,
} from '../game/combat/DamageCalculator';
import { HitboxSystem } from '../game/combat/HitboxSystem';
import { PlayerProjectilePool } from '../game/combat/PlayerProjectilePool';
import { evaluateElementalReaction } from '../game/combat/ReactionSystem';
import { getElementConfig } from '../game/data/elements';
import { getEnemyConfig, type EnemyConfigId } from '../game/data/enemies';
import { getStageConfig } from '../game/data/stages';
import { BossKaijin } from '../game/entities/BossKaijin';
import { EnemyBase } from '../game/entities/EnemyBase';
import { GemShardPool } from '../game/entities/GemShardPool';
import { PetEntity } from '../game/entities/PetEntity';
import {
  PlayerRider,
  WARP_COUNTER_DAMAGE_MULTIPLIER,
  type PlayerDesiredMovement,
} from '../game/entities/PlayerRider';
import type {
  ElementId,
  FloatingTextKind,
  HurtboxTarget,
  StageId,
  Vec3Snapshot,
  WaveConfig,
} from '../game/types/schema';
import { ElementSkillVfx } from '../game/vfx/ElementSkillVfx';
import { ParticlePool } from '../game/vfx/ParticlePool';
import { useGameStore } from '../store/useGameStore';

const PLAYER_GRAVITY_PULL = -18.0;
const COMBO_RESET_DELAY_SEC = 3.5;
const PERFECT_DODGE_SLOWMO_SCALE = 0.25;
const PERFECT_DODGE_SLOWMO_DURATION = 0.6;
const SWITCH_REACTION_BURST_RANGE = 6.5;
const STAGE_OUTCOME_CUTIN_DURATION_SEC = 2.35;

export class GameApp {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly cameraRig: CameraRig;
  private readonly audio: AudioManager;
  private readonly assetLoader: AssetLoader;
  private readonly physics: PhysicsWorld;
  private readonly input: InputManager;
  private readonly loop: Loop;
  private readonly stageManager: StageManager;

  private player: PlayerRider | null = null;
  private petEntity: PetEntity | null = null;
  private readonly gemShardPool: GemShardPool;
  private readonly particlePool: ParticlePool;
  private readonly elementSkillVfx: ElementSkillVfx;
  private readonly playerProjectilePool: PlayerProjectilePool;
  private readonly arenaThemeManager: ArenaThemeManager;
  private readonly playerHitbox: HitboxSystem;
  private readonly skillHitbox: HitboxSystem;

  private hemiLight!: THREE.HemisphereLight;
  private sunLight!: THREE.DirectionalLight;
  private fillLight!: THREE.DirectionalLight;
  private finisherSpotLight!: THREE.PointLight;
  private domainDimActive = false;
  private domainDimBlend = 0;
  private domainBaseSunIntensity = 2.7;
  private domainBaseHemiIntensity = 0.78;
  private domainBaseFillIntensity = 0.58;
  private domainBaseEnvIntensity = 1.22;
  private deckMat: THREE.MeshStandardMaterial | null = null;
  private skirtMat: THREE.MeshStandardMaterial | null = null;
  private skirtMesh: THREE.Mesh | null = null;
  private hazardRingMat: THREE.MeshStandardMaterial | null = null;
  private defaultPropsGroup: THREE.Object3D | null = null;
  private defaultSkirtAlbedo: THREE.Texture | null = null;
  private defaultSkirtNormal: THREE.Texture | null = null;
  private readonly defaultAtmosphereParts: DisposableAtmospherePart[] = [];

  private readonly enemies: EnemyBase[] = [];
  private lockedEnemy: EnemyBase | null = null;
  private lastPerfectDodgeAttacker: EnemyBase | null = null;
  private nextEnemyUid = 1;

  private pmremRenderTarget: THREE.WebGLRenderTarget | null = null;
  private pbrTextures: PbrTextureSet | null = null;
  private readonly disposableTextures: THREE.Texture[] = [];
  private readonly arenaOwnedMaterials: THREE.Material[] = [];

  private bloomEnabled = true;
  private comboCount = 0;
  private comboResetTimer = 0;
  private pendingVictoryFinish = false;
  private defeatDelayTimer = 0;
  private outcomeSequenceActive = false;
  private outcomeSequenceVictory = false;
  private outcomeSequenceElapsed = 0;
  private telemetryCooldownSec = 0;
  private disposed = false;

  // Reusable scratch objects (Zero-Allocation Hot Path)
  private readonly scratchLookDelta: LookDelta2D = { dx: 0, dy: 0 };
  private readonly scratchDesiredMove: PlayerDesiredMovement = { dx: 0, dz: 0 };
  private readonly scratchPrevPos = new THREE.Vector3(0, PLAYER_SPAWN_Y, 0);
  private readonly scratchCurrPos = new THREE.Vector3(0, PLAYER_SPAWN_Y, 0);
  private readonly scratchRenderPos = new THREE.Vector3(0, PLAYER_SPAWN_Y, 0);
  private readonly scratchLockTargetPos = new THREE.Vector3();
  private readonly scratchPlayerForwardXZ = { x: 0, z: 1 };
  private readonly scratchOriginSnapshot: Vec3Snapshot = { x: 0, y: 0, z: 0 };
  private readonly scratchTargetSnapshot: Vec3Snapshot = { x: 0, y: 0, z: 0 };
  private readonly scratchProjectVec = new THREE.Vector3();
  private readonly scratchHitResults: HurtboxTarget[] = [];
  private readonly scratchColorHelper = new THREE.Color();
  private readonly scratchSkillCds: [number, number, number] = [0, 0, 0];
  private readonly scratchPetCds: [number, number, number] = [0, 0, 0];

  constructor(container: HTMLElement) {
    this.container = container;

    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    // Cap pixelRatio at 1.5 for rock-solid 60 FPS with selective post-processing bloom
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.96;

    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8ea7be);
    this.scene.fog = new THREE.FogExp2(0xa9b6c2, 0.0064);

    this.camera = new THREE.PerspectiveCamera(58, width / height, 0.1, 220);
    this.cameraRig = new CameraRig(this.camera);
    this.audio = new AudioManager();
    this.assetLoader = new AssetLoader();
    this.arenaThemeManager = new ArenaThemeManager();
    const initialStage = getStageConfig(useGameStore.getState().selectedStageId);
    this.stageManager = new StageManager(initialStage);

    // Filmic selective UnrealBloomPass (blooms only hot sparks, visor eyes & energy > 1.15, keeping sunlit concrete sharp!)
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, Math.floor(width / 2)), Math.max(1, Math.floor(height / 2))),
      0.24,
      0.3,
      1.15
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.setupLighting();

    this.particlePool = new ParticlePool();
    this.scene.add(this.particlePool.root);

    this.elementSkillVfx = new ElementSkillVfx();
    this.scene.add(this.elementSkillVfx.root);

    this.playerProjectilePool = new PlayerProjectilePool();
    this.scene.add(this.playerProjectilePool.root);

    this.gemShardPool = new GemShardPool();
    this.scene.add(this.gemShardPool.root);

    this.playerHitbox = new HitboxSystem();
    this.skillHitbox = new HitboxSystem();
    this.physics = new PhysicsWorld();

    this.input = new InputManager({
      targetElement: this.renderer.domElement,
      onUserGesture: () => {
        this.audio.unlock();
      },
      onPointerLockChange: (locked) => {
        useGameStore.getState().setPointerLocked(locked);
      },
      onActionBuffered: (action, timestampMs) => {
        useGameStore.getState().setLastBufferedAction(action, timestampMs);
      },
      onActiveKeysChange: (keys) => {
        useGameStore.getState().setActiveKeys(keys);
      },
      onGamepadChange: (connected, name) => {
        useGameStore.getState().setGamepadStatus(connected, name);
      },
      onDebugToggle: () => {
        useGameStore.getState().toggleDebugOverlay();
      },
      onSpecialKey: (code) => {
        if (code === 'KeyM') {
          const nextMuted = !this.audio.isMuted;
          this.audio.setMuted(nextMuted);
          useGameStore.getState().setAudioMuted(nextMuted);
        } else if (code === 'KeyB') {
          this.bloomEnabled = !this.bloomEnabled;
          useGameStore.getState().setBloomEnabled(this.bloomEnabled);
        }
      },
    });

    this.loop = new Loop({
      onFixedUpdate: this.onFixedUpdate,
      onRender: this.onRender,
      onFpsSample: (fps, frameTimeMs, timeScale, hitStopActive) => {
        useGameStore
          .getState()
          .setPerformanceMetrics(fps, frameTimeMs, timeScale, hitStopActive);
      },
    });

    this.cameraRig.setMode('HUB_PEDESTAL');
    this.cameraRig.update(0.016, this.scratchCurrPos, null);
    useGameStore.getState().setEngineStatus('initializing');

    window.addEventListener('resize', this.handleResize);
  }

  public async init(): Promise<void> {
    if (this.disposed) return;
    const store = useGameStore.getState();
    store.setLoadProgress(5, 'Initializing Rapier3D WASM & .glb Assets...');

    try {
      await Promise.all([
        this.physics.init(),
        this.assetLoader.preloadAll((loaded, total, label) => {
          const pct = Math.round(10 + (loaded / Math.max(1, total)) * 85);
          useGameStore.getState().setLoadProgress(pct, `Loaded ${label} (${loaded}/${total})`);
        }),
      ]);

      if (this.disposed) {
        this.physics.dispose();
        return;
      }

      // Bind real 360-degree equirectangular panorama & generate PMREM IBL environment map
      this.pbrTextures = this.assetLoader.getPbrTextures();
      this.applyEnvironmentPanorama();

      // Build photo-textured concrete arena + seamless horizon skirt + realistic quarry/waterfront props
      this.buildArenaDeck(this.pbrTextures);
      await this.mountArenaProps(this.pbrTextures);

      // Build Rider & Pooled Pets from cached .glb prototypes (or custom Mixamo skeletal rigs!)
      const initialStore = useGameStore.getState();
      const initialOrder = initialStore.loadoutOrder;
      this.player = new PlayerRider(this.assetLoader, this.pbrTextures, initialOrder[0]);
      this.player.setLoadoutOrder(initialOrder);
      this.player.setGemLevels(initialStore.saveRecord.gemLevels);
      this.scene.add(this.player.root);
      this.scene.add(this.player.slashTrail.mesh);
      useGameStore
        .getState()
        .setRiderRigMode(this.player.isCustomSkeletalRig ? 'MIXAMO SKELETAL' : 'PROCEDURAL PBR');

      this.petEntity = new PetEntity(this.assetLoader, this.pbrTextures);
      this.scene.add(this.petEntity.root);

      // Apply selected stage's thematic arena (lazy-loads Stage 2/3 chunk if saved!)
      await this.selectStage(initialStore.selectedStageId);

      this.physics.getPlayerPosition(this.scratchCurrPos);
      this.scratchPrevPos.copy(this.scratchCurrPos);
      this.player.root.position.copy(this.scratchCurrPos);

      this.updateBgmIntensity('HUB');
      useGameStore.getState().setLoadProgress(100, 'Ready');
      useGameStore.getState().setEngineStatus('ready');
      this.loop.start();
    } catch (error) {
      if (this.disposed) return;
      const message =
        error instanceof Error ? error.message : 'Failed to initialize K-DRIVER Engine';
      useGameStore.getState().setEngineStatus('error', message);
    }
  }

  public async selectStage(stageId: StageId): Promise<void> {
    const stage = getStageConfig(stageId);
    this.stageManager.setStage(stage);
    useGameStore.getState().setSelectedStageId(stage.id);

    if (
      this.pbrTextures &&
      this.deckMat &&
      this.skirtMat &&
      this.hazardRingMat &&
      this.defaultPropsGroup
    ) {
      const refs: ArenaSceneRefs = {
        scene: this.scene,
        renderer: this.renderer,
        assetLoader: this.assetLoader,
        hemiLight: this.hemiLight,
        sunLight: this.sunLight,
        fillLight: this.fillLight,
        deckMat: this.deckMat,
        skirtMat: this.skirtMat,
        skirtMesh: this.skirtMesh ?? undefined,
        hazardRingMat: this.hazardRingMat,
        defaultPropsGroup: this.defaultPropsGroup,
        skyboxTexture: this.assetLoader.getSkyboxTexture(),
        defaultEnvMap: this.pmremRenderTarget?.texture ?? null,
        defaultFloorTextures:
          this.defaultSkirtAlbedo && this.defaultSkirtNormal
            ? {
                albedo: this.pbrTextures.floorAlbedo,
                normal: this.pbrTextures.floorNormal,
                roughness: this.pbrTextures.floorRoughness,
                skirtAlbedo: this.defaultSkirtAlbedo,
                skirtNormal: this.defaultSkirtNormal,
              }
            : undefined,
      };
      await this.arenaThemeManager.loadTheme(stage.arenaTheme, refs, this.pbrTextures, ARENA_RADIUS);
      useGameStore.getState().setArenaTheme(stage.arenaTheme);
    }
  }

  public syncGemProgression(): void {
    const record = useGameStore.getState().saveRecord;
    this.player?.setGemLevels(record.gemLevels);
  }

  public previewHubElement(elementId: ElementId): void {
    if (!this.player) return;
    this.audio.unlock();
    this.player.setElementTheme(elementId);
    this.audio.playFormSwitch(elementId);
    const cfg = getElementConfig(elementId);
    this.scratchColorHelper.set(cfg.emissiveColor);
    this.particlePool.emitBeltSwitchBurst(0, 1.0, 0, this.scratchColorHelper.getHex());
    useGameStore.getState().setActiveElement(elementId);
  }

  public setLoadoutOrder(order: [ElementId, ElementId, ElementId]): void {
    useGameStore.getState().setLoadoutOrder(order);
    this.player?.setLoadoutOrder(order);
    this.previewHubElement(order[0]);
  }

  public resetHubCamera(): void {
    this.cameraRig.resetHubOrbit();
  }

  public deployToArena(): void {
    if (!this.player || !this.petEntity) return;
    const store = useGameStore.getState();
    const stage = getStageConfig(store.selectedStageId);
    this.stageManager.setStage(stage);
    this.audio.unlock();
    this.input.setAllowPointerLock(true);
    this.disposeAllEnemies();
    this.gemShardPool.clearAll();
    this.playerProjectilePool.clearAll();
    this.elementSkillVfx.clearAll();
    this.resetDomainDimming();
    this.petEntity.resetAll();
    this.playerHitbox.endSwing();
    this.skillHitbox.endSwing();
    this.loop.resetTimeScale();

    this.comboCount = 0;
    this.comboResetTimer = 0;
    this.pendingVictoryFinish = false;
    this.defeatDelayTimer = 0;
    this.outcomeSequenceActive = false;
    this.outcomeSequenceElapsed = 0;

    this.physics.resetPlayerPosition(0, 3.5);
    this.physics.getPlayerPosition(this.scratchCurrPos);
    this.scratchPrevPos.copy(this.scratchCurrPos);

    this.player.setGemLevels(store.saveRecord.gemLevels);
    this.player.resetForNewStage(store.loadoutOrder, Math.PI);
    this.player.root.position.copy(this.scratchCurrPos);
    this.player.triggerEntryHenshinVisual();

    this.stageManager.startStage();
    this.cameraRig.setLockedOn(false);
    this.cameraRig.setMode('ARENA_ENTRY', Math.PI);

    store.resetArenaState();
    store.setScreenMode('ARENA');
    store.triggerWaveBanner(stage.name.toUpperCase(), stage.subtitle.toUpperCase(), stage.accentColor);

    this.updateBgmIntensity('COMBAT');
    this.audio.playHenshinSuper('HENSHIN!');
    this.particlePool.emitElementBurst(store.loadoutOrder[0], 0, 1.1, 3.5, 42, 1.4);
  }

  public retryStage(): void {
    this.deployToArena();
  }

  public returnToHub(): void {
    if (!this.player || !this.petEntity) return;
    this.input.setAllowPointerLock(false);
    this.input.releasePointerLock();
    this.outcomeSequenceActive = false;
    this.outcomeSequenceElapsed = 0;
    this.disposeAllEnemies();
    this.gemShardPool.clearAll();
    this.playerProjectilePool.clearAll();
    this.elementSkillVfx.clearAll();
    this.resetDomainDimming();
    this.petEntity.resetAll();
    this.stageManager.resetToIdle();
    this.loop.resetTimeScale();

    this.physics.resetPlayerPosition(0, 0);
    this.physics.getPlayerPosition(this.scratchCurrPos);
    this.scratchPrevPos.copy(this.scratchCurrPos);

    const store = useGameStore.getState();
    this.player.setGemLevels(store.saveRecord.gemLevels);
    this.player.resetForNewStage(store.loadoutOrder, 0);
    this.player.root.position.copy(this.scratchCurrPos);

    this.cameraRig.setLockedOn(false);
    this.cameraRig.setMode('HUB_PEDESTAL', 0);
    this.updateBgmIntensity('HUB');

    store.resetArenaState();
    store.setScreenMode('HUB');
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    window.removeEventListener('resize', this.handleResize);

    this.loop.dispose();
    this.input.dispose();
    this.physics.dispose();
    this.playerHitbox.dispose();
    this.skillHitbox.dispose();
    this.disposeAllEnemies();
    this.player?.dispose();
    this.petEntity?.dispose();
    this.gemShardPool.dispose();
    this.playerProjectilePool.dispose();
    this.arenaThemeManager.dispose(this.scene);
    for (let i = 0; i < this.defaultAtmosphereParts.length; i++) {
      this.defaultAtmosphereParts[i]!.dispose();
    }
    this.defaultAtmosphereParts.length = 0;
    this.particlePool.dispose();
    this.elementSkillVfx.dispose();
    this.cameraRig.dispose();
    this.audio.dispose();

    // Dispose non-shared arena geometries & materials first, then AssetLoader frees all shared .glb buffers!
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points) {
        if (obj.geometry && !obj.geometry.userData.sharedAssetGeometry) {
          obj.geometry.dispose();
        }
        if (!obj.userData.isOutlineMesh) {
          const material = obj.material;
          if (Array.isArray(material)) {
            for (let i = 0; i < material.length; i++) {
              material[i]?.dispose();
            }
          } else {
            material.dispose();
          }
        }
      }
    });

    for (let i = 0; i < this.arenaOwnedMaterials.length; i++) {
      this.arenaOwnedMaterials[i]?.dispose();
    }
    this.arenaOwnedMaterials.length = 0;

    if (this.pmremRenderTarget) {
      this.pmremRenderTarget.dispose();
      this.pmremRenderTarget = null;
    }
    this.scene.environment = null;
    this.scene.background = null;

    this.assetLoader.dispose();

    for (let i = 0; i < this.disposableTextures.length; i++) {
      this.disposableTextures[i]?.dispose();
    }
    this.disposableTextures.length = 0;

    this.bloomPass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }

  private updateBgmIntensity(intensity: BgmIntensity): void {
    this.audio.setBgmIntensity(intensity);
    useGameStore.getState().setBgmIntensity(intensity);
  }

  private applyEnvironmentPanorama(): void {
    const skyTex = this.assetLoader.getSkyboxTexture();
    if (!skyTex) return;

    this.scene.background = skyTex;
    this.scene.backgroundBlurriness = 0.02;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    pmrem.compileEquirectangularShader();
    this.pmremRenderTarget = pmrem.fromEquirectangular(skyTex);
    this.scene.environment = this.pmremRenderTarget.texture;
    this.scene.environmentIntensity = 1.22;
    pmrem.dispose();
  }

  private async mountArenaProps(pbrTextures: PbrTextureSet): Promise<void> {
    const props = this.assetLoader.cloneModel('arena_props');

    const concreteMat = new THREE.MeshStandardMaterial({
      color: 0xc2c5c8,
      map: pbrTextures.floorAlbedo,
      normalMap: pbrTextures.floorNormal,
      normalScale: new THREE.Vector2(0.75, 0.75),
      roughnessMap: pbrTextures.floorRoughness,
      roughness: 0.92,
      metalness: 0.04,
      envMapIntensity: 0.85,
    });
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x525c68,
      roughnessMap: pbrTextures.armorWearRoughness,
      roughness: 0.44,
      metalness: 0.78,
      envMapIntensity: 1.25,
    });
    const lampMat = new THREE.MeshStandardMaterial({
      color: 0xfff8e7,
      emissive: 0xffdf9e,
      emissiveIntensity: 1.55,
      roughness: 0.16,
    });
    const containerAMat = new THREE.MeshStandardMaterial({
      color: 0x7c2d12,
      roughnessMap: pbrTextures.armorWearRoughness,
      roughness: 0.68,
      metalness: 0.42,
      envMapIntensity: 0.95,
    });
    const containerBMat = new THREE.MeshStandardMaterial({
      color: 0x1e3a5f,
      roughnessMap: pbrTextures.armorWearRoughness,
      roughness: 0.68,
      metalness: 0.42,
      envMapIntensity: 0.95,
    });
    const rockMat = new THREE.MeshStandardMaterial({
      color: 0x867e76,
      normalMap: pbrTextures.kaijinChitinNormal,
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.95,
      metalness: 0.03,
      envMapIntensity: 0.7,
    });

    this.arenaOwnedMaterials.push(
      concreteMat,
      steelMat,
      lampMat,
      containerAMat,
      containerBMat,
      rockMat
    );
    bindPbrMaterials(props, {
      arena_concrete: concreteMat,
      arena_steel: steelMat,
      arena_lamp: lampMat,
      arena_container_a: containerAMat,
      arena_container_b: containerBMat,
      arena_rock: rockMat,
    });

    // Tier 2 Upgrade: Replace primitive box JerseyBarriers & GuardRails with 24 GPU-instanced sculpted Meshy PBR harbor barriers!
    const barrierProto = await this.assetLoader.loadPropPrototype(
      '/assets/models/custom/prop_harbor_barrier.glb',
      { envMapIntensity: 1.15 }
    );
    if (!this.disposed && barrierProto) {
      props.traverse((obj) => {
        if (/^(JerseyBarrier_|GuardRail_)/.test(obj.name)) {
          obj.visible = false;
        }
      });

      const barrierCount = ARENA_SIDES * 3;
      const instBarriers = new THREE.InstancedMesh(
        barrierProto.geometry,
        barrierProto.material,
        barrierCount
      );
      instBarriers.name = 'InstancedHarborBarriers';
      instBarriers.castShadow = true;
      instBarriers.receiveShadow = true;

      const targetLenX = 3.55;
      const scale = targetLenX / Math.max(0.01, barrierProto.size.x);
      const dummy = new THREE.Object3D();
      const barrierAo: ContactShadowPlacement[] = [];
      let idx = 0;

      for (let i = 0; i < ARENA_SIDES; i++) {
        const wallAngle = (i * Math.PI * 2) / ARENA_SIDES;
        const dist = ARENA_RADIUS + 0.68;
        const cx = Math.sin(wallAngle) * dist;
        const cz = Math.cos(wallAngle) * dist;
        const tangentX = Math.cos(wallAngle);
        const tangentZ = -Math.sin(wallAngle);

        for (let seg = -1; seg <= 1; seg++) {
          const bx = cx + tangentX * seg * 3.85;
          const bz = cz + tangentZ * seg * 3.85;
          dummy.position.set(bx, -0.02, bz);
          // Slight natural placement jitter + alternating facing for worn quarry authenticity
          const jitterYaw = Math.sin((i * 3 + seg) * 4.7) * 0.025;
          dummy.rotation.set(0, wallAngle + jitterYaw + (idx % 2 === 0 ? 0 : Math.PI), 0);
          dummy.scale.setScalar(scale);
          dummy.updateMatrix();
          instBarriers.setMatrixAt(idx++, dummy.matrix);
          barrierAo.push({
            x: bx,
            z: bz,
            radiusX: 2.15,
            radiusZ: 0.92,
            rotY: wallAngle + jitterYaw,
            y: 0.012,
          });
        }
      }
      instBarriers.instanceMatrix.needsUpdate = true;
      props.add(instBarriers);

      // Tier 3 Grounded Contact AO shadows beneath all 24 sculpted harbor concrete barriers
      const aoPart = createContactShadowDiscs('HarborBarrierContactAO', barrierAo, 0.52);
      this.defaultAtmosphereParts.push(aoPart);
      props.add(aoPart.object);
    }

    // Tier 3 Sunlit Late-Afternoon Harbor Dust Motes drifting across Nexus Sector 01
    const harborDust = createAmbientParticleField('HarborDustMotes', {
      count: 140,
      innerRadius: 1.5,
      outerRadius: ARENA_RADIUS + 8.0,
      minHeight: 0.5,
      maxHeight: 7.5,
      baseSize: 0.44,
      riseSpeed: 0,
      driftSpeed: 1.55,
      colorA: 0xfde68a,
      colorB: 0xe2e8f0,
      opacity: 0.52,
      additive: true,
    });
    this.defaultAtmosphereParts.push(harborDust);
    props.add(harborDust.object);

    this.defaultPropsGroup = props;
    this.scene.add(props);
  }

  private readonly onFixedUpdate = (fixedDt: number): void => {
    this.input.pollGamepad(fixedDt);
    this.input.clearExpiredBuffers();

    if (!this.player || !this.petEntity) return;
    const screenMode = useGameStore.getState().screenMode;
    if (screenMode === 'HUB') {
      // Leave look/zoom deltas intact for 60fps Hub pedestal orbit & scroll zoom in onRender!
      return;
    }
    if (screenMode !== 'ARENA') {
      this.input.consumeLookDelta(this.scratchLookDelta);
      this.input.consumeZoomDelta();
      return;
    }

    if (this.outcomeSequenceActive) {
      this.input.consumeLookDelta(this.scratchLookDelta);
      return;
    }

    if (this.player.fsm.isDead) {
      this.defeatDelayTimer += fixedDt;
      if (this.defeatDelayTimer >= 0.55) {
        this.startStageOutcomeCutIn(false);
      }
      return;
    }

    // 1. Stage Wave Progression
    const aliveCount = this.countAliveEnemies();
    const stageTick = this.stageManager.fixedUpdate(fixedDt, aliveCount);

    if (stageTick.spawnWave) {
      if (this.cameraRig.currentMode === 'ARENA_ENTRY') {
        this.cameraRig.setMode('COMBAT');
      }
      this.spawnWave(stageTick.spawnWave);
    }

    if (stageTick.stageCleared) {
      this.pendingVictoryFinish = true;
    }

    if (this.pendingVictoryFinish && !this.player.fsm.isInCinematic) {
      this.pendingVictoryFinish = false;
      this.startStageOutcomeCutIn(true);
      return;
    }

    // Dynamic BGM Intensity (escalates on Wave 3 Boss OR Super/Ultimate Form!)
    const desiredBgm: BgmIntensity =
      this.stageManager.waveNumber >= 3 || this.player.currentFormTier !== 'BASIC'
        ? 'BOSS'
        : 'COMBAT';
    if (this.audio.currentBgmIntensity !== desiredBgm) {
      this.updateBgmIntensity(desiredBgm);
    }

    // 2. Smart Lock-On
    if (this.lockedEnemy && !this.lockedEnemy.isAlive) {
      this.lockedEnemy.setLockedOn(false);
      this.lockedEnemy = this.findPriorityTarget();
      if (this.lockedEnemy) {
        this.lockedEnemy.setLockedOn(true);
      } else {
        this.cameraRig.setLockedOn(false);
      }
    }

    if (this.input.consumeBufferedAction('LOCK_ON')) {
      if (this.cameraRig.isLockedOn) {
        this.lockedEnemy?.setLockedOn(false);
        this.lockedEnemy = null;
        this.cameraRig.setLockedOn(false);
        this.audio.playLockOn(false);
      } else {
        const best = this.findPriorityTarget();
        if (best) {
          this.lockedEnemy = best;
          best.setLockedOn(true);
          this.cameraRig.setLockedOn(true);
          this.audio.playLockOn(true);
        }
      }
    }

    this.input.consumeLookDelta(this.scratchLookDelta);
    this.cameraRig.applyLookDelta(this.scratchLookDelta);

    let lockTargetPos: THREE.Vector3 | null = null;
    if (this.lockedEnemy && this.lockedEnemy.isAlive) {
      this.lockedEnemy.getPosition(this.scratchTargetSnapshot);
      this.scratchLockTargetPos.set(
        this.scratchTargetSnapshot.x,
        this.scratchTargetSnapshot.y,
        this.scratchTargetSnapshot.z
      );
      lockTargetPos = this.scratchLockTargetPos;
    }

    const controlsLocked = this.stageManager.state === 'ENTRY_HENSHIN';
    const bossStaggered = this.isAnyBossStaggered();

    // 3. Player FSM & Movement
    const prevInCinematic = this.player.fsm.isInCinematic;
    const prevWasRiderKick = this.player.fsm.state === 'RIDER_KICK';
    const playerEvents = this.player.fixedUpdate(
      fixedDt,
      this.input,
      this.cameraRig.getYaw(),
      lockTargetPos,
      bossStaggered,
      controlsLocked,
      this.scratchDesiredMove
    );

    if (prevInCinematic && !this.player.fsm.isInCinematic) {
      this.cameraRig.setMode('COMBAT');
      this.petEntity.deactivateUltimatePet();
      this.domainDimActive = false;
      useGameStore.getState().clearFinisherCinematic();
    } else if (prevWasRiderKick && this.player.fsm.state !== 'RIDER_KICK' && this.cameraRig.currentMode === 'RIDER_KICK') {
      this.cameraRig.setMode('COMBAT');
    }

    if (playerEvents.startedHenshinSuper) this.handleHenshinSuperEvent();
    if (playerEvents.startedHenshinUltimate) this.handleHenshinUltimateEvent();
    if (playerEvents.startedUltimateFinisher) this.handleUltimateStartEvent();
    if (playerEvents.ultimateImpactThisStep) this.resolveUltimateFinisherImpact();
    if (playerEvents.ultimateExplosionPulseThisStep) this.triggerUltimateBackExplosionVfx();
    if (playerEvents.switchedToElement) this.handleFormSwitchEvent(playerEvents.switchedToElement);
    if (playerEvents.startedSkillElement) this.handleSkillStartEvent(playerEvents.startedSkillElement);
    if (playerEvents.startedRiderKick) this.handleRiderKickStartEvent();
    if (playerEvents.riderKickImpactThisStep) this.resolveRiderKickImpact();
    if (playerEvents.triggeredWarpCounter) this.handleWarpCounterEvent();
    if (playerEvents.startedSwingStep !== 0) {
      const elemId = this.player.currentElementId;
      this.audio.playSlash(playerEvents.startedSwingStep, elemId);
      if (this.player.activeElement.weapon.archetype === 'RANGED') {
        this.player.getPosition(this.scratchOriginSnapshot);
        const cfg = getElementConfig(elemId);
        this.scratchColorHelper.set(cfg.emissiveColor);
        let aimYaw = this.player.facingYaw;
        const aimTarget = this.lockedEnemy?.isAlive ? this.lockedEnemy : this.findPriorityTarget();
        if (aimTarget && aimTarget.isAlive) {
          aimTarget.getPosition(this.scratchTargetSnapshot);
          const dx = this.scratchTargetSnapshot.x - this.scratchOriginSnapshot.x;
          const dz = this.scratchTargetSnapshot.z - this.scratchOriginSnapshot.z;
          if (dx * dx + dz * dz > 0.04) {
            aimYaw = Math.atan2(dx, dz);
          }
        }
        this.playerProjectilePool.fireVolley(
          elemId,
          playerEvents.startedSwingStep,
          this.scratchOriginSnapshot.x,
          this.scratchOriginSnapshot.y + 0.35,
          this.scratchOriginSnapshot.z,
          aimYaw,
          this.scratchColorHelper.getHex()
        );
      }
    }
    if (playerEvents.startedDodge) {
      this.audio.playDodge();
    }

    // 4. Async Pet Assist (`E`)
    const activeElemId = this.player.currentElementId;
    if (
      !controlsLocked &&
      !this.player.fsm.isInCinematic &&
      this.petEntity.canSummon(activeElemId) &&
      this.input.consumeBufferedAction('PET')
    ) {
      this.player.getPosition(this.scratchOriginSnapshot);
      this.player.getForwardXZ(this.scratchPlayerForwardXZ);
      const petTargetEntity = this.lockedEnemy ?? this.findPriorityTarget();
      let petTarget: Vec3Snapshot | null = null;
      if (petTargetEntity && petTargetEntity.isAlive) {
        petTargetEntity.getPosition(this.scratchTargetSnapshot);
        petTarget = this.scratchTargetSnapshot;
      }
      if (
        this.petEntity.summon(
          activeElemId,
          this.scratchOriginSnapshot,
          this.scratchPlayerForwardXZ.x,
          this.scratchPlayerForwardXZ.z,
          petTarget
        )
      ) {
        this.player.triggerBeltGesture();
        this.player.addDriverGauge(10);
        this.audio.playPetSummon(activeElemId);
        this.particlePool.emitElementBurst(
          activeElemId,
          this.scratchOriginSnapshot.x,
          this.scratchOriginSnapshot.y + 0.2,
          this.scratchOriginSnapshot.z,
          8,
          0.42
        );
      }
    }

    // 5. Physics step for Rider
    this.scratchPrevPos.copy(this.scratchCurrPos);
    const moveResult = this.physics.stepPlayerMovement(
      this.scratchDesiredMove.dx,
      PLAYER_GRAVITY_PULL * fixedDt,
      this.scratchDesiredMove.dz,
      fixedDt,
      this.scratchCurrPos
    );
    this.player.root.position.copy(this.scratchCurrPos);

    // 6. Melee, Ranged Projectile & Skill Hitboxes
    if (playerEvents.hitboxActive && this.player.activeElement.weapon.archetype !== 'RANGED') {
      this.playerHitbox.beginSwing(playerEvents.swingId);
      this.resolvePlayerMeleeHits();
    } else if (this.playerHitbox.currentSwingId !== null) {
      this.playerHitbox.endSwing();
    }

    const rangedHits = this.playerProjectilePool.fixedUpdate(fixedDt, this.enemies);
    for (let i = 0; i < rangedHits.length; i++) {
      const hit = rangedHits[i]!;
      const target = hit.target as EnemyBase;
      const cfg = getElementConfig(hit.element);
      if (hit.source === 'PET') {
        this.applyElementalStrikeOnEnemy(
          target,
          hit.element,
          0.55,
          10,
          0,
          false,
          `${cfg.pet.name.toUpperCase()} SHOT`,
          false
        );
      } else {
        const mult = cfg.weapon.comboMultipliers[hit.comboStep - 1] ?? 1.0;
        this.applyElementalStrikeOnEnemy(
          target,
          hit.element,
          mult,
          hit.comboStep === 3 ? 24 : 14,
          cfg.weapon.hitStopMs,
          hit.comboStep === 3,
          hit.comboStep === 3 ? 'VOLLEY' : undefined,
          false
        );
      }
    }

    if (playerEvents.skillHitboxActive) {
      this.skillHitbox.beginSwing(playerEvents.skillId);
      this.resolveElementSkillHits();
    } else if (this.skillHitbox.currentSwingId !== null) {
      this.skillHitbox.endSwing();
    }

    // 7. Pooled Pet Update (Assist Strike -> 18s Companion Follow + 1.5s Auto Elemental Shots!)
    this.player.getPosition(this.scratchOriginSnapshot);
    const petEvents = this.petEntity.fixedUpdate(
      fixedDt,
      this.scratchOriginSnapshot,
      this.player.facingYaw,
      this.enemies,
      this.lockedEnemy,
      this.player.fsm.isInCinematic || controlsLocked
    );
    if (petEvents.impact) {
      this.resolvePetImpact(
        petEvents.impact.element,
        petEvents.impact.x,
        petEvents.impact.y,
        petEvents.impact.z,
        petEvents.impact.radius,
        petEvents.impact.damageMultiplier,
        petEvents.impact.healRiderAmount
      );
    }
    for (let i = 0; i < petEvents.shots.length; i++) {
      const shot = petEvents.shots[i]!;
      const shotCfg = getElementConfig(shot.element);
      this.scratchColorHelper.set(shotCfg.emissiveColor);
      const hex = this.scratchColorHelper.getHex();
      this.playerProjectilePool.firePetShot(
        shot.element,
        shot.x,
        shot.y,
        shot.z,
        shot.targetX,
        shot.targetY,
        shot.targetZ,
        hex
      );
      this.particlePool.emitHitSparks(shot.x, shot.y, shot.z, hex, false);
    }

    // 8. Gem Shard Pickups
    this.player.getPosition(this.scratchOriginSnapshot);
    const shardPickup = this.gemShardPool.fixedUpdate(fixedDt, this.scratchOriginSnapshot);
    if (shardPickup.collectedCount > 0) {
      const healed = this.player.heal(shardPickup.hpRestored);
      this.player.addDriverGauge(shardPickup.gaugeAdded);
      this.audio.playShardPickup();
      this.emitFloatingTextAtWorld(
        this.scratchCurrPos.x,
        this.scratchCurrPos.y + 1.4,
        this.scratchCurrPos.z,
        healed > 0 ? `+${healed} HP` : `+${shardPickup.gaugeAdded} GAUGE`,
        'heal',
        'GEM SHARD'
      );
    }

    // 9. Update Active Enemies & Boss Projectiles
    const freezeEnemies = this.player.fsm.isInCinematic || controlsLocked;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i]!;
      const ev = enemy.fixedUpdate(fixedDt, this.player, this.enemies, freezeEnemies);

      if (ev.startedTelegraph) this.audio.playTelegraphCue();
      if (ev.enteredPhase2) {
        this.audio.playBossPhase2();
        this.cameraRig.addShake(0.42, 0.32);
        enemy.getPosition(this.scratchTargetSnapshot);
        this.particlePool.emitReactionBurst(
          'OVERLOAD',
          this.scratchTargetSnapshot.x,
          this.scratchTargetSnapshot.y,
          this.scratchTargetSnapshot.z
        );
        if (enemy instanceof BossKaijin) {
          const prof = enemy.signatureProfile;
          useGameStore
            .getState()
            .triggerWaveBanner(prof.phase2Title, prof.phase2Subtitle, prof.phase2BannerColor);
        } else {
          useGameStore
            .getState()
            .triggerWaveBanner('PHASE 2 — OBSIDIAN OVERDRIVE!', 'DARK ENERGY UNLEASHED', '#f43f5e');
        }
      }
      if (ev.hitPlayerDamage > 0) {
        enemy.getPosition(this.scratchTargetSnapshot);
        this.resolveIncomingHitOnPlayer(
          ev.hitPlayerDamage,
          this.scratchCurrPos.x - this.scratchTargetSnapshot.x,
          this.scratchCurrPos.z - this.scratchTargetSnapshot.z,
          ev.hitPlayerHeavy,
          enemy
        );
      }
      if (ev.burnTickDamage > 0) {
        enemy.getPosition(this.scratchTargetSnapshot);
        this.particlePool.emitHitSparks(
          this.scratchTargetSnapshot.x,
          this.scratchTargetSnapshot.y,
          this.scratchTargetSnapshot.z,
          0xff5722,
          false
        );
        this.emitFloatingTextAtWorld(
          this.scratchTargetSnapshot.x,
          this.scratchTargetSnapshot.y + 0.9,
          this.scratchTargetSnapshot.z,
          `${ev.burnTickDamage}`,
          'normal',
          'BURN'
        );
      }
      if (ev.microExplosionDamage > 0) {
        enemy.getPosition(this.scratchTargetSnapshot);
        this.particlePool.emitElementBurst(
          'pyro',
          this.scratchTargetSnapshot.x,
          this.scratchTargetSnapshot.y,
          this.scratchTargetSnapshot.z,
          16,
          0.8
        );
        this.cameraRig.addShake(0.16, 0.11);
        this.audio.playHitImpact(true, false);
        this.emitFloatingTextAtWorld(
          this.scratchTargetSnapshot.x,
          this.scratchTargetSnapshot.y + 1.0,
          this.scratchTargetSnapshot.z,
          `${ev.microExplosionDamage}`,
          'reaction',
          'OVERLOAD'
        );
      }
      if (ev.diedThisFrame) {
        this.onEnemyDefeated(enemy, false);
      }

      if (enemy instanceof BossKaijin && !freezeEnemies) {
        const projHit = enemy.stepProjectiles(fixedDt, this.player);
        if (projHit.damage > 0) {
          this.resolveIncomingHitOnPlayer(projHit.damage, projHit.dirX, projHit.dirZ, false, enemy);
        }

        const hazardStep = enemy.stepHazards(fixedDt, this.player);
        if (hazardStep.eruptedCount > 0) {
          this.audio.playBossHazardErupt(enemy.config.id);
          this.cameraRig.addShake(0.32, 0.22);
          this.elementSkillVfx.spawnExplosionPillar(
            enemy.signatureProfile.hazardElement,
            hazardStep.lastEruptX,
            hazardStep.lastEruptZ,
            2.35
          );
        }
        if (hazardStep.damage > 0) {
          this.resolveIncomingHitOnPlayer(
            hazardStep.damage,
            hazardStep.dirX,
            hazardStep.dirZ,
            hazardStep.isHeavy,
            enemy
          );
        }
        if (hazardStep.healedBossAmount > 0) {
          enemy.getPosition(this.scratchTargetSnapshot);
          this.particlePool.emitElementBurst(
            'flora',
            this.scratchTargetSnapshot.x,
            this.scratchTargetSnapshot.y + 0.6,
            this.scratchTargetSnapshot.z,
            26,
            1.1
          );
          this.emitFloatingTextAtWorld(
            this.scratchTargetSnapshot.x,
            this.scratchTargetSnapshot.y + 1.6,
            this.scratchTargetSnapshot.z,
            `+${hazardStep.healedBossAmount} HP`,
            'heal',
            'SANCTUARY MEND'
          );
        }
        if (hazardStep.channelInterrupted) {
          enemy.getPosition(this.scratchTargetSnapshot);
          this.emitFloatingTextAtWorld(
            this.scratchTargetSnapshot.x,
            this.scratchTargetSnapshot.y + 1.8,
            this.scratchTargetSnapshot.z,
            'INTERRUPTED!',
            'dodge',
            'MEND BROKEN'
          );
        }
      }

      if (enemy.canBeDisposed) {
        this.removeAndDisposeEnemyAt(i);
      }
    }

    if (this.comboCount > 0) {
      this.comboResetTimer -= fixedDt;
      if (this.comboResetTimer <= 0) this.comboCount = 0;
    }

    this.telemetryCooldownSec -= fixedDt;
    if (this.telemetryCooldownSec <= 0) {
      this.telemetryCooldownSec = 0.065;
      this.syncHudTelemetry(moveResult.isGrounded, moveResult.isTouchingWall, bossStaggered);
    }
  };

  private spawnWave(wave: WaveConfig): void {
    if (!this.player) return;
    const store = useGameStore.getState();
    const bannerColor =
      wave.waveNumber === 3 ? '#f43f5e' : wave.waveNumber === 2 ? '#a855f7' : '#38bdf8';
    store.triggerWaveBanner(wave.title, wave.subtitle, bannerColor);
    this.audio.playFormSwitch(this.player.currentElementId, false);

    const flatIds: EnemyConfigId[] = [];
    for (let i = 0; i < wave.spawns.length; i++) {
      const entry = wave.spawns[i]!;
      for (let c = 0; c < entry.count; c++) {
        flatIds.push(entry.enemyId);
      }
    }

    const total = flatIds.length;
    for (let i = 0; i < total; i++) {
      const enemyId = flatIds[i]!;
      const cfg = getEnemyConfig(enemyId);
      const spread = total === 1 ? 0 : (i / (total - 1) - 0.5) * Math.PI * 0.85;
      const dist = cfg.tier === 'BOSS' ? 8.0 : cfg.tier === 'ELITE' ? 9.2 : 10.2;
      const sx = Math.sin(spread) * dist;
      const sz = -Math.cos(spread) * dist;

      const uid = `${enemyId}_${this.nextEnemyUid++}`;
      const textures = this.pbrTextures ?? this.assetLoader.getPbrTextures();
      const enemy =
        cfg.tier === 'BOSS'
          ? new BossKaijin(uid, cfg, this.assetLoader, textures, sx, sz)
          : new EnemyBase(uid, cfg, this.assetLoader, textures, sx, sz);

      this.scene.add(enemy.root);
      if (enemy instanceof BossKaijin) {
        this.scene.add(enemy.projectileGroup);
        this.scene.add(enemy.hazardGroup);
      }
      this.enemies.push(enemy);

      this.particlePool.emitElementBurst(
        cfg.tier === 'BOSS' ? 'pyro' : cfg.tier === 'ELITE' ? 'volt' : 'aqua',
        sx,
        1.1,
        sz,
        24,
        1.0
      );
    }
  }

  private handleHenshinSuperEvent(): void {
    if (!this.player) return;
    const elemId = this.player.currentElementId;
    this.audio.playHenshinSuper();
    this.cameraRig.addShake(0.4, 0.35);
    this.player.getPosition(this.scratchOriginSnapshot);
    this.elementSkillVfx.spawnSkillVfx(
      elemId,
      this.scratchOriginSnapshot.x,
      this.scratchOriginSnapshot.z,
      this.player.facingYaw,
      7.5,
      true
    );
    this.particlePool.emitReactionBurst(
      'OVERLOAD',
      this.scratchOriginSnapshot.x,
      this.scratchOriginSnapshot.y + 0.4,
      this.scratchOriginSnapshot.z
    );
    useGameStore
      .getState()
      .triggerWaveBanner(
        'SUPER FORM HENSHIN!',
        '+30% DMG • 32s SUSTAIN • FINISHER [R] READY',
        '#facc15'
      );

    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i]!;
      if (!enemy.isAlive) continue;
      enemy.getPosition(this.scratchTargetSnapshot);
      const dx = this.scratchTargetSnapshot.x - this.scratchOriginSnapshot.x;
      const dz = this.scratchTargetSnapshot.z - this.scratchOriginSnapshot.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= 7.5 + enemy.radius) {
        this.applyElementalStrikeOnEnemy(
          enemy,
          elemId,
          1.4,
          65,
          65,
          true,
          'HENSHIN WAVE',
          false
        );
      }
    }
  }

  private handleHenshinUltimateEvent(): void {
    if (!this.player) return;
    const elemId = this.player.currentElementId;
    const cfg = getElementConfig(elemId);
    this.audio.playHenshinUltimate();
    this.cameraRig.addShake(0.5, 0.4);
    this.player.getPosition(this.scratchOriginSnapshot);
    this.elementSkillVfx.spawnFinisherClimax(
      elemId,
      this.scratchOriginSnapshot.x,
      this.scratchOriginSnapshot.z,
      9.2
    );
    this.particlePool.emitReactionBurst(
      'ELECTRO_SURGE',
      this.scratchOriginSnapshot.x,
      this.scratchOriginSnapshot.y + 0.5,
      this.scratchOriginSnapshot.z
    );
    useGameStore
      .getState()
      .triggerWaveBanner(
        'ULTIMATE FORM AWAKENED!',
        '+60% DMG • 25s FULL ARMOR • FREE FINISHER [R]',
        cfg.emissiveColor
      );

    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i]!;
      if (!enemy.isAlive) continue;
      enemy.getPosition(this.scratchTargetSnapshot);
      const dist = Math.hypot(
        this.scratchTargetSnapshot.x - this.scratchOriginSnapshot.x,
        this.scratchTargetSnapshot.z - this.scratchOriginSnapshot.z
      );
      if (dist <= 9.2 + enemy.radius) {
        this.applyElementalStrikeOnEnemy(
          enemy,
          elemId,
          2.2,
          95,
          85,
          true,
          'ULTIMATE AWAKENING',
          false
        );
      }
    }
  }

  private handleUltimateStartEvent(): void {
    if (!this.player || !this.petEntity) return;
    const elemId = this.player.currentElementId;
    const cfg = getElementConfig(elemId);

    // Capture current arena's natural daylight intensities once before domain dimming engages
    if (!this.domainDimActive && this.domainDimBlend <= 0.01) {
      this.domainBaseSunIntensity = this.sunLight.intensity;
      this.domainBaseHemiIntensity = this.hemiLight.intensity;
      this.domainBaseFillIntensity = this.fillLight.intensity;
      this.domainBaseEnvIntensity = this.scene.environmentIntensity;
    }
    this.domainDimActive = true;
    this.finisherSpotLight.color.set(cfg.emissiveColor);

    this.audio.playUltimateFinisher();
    this.player.getPosition(this.scratchOriginSnapshot);
    this.petEntity.activateUltimatePet(elemId, this.scratchOriginSnapshot, this.player.facingYaw);
    this.cameraRig.setMode('ULTIMATE_CINEMATIC', this.player.facingYaw);
    this.cameraRig.addShake(0.28, 0.3);
    this.particlePool.emitReactionBurst(
      'ELECTRO_SURGE',
      this.scratchOriginSnapshot.x,
      this.scratchOriginSnapshot.y + 0.6,
      this.scratchOriginSnapshot.z
    );
    useGameStore
      .getState()
      .triggerFinisherCinematic(elemId, cfg.finisherName, this.player.wasFinisherCastFromUltimate);
  }

  private resolveUltimateFinisherImpact(): void {
    if (!this.player) return;
    const elemId = this.player.currentElementId;
    const cfg = getElementConfig(elemId);
    this.player.getPosition(this.scratchOriginSnapshot);
    this.player.getForwardXZ(this.scratchPlayerForwardXZ);
    const impactX = this.scratchOriginSnapshot.x + this.scratchPlayerForwardXZ.x * 2.6;
    const impactZ = this.scratchOriginSnapshot.z + this.scratchPlayerForwardXZ.z * 2.6;

    this.elementSkillVfx.spawnFinisherClimax(elemId, impactX, impactZ, 12.5);
    this.loop.triggerHitStop(0.14);
    this.cameraRig.addShake(0.6, 0.45);
    this.audio.playRiderKickImpact();
    this.audio.playReaction('STEAM_BURST');

    const finisherMult = this.player.wasFinisherCastFromUltimate ? 7.8 : 6.2;

    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i]!;
      if (!enemy.isAlive) continue;
      enemy.getPosition(this.scratchTargetSnapshot);
      const dist = Math.hypot(
        this.scratchTargetSnapshot.x - this.scratchOriginSnapshot.x,
        this.scratchTargetSnapshot.z - this.scratchOriginSnapshot.z
      );
      if (dist <= 15.0) {
        this.particlePool.emitReactionBurst(
          'STEAM_BURST',
          this.scratchTargetSnapshot.x,
          this.scratchTargetSnapshot.y,
          this.scratchTargetSnapshot.z
        );
        this.applyElementalStrikeOnEnemy(
          enemy,
          elemId,
          finisherMult,
          195,
          95,
          true,
          cfg.finisherName.toUpperCase(),
          true
        );
      }
    }
  }

  private triggerUltimateBackExplosionVfx(): void {
    if (!this.player) return;
    this.player.getPosition(this.scratchOriginSnapshot);
    const fx = Math.sin(this.player.facingYaw);
    const fz = Math.cos(this.player.facingYaw);
    const bx =
      this.scratchOriginSnapshot.x +
      fx * (3.5 + Math.random() * 2.5) +
      (Math.random() - 0.5) * 3.0;
    const bz =
      this.scratchOriginSnapshot.z +
      fz * (3.5 + Math.random() * 2.5) +
      (Math.random() - 0.5) * 3.0;

    this.elementSkillVfx.spawnExplosionPillar(this.player.currentElementId, bx, bz, 3.6);
    this.particlePool.emitReactionBurst('OVERLOAD', bx, 1.2, bz);
    this.cameraRig.addShake(0.36, 0.22);
    this.audio.playReaction('OVERLOAD');
  }

  private handleFormSwitchEvent(nextElement: ElementId): void {
    if (!this.player) return;
    const cfg = getElementConfig(nextElement);
    useGameStore.getState().setActiveElement(nextElement);
    this.audio.playFormSwitch(nextElement);

    this.player.getPosition(this.scratchOriginSnapshot);
    this.scratchColorHelper.set(cfg.emissiveColor);
    this.particlePool.emitBeltSwitchBurst(
      this.scratchOriginSnapshot.x,
      this.scratchOriginSnapshot.y,
      this.scratchOriginSnapshot.z,
      this.scratchColorHelper.getHex()
    );
    this.cameraRig.addShake(0.12, 0.12);

    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i]!;
      if (!enemy.isAlive) continue;
      enemy.getPosition(this.scratchTargetSnapshot);
      const dist = Math.hypot(
        this.scratchTargetSnapshot.x - this.scratchOriginSnapshot.x,
        this.scratchTargetSnapshot.z - this.scratchOriginSnapshot.z
      );
      if (dist <= SWITCH_REACTION_BURST_RANGE) {
        const preview = evaluateElementalReaction(enemy.getActiveStatusIds(), nextElement);
        if (preview.triggered) {
          this.applyElementalStrikeOnEnemy(
            enemy,
            nextElement,
            1.0,
            28,
            75,
            true,
            'SWITCH BURST',
            false
          );
        }
      }
    }
  }

  private handleSkillStartEvent(element: ElementId): void {
    if (!this.player) return;
    const cfg = getElementConfig(element);
    this.audio.playElementSkill(element);
    this.player.addDriverGauge(10);
    this.player.getPosition(this.scratchOriginSnapshot);
    this.player.getForwardXZ(this.scratchPlayerForwardXZ);
    const isSuper = this.player.currentFormTier !== 'BASIC';
    const vfxX = this.scratchOriginSnapshot.x + this.scratchPlayerForwardXZ.x * 1.6;
    const vfxZ = this.scratchOriginSnapshot.z + this.scratchPlayerForwardXZ.z * 1.6;
    this.elementSkillVfx.spawnSkillVfx(
      element,
      vfxX,
      vfxZ,
      this.player.facingYaw,
      cfg.skill.radius * (isSuper ? 1.35 : 1.0),
      isSuper
    );
    this.particlePool.emitElementBurst(
      element,
      vfxX,
      this.scratchOriginSnapshot.y + 0.3,
      vfxZ,
      isSuper ? 52 : 36,
      isSuper ? 1.65 : 1.25
    );
    this.cameraRig.addShake(isSuper ? 0.32 : 0.24, 0.18);
  }

  private resolvePlayerMeleeHits(): void {
    if (!this.player) return;
    const spec = this.player.fsm.getCurrentAttackSpec();
    const comboStep = this.player.fsm.comboStep;
    if (!spec || comboStep === 0) return;

    const weapon = this.player.activeElement.weapon;
    this.player.getPosition(this.scratchOriginSnapshot);
    this.player.getForwardXZ(this.scratchPlayerForwardXZ);

    this.playerHitbox.checkMeleeArc(
      this.scratchOriginSnapshot,
      this.scratchPlayerForwardXZ.x,
      this.scratchPlayerForwardXZ.z,
      weapon.range,
      spec.minDotProduct,
      this.enemies,
      this.scratchHitResults
    );

    if (this.scratchHitResults.length === 0) return;

    const skillMult = weapon.comboMultipliers[comboStep - 1] ?? 1.0;
    const hitStopMs = comboStep === 3 ? Math.max(75, weapon.hitStopMs) : weapon.hitStopMs;
    const isHeavy = comboStep === 3 || weapon.archetype === 'HEAVY_MELEE';
    const baseGuardDamage = weapon.archetype === 'HEAVY_MELEE' ? 36 : comboStep === 3 ? 28 : 16;

    for (let i = 0; i < this.scratchHitResults.length; i++) {
      const target = this.scratchHitResults[i] as EnemyBase;
      this.applyElementalStrikeOnEnemy(
        target,
        this.player.currentElementId,
        skillMult,
        baseGuardDamage,
        hitStopMs,
        isHeavy,
        comboStep === 3 ? 'FINISHER' : undefined,
        false
      );
    }
  }

  private resolveElementSkillHits(): void {
    if (!this.player) return;
    const elementId = this.player.currentElementId;
    const cfg = getElementConfig(elementId);
    const isSuper = this.player.currentFormTier !== 'BASIC';

    this.player.getPosition(this.scratchOriginSnapshot);
    this.player.getForwardXZ(this.scratchPlayerForwardXZ);
    this.scratchOriginSnapshot.x += this.scratchPlayerForwardXZ.x * 1.6;
    this.scratchOriginSnapshot.z += this.scratchPlayerForwardXZ.z * 1.6;

    const radius = cfg.skill.radius * (isSuper ? 1.35 : 1.0);
    const mult = cfg.skill.damageMultiplier * (isSuper ? 1.35 : 1.0);
    const label = isSuper ? `SUPER ${cfg.skill.name.toUpperCase()}` : cfg.skill.name.toUpperCase();

    this.skillHitbox.checkSphere(
      this.scratchOriginSnapshot,
      radius,
      this.enemies,
      this.scratchHitResults
    );

    for (let i = 0; i < this.scratchHitResults.length; i++) {
      const target = this.scratchHitResults[i] as EnemyBase;
      target.getPosition(this.scratchTargetSnapshot);
      this.particlePool.emitElementBurst(
        elementId,
        this.scratchTargetSnapshot.x,
        this.scratchTargetSnapshot.y,
        this.scratchTargetSnapshot.z,
        28,
        1.1
      );
      // Element-specific bonus mechanics (Aero Vortex Pull, Lunar Lifesteal, Terra Guard Break)
      if (elementId === 'aero') {
        const px = this.scratchOriginSnapshot.x - this.scratchTargetSnapshot.x;
        const pz = this.scratchOriginSnapshot.z - this.scratchTargetSnapshot.z;
        const pLen = Math.hypot(px, pz) || 1;
        target.applyKnockback(px / pLen, pz / pLen, 7.2);
      } else if (elementId === 'lunar') {
        const healed = this.player.heal(10);
        if (healed > 0) {
          this.emitFloatingTextAtWorld(
            this.scratchCurrPos.x,
            this.scratchCurrPos.y + 1.3,
            this.scratchCurrPos.z,
            `+${healed} HP`,
            'heal',
            'LIFESTEAL'
          );
        }
      }
      const guardBreakPower = elementId === 'terra' ? 75 : 46;
      this.applyElementalStrikeOnEnemy(
        target,
        elementId,
        mult,
        guardBreakPower,
        75,
        true,
        label,
        false
      );
    }
  }

  private resolvePetImpact(
    element: ElementId,
    x: number,
    y: number,
    z: number,
    radius: number,
    damageMultiplier: number,
    healRiderAmount: number
  ): void {
    if (!this.player) return;
    this.particlePool.emitElementBurst(element, x, y, z, 38, 1.3);
    this.cameraRig.addShake(0.22, 0.16);
    this.audio.playElementSkill(element);

    const petName = getElementConfig(element).pet.name.toUpperCase();
    if (healRiderAmount > 0) {
      const healed = this.player.heal(healRiderAmount);
      if (healed > 0) {
        this.emitFloatingTextAtWorld(
          this.scratchCurrPos.x,
          this.scratchCurrPos.y + 1.3,
          this.scratchCurrPos.z,
          `+${healed} HP`,
          'heal',
          petName
        );
      }
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i]!;
      if (!enemy.isAlive) continue;
      enemy.getPosition(this.scratchTargetSnapshot);
      const dist = Math.hypot(this.scratchTargetSnapshot.x - x, this.scratchTargetSnapshot.z - z);
      if (dist <= radius + enemy.radius) {
        this.applyElementalStrikeOnEnemy(
          enemy,
          element,
          damageMultiplier,
          32,
          55,
          true,
          petName,
          false
        );
      }
    }
  }

  private handleRiderKickStartEvent(): void {
    if (!this.player) return;
    const elemId = this.player.currentElementId;
    const aimTarget = this.lockedEnemy?.isAlive ? this.lockedEnemy : this.findPriorityTarget();
    if (aimTarget && aimTarget.isAlive) {
      aimTarget.getPosition(this.scratchTargetSnapshot);
      const dist = Math.hypot(
        this.scratchTargetSnapshot.x - this.scratchCurrPos.x,
        this.scratchTargetSnapshot.z - this.scratchCurrPos.z
      );
      if (dist <= 12.0) {
        this.player.faceToward(this.scratchTargetSnapshot.x, this.scratchTargetSnapshot.z);
      }
    }

    this.audio.playRiderKickLaunch();
    this.cameraRig.setMode('RIDER_KICK', this.player.facingYaw);
    this.loop.setTimeScale(0.62, 0.28);
    this.cameraRig.addShake(0.18, 0.16);
    this.player.getPosition(this.scratchOriginSnapshot);
    this.particlePool.emitElementBurst(
      elemId,
      this.scratchOriginSnapshot.x,
      this.scratchOriginSnapshot.y + 0.35,
      this.scratchOriginSnapshot.z,
      28,
      1.15
    );
  }

  private resolveRiderKickImpact(): void {
    if (!this.player) return;
    const elemId = this.player.currentElementId;
    const isSuper = this.player.currentFormTier !== 'BASIC';
    this.player.getPosition(this.scratchOriginSnapshot);
    this.player.getForwardXZ(this.scratchPlayerForwardXZ);
    const impactX = this.scratchOriginSnapshot.x + this.scratchPlayerForwardXZ.x * 1.1;
    const impactZ = this.scratchOriginSnapshot.z + this.scratchPlayerForwardXZ.z * 1.1;
    const kickRadius = isSuper ? 5.2 : 4.4;

    this.audio.playRiderKickImpact();
    this.loop.triggerHitStop(0.1);
    this.cameraRig.addShake(0.48, 0.32);
    this.elementSkillVfx.spawnSkillVfx(elemId, impactX, impactZ, this.player.facingYaw, kickRadius, isSuper);
    this.elementSkillVfx.spawnExplosionPillar(elemId, impactX, impactZ, isSuper ? 3.2 : 2.6);
    this.particlePool.emitReactionBurst('OVERLOAD', impactX, 0.9, impactZ);

    let connected = false;
    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i]!;
      if (!enemy.isAlive) continue;
      enemy.getPosition(this.scratchTargetSnapshot);
      const dist = Math.hypot(
        this.scratchTargetSnapshot.x - impactX,
        this.scratchTargetSnapshot.z - impactZ
      );
      if (dist <= kickRadius + enemy.radius) {
        connected = true;
        const mult = enemy.isStaggered ? (isSuper ? 4.2 : 3.5) : isSuper ? 3.3 : 2.6;
        this.applyElementalStrikeOnEnemy(
          enemy,
          elemId,
          mult,
          75,
          95,
          true,
          enemy.isStaggered ? 'CRITICAL RIDER KICK!' : 'RIDER KICK!',
          false,
          enemy.isStaggered
        );
      }
    }
    if (connected) {
      this.player.addDriverGauge(22);
    }
  }

  private handleWarpCounterEvent(): void {
    if (!this.player) return;
    const target =
      this.lastPerfectDodgeAttacker && this.lastPerfectDodgeAttacker.isAlive
        ? this.lastPerfectDodgeAttacker
        : this.lockedEnemy && this.lockedEnemy.isAlive
          ? this.lockedEnemy
          : this.findPriorityTarget();
    this.lastPerfectDodgeAttacker = null;

    if (!target || !target.isAlive) return;

    const elemId = this.player.currentElementId;
    this.player.getPosition(this.scratchOriginSnapshot);
    this.particlePool.emitElementBurst(
      elemId,
      this.scratchOriginSnapshot.x,
      this.scratchOriginSnapshot.y + 0.5,
      this.scratchOriginSnapshot.z,
      20,
      0.85
    );

    target.getPosition(this.scratchTargetSnapshot);
    const targetYaw = target.root.rotation.y;
    const warpDist = target.radius + 1.45;
    let warpX = this.scratchTargetSnapshot.x - Math.sin(targetYaw) * warpDist;
    let warpZ = this.scratchTargetSnapshot.z - Math.cos(targetYaw) * warpDist;
    const maxR = ARENA_RADIUS - 1.5;
    const radial = Math.hypot(warpX, warpZ);
    if (radial > maxR && radial > 0.001) {
      const s = maxR / radial;
      warpX *= s;
      warpZ *= s;
    }

    this.physics.resetPlayerPosition(warpX, warpZ);
    this.physics.getPlayerPosition(this.scratchCurrPos);
    this.scratchPrevPos.copy(this.scratchCurrPos);
    this.player.root.position.copy(this.scratchCurrPos);
    this.player.faceToward(this.scratchTargetSnapshot.x, this.scratchTargetSnapshot.z);

    this.audio.playWarpCounter();
    this.cameraRig.addShake(0.32, 0.2);
    this.particlePool.emitElementBurst(
      elemId,
      this.scratchCurrPos.x,
      this.scratchCurrPos.y + 0.6,
      this.scratchCurrPos.z,
      26,
      1.05
    );

    this.player.addDriverGauge(12);
    this.applyElementalStrikeOnEnemy(
      target,
      elemId,
      WARP_COUNTER_DAMAGE_MULTIPLIER,
      38,
      80,
      true,
      'WARP COUNTER!',
      false,
      true
    );
  }

  private applyElementalStrikeOnEnemy(
    enemy: EnemyBase,
    elementId: ElementId,
    skillMultiplier: number,
    baseGuardDamage: number,
    hitStopMs: number,
    isHeavy: boolean,
    label: string | undefined,
    isUltimateFinisher: boolean,
    forceGuaranteedCrit = false
  ): void {
    if (!this.player || !enemy.isAlive) return;
    const cfg = getElementConfig(elementId);
    const currentStatuses = enemy.getActiveStatusIds();

    const reactionEval = evaluateElementalReaction(currentStatuses, elementId, cfg.statusApplied);
    const reactionSpec = reactionEval.reaction;
    const reactionMult = reactionSpec ? reactionSpec.damageMultiplier : 1.0;

    const dmgResult = calculateDamage({
      baseDamage: this.player.getEffectiveBaseAttack(),
      skillMultiplier,
      formTier: this.player.currentFormTier,
      reactionMultiplier: reactionMult,
      targetDefense: enemy.config.defense,
      targetStaggered: enemy.isStaggered,
      targetStatuses: currentStatuses,
      ignoresDefense: reactionSpec?.ignoresDefense ?? false,
      critRoll: forceGuaranteedCrit ? 0 : undefined,
    });

    const guardDamage = baseGuardDamage * (reactionSpec ? reactionSpec.guardDamageMultiplier : 1.0);
    const knockback = reactionSpec ? reactionSpec.knockbackForce : isHeavy ? 5.0 : 2.6;

    this.player.getPosition(this.scratchOriginSnapshot);
    const hitOutcome = enemy.applyDamage(
      dmgResult.finalDamage,
      guardDamage,
      this.scratchOriginSnapshot.x,
      this.scratchOriginSnapshot.z,
      knockback
    );

    if (reactionEval.triggered && reactionEval.consumedStatus && reactionSpec) {
      enemy.consumeStatus(reactionEval.consumedStatus);
      this.stageManager.recordReaction();
      const reactExt = this.player.extendFormDuration(2.0);
      if (reactExt > 0.2) {
        this.emitFloatingTextAtWorld(
          this.scratchCurrPos.x,
          this.scratchCurrPos.y + 1.65,
          this.scratchCurrPos.z,
          `+${reactExt.toFixed(1)}s`,
          'heal',
          'OVERDRIVE SUSTAIN'
        );
      }
      if (reactionSpec.microExplosionCount > 1 && enemy.isAlive) {
        const microDmg = Math.max(14, Math.floor(dmgResult.finalDamage * 0.28));
        enemy.queueMicroExplosions(reactionSpec.microExplosionCount, microDmg);
      }
      if (reactionSpec.id === 'ELECTRO_SURGE') {
        this.applyChainLightningBounce(enemy, Math.round(dmgResult.finalDamage * 0.45));
      } else if (reactionSpec.id === 'WILDFIRE' && enemy.isAlive) {
        enemy.applyStatus('BURN');
      }
    } else if (reactionEval.appliedStatus && enemy.isAlive) {
      enemy.applyStatus(reactionEval.appliedStatus);
    }

    if (!isUltimateFinisher) {
      const triggeredSwitchBonus = reactionEval.triggered && this.player.isInRecentSwitchWindow;
      let gaugeGain = calculateHitGaugeGain(cfg.weapon.gaugePerHit, triggeredSwitchBonus);
      if (reactionSpec && reactionSpec.gaugeMultiplier > 1) {
        gaugeGain *= reactionSpec.gaugeMultiplier;
      }
      this.player.addDriverGauge(gaugeGain);
    }

    this.comboCount++;
    this.comboResetTimer = COMBO_RESET_DELAY_SEC;
    this.stageManager.recordCombo(this.comboCount);

    enemy.getPosition(this.scratchTargetSnapshot);
    this.scratchColorHelper.set(cfg.emissiveColor);

    if (hitOutcome.guardBroken) {
      this.audio.playGuardBreak();
      this.cameraRig.addShake(0.35, 0.25);
      this.emitFloatingTextAtWorld(
        this.scratchTargetSnapshot.x,
        this.scratchTargetSnapshot.y + 1.5,
        this.scratchTargetSnapshot.z,
        'ARMOR BREAK!',
        'reaction',
        'STAGGERED (-50% DEF)'
      );
    }

    if (reactionSpec) {
      this.loop.triggerHitStop(Math.max(0.085, hitStopMs / 1000));
      this.cameraRig.addShake(0.36, 0.22);
      this.audio.playReaction(reactionSpec.id);
      this.particlePool.emitReactionBurst(
        reactionSpec.id,
        this.scratchTargetSnapshot.x,
        this.scratchTargetSnapshot.y,
        this.scratchTargetSnapshot.z
      );
      useGameStore.getState().triggerReactionBanner(reactionSpec);
      this.emitFloatingTextAtWorld(
        this.scratchTargetSnapshot.x,
        this.scratchTargetSnapshot.y + 1.25,
        this.scratchTargetSnapshot.z,
        `${dmgResult.finalDamage}`,
        'reaction',
        reactionSpec.displayName
      );
    } else {
      if (!isUltimateFinisher && hitStopMs > 0) {
        this.loop.triggerHitStop(hitStopMs / 1000);
      }
      if (hitStopMs > 0) {
        this.cameraRig.addShake(
          dmgResult.isCrit ? 0.3 : isHeavy ? 0.22 : 0.12,
          isHeavy ? 0.18 : 0.11
        );
      } else {
        this.cameraRig.addShake(0.04, 0.06);
      }
      this.audio.playHitImpact(dmgResult.isCrit, isHeavy);
      this.particlePool.emitHitSparks(
        this.scratchTargetSnapshot.x,
        this.scratchTargetSnapshot.y + 0.3,
        this.scratchTargetSnapshot.z,
        this.scratchColorHelper.getHex(),
        dmgResult.isCrit
      );

      const jitterX = (Math.random() - 0.5) * 0.65;
      const jitterY = 0.75 + Math.random() * 0.4;
      const subtext = dmgResult.isCrit
        ? 'CRIT!'
        : label ?? (reactionEval.appliedStatus ? reactionEval.appliedStatus : undefined);
      this.emitFloatingTextAtWorld(
        this.scratchTargetSnapshot.x + jitterX,
        this.scratchTargetSnapshot.y + jitterY,
        this.scratchTargetSnapshot.z,
        `${dmgResult.finalDamage}`,
        isUltimateFinisher ? 'reaction' : dmgResult.isCrit ? 'crit' : 'normal',
        subtext
      );
    }

    if (hitOutcome.killed) {
      this.onEnemyDefeated(enemy, isUltimateFinisher);
    }
  }

  private applyChainLightningBounce(source: EnemyBase, chainDamage: number): void {
    source.getPosition(this.scratchOriginSnapshot);
    for (let i = 0; i < this.enemies.length; i++) {
      const other = this.enemies[i]!;
      if (other === source || !other.isAlive) continue;
      other.getPosition(this.scratchTargetSnapshot);
      const dist = Math.hypot(
        this.scratchTargetSnapshot.x - this.scratchOriginSnapshot.x,
        this.scratchTargetSnapshot.z - this.scratchOriginSnapshot.z
      );
      if (dist <= 6.2) {
        const res = other.applyDamage(
          chainDamage,
          40,
          this.scratchOriginSnapshot.x,
          this.scratchOriginSnapshot.z,
          2.0
        );
        this.particlePool.emitElementBurst(
          'volt',
          this.scratchTargetSnapshot.x,
          this.scratchTargetSnapshot.y,
          this.scratchTargetSnapshot.z,
          14,
          0.8
        );
        this.emitFloatingTextAtWorld(
          this.scratchTargetSnapshot.x,
          this.scratchTargetSnapshot.y + 1.0,
          this.scratchTargetSnapshot.z,
          `${chainDamage}`,
          'dodge',
          'CHAIN SURGE'
        );
        if (res.killed) {
          this.onEnemyDefeated(other, false);
        }
        break;
      }
    }
  }

  private onEnemyDefeated(enemy: EnemyBase, killedByUltimate: boolean): void {
    enemy.getPosition(this.scratchTargetSnapshot);
    this.particlePool.emitReactionBurst(
      enemy.config.tier === 'BOSS' ? 'OVERLOAD' : 'ELECTRO_SURGE',
      this.scratchTargetSnapshot.x,
      this.scratchTargetSnapshot.y,
      this.scratchTargetSnapshot.z
    );

    if (enemy.config.tier === 'BOSS' && killedByUltimate) {
      this.stageManager.markBossFinisherKill();
    }

    // Overdrive Sustain: defeating enemies extends Super / Ultimate Form duration!
    if (this.player && this.player.currentFormTier !== 'BASIC') {
      const killExt = this.player.extendFormDuration(3.0);
      if (killExt > 0.2) {
        this.emitFloatingTextAtWorld(
          this.scratchCurrPos.x,
          this.scratchCurrPos.y + 1.55,
          this.scratchCurrPos.z,
          `+${killExt.toFixed(1)}s`,
          'heal',
          'KILL SUSTAIN'
        );
      }
    }

    const shardCount = enemy.config.tier === 'ELITE' ? 3 : enemy.config.tier === 'BOSS' ? 0 : 1;
    if (shardCount > 0) {
      this.gemShardPool.spawn(
        this.scratchTargetSnapshot.x,
        this.scratchTargetSnapshot.z,
        shardCount,
        14,
        12
      );
    }

    if (this.lockedEnemy === enemy) {
      enemy.setLockedOn(false);
      this.lockedEnemy = null;
    }
  }

  private resolveIncomingHitOnPlayer(
    damage: number,
    dirX: number,
    dirZ: number,
    isHeavy: boolean,
    attacker?: EnemyBase
  ): void {
    if (!this.player) return;
    const len = Math.hypot(dirX, dirZ) || 1;
    const outcome = this.player.receiveEnemyAttack(damage, dirX / len, dirZ / len, isHeavy);

    if (outcome === 'PERFECT_DODGE') {
      this.lastPerfectDodgeAttacker = attacker ?? null;
      this.loop.setTimeScale(PERFECT_DODGE_SLOWMO_SCALE, PERFECT_DODGE_SLOWMO_DURATION);
      this.player.addDriverGauge(PERFECT_DODGE_GAUGE_BONUS);
      this.stageManager.recordPerfectDodge();
      this.audio.playPerfectDodge();
      this.cameraRig.addShake(0.2, 0.2);

      useGameStore.getState().triggerPerfectDodgeFlash();
      this.emitFloatingTextAtWorld(
        this.scratchCurrPos.x,
        this.scratchCurrPos.y + 1.3,
        this.scratchCurrPos.z,
        'PERFECT DODGE!',
        'dodge',
        'WARP COUNTER READY!'
      );
    } else if (outcome === 'DAMAGED') {
      this.stageManager.recordDamageTaken(damage);
      if (this.player.fsm.state === 'HITSTUN') {
        this.comboCount = 0;
      }
      this.audio.playPlayerHurt();
      this.cameraRig.addShake(0.3, 0.2);
      this.loop.triggerHitStop(0.045);
      this.emitFloatingTextAtWorld(
        this.scratchCurrPos.x,
        this.scratchCurrPos.y + 1.15,
        this.scratchCurrPos.z,
        `-${damage}`,
        'playerHit',
        this.player.fsm.isDead
          ? 'DEFEATED'
          : this.player.fsm.state === 'HITSTUN'
            ? 'HITSTUN'
            : 'ARMOR'
      );
    }
  }

  private startStageOutcomeCutIn(victory: boolean): void {
    if (this.outcomeSequenceActive || !this.player) return;
    this.outcomeSequenceActive = true;
    this.outcomeSequenceVictory = victory;
    this.outcomeSequenceElapsed = 0;

    this.input.setAllowPointerLock(false);
    this.input.releasePointerLock();
    this.loop.setTimeScale(0.32, STAGE_OUTCOME_CUTIN_DURATION_SEC + 0.15);
    this.cameraRig.setMode('STAGE_OUTCOME', this.player.facingYaw);

    this.player.getPosition(this.scratchOriginSnapshot);
    this.audio.playStageOutcome(victory);
    if (victory) {
      this.cameraRig.addShake(0.26, 0.25);
      this.particlePool.emitReactionBurst(
        'ELECTRO_SURGE',
        this.scratchOriginSnapshot.x,
        this.scratchOriginSnapshot.y + 0.5,
        this.scratchOriginSnapshot.z
      );
    } else {
      this.cameraRig.addShake(0.4, 0.35);
      this.particlePool.emitReactionBurst(
        'OVERLOAD',
        this.scratchOriginSnapshot.x,
        this.scratchOriginSnapshot.y + 0.3,
        this.scratchOriginSnapshot.z
      );
    }

    const store = useGameStore.getState();
    const stage = getStageConfig(store.selectedStageId);
    store.triggerStageOutcomeCutIn(victory, stage.name, stage.accentColor);
  }

  private finishStage(victory: boolean): void {
    this.outcomeSequenceActive = false;
    this.outcomeSequenceElapsed = 0;
    this.input.setAllowPointerLock(false);
    this.input.releasePointerLock();
    this.loop.resetTimeScale();
    this.resetDomainDimming();
    this.updateBgmIntensity('HUB');
    const { result, saveRecord } = this.stageManager.buildResultAndPersist(victory);
    const store = useGameStore.getState();
    store.clearFinisherCinematic();
    store.clearStageOutcomeCutIn();
    store.setStageResult(result, saveRecord);
    store.setScreenMode('RESULT');
  }

  private syncHudTelemetry(
    isGrounded: boolean,
    isTouchingWall: boolean,
    bossStaggered: boolean
  ): void {
    if (!this.player || !this.petEntity) return;
    const store = useGameStore.getState();
    const nowMs = performance.now();
    const dist = Math.hypot(this.scratchCurrPos.x, this.scratchCurrPos.z);

    store.setPlayerTelemetry(
      this.scratchCurrPos.x,
      this.scratchCurrPos.y,
      this.scratchCurrPos.z,
      dist,
      isGrounded,
      isTouchingWall
    );

    const focused = this.lockedEnemy?.isAlive ? this.lockedEnemy : this.findPriorityTarget();
    const ultimateTitle = this.player.fsm.isInCinematic
      ? getElementConfig(this.player.currentElementId).finisherName
      : null;

    store.setCombatSnapshot({
      playerState: this.player.fsm.state,
      formTier: this.player.currentFormTier,
      playerHp: this.player.currentHp,
      playerMaxHp: this.player.maximumHp,
      driverGauge: this.player.currentDriverGauge,
      overdriveGauge: this.player.currentOverdriveGauge,
      superFormRemaining: this.player.currentSuperFormRemaining,
      finisherCooldown: this.player.currentFinisherCooldown,
      riderKickCooldown: this.player.currentRiderKickCooldown,
      activePetRemaining: this.petEntity.getActiveCompanionRemaining(),
      activeElementPetRemaining: this.petEntity.getActiveCompanionRemaining(
        this.player.currentElementId
      ),
      activePetCount: this.petEntity.getActiveCompanionCount(),
      canActivateSuper: this.player.canActivateSuperForm(),
      canActivateUltimateForm: this.player.canActivateUltimateForm(bossStaggered),
      canActivateUltimate: this.player.canActivateFinisher(),
      warpCounterReady: this.player.isWarpCounterReady,
      ultimateBannerTitle: ultimateTitle,
      comboCount: this.comboCount,
      isLockedOn: this.cameraRig.isLockedOn && this.lockedEnemy !== null,
      waveNumber: this.stageManager.waveNumber,
      totalWaves: this.stageManager.totalWaves,
      aliveEnemyCount: this.countAliveEnemies(),
      stageElapsedSec: this.stageManager.clearTimeSec,
      focusedEnemy: focused ? focused.getHudSnapshot() : null,
    });

    const loadout = store.loadoutOrder;
    this.scratchSkillCds[0] = this.player.getSkillCooldown(loadout[0]);
    this.scratchSkillCds[1] = this.player.getSkillCooldown(loadout[1]);
    this.scratchSkillCds[2] = this.player.getSkillCooldown(loadout[2]);
    this.scratchPetCds[0] = this.petEntity.getCooldown(loadout[0]);
    this.scratchPetCds[1] = this.petEntity.getCooldown(loadout[1]);
    this.scratchPetCds[2] = this.petEntity.getCooldown(loadout[2]);
    store.setAbilityCooldowns(
      this.player.fsm.formSwitchCooldown,
      loadout,
      this.scratchSkillCds,
      this.scratchPetCds
    );

    store.pruneFloatingTexts(nowMs);
    store.clearExpiredBanners(nowMs);
  }

  private countAliveEnemies(): number {
    let count = 0;
    for (let i = 0; i < this.enemies.length; i++) {
      if (this.enemies[i]!.isAlive) count++;
    }
    return count;
  }

  private isAnyBossStaggered(): boolean {
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]!;
      if (e.isAlive && e.config.tier === 'BOSS' && e.isStaggered) return true;
    }
    return false;
  }

  private findPriorityTarget(): EnemyBase | null {
    let best: EnemyBase | null = null;
    let bestScore = -Infinity;
    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i]!;
      if (!e.isAlive) continue;
      e.getPosition(this.scratchTargetSnapshot);
      const dist = Math.hypot(
        this.scratchTargetSnapshot.x - this.scratchCurrPos.x,
        this.scratchTargetSnapshot.z - this.scratchCurrPos.z
      );
      const tierBonus = e.config.tier === 'BOSS' ? 1000 : e.config.tier === 'ELITE' ? 200 : 0;
      const score = tierBonus - dist;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  private removeAndDisposeEnemyAt(index: number): void {
    const enemy = this.enemies[index];
    if (!enemy) return;
    if (this.lockedEnemy === enemy) {
      this.lockedEnemy = null;
    }
    if (this.lastPerfectDodgeAttacker === enemy) {
      this.lastPerfectDodgeAttacker = null;
    }
    this.scene.remove(enemy.root);
    if (enemy instanceof BossKaijin) {
      this.scene.remove(enemy.projectileGroup);
      this.scene.remove(enemy.hazardGroup);
    }
    enemy.dispose();
    this.enemies.splice(index, 1);
  }

  private disposeAllEnemies(): void {
    this.lockedEnemy = null;
    this.lastPerfectDodgeAttacker = null;
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      this.removeAndDisposeEnemyAt(i);
    }
  }

  private emitFloatingTextAtWorld(
    worldX: number,
    worldY: number,
    worldZ: number,
    text: string,
    kind: FloatingTextKind,
    subtext?: string
  ): void {
    this.scratchProjectVec.set(worldX, worldY, worldZ).project(this.camera);
    const xPct = Math.min(90, Math.max(10, (this.scratchProjectVec.x * 0.5 + 0.5) * 100));
    const yPct = Math.min(82, Math.max(14, (-this.scratchProjectVec.y * 0.5 + 0.5) * 100));
    useGameStore.getState().pushFloatingText(text, xPct, yPct, kind, subtext);
  }

  private readonly onRender = (alpha: number, rawDt: number): void => {
    if (!this.player || !this.petEntity) return;
    const screenMode = useGameStore.getState().screenMode;

    if (screenMode === 'HUB') {
      this.input.consumeLookDelta(this.scratchLookDelta);
      this.cameraRig.applyLookDelta(this.scratchLookDelta);
      const wheelZoom = this.input.consumeZoomDelta();
      if (wheelZoom !== 0) {
        this.cameraRig.applyHubZoom(wheelZoom);
      }

      this.arenaThemeManager.update(rawDt);
      if (this.arenaThemeManager.activeThemeId === 'coastal_quarry') {
        for (let i = 0; i < this.defaultAtmosphereParts.length; i++) {
          this.defaultAtmosphereParts[i]!.update?.(rawDt);
        }
      }
      this.player.updateHubPedestalVisuals(rawDt);
      this.particlePool.update(rawDt);
      this.scratchRenderPos.set(0, PLAYER_SPAWN_Y, 0);
      this.cameraRig.update(rawDt, this.scratchRenderPos, null);
      this.renderFrame();
      return;
    }

    if (this.outcomeSequenceActive) {
      this.outcomeSequenceElapsed += rawDt;
      if (this.outcomeSequenceElapsed >= STAGE_OUTCOME_CUTIN_DURATION_SEC) {
        this.finishStage(this.outcomeSequenceVictory);
      }
    }

    this.scratchRenderPos.lerpVectors(this.scratchPrevPos, this.scratchCurrPos, alpha);

    const visualDt = this.loop.isHitStopActive ? 0 : rawDt * this.loop.getTimeScale();
    this.arenaThemeManager.update(visualDt);
    if (this.arenaThemeManager.activeThemeId === 'coastal_quarry') {
      for (let i = 0; i < this.defaultAtmosphereParts.length; i++) {
        this.defaultAtmosphereParts[i]!.update?.(visualDt);
      }
    }
    this.player.updateVisuals(visualDt, this.scratchRenderPos);
    this.petEntity.updateVisuals();
    for (let i = 0; i < this.enemies.length; i++) {
      this.enemies[i]!.updateVisuals(visualDt, this.camera);
    }
    this.particlePool.update(rawDt * this.loop.getTimeScale());
    this.elementSkillVfx.update(rawDt * this.loop.getTimeScale());
    this.updateDomainDimming(rawDt, this.scratchRenderPos);

    let lockTargetPos: THREE.Vector3 | null = null;
    if (this.cameraRig.isLockedOn && this.lockedEnemy && this.lockedEnemy.isAlive) {
      this.lockedEnemy.getPosition(this.scratchTargetSnapshot);
      this.scratchLockTargetPos.set(
        this.scratchTargetSnapshot.x,
        this.scratchTargetSnapshot.y,
        this.scratchTargetSnapshot.z
      );
      lockTargetPos = this.scratchLockTargetPos;
    }

    this.cameraRig.update(rawDt, this.scratchRenderPos, lockTargetPos);
    this.renderFrame();
  };

  private renderFrame(): void {
    if (this.bloomEnabled) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private setupLighting(): void {
    // Natural Japanese golden-afternoon daylight hemisphere (sky blue overhead, warm quarry bounce below)
    this.hemiLight = new THREE.HemisphereLight(0xc2dcf5, 0x6f6559, 0.78);
    this.hemiLight.position.set(0, 32, 0);
    this.scene.add(this.hemiLight);

    // Crisp 2048x2048 directional sunlight aligned with the golden afternoon sun in the 360° skybox
    this.sunLight = new THREE.DirectionalLight(0xfff1d6, 2.7);
    this.sunLight.position.set(-18, 22, -14);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 70;
    this.sunLight.shadow.camera.left = -22;
    this.sunLight.shadow.camera.right = 22;
    this.sunLight.shadow.camera.top = 22;
    this.sunLight.shadow.camera.bottom = -22;
    this.sunLight.shadow.bias = -0.0004;
    this.sunLight.shadow.normalBias = 0.025;
    this.scene.add(this.sunLight);

    // Subtle cool sky bounce fill so shaded armor contours remain legible like Toei outdoor cinematography
    this.fillLight = new THREE.DirectionalLight(0x93c5fd, 0.58);
    this.fillLight.position.set(16, 12, 16);
    this.scene.add(this.fillLight);

    // Theatrical elemental spotlight illuminated during Domain-Dimmed Ultimate Finisher Climax
    this.finisherSpotLight = new THREE.PointLight(0xfacc15, 0, 30, 1.35);
    this.finisherSpotLight.position.set(0, 4.5, 0);
    this.scene.add(this.finisherSpotLight);
  }

  private resetDomainDimming(): void {
    if (this.domainDimBlend > 0.001 || this.domainDimActive) {
      this.sunLight.intensity = this.domainBaseSunIntensity;
      this.hemiLight.intensity = this.domainBaseHemiIntensity;
      this.fillLight.intensity = this.domainBaseFillIntensity;
      this.scene.environmentIntensity = this.domainBaseEnvIntensity;
    }
    this.domainDimActive = false;
    this.domainDimBlend = 0;
    if (this.finisherSpotLight) {
      this.finisherSpotLight.intensity = 0;
    }
  }

  private updateDomainDimming(dt: number, riderPos: THREE.Vector3): void {
    const target = this.domainDimActive ? 1 : 0;
    if (this.domainDimBlend === target) return;

    const rate = target > this.domainDimBlend ? 4.2 : 2.6;
    if (target > this.domainDimBlend) {
      this.domainDimBlend = Math.min(1, this.domainDimBlend + dt * rate);
    } else {
      this.domainDimBlend = Math.max(0, this.domainDimBlend - dt * rate);
    }

    const dimFactor = 1 - this.domainDimBlend * 0.78;
    const envDimFactor = 1 - this.domainDimBlend * 0.72;
    this.sunLight.intensity = this.domainBaseSunIntensity * dimFactor;
    this.hemiLight.intensity = this.domainBaseHemiIntensity * dimFactor;
    this.fillLight.intensity = this.domainBaseFillIntensity * dimFactor;
    this.scene.environmentIntensity = this.domainBaseEnvIntensity * envDimFactor;

    this.finisherSpotLight.position.set(riderPos.x, riderPos.y + 4.4, riderPos.z);
    this.finisherSpotLight.intensity = this.domainDimBlend * 18.0;
  }

  private buildArenaDeck(pbrTextures: PbrTextureSet): void {
    const arenaGroup = new THREE.Group();
    const circumradius = ARENA_RADIUS / Math.cos(Math.PI / ARENA_SIDES);

    // 1. Weathered Poured-Concrete Combat Deck (photo-derived Albedo + Sobel Normal + Roughness)
    const deckGeo = new THREE.CylinderGeometry(circumradius + 0.5, circumradius + 1.2, 0.4, ARENA_SIDES);
    const deckMat = new THREE.MeshStandardMaterial({
      color: 0xd6d3ce,
      map: pbrTextures.floorAlbedo,
      normalMap: pbrTextures.floorNormal,
      normalScale: new THREE.Vector2(1.05, 1.05),
      roughnessMap: pbrTextures.floorRoughness,
      roughness: 0.9,
      metalness: 0.04,
      envMapIntensity: 0.9,
    });
    this.deckMat = deckMat;
    this.arenaOwnedMaterials.push(deckMat);
    const deckMesh = new THREE.Mesh(deckGeo, deckMat);
    deckMesh.position.y = -0.2;
    deckMesh.rotation.y = Math.PI / ARENA_SIDES;
    deckMesh.receiveShadow = true;
    arenaGroup.add(deckMesh);

    // 2. Subtle Painted Yellow-Ochre Industrial Safety Line Marking inside Perimeter
    const hazardRingGeo = new THREE.RingGeometry(ARENA_RADIUS - 0.52, ARENA_RADIUS - 0.28, 48);
    const hazardRingMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.85,
      metalness: 0.05,
      transparent: true,
      opacity: 0.62,
      side: THREE.DoubleSide,
    });
    this.hazardRingMat = hazardRingMat;
    this.arenaOwnedMaterials.push(hazardRingMat);
    const hazardRing = new THREE.Mesh(hazardRingGeo, hazardRingMat);
    hazardRing.rotation.x = -Math.PI / 2;
    hazardRing.position.y = 0.012;
    hazardRing.receiveShadow = true;
    arenaGroup.add(hazardRing);

    // 3. Wide Seamless Surrounding Concrete/Gravel Ground Skirt (eliminates floating platform void!)
    const skirtAlbedo = pbrTextures.floorAlbedo.clone();
    skirtAlbedo.repeat.set(28, 28);
    skirtAlbedo.needsUpdate = true;
    const skirtNormal = pbrTextures.floorNormal.clone();
    skirtNormal.repeat.set(28, 28);
    skirtNormal.needsUpdate = true;
    this.defaultSkirtAlbedo = skirtAlbedo;
    this.defaultSkirtNormal = skirtNormal;
    this.disposableTextures.push(skirtAlbedo, skirtNormal);

    const skirtGeo = new THREE.CircleGeometry(135, 48);
    const skirtMat = new THREE.MeshStandardMaterial({
      color: 0xbcb6ad,
      map: skirtAlbedo,
      normalMap: skirtNormal,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.95,
      metalness: 0.02,
      envMapIntensity: 0.65,
    });
    this.skirtMat = skirtMat;
    this.arenaOwnedMaterials.push(skirtMat);
    const skirtMesh = new THREE.Mesh(skirtGeo, skirtMat);
    skirtMesh.rotation.x = -Math.PI / 2;
    skirtMesh.position.y = -0.04;
    skirtMesh.receiveShadow = true;
    this.skirtMesh = skirtMesh;
    arenaGroup.add(skirtMesh);

    this.scene.add(arenaGroup);
  }

  private readonly handleResize = (): void => {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.composer.setSize(width, height);
    this.bloomPass.resolution.set(
      Math.max(1, Math.floor(width / 2)),
      Math.max(1, Math.floor(height / 2))
    );
  };
}
