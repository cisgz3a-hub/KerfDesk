import { useCallback, useEffect, useMemo } from 'react';
import { resolveBedHeightMm, resolveBedWidthMm } from '../../app/PipelineService';
import {
  applyProfileToScene,
  deleteDeviceProfile,
  getActiveProfile,
  getActiveProfileId,
  getDeviceProfiles,
  initializeDeviceProfiles,
  profileFromScene,
  saveDeviceProfile,
  setActiveProfileId,
  type DeviceProfile,
} from '../../core/devices/DeviceProfile';
import { inferHomeCornerFromGrblHomingDir } from '../../core/devices/homeCorner';
import { type Scene } from '../../core/scene/Scene';
import {
  initializeMaterialLibrary,
  migrateDeviceProfileResponseCurves,
} from '../../core/materials/MaterialLibrary';
import { initializeMaterialPresets } from '../../core/materials/MaterialPresets';
import { entitlementService } from '../../entitlements';

interface MachineBedSize {
  readonly width: number;
  readonly height: number;
}

interface GrblMachineInfoForProfile {
  readonly bedWidth: number;
  readonly bedHeight: number;
  readonly maxFeedX: number;
  readonly maxFeedY: number;
  readonly maxAccelX: number;
  readonly maxAccelY: number;
  readonly maxSpindle: number;
  readonly homingDir: number;
}

interface WcsConsentPayload {
  readonly g54: { readonly x: number; readonly y: number; readonly z: number };
  readonly statusMask: number;
}

interface ProfileAwareController {
  onWcsConsentNeeded?: (
    listener: (payload: WcsConsentPayload) => void | Promise<void>,
  ) => () => void;
  applyWcsNormalization?: () => void;
  skipWcsNormalization?: () => void;
  setStopOnError?: (enabled: boolean) => void;
}

interface ConfirmWithCheckboxResult {
  readonly ok: boolean;
  readonly checkboxChecked: boolean;
}

interface UseAppDeviceProfilesParams {
  readonly scene: Scene;
  readonly profileRevision: number;
  readonly bumpProfileRevision: () => void;
  readonly machineBedFromGrbl: MachineBedSize | null;
  readonly grblMachineInfo: GrblMachineInfoForProfile | null;
  readonly controller: ProfileAwareController | null;
  readonly showConfirmWithCheckbox: (
    title: string,
    message: string,
    checkboxLabel: string,
  ) => Promise<ConfirmWithCheckboxResult>;
  readonly applyProfileScene: (scene: Scene) => void;
}

