// CameraCalibrationWizard — the lens-calibration dialog (ADR-108 v2.e):
// describe/print the board, auto-capture diverse poses with live detection,
// solve through the focal sweep, and gate Apply behind the A/B perceptual
// check. State lives in camera-wizard-store; steps are thin renderers. The
// wizard can minimize (CameraWizardFrame) so the operator watches the camera
// while positioning the board with a fixed overhead camera.

import { assertNever } from '../../../core/scene';
import { useCameraWizardStore, type WizardStep } from './camera-wizard-store';
import { CameraWizardFrame } from './CameraWizardFrame';
import { CaptureStep } from './CaptureStep';
import { ReviewStep } from './ReviewStep';
import { SetupStep } from './SetupStep';

const STEP_LABELS: Readonly<Record<WizardStep, string>> = {
  setup: '1 · Board',
  capture: '2 · Capture',
  review: '3 · Review',
};
const STEP_ORDER: ReadonlyArray<WizardStep> = ['setup', 'capture', 'review'];

export function CameraCalibrationWizard(): JSX.Element {
  const step = useCameraWizardStore((s) => s.step);
  const minimized = useCameraWizardStore((s) => s.minimized);
  const closeWizard = useCameraWizardStore((s) => s.closeWizard);
  const toggleMinimized = useCameraWizardStore((s) => s.toggleMinimized);
  return (
    <CameraWizardFrame
      title="Calibrate camera lens"
      minimized={minimized}
      onToggleMinimize={toggleMinimized}
      onExit={closeWizard}
    >
      {minimized ? null : (
        <div style={stepsRowStyle} aria-label="Wizard progress">
          {STEP_ORDER.map((s) => (
            <span key={s} style={s === step ? activeStepStyle : stepStyle}>
              {STEP_LABELS[s]}
            </span>
          ))}
        </div>
      )}
      <StepBody step={step} />
    </CameraWizardFrame>
  );
}

function StepBody(props: { readonly step: WizardStep }): JSX.Element {
  switch (props.step) {
    case 'setup':
      return <SetupStep />;
    case 'capture':
      return <CaptureStep />;
    case 'review':
      return <ReviewStep />;
    default:
      return assertNever(props.step, 'wizard step');
  }
}

const stepsRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  marginBottom: 12,
  fontSize: 12,
};
const stepStyle: React.CSSProperties = { color: 'var(--lf-text-faint)' };
const activeStepStyle: React.CSSProperties = { color: 'var(--lf-text)', fontWeight: 600 };
