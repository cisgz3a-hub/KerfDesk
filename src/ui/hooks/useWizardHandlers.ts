import { useCallback, type RefObject } from 'react';
import { type Scene } from '../../core/scene/Scene';
import { deserializeScene } from '../../io/SceneSerializer';
import {
  formatMissingImageReferenceReport,
  validateAndAnnotateImageReferences,
} from '../../io/ImageReferenceValidation';
import { readAutosave } from '../../app/autosavePersistence';
import {
  createBlankProfile,
  createFalconSerialProfile,
  createPrt4040RouterLaserProfile,
  getActiveProfile,
  saveDeviceProfile,
  setActiveProfileId,
  type DeviceProfile,
} from '../../core/devices/DeviceProfile';
import { shouldShowFirstRunGuide } from '../../onboarding/FirstRunGuide';
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

/** Keep calibration / G-code / connection fields when wizard updates machine basics. */
function mergePreservedProfileFields(target: DeviceProfile, previous: DeviceProfile): void {
  target.scanningOffsets = previous.scanningOffsets;
  target.maxAccelMmPerS2 = previous.maxAccelMmPerS2;
  target.accelAwarePower = previous.accelAwarePower;
  target.minPowerRatioAccel = previous.minPowerRatioAccel;
  target.smartOverscanEnabled = previous.smartOverscanEnabled;
  target.overscanMm = previous.overscanMm;
  target.preferredPort = previous.preferredPort;
  target.startGcode = previous.startGcode;
  target.endGcode = previous.endGcode;
  target.gcodeHeaderTemplate = previous.gcodeHeaderTemplate;
  target.gcodeFooterTemplate = previous.gcodeFooterTemplate;
  target.maxRateX = previous.maxRateX;
  target.maxRateY = previous.maxRateY;
  target.maxAccelX = previous.maxAccelX;
  target.maxAccelY = previous.maxAccelY;
  target.frameDotFeedRate = previous.frameDotFeedRate;
}

export function parseWizardWatts(machineWatts?: string): number {
  const firstNumber = (machineWatts || '10').match(/\d+/)?.[0] || '10';
  return parseInt(firstNumber, 10) || 10;
}

export interface UseWizardHandlersParams {
  scene: Scene;
  handleSceneCommit: (newScene: Scene) => void;
  handleNewProject: (scene: Scene, source: 'file' | 'autosave' | 'new') => void;
  setShowSetup: (show: boolean) => void;
  setShowFirstRunGuide?: (show: boolean) => void;
  setShowRecover: (show: boolean) => void;
  setRecoverAutosaveTimeLabel?: (label: string | null) => void;
  viewportActionsRef: RefObject<ViewportActions | null>;
  /** Bump so `getActiveProfile()` / device list re-read after wizard creates a profile. */
  refreshProfiles: () => void;
  /** T1-70: surface recovery failures to the user instead of swallowing into console. */
  showAlert: (title: string, message: string) => Promise<unknown>;
}

export interface WizardHandlers {
  handleRecover: () => void | Promise<void>;
  handleWizardComplete: (result: WizardResult) => void;
  handleWizardSkip: () => void;
}

