import { useCallback, type RefObject } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { deserializeScene } from '../../io/SceneSerializer';
import { type WizardResult } from '../components/WelcomeWizard';
import { type ViewportActions } from '../components/CanvasViewport';

/** Wizard key: Electron uses a separate key so browser dev `laserforge_setup_complete` does not skip the wizard in the packaged app. */
export function getSetupStorageKey(): string {
  try {
    if (typeof window !== 'undefined' && window.electronAPI?.isElectron) {
      return 'laserforge_setup_complete_electron';
    }
  } catch { /* ignore */ }
  return 'laserforge_setup_complete';
}

export interface UseWizardHandlersParams {
  scene: Scene;
  handleSceneCommit: (newScene: Scene) => void;
  handleNewProject: (scene: Scene) => void;
  setShowSetup: (show: boolean) => void;
  setShowRecover: (show: boolean) => void;
  viewportActionsRef: RefObject<ViewportActions | null>;
}

export interface WizardHandlers {
  handleRecover: () => void;
  handleWizardComplete: (result: WizardResult) => void;
  handleWizardSkip: () => void;
}

export function useWizardHandlers(params: UseWizardHandlersParams): WizardHandlers {
  const {
    scene,
    handleSceneCommit,
    handleNewProject,
    setShowSetup,
    setShowRecover,
    viewportActionsRef,
  } = params;

  const handleRecover = useCallback(() => {
    try {
      const saved = localStorage.getItem('laserforge_autosave');
      if (saved) {
        const recovered = deserializeScene(saved);
        handleNewProject(recovered);
      }
    } catch (e) {
      console.error('Recovery failed:', e);
    }
    setShowRecover(false);
  }, [handleNewProject]);

  const handleWizardComplete = useCallback((result: WizardResult) => {
    setShowSetup(false);
    try { localStorage.setItem(getSetupStorageKey(), 'true'); } catch { /* ignore */ }

    // Apply wizard results to scene
    const matX = Math.round((result.bedWidth - result.materialWidth) / 2);
    const matY = Math.round((result.bedHeight - result.materialHeight) / 2);

    const newScene = {
      ...scene,
      canvas: { ...scene.canvas, width: result.bedWidth, height: result.bedHeight },
      material: {
        enabled: true,
        x: matX,
        y: matY,
        width: result.materialWidth,
        height: result.materialHeight,
        thickness: result.materialThickness,
        type: result.materialType as NonNullable<Scene['material']>['type'],
        name: result.materialName,
        color: result.materialColor,
      },
      machine: {
        name: result.machineName || 'Custom',
        watts: result.machineWatts || '',
        type: result.machineType || 'diode',
      },
    };
    handleSceneCommit(newScene);

    // Fit to bed after a tick
    setTimeout(() => viewportActionsRef.current?.fitToBed(), 100);
  }, [scene, handleSceneCommit, setShowSetup]);

  const handleWizardSkip = useCallback(() => {
    setShowSetup(false);
    try { localStorage.setItem(getSetupStorageKey(), 'true'); } catch { /* ignore */ }
  }, [setShowSetup]);

  return {
    handleRecover,
    handleWizardComplete,
    handleWizardSkip,
  };
}
