// CalibrateCameraControls — the Camera panel's calibration row (ADR-441):
// opens the one-photo calibration wizard and says how the saved calibration
// measured, so the operator sees at a glance whether the camera is ready.

import { useStore } from '../../state';
import { calibrationGrade } from './calibration-result';
import { CameraCalibrationWizard } from './CameraCalibrationWizard';
import { useCameraCalibrationStore } from './camera-calibration-store';

export function CalibrateCameraControls(): JSX.Element {
  const openWizard = useCameraCalibrationStore((s) => s.openWizard);
  const model = useStore((s) => s.project.device.cameraModel);
  return (
    <div style={columnStyle}>
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn"
          onClick={openWizard}
          title="Engrave a ring target, take one photo, and fit the camera lens and position to the bed."
        >
          {model === undefined ? 'Calibrate camera…' : 'Recalibrate camera…'}
        </button>
      </div>
      {model === undefined ? null : (
        <p style={noteStyle}>
          Calibrated {new Date(model.calibratedAt).toLocaleDateString()}: average error{' '}
          {model.accuracy.rmsErrorMm.toFixed(2)} mm. {calibrationGrade(model).headline}
        </p>
      )}
      <CameraCalibrationWizard />
    </div>
  );
}

const columnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const noteStyle: React.CSSProperties = { margin: 0, fontSize: 12, color: 'var(--lf-text-faint)' };
