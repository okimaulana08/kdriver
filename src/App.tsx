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
import { CyberCounterPreloader } from './ui/motion/CyberCounterPreloader';
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
            <CyberCounterPreloader progress={loadProgress} label={loadLabel} />
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
