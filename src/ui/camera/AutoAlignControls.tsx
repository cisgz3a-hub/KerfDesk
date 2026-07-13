// AutoAlignControls — launches the bed-alignment wizard (F-CAM9): burn the
// five-marker target as a real job, clear the bed, detect, and solve. The
// capture/detect body lives in auto-align.ts; manual 4-corner alignment
// remains available on the machine-camera preview for display-only setups.

import { useEffect } from 'react';
import { useStore } from '../state';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useCameraAlignWizardStore } from './align-wizard/camera-align-wizard-store';
import { CameraAlignWizard } from './align-wizard/CameraAlignWizard';

export function AutoAlignControls(): JSX.Element {
  const open = useCameraAlignWizardStore((s) => s.open);
  const openWizard = useCameraAlignWizardStore((s) => s.openWizard);
  const closeWizard = useCameraAlignWizardStore((s) => s.closeWizard);
  const featureEnabled = useExperimentalLaserFeatures((state) => state.features.cameraAlignmentV2);
  const homingEnabled = useStore((state) => state.project.device.homing.enabled);
  const available = featureEnabled && homingEnabled;

  useEffect(() => {
    if (!available && open) closeWizard();
  }, [available, closeWizard, open]);

  return (
    <div style={rowStyle}>
      <button
        type="button"
        className="lf-btn"
        disabled={!available}
        onClick={openWizard}
        title={alignmentButtonTitle(featureEnabled, homingEnabled)}
      >
        Align to bed…
      </button>
      {available && open ? <CameraAlignWizard /> : null}
    </div>
  );
}

function alignmentButtonTitle(featureEnabled: boolean, homingEnabled: boolean): string {
  if (!featureEnabled) return 'Enable Camera alignment v2 in Tools > Labs first.';
  if (!homingEnabled) return 'Camera bed alignment requires a homing-enabled machine profile.';
  return 'Align the camera to the bed: burn the marker target (or reuse a burned one), then detect it.';
}

const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
