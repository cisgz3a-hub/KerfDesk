// CameraSetupCallout — what the everyday Camera panel offers before the camera
// is lined up with the bed (ADR-663): one button into the guided setup, which
// picks the camera, engraves a target and fits the camera from one photo
// (ADR-441). It replaces the old two-step strip. Calibrating is camera
// alignment, a Pro tool (ADR-540); a saved calibration keeps working in Free.

import type { CSSProperties } from 'react';
import { BROWSER_FREE_BUILD } from '../../../platform/build-capabilities';
import { useEdition } from '../../licensing/edition';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { useOwnCameraModel } from '../active-camera-model';
import { useCameraCalibrationStore } from '../calibrate/camera-calibration-store';

const STEPS = ['Pick the camera', 'Engrave a target', 'Take one photo'] as const;

export function CameraSetupCallout(): JSX.Element | null {
  const own = useOwnCameraModel();
  const live = useCameraStore((s) => s.sourceState.kind === 'live');
  const otherCalibrated = useStore((s) => s.project.device.cameraModel !== undefined);
  const openSetup = useCameraCalibrationStore((s) => s.openSetup);
  const { requestPro } = useEdition();
  if (own !== undefined) return null;
  if (BROWSER_FREE_BUILD) {
    return (
      <p style={noteStyle}>
        You can watch the camera here. Lining its picture up with the bed is a Pro tool in the
        desktop app.
      </p>
    );
  }
  // A running camera with no calibration of its own, while another camera has one.
  const anotherCamera = live && otherCalibrated;
  return (
    <section style={calloutStyle} aria-label="Set up the camera">
      <strong>{anotherCamera ? 'Line this camera up with the bed' : 'Set up your camera'}</strong>
      <p style={textStyle}>
        Do it once, and artwork you place on the camera picture burns where you see it. It takes
        about five minutes and a sheet of scrap that covers the bed.
      </p>
      <ol style={stepsStyle}>
        {STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <button
        type="button"
        className="lf-btn lf-btn--primary"
        onClick={() => requestPro('camera-alignment', openSetup)}
        title="Choose the camera, engrave a ring target and take one photo, so the camera picture lines up with the bed."
      >
        Set up camera
      </button>
      {anotherCamera ? <p style={noteStyle}>Your other camera keeps its own calibration.</p> : null}
    </section>
  );
}

const calloutStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 6,
  padding: 10,
  borderRadius: 6,
  border: '1px solid var(--lf-accent)',
  background: 'var(--lf-bg-1)',
};
const textStyle: CSSProperties = { margin: 0 };
const stepsStyle: CSSProperties = {
  margin: 0,
  paddingLeft: 20,
  color: 'var(--lf-text-faint)',
  fontSize: 12,
};
const noteStyle: CSSProperties = { margin: 0, fontSize: 12, color: 'var(--lf-text-faint)' };
