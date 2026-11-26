import { useCallback, useEffect, useRef } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import type { HubCameraPreset } from './engine/CameraRig';
import { GameApp } from './engine/GameApp';
import type { DifficultyId, ElementId, RiderId, StageId } from './game/types/schema';
import { useGameStore } from './store/useGameStore';
import { CombatHUD } from './ui/CombatHUD';
import { DamageNumbers } from './ui/DamageNumbers';
import { DebugOverlay } from './ui/DebugOverlay';
import { LoadoutHub } from './ui/LoadoutHub';
import { ResultModal } from './ui/ResultModal';
import { StageOutcomeCutIn } from './ui/StageOutcomeCutIn';

export function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<GameApp | null>(null);

  const engineStatus = useGameStore((s) => s.engineStatus);
  const errorMessage = useGameStore((s) => s.errorMessage);
  const loadProgress = useGameStore((s) => s.loadProgress);
  const loadLabel = useGameStore((s) => s.loadLabel);
  const screenMode = useGameStore((s) => s.screenMode);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const app = new GameApp(container);
    appRef.current = app;
    void app.init();

    return () => {
      appRef.current = null;
      app.dispose();
    };
  }, []);

  const handlePreviewElement = useCallback((id: ElementId) => {
    appRef.current?.previewHubElement(id);
  }, []);

  const handleUpdateLoadout = useCallback((order: [ElementId, ElementId, ElementId]) => {
    appRef.current?.setLoadoutOrder(order);
  }, []);

  const handleSelectStage = useCallback((stageId: StageId) => {
    void appRef.current?.selectStage(stageId);
  }, []);

  const handleSelectDifficulty = useCallback((difficulty: DifficultyId) => {
    appRef.current?.selectDifficulty(difficulty);
  }, []);

  const handleSelectRider = useCallback((riderId: RiderId) => {
    appRef.current?.selectRider(riderId);
  }, []);

  const handleGemProgressionChanged = useCallback(() => {
    appRef.current?.syncGemProgression();
  }, []);

  const handleDeploy = useCallback(() => {
    appRef.current?.deployToArena();
  }, []);

  const handleRetry = useCallback(() => {
    appRef.current?.retryStage();
  }, []);

  const handleReturnToHub = useCallback(() => {
    appRef.current?.returnToHub();
  }, []);

  const handleResetHubView = useCallback(() => {
    appRef.current?.resetHubCamera();
  }, []);

  const handleSelectHubCameraPreset = useCallback((preset: HubCameraPreset) => {
    appRef.current?.setHubCameraPreset(preset);
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <main className="relative h-screen w-screen overflow-hidden bg-slate-950">
        <div
          ref={mountRef}
          className={`h-full w-full ${
            screenMode === 'ARENA'
              ? 'cursor-crosshair'
              : screenMode === 'HUB'
                ? 'cursor-grab active:cursor-grabbing'
                : 'cursor-default'
          }`}
          aria-label="Project K-DRIVER 3D Arena"
        />

        <AnimatePresence mode="wait">
          {screenMode === 'HUB' && (
            <LoadoutHub
              key="loadout-hub"
              onPreviewElement={handlePreviewElement}
              onUpdateLoadoutOrder={handleUpdateLoadout}
              onSelectStage={handleSelectStage}
              onSelectDifficulty={handleSelectDifficulty}
              onSelectRider={handleSelectRider}
              onGemProgressionChanged={handleGemProgressionChanged}
              onDeploy={handleDeploy}
              onResetView={handleResetHubView}
              onSelectCameraPreset={handleSelectHubCameraPreset}
            />
          )}

          {screenMode === 'ARENA' && (
            <motion.div
              key="arena-hud"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
            >
              <DamageNumbers />
              <CombatHUD />
              <StageOutcomeCutIn />
            </motion.div>
          )}

          {screenMode === 'RESULT' && (
            <ResultModal
              key="result-modal"
              onRetry={handleRetry}
              onReturnToHub={handleReturnToHub}
            />
          )}
        </AnimatePresence>

        <DebugOverlay />

        <AnimatePresence>
          {engineStatus === 'initializing' && (
            <motion.div
              key="boot-overlay"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 1.04 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-slate-950/94 backdrop-blur-md"
            >
              <div className="game-chamfer game-panel-bezel relative w-96 overflow-hidden border-t-2 border-cyan-400/80 px-7 py-6 text-center shadow-[0_0_60px_rgba(6,182,212,0.28)]">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 2.4, ease: 'linear' }}
                    className="game-hex flex h-12 w-12 items-center justify-center bg-gradient-to-br from-cyan-400 via-rose-500 to-amber-400 p-[2px]"
                  >
                    <div className="game-hex flex h-full w-full items-center justify-center bg-slate-950 font-game-display text-xs font-black text-cyan-300">
                      K
                    </div>
                  </motion.div>
                </div>
                <p className="font-game-display text-xs font-black tracking-[0.3em] text-cyan-300 uppercase">
                  K-DRIVER SYSTEM BOOT
                </p>
                <div className="mt-3.5 h-2 w-full overflow-hidden bg-slate-900 ring-1 ring-white/10">
                  <motion.div
                    className="h-full bg-gradient-to-r from-cyan-400 via-rose-500 to-amber-400"
                    initial={{ width: 0 }}
                    animate={{ width: `${loadProgress}%` }}
                    transition={{ duration: 0.18, ease: 'easeOut' }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-slate-300">
                  <span className="truncate pr-2">{loadLabel}</span>
                  <span className="shrink-0 font-bold text-amber-300">{loadProgress}%</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {engineStatus === 'error' && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/90 p-6">
            <div className="game-chamfer max-w-md border border-rose-500/50 bg-slate-900 p-5 font-mono text-sm text-rose-200 shadow-2xl">
              <h2 className="font-game-display font-bold text-rose-400">Engine Initialization Failed</h2>
              <p className="mt-2 text-xs text-slate-300">
                {errorMessage ?? 'Unexpected WebGL or Rapier3D initialization error.'}
              </p>
            </div>
          </div>
        )}
      </main>
    </MotionConfig>
  );
}

export default App;
