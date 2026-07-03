// ReviewStep — solve results and the A/B "Apply Calibration?" gate (the
// OpenPnP-style perceptual check ADR-107 requires): the operator flips between
// the raw capture and its de-fisheyed render and applies only if the image
// actually straightened. Apply persists onto the device profile (undoable).

import { useEffect } from 'react';
import { toCameraCalibration, type TrustReason } from '../../../core/camera';
import { assertNever } from '../../../core/scene';
import { Button } from '../../kit';
import { useStore } from '../../state';
import { useCameraWizardStore } from './camera-wizard-store';
import { RgbaCanvas } from './RgbaCanvas';

export function ReviewStep(): JSX.Element {
  const session = useCameraWizardStore((s) => s.session);
  const solving = useCameraWizardStore((s) => s.solving);
  const completeSolve = useCameraWizardStore((s) => s.completeSolve);

  // Defer the (seconds-long) solve one tick so "Solving…" paints first.
  useEffect(() => {
    if (!solving) return undefined;
    const id = setTimeout(completeSolve, 30);
    return () => clearTimeout(id);
  }, [solving, completeSolve]);

  if (solving) {
    return <p style={noteStyle}>Solving the lens model — this takes a few seconds…</p>;
  }
  if (session.kind === 'failed') {
    return <FailedView reason={session.reason} />;
  }
  if (session.kind !== 'solved') {
    return <p style={noteStyle}>No solve yet — capture poses first.</p>;
  }
  return <SolvedView />;
}

function FailedView(props: { readonly reason: string }): JSX.Element {
  const resetSession = useCameraWizardStore((s) => s.resetSession);
  return (
    <div style={columnStyle}>
      <p style={errStyle}>Calibration failed ({props.reason}). Capture a fresh set of poses.</p>
      <div style={rowStyle}>
        <Button onClick={resetSession}>Back to capture</Button>
      </div>
    </div>
  );
}

function SolvedView(): JSX.Element {
  const session = useCameraWizardStore((s) => s.session);
  const abMode = useCameraWizardStore((s) => s.abMode);
  const setAbMode = useCameraWizardStore((s) => s.setAbMode);
  const lastFrame = useCameraWizardStore((s) => s.lastFrame);
  const rectifiedFrame = useCameraWizardStore((s) => s.rectifiedFrame);
  const setStep = useCameraWizardStore((s) => s.setStep);
  const closeWizard = useCameraWizardStore((s) => s.closeWizard);
  const updateDeviceProfile = useStore((s) => s.updateDeviceProfile);
  if (session.kind !== 'solved') return <></>;
  const { result, diversity } = session;

  const apply = (): void => {
    updateDeviceProfile({ cameraCalibration: toCameraCalibration(result, Date.now()) });
    closeWizard();
  };

  const shown = abMode === 'rectified' ? rectifiedFrame : lastFrame;
  return (
    <div style={columnStyle}>
      <p style={statusStyle}>
        Reprojection error: {result.rmsPx.toFixed(2)} px over {result.views.length} poses.
        {result.converged ? '' : ' (best-effort fit — more poses can sharpen it)'}
      </p>
      <TrustNotes />
      {diversity.kind === 'insufficient-pose-diversity' ? (
        <p style={warnStyle}>
          The poses were too similar — recapture with stronger tilts for a reliable focal.
        </p>
      ) : null}
      <div style={rowStyle}>
        <Button pressed={abMode === 'raw'} onClick={() => setAbMode('raw')}>
          Original
        </Button>
        <Button pressed={abMode === 'rectified'} onClick={() => setAbMode('rectified')}>
          Corrected
        </Button>
      </div>
      {shown !== null ? (
        <RgbaCanvas
          image={shown}
          alt={abMode === 'rectified' ? 'De-fisheyed camera frame' : 'Original camera frame'}
        />
      ) : null}
      <p style={noteStyle}>
        Flip between Original and Corrected: straight edges in the scene should LOOK straight in the
        corrected view. Apply only if they do.
      </p>
      <div style={rowStyle}>
        <Button variant="ghost" onClick={() => setStep('capture')}>
          Capture more poses
        </Button>
        <Button variant="primary" onClick={apply}>
          Apply calibration
        </Button>
      </div>
    </div>
  );
}

function TrustNotes(): JSX.Element | null {
  const session = useCameraWizardStore((s) => s.session);
  if (session.kind !== 'solved' || session.trust.kind === 'trusted') return null;
  return (
    <div style={columnStyle}>
      {session.trust.reasons.map((reason) => (
        <p key={reason.kind} style={warnStyle}>
          {trustReasonCopy(reason)}
        </p>
      ))}
    </div>
  );
}

function trustReasonCopy(reason: TrustReason): string {
  switch (reason.kind) {
    case 'coefficient-out-of-bounds':
      return `A distortion coefficient fitted an implausible value (${reason.coefficient} = ${reason.value.toFixed(2)}) — the model may be overfitting; capture more varied poses.`;
    case 'rms-too-high':
      return `The reprojection error (${reason.rmsPx.toFixed(2)} px) is above the ${reason.threshold} px trust threshold — detections may be poor (lighting, focus).`;
    case 'uneven-coverage':
      return 'Part of the camera view never saw the board — capture poses nearer the empty corner.';
    case 'intrinsics-implausible':
      return 'The fitted camera geometry is implausible — recapture from scratch.';
    default:
      return assertNever(reason, 'trust reason');
  }
}

const columnStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8 };
const rowStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap' };
const noteStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-text-faint)' };
const statusStyle: React.CSSProperties = { margin: 0 };
const warnStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-warning-fg)' };
const errStyle: React.CSSProperties = { margin: 0, color: 'var(--lf-danger)' };
