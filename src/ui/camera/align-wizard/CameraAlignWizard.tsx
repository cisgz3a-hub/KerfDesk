// CameraAlignWizard — LightBurn-style bed-alignment wizard (F-CAM9): burn
// the five-marker target pattern as a real job, clear the bed, then detect
// and solve the camera→bed homography. State lives in
// camera-align-wizard-store; steps are thin renderers.

import { assertNever } from '../../../core/scene';
import { CameraWizardFrame } from '../wizard/CameraWizardFrame';
import { useCameraAlignWizardStore, type AlignWizardStep } from './camera-align-wizard-store';
import { BurningStep, ClearBedStep, SetupStep } from './AlignWizardSteps';
import { DetectStep, DoneStep } from './AlignWizardDetectStep';

const STEP_LABELS: ReadonlyArray<{
  readonly kind: AlignWizardStep['kind'];
  readonly label: string;
}> = [
  { kind: 'setup', label: '1 · Burn target' },
  { kind: 'clear-bed', label: '2 · Clear bed' },
  { kind: 'detect', label: '3 · Detect' },
];

export function CameraAlignWizard(): JSX.Element {
  const step = useCameraAlignWizardStore((s) => s.step);
  const minimized = useCameraAlignWizardStore((s) => s.minimized);
  const closeWizard = useCameraAlignWizardStore((s) => s.closeWizard);
  const toggleMinimized = useCameraAlignWizardStore((s) => s.toggleMinimized);
  return (
    <CameraWizardFrame
      title="Align camera to bed"
      minimized={minimized}
      onToggleMinimize={toggleMinimized}
      onExit={closeWizard}
    >
      {minimized ? null : (
        <div style={stepsRowStyle} aria-label="Wizard progress">
          {STEP_LABELS.map((entry) => (
            <span
              key={entry.kind}
              style={isCurrent(step, entry.kind) ? activeStepStyle : stepStyle}
            >
              {entry.label}
            </span>
          ))}
        </div>
      )}
      <StepBody step={step} />
    </CameraWizardFrame>
  );
}

// 'burning' shows under the Burn label; 'done' under Detect.
function isCurrent(step: AlignWizardStep, label: AlignWizardStep['kind']): boolean {
  if (step.kind === 'burning') return label === 'setup';
  if (step.kind === 'done') return label === 'detect';
  return step.kind === label;
}

function StepBody(props: { readonly step: AlignWizardStep }): JSX.Element {
  const { step } = props;
  switch (step.kind) {
    case 'setup':
      return <SetupStep note={step.note} />;
    case 'burning':
      return <BurningStep />;
    case 'clear-bed':
      return <ClearBedStep />;
    case 'detect':
      return <DetectStep status={step.status} />;
    case 'done':
      return <DoneStep basis={step.basis} />;
    default:
      return assertNever(step, 'align wizard step');
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
