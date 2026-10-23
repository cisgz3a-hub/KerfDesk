// CalibrateCameraControls — the calibration part of Camera settings (ADR-441,
// ADR-663): set the camera up, recalibrate it straight from the target, or
// check the saved calibration against a new photo (Amendment 1), and say how
// the saved calibration measured, with its accuracy map, and whether it was
// made for the bed the machine is set up with now. The wizard itself is
// mounted by the Camera panel, so it stays open whichever page the panel shows.

import { isHeadCameraModel } from '../../../core/camera/model/head-camera';
import { useEdition } from '../../licensing/edition';
import { AccuracyMapToggle } from '../accuracy/AccuracyMapToggle';
import { useOwnCameraFrameNote, useOwnCameraModel } from '../active-camera-model';
import { CameraFrameNotice } from '../CameraFrameNotice';
import { calibrationGrade } from './calibration-result';
import { useCameraCalibrationStore } from './camera-calibration-store';
import { hasViewReference } from '../helpers/view-reference';

export function CalibrateCameraControls(): JSX.Element {
  const openSetup = useCameraCalibrationStore((s) => s.openSetup);
  const openWizard = useCameraCalibrationStore((s) => s.openWizard);
  const openCheck = useCameraCalibrationStore((s) => s.openCheck);
  const openNudge = useCameraCalibrationStore((s) => s.openNudge);
  const model = useOwnCameraModel();
  const frameNote = useOwnCameraFrameNote();
  // Calibrating or checking the camera is camera alignment, a Pro tool
  // (ADR-540). A saved calibration keeps working in Free.
  const { requestPro } = useEdition();
  return (
    <div style={columnStyle}>
      <div style={rowStyle}>
        {model === undefined ? (
          <button
            type="button"
            className="lf-btn"
            onClick={() => requestPro('camera-alignment', openSetup)}
            title="Choose the camera, engrave a ring target and take one photo, so the camera picture lines up with the bed."
          >
            Set up camera…
          </button>
        ) : (
          <>
            <button
              type="button"
              className="lf-btn"
              onClick={() => requestPro('camera-alignment', openWizard)}
              title="Engrave a new ring target, take one photo, and fit the camera lens and position to the bed again."
            >
              Recalibrate…
            </button>
            <button
              type="button"
              className="lf-btn"
              onClick={() => requestPro('camera-alignment', () => openCheck(model))}
              title="Take one photo of the target from the last calibration, still where it was engraved, and see whether the camera has moved."
            >
              Check camera…
            </button>
            {isHeadCameraModel(model) ? null : (
              <button
                type="button"
                className="lf-btn"
                onClick={() => requestPro('camera-alignment', openNudge)}
                title="The picture is a millimetre or two off: burn one ring, take a photo, and move the picture onto it."
              >
                Fix a small offset…
              </button>
            )}
            <AccuracyMapToggle />
          </>
        )}
      </div>
      {model === undefined ? (
        <p style={noteStyle}>This camera is not calibrated yet.</p>
      ) : (
        <p style={noteStyle}>
          Calibrated {new Date(model.calibratedAt).toLocaleDateString()}: average error{' '}
          {model.accuracy.rmsErrorMm.toFixed(2)} mm. {calibrationGrade(model).headline}
        </p>
      )}
      {model === undefined || isHeadCameraModel(model) || hasViewReference(model) ? null : (
        <p style={noteStyle}>
          To be warned when the camera moves, run Check camera or Fix a small offset once: KerfDesk
          then keeps a view to compare with.
        </p>
      )}
      {frameNote === null ? null : (
        <CameraFrameNotice note={frameNote} style={frameNote.usable ? noteStyle : frameIssueStyle} />
      )}
    </div>
  );
}

const columnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const noteStyle: React.CSSProperties = { margin: 0, fontSize: 12, color: 'var(--lf-text-faint)' };
const frameIssueStyle: React.CSSProperties = { ...noteStyle, color: 'var(--lf-warning-fg)' };
