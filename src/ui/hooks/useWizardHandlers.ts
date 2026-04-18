import { useCallback, type RefObject } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { deserializeScene } from '../../io/SceneSerializer';
import {
  createBlankProfile,
  saveDeviceProfile,
  setActiveProfileId,
} from '../../core/devices/DeviceProfile';
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
  /** Bump so `getActiveProfile()` / device list re-read after wizard creates a profile. */
  refreshProfiles: () => void;
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
    refreshProfiles,
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

    const wattsRaw = result.machineWatts || '10';
    const wattsParsed = parseInt(wattsRaw.split(/[-]/)[0]?.replace(/\D/g, '') || '10', 10) || 10;
    const mt = result.machineType || 'diode';
    const profile = createBlankProfile(result.machineName || 'My Laser');
    profile.machineType = mt === 'co2' || mt === 'fiber' || mt === 'diode' ? mt : 'diode';
    profile.watts = wattsParsed;
    profile.bedWidth = result.bedWidth;
    profile.bedHeight = result.bedHeight;
    profile.originCorner = result.originCorner;
    profile.homingEnabled = result.homingEnabled;
    profile.softLimitsEnabled = result.homingEnabled;
    profile.maxSpindle = result.maxSpindle;
    profile.invertY = result.originCorner === 'front-left' || result.originCorner === 'front-right';

    saveDeviceProfile(profile);
    setActiveProfileId(profile.id);
    refreshProfiles();

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
      metadata: {
        ...scene.metadata,
        deviceProfileId: profile.id,
      },
    };
    handleSceneCommit(newScene);

    // Fit to bed after a tick
    setTimeout(() => viewportActionsRef.current?.fitToBed(), 100);
  }, [scene, handleSceneCommit, setShowSetup, refreshProfiles]);

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
