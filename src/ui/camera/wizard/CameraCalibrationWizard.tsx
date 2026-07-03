// CameraCalibrationWizard — the lens-calibration dialog (ADR-108 v2.e):
// describe the printed board, auto-capture diverse poses with live detection,
// solve through the focal sweep, and gate Apply behind the A/B perceptual
// check. State lives in camera-wizard-store; steps are thin renderers.

import { assertNever } from '../../../core/scene';
import { Dialog } from '../../kit';
import { useCameraWizardStore, type WizardStep } from './camera-wizard-store';
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
  const closeWizard = useCameraWizardStore((s) => s.closeWizard);
  return (
    <Dialog title="Calibrate camera lens" size="lg" onClose={closeWizard}>
      <div style={stepsRowStyle} aria-label="Wizard progress">
        {STEP_ORDER.map((s) => (
          <span key={s} style={s === step ? activeStepStyle : stepStyle}>
            {STEP_LABELS[s]}
          </span>
        ))}
      </div>
      <StepBody step={step} />
    </Dialog>
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
