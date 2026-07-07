// AutoAlignControls — launches the bed-alignment wizard (F-CAM9): burn the
// five-marker target as a real job, clear the bed, detect, and solve. The
// capture/detect body lives in auto-align.ts; manual 4-corner alignment
// remains available on the machine-camera preview for display-only setups.

import { useCameraAlignWizardStore } from './align-wizard/camera-align-wizard-store';
import { CameraAlignWizard } from './align-wizard/CameraAlignWizard';

export function AutoAlignControls(): JSX.Element {
  const open = useCameraAlignWizardStore((s) => s.open);
  const openWizard = useCameraAlignWizardStore((s) => s.openWizard);
  return (
    <div style={rowStyle}>
      <button
        type="button"
        className="lf-btn"
        onClick={openWizard}
        title="Align the camera to the bed: burn the marker target (or reuse a burned one), then detect it."
      >
        Align to bed…
      </button>
      {open ? <CameraAlignWizard /> : null}
    </div>
  );
}

const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
