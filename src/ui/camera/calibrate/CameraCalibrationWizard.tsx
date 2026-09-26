// CameraCalibrationWizard — one-photo camera calibration (ADR-441): engrave
// the ring target on a sheet covering the bed, take one photo, and review the
// fit in millimetres before saving it to the machine profile. It replaces the
// printed-checkerboard lens wizard and the five-marker bed alignment: one
// target gives the lens, the camera's position and the bed mapping together.
// State lives in camera-calibration-store; steps are thin renderers.

import { assertNever } from '../../../core/scene';
import { CameraWizardFrame } from './CameraWizardFrame';
import { CalibrationSetupStep } from './CalibrationSetupStep';
import { EngravingStep, PhotoStep } from './CalibrationPhotoSteps';
import { CalibrationResultStep } from './CalibrationResultStep';
import { useCameraCalibrationStore, type CalibrationStep } from './camera-calibration-store';

const STEP_LABELS: ReadonlyArray<{
  readonly kinds: ReadonlyArray<CalibrationStep['kind']>;
  readonly label: string;
}> = [
  { kinds: ['setup', 'engraving'], label: '1 · Engrave target' },
  { kinds: ['photo'], label: '2 · Take photo' },
  { kinds: ['result'], label: '3 · Check and save' },
];

export function CameraCalibrationWizard(): JSX.Element | null {
  const open = useCameraCalibrationStore((s) => s.open);
  return open ? <OpenWizard /> : null;
}

function OpenWizard(): JSX.Element {
  const step = useCameraCalibrationStore((s) => s.step);
  const minimized = useCameraCalibrationStore((s) => s.minimized);
  const closeWizard = useCameraCalibrationStore((s) => s.closeWizard);
  const toggleMinimized = useCameraCalibrationStore((s) => s.toggleMinimized);
  return (
    <CameraWizardFrame
      title="Calibrate camera"
      minimized={minimized}
      onToggleMinimize={toggleMinimized}
      onExit={closeWizard}
    >
      {minimized ? null : (
        <div style={stepsRowStyle} aria-label="Wizard progress">
          {STEP_LABELS.map((entry) => (
            <span
              key={entry.label}
              style={entry.kinds.includes(step.kind) ? activeStepStyle : stepStyle}
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

function StepBody(props: { readonly step: CalibrationStep }): JSX.Element {
  const { step } = props;
  switch (step.kind) {
    case 'setup':
      return <CalibrationSetupStep note={step.note} />;
    case 'engraving':
      return <EngravingStep started={step.started} earlierJob={step.earlierJob} />;
    case 'photo':
      return <PhotoStep status={step.status} />;
    case 'result':
      return <CalibrationResultStep result={step.result} />;
    default:
      return assertNever(step, 'camera calibration step');
  }
}

const stepsRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  marginBottom: 12,
  fontSize: 12,
  flexWrap: 'wrap',
};
const stepStyle: React.CSSProperties = { color: 'var(--lf-text-faint)' };
const activeStepStyle: React.CSSProperties = { color: 'var(--lf-text)', fontWeight: 600 };
