// CameraElsewhereNotice — the running network camera's calibration was made on
// another computer (ADR-692 Amendment 3; the maintainer's choice on camera
// audit v2 K5-P3-3, "Notice + Check camera"). It is matched by the camera's
// address only, so it may be another camera there (Amendment 4, K6-P2-1), and
// this computer keeps no view of it to watch for a move: the notice asks for
// Check camera, and Job Review says the same until it passes. A check that
// finds the camera where it was keeps that view here, and both go. No picture
// travels in the project or machine files.

import type { CSSProperties } from 'react';
import { useState } from 'react';
import { useEdition } from '../../licensing/edition';
import { useCameraStore } from '../../state/camera-store';
import { useCameraCalibrationStore } from '../calibrate/camera-calibration-store';
import {
  CALIBRATION_ELSEWHERE_DETAIL,
  CALIBRATION_ELSEWHERE_NOTICE,
  uncheckedCalibrationFromElsewhere,
} from '../helpers/calibration-elsewhere';
import { useCameraMovedStore } from '../helpers/moved-check';
import { useStore } from '../../state';

export const CAMERA_ELSEWHERE_NOTICE = CALIBRATION_ELSEWHERE_NOTICE;

export function CameraElsewhereNotice(): JSX.Element | null {
  const device = useStore((s) => s.project.device);
  const sourceState = useCameraStore((s) => s.sourceState);
  // A passing check marks the camera steady: read again then.
  useCameraMovedStore((s) => s.state);
  const openCheck = useCameraCalibrationStore((s) => s.openCheck);
  const { requestPro } = useEdition();
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);
  const own = uncheckedCalibrationFromElsewhere(device, sourceState);
  if (own === null || dismissedFor === own.calibratedAt) return null;
  return (
    <section role="status" aria-label="Calibrated on another computer" style={noticeStyle}>
      <strong>{CAMERA_ELSEWHERE_NOTICE}</strong>
      <span style={textStyle}>{CALIBRATION_ELSEWHERE_DETAIL}</span>
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
