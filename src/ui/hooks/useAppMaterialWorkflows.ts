import { useCallback } from 'react';
import { getActiveProfile, saveDeviceProfile, type DeviceProfile } from '../../core/devices/DeviceProfile';
import { type Scene } from '../../core/scene/Scene';
import { type SceneCommitAction } from '../scene/SceneCommitActions';
import { type CalibrationGridResult } from '../../core/materials/CalibrationGrid';
import { type ResponseCurve } from '../../core/materials/ResponseCurve';
import { getPresets, savePreset } from '../../core/materials/MaterialLibrary';
import type { MaterialPreset } from '../../core/materials/MaterialPreset';
import { useKerfHandlers } from './useKerfHandlers';
import { useMaterialHandlers } from './useMaterialHandlers';
import { useMaterialTestHandlers } from './useMaterialTestHandlers';

interface UseAppMaterialWorkflowsParams {
  readonly scene: Scene;
  readonly handleSceneCommit: (scene: Scene, action?: SceneCommitAction) => void;
  readonly showAlert: (title: string, message: string) => Promise<void>;
  readonly setShowMaterial: (value: boolean) => void;
  readonly setLastCalibrationGridResult: (result: CalibrationGridResult | null) => void;
  readonly refreshProfiles: () => void;
}

export function useAppMaterialWorkflows({
  scene,
  handleSceneCommit,
  showAlert,
  setShowMaterial,
  setLastCalibrationGridResult,
  refreshProfiles,
}: UseAppMaterialWorkflowsParams) {
  const { handleMaterialTestApply } = useMaterialTestHandlers({
    scene,
    handleSceneCommit,
  });

  const handleCalibrationGridEmitted = useCallback((result: CalibrationGridResult) => {
    const nextScene: Scene = {
      ...scene,
      layers: [...scene.layers, ...result.layers],
      objects: [...scene.objects, ...result.objects],
      activeLayerId: result.layers[0]?.id ?? scene.activeLayerId,
    };
    setLastCalibrationGridResult(result);
    handleSceneCommit(nextScene, 'calibration-grid');
  }, [scene, setLastCalibrationGridResult, handleSceneCommit]);

  const handleCalibrationCurveReady = useCallback((
    curve: ResponseCurve,
    _measurements: Array<{ index: number; commandedPower: number; meanLuminance: number; observedDarkness: number }>,
  ) => {
    const matching = getPresets().find(
      p => p.material.toLowerCase() === curve.materialName.toLowerCase(),
    );
    if (matching) {
      const updatedPreset: MaterialPreset = { ...matching, responseCurve: curve };
      savePreset(updatedPreset);
      return;
    }

    const profile = getActiveProfile();
    if (!profile) return;
    const updated: DeviceProfile = {
      ...profile,
      responseCurves: {
        ...(profile.responseCurves ?? {}),
        [curve.materialName]: curve,
      },
    };
    saveDeviceProfile(updated);
    refreshProfiles();
  }, [refreshProfiles]);

  const {
    handleKerfGenerateTest,
    handleKerfApply,
    handleKerfSaveToPreset,
  } = useKerfHandlers({
    scene,
    handleSceneCommit,
    showAlert,
  });

  const {
    handleMaterialConfirm,
    handleMaterialClear,
    handleMaterialPresetApply,
  } = useMaterialHandlers({
    scene,
    handleSceneCommit,
    setShowMaterial,
  });

  return {
    handleMaterialTestApply,
    handleCalibrationGridEmitted,
    handleCalibrationCurveReady,
    handleKerfGenerateTest,
    handleKerfApply,
    handleKerfSaveToPreset,
    handleMaterialConfirm,
    handleMaterialClear,
    handleMaterialPresetApply,
  };
}