export function useWizardHandlers(params: UseWizardHandlersParams): WizardHandlers {
  const {
    scene,
    handleSceneCommit,
    handleNewProject,
    setShowSetup,
    setShowFirstRunGuide,
    setShowRecover,
    setRecoverAutosaveTimeLabel,
    viewportActionsRef,
    refreshProfiles,
    showAlert,
  } = params;

  // T1-70: previously the catch logged to console only and the prompt
  // was unconditionally hidden — a user who clicked Recover on a corrupt
  // or unreadable autosave saw the dialog vanish and concluded their work
  // was gone. Now: surface the failure with a user-facing alert. On
  // deserialize failure the prompt stays visible so retry /
  // download-for-support affordances (T2-70 follow-ups) can hang off the
  // same dialog. `readAutosave` already swallows storage errors and
  // resolves null, so the empty-payload branch surfaces an "unavailable"
  // alert instead of the silent disappear.
  const handleRecover = useCallback(async () => {
    const payload = await readAutosave();
    if (!payload?.json) {
      await showAlert(
        'Recovery unavailable',
        'No autosave data was found. Your browser may have cleared its storage, or the autosave was already discarded.',
      );
      setShowRecover(false);
      setRecoverAutosaveTimeLabel?.(null);
      return;
    }
    try {
      const recovered = deserializeScene(payload.json);
      const { scene: annotated, validation } = await validateAndAnnotateImageReferences(recovered);
      handleNewProject(annotated, 'autosave');
      const imageReport = formatMissingImageReferenceReport(validation);
      if (imageReport) {
        await showAlert('Missing Images', imageReport);
      }
      setShowRecover(false);
      setRecoverAutosaveTimeLabel?.(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('Recovery failed:', e);
      await showAlert(
        'Recovery failed',
        `Could not restore the autosaved project.\n\n${msg}\n\nThe autosave data may be corrupted or use a newer file format. The recovery prompt has been kept open so you can try again or discard.`,
      );
    }
  }, [handleNewProject, setShowRecover, setRecoverAutosaveTimeLabel, showAlert]);

  const handleWizardComplete = useCallback((result: WizardResult) => {
    setShowSetup(false);
    try { localStorage.setItem(getSetupStorageKey(), 'true'); } catch { /* ignore */ }

    // Apply wizard results to scene
    const wattsParsed = parseWizardWatts(result.machineWatts);
    const mt = result.machineType || 'diode';
    const machineTypeSafe = mt === 'co2' || mt === 'fiber' || mt === 'diode' ? mt : 'diode';
    const invertY = result.originCorner === 'front-left' || result.originCorner === 'front-right';

    const existing = getActiveProfile();
    let profileId: string;
    if (existing) {
      const updated: DeviceProfile = {
        ...existing,
        name: result.machineName || existing.name,
        machineType: machineTypeSafe,
        watts: wattsParsed,
        bedWidth: result.bedWidth,
        bedHeight: result.bedHeight,
        originCorner: result.originCorner,
        homeCorner: result.homeCorner,
        homingEnabled: result.homingEnabled,
        softLimitsEnabled: result.homingEnabled,
        maxSpindle: result.maxSpindle,
        invertY,
      };
      if (result.machinePresetKey === 'prt4040-router-laser') {
        updated.brand = 'PRTCNC';
        updated.model = 'PRT4040 router + laser';
        updated.maxFeedRate = 1500;
        updated.returnToOrigin = false;
        updated.autoFocusSupported = false;
        updated.autoFocusCommand = undefined;
        updated.autoFocusTimeoutMs = undefined;
        updated.allowsNegativeWorkspace = true;
      }
      mergePreservedProfileFields(updated, existing);
      saveDeviceProfile(updated);
      setActiveProfileId(existing.id);
      profileId = existing.id;
    } else {
      // Pick a brand-specific factory when the wizard signals a known preset;
      // otherwise fall back to the generic blank profile. Subsequent field
      // assignments (bedWidth, etc.) overwrite factory defaults the user
      // edited in the wizard — autofocus fields are left intact because the
      // wizard never touches them.
      const profile =
        result.machinePresetKey === 'falcon-a1-pro'
          ? createFalconSerialProfile(result.machineName || 'Creality Falcon A1 Pro')
          : result.machinePresetKey === 'prt4040-router-laser'
            ? createPrt4040RouterLaserProfile(result.machineName || 'PRTCNC PRT4040')
          : createBlankProfile(result.machineName || 'My Laser');
      profile.machineType = machineTypeSafe;
      profile.watts = wattsParsed;
      profile.bedWidth = result.bedWidth;
      profile.bedHeight = result.bedHeight;
      profile.originCorner = result.originCorner;
      profile.homeCorner = result.homeCorner;
      profile.homingEnabled = result.homingEnabled;
      profile.softLimitsEnabled = result.homingEnabled;
      profile.maxSpindle = result.maxSpindle;
      profile.invertY = invertY;
      saveDeviceProfile(profile);
      setActiveProfileId(profile.id);
      profileId = profile.id;
    }
    refreshProfiles();

    const newScene = {
      ...scene,
      canvas: { ...scene.canvas, width: result.bedWidth, height: result.bedHeight },
      // Setup material answers are only recommendation inputs. Do not place a
      // material board on the canvas; users can add one explicitly later.
      material: null,
      machine: {
        name: result.machineName || 'Custom',
        watts: result.machineWatts || '',
        type: result.machineType || 'diode',
      },
      metadata: {
        ...scene.metadata,
        deviceProfileId: profileId,
      },
    };
    handleSceneCommit(newScene);

    // Fit to bed after a tick
    setTimeout(() => viewportActionsRef.current?.fitToBed(), 100);
    if (shouldShowFirstRunGuide()) {
      setShowFirstRunGuide?.(true);
    }
  }, [scene, handleSceneCommit, setShowSetup, setShowFirstRunGuide, refreshProfiles, viewportActionsRef]);

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
