import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { type SceneCommitAction } from '../scene/SceneCommitActions';

export interface ConnectionPanelGrbl {
  isJobRunning: boolean;
}

export interface UseConnectionHandlersParams {
  scene: Scene;
  handleSceneCommit: (newScene: Scene, action?: SceneCommitAction, selectionAfter?: ReadonlySet<string>) => void;
  compileGcode: (targetScene: Scene) => Promise<string | null>;
  setCurrentGcode: Dispatch<SetStateAction<string | null>>;
  connectionSidebarOpen: boolean;
  gcodeStale: boolean;
  setGcodeStale: Dispatch<SetStateAction<boolean>>;
  grbl: ConnectionPanelGrbl;
}

export interface ConnectionHandlers {
  handleConnectionRecompile: () => void;
}

export function useConnectionHandlers(params: UseConnectionHandlersParams): ConnectionHandlers {
  const {
    scene,
    handleSceneCommit,
    compileGcode,
    setCurrentGcode,
    connectionSidebarOpen,
    gcodeStale,
    setGcodeStale,
    grbl,
  } = params;

  const isJobRunningRef = useRef(grbl.isJobRunning);
  isJobRunningRef.current = grbl.isJobRunning;

  const handleConnectionRecompile = useCallback(() => {
    void (async () => {
      const gc = await compileGcode(scene);
      setCurrentGcode(gc);
    })();
  }, [scene, compileGcode, setCurrentGcode]);

  // Auto-recompile G-code when the design changes (debounced).
  // Replaces the manual "Update" step in the connection panel.
  useEffect(() => {
    if (!connectionSidebarOpen) return;
    if (grbl.isJobRunning) return;
    if (!gcodeStale) return;

    const timer = setTimeout(() => {
      // Re-check at fire time - job may have started between scheduling and firing.
      // The effect-level guard only covers scheduling time.
      if (isJobRunningRef.current) return;
      handleConnectionRecompile();
    }, 500);

    return () => clearTimeout(timer);
  }, [gcodeStale, connectionSidebarOpen, grbl.isJobRunning, handleConnectionRecompile]);

  return {
    handleConnectionRecompile,
  };
}
