// AutoAlignControls — launches the bed-alignment wizard (F-CAM9): burn the
// five-marker target as a real job, clear the bed, detect, and solve. The
// capture/detect body lives in auto-align.ts; manual 4-corner alignment
// remains available on the machine-camera preview for display-only setups.
//
// Available for any camera source once a lens calibration exists (ADR-387;
// it no longer waits for a Labs switch). LightBurn orders it the same way:
// calibrate the lens, then align.
// https://docs.lightburnsoftware.com/2.1/Reference/Cameras/Alignment/
// Every check on the alignment itself (calibration binding, marker detection,
// degenerate solve) stays in runAutoAlign.

import { useEffect } from 'react';
import { useStore } from '../state';
import { useCameraAlignWizardStore } from './align-wizard/camera-align-wizard-store';
import { CameraAlignWizard } from './align-wizard/CameraAlignWizard';

export function AutoAlignControls(): JSX.Element {
  const open = useCameraAlignWizardStore((s) => s.open);
  const openWizard = useCameraAlignWizardStore((s) => s.openWizard);
  const closeWizard = useCameraAlignWizardStore((s) => s.closeWizard);
  const available = useStore((s) => s.project.device.cameraCalibration !== undefined);

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
        title={alignmentButtonTitle(available)}
      >
        Align to bed…
      </button>
      {available && open ? <CameraAlignWizard /> : null}
    </div>
  );
}

function alignmentButtonTitle(lensCalibrated: boolean): string {
  if (!lensCalibrated) {
    return 'Calibrate the lens first (Calibrate lens…). Align to bed measures the bed through the lens-corrected view.';
  }
  return 'Align the camera to the bed: burn the marker target (or reuse a burned one), then detect it.';
}

const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
