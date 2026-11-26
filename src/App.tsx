import { useCallback, useEffect, useRef } from 'react';
import { GameApp } from './engine/GameApp';
import type { DifficultyId, ElementId, StageId } from './game/types/schema';
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

  return (
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

      {screenMode === 'HUB' && (
        <LoadoutHub
          onPreviewElement={handlePreviewElement}
          onUpdateLoadoutOrder={handleUpdateLoadout}
          onSelectStage={handleSelectStage}
          onSelectDifficulty={handleSelectDifficulty}
          onGemProgressionChanged={handleGemProgressionChanged}
          onDeploy={handleDeploy}
          onResetView={handleResetHubView}
        />
      )}

      {screenMode === 'ARENA' && (
        <>
          <DamageNumbers />
          <CombatHUD />
          <StageOutcomeCutIn />
        </>
      )}

      {screenMode === 'RESULT' && (
        <ResultModal onRetry={handleRetry} onReturnToHub={handleReturnToHub} />
      )}

      <DebugOverlay />

      {engineStatus === 'initializing' && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-slate-950/90 backdrop-blur-sm">
          <div className="w-80 rounded-xl border border-cyan-500/40 bg-slate-900/95 px-6 py-5 text-center font-mono shadow-2xl">
            <p className="text-xs font-bold tracking-[0.25em] text-cyan-400 uppercase">
              Initializing K-DRIVER
            </p>
            <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-rose-500 to-amber-400 transition-[width] duration-150"
                style={{ width: `${loadProgress}%` }}
              />
            </div>
            <p className="mt-2 truncate text-[11px] text-slate-300">{loadLabel}</p>
          </div>
        </div>
      )}

      {engineStatus === 'error' && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/90 p-6">
          <div className="max-w-md rounded-xl border border-rose-500/50 bg-slate-900 p-5 font-mono text-sm text-rose-200 shadow-2xl">
            <h2 className="font-bold text-rose-400">Engine Initialization Failed</h2>
            <p className="mt-2 text-xs text-slate-300">
              {errorMessage ?? 'Unexpected WebGL or Rapier3D initialization error.'}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

export default App;
