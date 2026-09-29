// CalibrateCameraControls — the Camera panel's calibration row (ADR-441):
// opens the one-photo calibration wizard, or a check of the saved calibration
// against a new photo (Amendment 1), and says how the saved calibration
// measured, so the operator sees at a glance whether the camera is ready.

import { useEdition } from '../../licensing/edition';
import { useOwnCameraModel } from '../active-camera-model';
import { calibrationGrade } from './calibration-result';
import { CameraCalibrationWizard } from './CameraCalibrationWizard';
import { useCameraCalibrationStore } from './camera-calibration-store';

export function CalibrateCameraControls(): JSX.Element {
  const openWizard = useCameraCalibrationStore((s) => s.openWizard);
  const openCheck = useCameraCalibrationStore((s) => s.openCheck);
  const model = useOwnCameraModel();
  // Calibrating or checking the camera is camera alignment, a Pro tool
  // (ADR-540). A saved calibration keeps working in Free.
  const { requestPro } = useEdition();
  return (
    <div style={columnStyle}>
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn"
          onClick={() => requestPro('camera-alignment', openWizard)}
          title="Engrave a ring target, take one photo, and fit the camera lens and position to the bed."
        >
          {model === undefined ? 'Calibrate camera…' : 'Recalibrate camera…'}
        </button>
        {model === undefined ? null : (
          <button
            type="button"
            className="lf-btn"
            onClick={() => requestPro('camera-alignment', () => openCheck(model))}
            title="Take one photo of the target from the last calibration, still where it was engraved, and see whether the camera has moved."
          >
            Check camera…
          </button>
        )}
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
