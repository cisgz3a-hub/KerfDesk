// AlignWizardDetectStep — the detection half of the alignment wizard
// (F-CAM9): show the live source, run runAutoAlign (capture → optional
// de-fisheye → marker detect → homography solve → persist), and report the
// outcome with the basis the alignment landed in.

import { useCallback } from 'react';
import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { runAutoAlign } from '../auto-align';
import { CameraSourceView } from '../CameraSourceView';
import { useCameraAlignWizardStore, type DetectStatus } from './camera-align-wizard-store';

export function DetectStep(props: { readonly status: DetectStatus }): JSX.Element {
  const sourceState = useCameraStore((s) => s.sourceState);
  const calibration = useStore((s) => s.project.device.cameraCalibration);
  const bedWidth = useStore((s) => s.project.device.bedWidth);
  const bedHeight = useStore((s) => s.project.device.bedHeight);
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  const setSurfaceHeightMm = useCameraStore((s) => s.setSurfaceHeightMm);
  const setStep = useCameraAlignWizardStore((s) => s.setStep);
  const planeHeightMm = useCameraAlignWizardStore((s) => s.planeHeightMm);

  const detect = useCallback(async (): Promise<void> => {
    if (sourceState.kind !== 'live') return;
    setStep({ kind: 'detect', status: { kind: 'running' } });
    const outcome = await runAutoAlign({
      source: sourceState.source,
      calibration,
      bedWidth,
      bedHeight,
      planeHeightMm,
      updateDeviceProfile,
    });
    if (outcome.kind === 'ok') {
      setSurfaceHeightMm(planeHeightMm);
      setStep({ kind: 'done', basis: outcome.basis });
      return;
    }
    setStep({ kind: 'detect', status: { kind: 'failed', message: outcome.message } });
  }, [
    sourceState,
    calibration,
    bedWidth,
    bedHeight,
    planeHeightMm,
    setSurfaceHeightMm,
    updateDeviceProfile,
    setStep,
  ]);

  return (
    <div style={columnStyle}>
      {sourceState.kind === 'live' ? (
        <CameraSourceView source={sourceState.source} />
      ) : (
        <p style={errStyle}>
          No camera source is running — start one in the Camera panel, then detect.
        </p>
      )}
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          disabled={sourceState.kind !== 'live' || props.status.kind === 'running'}
          onClick={() => void detect()}
          title="Capture a frame, find the five burned markers, and solve the camera-to-bed alignment."
        >
          {props.status.kind === 'running' ? 'Detecting…' : 'Detect markers'}
        </button>
      </div>
      {props.status.kind === 'failed' ? <p style={errStyle}>{props.status.message}</p> : null}
    </div>
  );
}

export function DoneStep(props: { readonly basis: 'raw' | 'rectified' }): JSX.Element {
  const closeWizard = useCameraAlignWizardStore((s) => s.closeWizard);
  const verificationErrorMm = useStore(
    (s) => s.project.device.cameraAlignment?.verificationErrorMm,
  );
  return (
    <div style={columnStyle}>
      <p style={okStyle}>
        Camera aligned — the alignment is saved to the device and the workspace overlay is
        registered to the measured marker plane.
      </p>
      <p style={noteStyle}>
        {props.basis === 'rectified'
          ? 'The alignment uses the lens-corrected (de-fisheyed) frame basis.'
          : 'No lens calibration was applied — calibrate the lens for best accuracy bed-wide.'}
      </p>
      {verificationErrorMm === undefined ? null : (
        <p style={noteStyle}>
          Independent marker-spacing check: {verificationErrorMm.toFixed(2)} mm average error. Lower
          is better; verify placement on scrap before production work.
        </p>
      )}
      <div style={rowStyle}>
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          onClick={closeWizard}
          title="Close the alignment wizard."
        >
          Done
        </button>
      </div>
    </div>
  );
}

const columnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const noteStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-faint)' };
const errStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-danger)' };
const okStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-accent)' };
