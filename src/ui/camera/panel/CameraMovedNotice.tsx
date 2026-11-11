// CameraMovedNotice — the Camera panel's "camera moved?" warning (ADR-663
// Amendments 3 and 5): the picture around the bed has shifted, or no longer
// matches, since the calibration was last known good. The quick nudge fix and
// Check camera are one click away; Dismiss keeps it quiet for this
// calibration. Advice only. It stays until the view is confirmed or dismissed.

import type { CSSProperties } from 'react';
import { useEdition } from '../../licensing/edition';
import { useOwnCameraModel } from '../active-camera-model';
import { useCameraCalibrationStore } from '../calibrate/camera-calibration-store';
import { cameraMovedTurned, shownCameraMovedWarning } from '../helpers/camera-moved-store';
import { useCameraMovedStore } from '../helpers/moved-check';

export function CameraMovedNotice(): JSX.Element | null {
  const state = useCameraMovedStore((s) => s.state);
  const dismissedFor = useCameraMovedStore((s) => s.dismissedFor);
  const dismiss = useCameraMovedStore((s) => s.dismiss);
  const openNudge = useCameraCalibrationStore((s) => s.openNudge);
  const openCheck = useCameraCalibrationStore((s) => s.openCheck);
  const own = useOwnCameraModel();
  const { requestPro } = useEdition();
  const shown = shownCameraMovedWarning(state, dismissedFor, own?.calibratedAt);
  if (shown === null || own === undefined) return null;
  const turned = shown.kind === 'moved' && cameraMovedTurned(shown);
  return (
    <section role="status" aria-label="Camera may have moved" style={noticeStyle}>
      <strong>
        {shown.kind === 'moved'
          ? `The camera may have moved: the picture may be up to about ${shown.mm.toFixed(1)} mm off.`
          : 'The camera may have moved: what it sees around the bed no longer matches its calibration.'}
      </strong>
      <span style={textStyle}>
        {shown.kind === 'moved'
          ? 'What it sees around the bed has shifted since its calibration was last checked, so the picture may not line up with the burn.'
          : 'The picture may not line up with the burn. Check it on the calibration target, or calibrate again.'}
        {turned
          ? ' The camera turned or tipped, so the bed is off by different amounts in different places: Fix a small offset cannot put that right.'
          : ''}
      </span>
      <div style={rowStyle}>
        {shown.kind === 'moved' && !turned ? (
          <button
            type="button"
            className="lf-btn lf-btn--primary"
            onClick={() => requestPro('camera-alignment', openNudge)}
            title="Burn one ring, take a photo, and move the picture onto it."
          >
            Fix a small offset…
          </button>
        ) : null}
        <button
          type="button"
          className={shown.kind === 'moved' && !turned ? 'lf-btn' : 'lf-btn lf-btn--primary'}
          onClick={() => requestPro('camera-alignment', () => openCheck(own))}
          title="Photograph the calibration target, if it is still on the bed, and measure the saved calibration on it."
        >
          Check camera…
        </button>
        <button
          type="button"
          className="lf-btn"
          onClick={dismiss}
          title="Hide this warning for the current calibration."
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