export function useAppDeviceProfiles({
  scene,
  profileRevision,
  bumpProfileRevision,
  machineBedFromGrbl,
  grblMachineInfo,
  controller,
  showConfirmWithCheckbox,
  applyProfileScene,
}: UseAppDeviceProfilesParams) {
  const activeProfile = useMemo(() => {
    void profileRevision;
    return getActiveProfile();
  }, [profileRevision]);

  const activeProfileId = useMemo(() => {
    void profileRevision;
    return getActiveProfileId();
  }, [profileRevision]);

  const resolvedMachineBedWidthMm = useMemo(
    () => resolveBedWidthMm(getActiveProfile(), machineBedFromGrbl),
    [profileRevision, machineBedFromGrbl],
  );

  const resolvedMachineBedHeightMm = useMemo(
    () => resolveBedHeightMm(getActiveProfile(), machineBedFromGrbl),
    [profileRevision, machineBedFromGrbl],
  );

  const allProfiles = useMemo(() => {
    void profileRevision;
    return getDeviceProfiles();
  }, [profileRevision]);

  const refreshProfiles = useCallback(() => bumpProfileRevision(), [bumpProfileRevision]);

  useEffect(() => {
    void Promise.all([
      initializeDeviceProfiles(),
      initializeMaterialLibrary(),
      initializeMaterialPresets(),
      entitlementService.initialize(),
    ])
      .then(() => {
        migrateDeviceProfileResponseCurves();
        refreshProfiles();
      })
      .catch(() => {
        migrateDeviceProfileResponseCurves();
        refreshProfiles();
      });
  }, [refreshProfiles]);

  useEffect(() => {
    const onExternalProfileChange = () => refreshProfiles();
    window.addEventListener('laserforge:active-profile-changed', onExternalProfileChange);
    return () => window.removeEventListener('laserforge:active-profile-changed', onExternalProfileChange);
  }, [refreshProfiles]);

  const updateActiveProfile = useCallback((updates: Partial<DeviceProfile>) => {
    const current = getActiveProfile();
    if (!current) return;
    const updated: DeviceProfile = { ...current, ...updates };
    saveDeviceProfile(updated);
    refreshProfiles();
  }, [refreshProfiles]);

  useEffect(() => {
    if (!controller || typeof controller.onWcsConsentNeeded !== 'function') return;

    return controller.onWcsConsentNeeded(async ({ g54, statusMask }) => {
      const profile = getActiveProfile();
      if (profile?.suppressWcsConsent === true) {
        controller.applyWcsNormalization?.();
        return;
      }

      const g54Line = `G54 offset: X=${g54.x.toFixed(3)} Y=${g54.y.toFixed(3)} Z=${g54.z.toFixed(3)}`;
      const maskLine = `$10 status mask: ${statusMask}`;

      const result = await showConfirmWithCheckbox(
        'Normalize machine settings?',
        'LaserForge requires G54 = (0,0,0) and $10 = 0 for reliable job placement.\n\n'
          + 'Your machine currently has:\n'
          + g54Line + '\n'
          + maskLine
          + '\n\n'
          + 'Normalize now? (Decline to leave settings unchanged - job placement is your responsibility.)',
        "Don't ask again for this profile",
      );

      if (result.checkboxChecked) {
        const p = getActiveProfile();
        if (p) {
          const updated: DeviceProfile = { ...p, suppressWcsConsent: true };
          saveDeviceProfile(updated);
          refreshProfiles();
        }
      }

      if (result.ok) {
        controller.applyWcsNormalization?.();
      } else {
        controller.skipWcsNormalization?.();
      }
    });
  }, [controller, showConfirmWithCheckbox, refreshProfiles]);

  useEffect(() => {
    if (!controller || typeof controller.setStopOnError !== 'function') return;
    const profile = getActiveProfile();
    const value = profile?.stopOnError !== false;
    controller.setStopOnError(value);
  }, [controller, profileRevision]);

  const mergeProfilePreservedFields = useCallback((target: DeviceProfile, previous: DeviceProfile): void => {
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
    if (previous.suppressWcsConsent) target.suppressWcsConsent = true;
    if (previous.stopOnError === false) target.stopOnError = false;
  }, []);

  const setActiveProfileAndApply = useCallback((id: string | null) => {
    setActiveProfileId(id);
    refreshProfiles();
    if (!id) return;
    const profile = getDeviceProfiles().find(p => p.id === id);
    if (!profile) return;
    applyProfileScene(applyProfileToScene(profile, scene));
  }, [refreshProfiles, scene, applyProfileScene]);

  const createProfileFromCurrentScene = useCallback((name: string) => {
    const profile = profileFromScene(name, scene);
    saveDeviceProfile(profile);
    setActiveProfileId(profile.id);
    refreshProfiles();
  }, [scene, refreshProfiles]);

  const updateCurrentProfileFromScene = useCallback(() => {
    const current = getActiveProfile();
    if (!current) return;
    const updated = profileFromScene(current.name, scene);
    updated.id = current.id;
    updated.createdAt = current.createdAt;
    updated.returnToOrigin = current.returnToOrigin ?? true;
    mergeProfilePreservedFields(updated, current);
    saveDeviceProfile(updated);
    refreshProfiles();
  }, [scene, mergeProfilePreservedFields, refreshProfiles]);

  const deleteProfileAndClearActive = useCallback((id: string) => {
    deleteDeviceProfile(id);
    if (getActiveProfileId() === id) setActiveProfileId(null);
    refreshProfiles();
  }, [refreshProfiles]);

  const handleAutoDetectMachine = useCallback(() => {
    if (!grblMachineInfo) return;
    const current = getActiveProfile();
    if (!current) return;
    updateActiveProfile({
      bedWidth: grblMachineInfo.bedWidth > 0 ? grblMachineInfo.bedWidth : current.bedWidth,
      bedHeight: grblMachineInfo.bedHeight > 0 ? grblMachineInfo.bedHeight : current.bedHeight,
      maxRateX: grblMachineInfo.maxFeedX > 0 ? grblMachineInfo.maxFeedX : current.maxRateX,
      maxRateY: grblMachineInfo.maxFeedY > 0 ? grblMachineInfo.maxFeedY : current.maxRateY,
      maxAccelX: grblMachineInfo.maxAccelX > 0 ? grblMachineInfo.maxAccelX : current.maxAccelX,
      maxAccelY: grblMachineInfo.maxAccelY > 0 ? grblMachineInfo.maxAccelY : current.maxAccelY,
      maxAccelMmPerS2:
        grblMachineInfo.maxAccelX > 0 && grblMachineInfo.maxAccelY > 0
          ? Math.min(grblMachineInfo.maxAccelX, grblMachineInfo.maxAccelY)
          : (grblMachineInfo.maxAccelX > 0 ? grblMachineInfo.maxAccelX
            : (grblMachineInfo.maxAccelY > 0 ? grblMachineInfo.maxAccelY : current.maxAccelMmPerS2)),
      // T1-52: copy live `$30` (maxSpindle) into the active profile
      // when Auto-Detect runs. The current value is preserved when `$30`
      // is unknown (controllerMaxSpindle null/non-positive).
      maxSpindle: grblMachineInfo.maxSpindle > 0
        ? grblMachineInfo.maxSpindle
        : current.maxSpindle,
      homeCorner: inferHomeCornerFromGrblHomingDir(grblMachineInfo.homingDir)
        ?? current.homeCorner
        ?? current.originCorner,
    });
  }, [grblMachineInfo, updateActiveProfile]);

  return {
    activeProfile,
    activeProfileId,
    resolvedMachineBedWidthMm,
    resolvedMachineBedHeightMm,
    allProfiles,
    refreshProfiles,
    updateActiveProfile,
    setActiveProfileAndApply,
    createProfileFromCurrentScene,
    updateCurrentProfileFromScene,
    deleteProfileAndClearActive,
    handleAutoDetectMachine,
  };
}
