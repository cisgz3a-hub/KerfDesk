// CameraElsewhereNotice — the running network camera's calibration was made on
// another computer (ADR-692 Amendment 3; the maintainer's choice on camera
// audit v2 K5-P3-3, "Notice + Check camera"). It is matched by the camera and
// its address, but this computer keeps no view of it to watch for a move, so
// the notice asks for Check camera once. A check that finds the camera where
// it was keeps that view here, and the notice goes. No picture travels in the
// project or machine files.

import type { CSSProperties } from 'react';
import { useState } from 'react';
import { modelFromElsewhere } from '../../../core/camera/model/saved-cameras';
import { useEdition } from '../../licensing/edition';
import { useCameraStore } from '../../state/camera-store';
import { useOwnCameraModel } from '../active-camera-model';
import { useCameraCalibrationStore } from '../calibrate/camera-calibration-store';
import { cameraSourceIdentity } from '../frame-source';
import { useCameraMovedStore } from '../helpers/moved-check';
import { hasViewReference } from '../helpers/view-reference';

export const CAMERA_ELSEWHERE_NOTICE =
  'This camera was calibrated on another computer: run Check camera once.';

export function CameraElsewhereNotice(): JSX.Element | null {
  const own = useOwnCameraModel();
  const sourceState = useCameraStore((s) => s.sourceState);
  // A passing check marks the camera steady: read again then.
  useCameraMovedStore((s) => s.state);
  const openCheck = useCameraCalibrationStore((s) => s.openCheck);
  const { requestPro } = useEdition();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  if (own === undefined || sourceState.kind !== 'live') return null;
  if (dismissedFor === own.calibratedAt) return null;
  if (!modelFromElsewhere(own, cameraSourceIdentity(sourceState.source))) return null;
  if (hasViewReference(own)) return null;
  return (
    <section role="status" aria-label="Calibrated on another computer" style={noticeStyle}>
      <strong>{CAMERA_ELSEWHERE_NOTICE}</strong>
      <span style={textStyle}>
        It is the same camera at the same address, so its calibration is used. This computer has not
        seen the camera yet, so it cannot warn you if the camera has moved. A check that finds the
        camera where it was starts that here.
      </span>
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          onClick={() => requestPro('camera-alignment', () => openCheck(own))}
          title="Photograph the calibration target, if it is still on the bed, and measure the saved calibration on it."
        >
          Check camera…
        </button>
        <button
          type="button"
          className="lf-btn"
          onClick={() => setDismissedFor(own.calibratedAt)}
          title="Hide this note until KerfDesk is opened again."
        >
          Dismiss
        </button>
      </div>
    </section>
  );
}

const noticeStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: 8,
  borderRadius: 6,
  border: '1px solid var(--lf-warning)',
  background: 'var(--lf-bg-1)',
  color: 'var(--lf-warning-fg)',
};
const textStyle: CSSProperties = { fontSize: 12, color: 'var(--lf-text-faint)' };
const rowStyle: CSSProperties = { display: 'flex', gap: 6, flexWrap: 'wrap' };
