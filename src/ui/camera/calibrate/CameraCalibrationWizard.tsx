// CameraCalibrationWizard — the guided camera setup (ADR-663) around the
// one-photo calibration (ADR-441): pick the camera, say where it is mounted
// and check its picture, then engrave the ring target on a sheet covering the
// bed, take one photo, and review the fit in millimetres before saving it to
// the machine profile. One target gives the lens, the camera's position and
// the bed mapping together. Recalibrating starts at the target; a check of the
// saved calibration starts at the photo. State lives in
// camera-calibration-store; steps are thin renderers. The same frame runs the
// quick nudge fix (ADR-663 Amendment 2): burn a ring, photograph it, fix.

import { assertNever } from '../../../core/scene';
import { CameraWizardFrame } from './CameraWizardFrame';
import { CalibrationSetupStep, TARGET_ON_CANVAS_NEXT_STEPS } from './CalibrationSetupStep';
import { EngravingStep, PhotoStep } from './CalibrationPhotoSteps';
import { CalibrationResultStep } from './CalibrationResultStep';
import { CameraMountStep } from './CameraMountStep';
import { CameraPickStep } from './CameraPickStep';
import { NudgePhotoStep, NudgeResultStep, NudgeSetupStep } from './NudgeSteps';
import { PictureCheckStep } from './PictureCheckStep';
import {
  useCameraCalibrationStore,
  type CalibrationMode,
  type CalibrationStep,
} from './camera-calibration-store';
import { useCalibrationPhoto, type CalibrationPhotoControls } from './use-calibration-photo';
import { useNudgePhoto, type NudgePhotoControls } from './use-nudge-photo';

type StepLabel = {
  readonly kinds: ReadonlyArray<CalibrationStep['kind']>;
  readonly label: string;
};

const SETUP_STEP_LABELS: ReadonlyArray<StepLabel> = [
  { kinds: ['camera'], label: '1 · Camera' },
  { kinds: ['mount'], label: '2 · Mounting' },
  { kinds: ['picture'], label: '3 · Picture' },
  { kinds: ['setup', 'engraving'], label: '4 · Target' },
  { kinds: ['photo'], label: '5 · Photo' },
  { kinds: ['result'], label: '6 · Save' },
];
const NUDGE_STEP_LABELS: ReadonlyArray<StepLabel> = [
  { kinds: ['nudge-setup', 'engraving'], label: '1 · Burn a ring' },
  { kinds: ['nudge-photo'], label: '2 · Photo' },
  { kinds: ['nudge-result'], label: '3 · Fix' },
];
const CHECK_STEP_LABELS: ReadonlyArray<StepLabel> = [
  { kinds: ['setup', 'engraving'], label: '1 · Target' },
  { kinds: ['photo'], label: '2 · Photo' },
  { kinds: ['result'], label: '3 · Compare' },
];

function wizardTitle(mode: CalibrationMode): string {
  switch (mode) {
    case 'check':
      return 'Check camera';
    case 'nudge':
      return 'Fix camera offset';
    case 'calibrate':
      return 'Camera setup';
  }
}

function stepLabels(mode: CalibrationMode): ReadonlyArray<StepLabel> {
  switch (mode) {
    case 'check':
      return CHECK_STEP_LABELS;
    case 'nudge':
      return NUDGE_STEP_LABELS;
    case 'calibrate':
      return SETUP_STEP_LABELS;
  }
}

export function CameraCalibrationWizard(): JSX.Element | null {
  const open = useCameraCalibrationStore((s) => s.open);
  return open ? <OpenWizard /> : null;
}

function OpenWizard(): JSX.Element {
  const step = useCameraCalibrationStore((s) => s.step);
  const mode = useCameraCalibrationStore((s) => s.mode);
  const minimized = useCameraCalibrationStore((s) => s.minimized);
  const closeWizard = useCameraCalibrationStore((s) => s.closeWizard);
  const toggleMinimized = useCameraCalibrationStore((s) => s.toggleMinimized);
  // The request outlives the step's modal/non-modal presentation when minimized.
  const photo = useCalibrationPhoto();
  const nudge = useNudgePhoto();
  const labels = stepLabels(mode);
  return (
    <CameraWizardFrame
      title={wizardTitle(mode)}
      minimized={minimized}
      onToggleMinimize={toggleMinimized}
      onExit={closeWizard}
    >
      {minimized ? null : (
        <ol style={stepsRowStyle} aria-label="Wizard progress">
          {labels.map((entry) => {
            const current = entry.kinds.includes(step.kind);
            return (
              <li
                key={entry.label}
                aria-current={current ? 'step' : undefined}
                style={current ? activeStepStyle : stepStyle}
              >
                {entry.label}
              </li>
            );
          })}
        </ol>
      )}
      <StepBody step={step} photo={photo} nudge={nudge} />
    </CameraWizardFrame>
  );
}

function StepBody(props: {
  readonly step: CalibrationStep;
  readonly photo: CalibrationPhotoControls;
  readonly nudge: NudgePhotoControls;
}): JSX.Element {
  const { step } = props;
  switch (step.kind) {
    case 'camera':
      return <CameraPickStep />;
    case 'mount':
      return <CameraMountStep />;
    case 'picture':
      return <PictureCheckStep />;
    case 'setup':
      return <CalibrationSetupStep note={step.note} />;
    case 'engraving':
      return <EngravingStep started={step.started} earlierJob={step.earlierJob} />;
    case 'photo':
      return (
        <PhotoStep
          status={step.status}
          take={props.photo.take}
          cancel={props.photo.cancel}
          {...(step.canvasTarget === true ? { beforePhoto: TARGET_ON_CANVAS_NEXT_STEPS } : {})}
        />
      );
    case 'result':
      return <CalibrationResultStep result={step.result} save={props.photo.save} />;
    case 'nudge-setup':
      return <NudgeSetupStep note={step.note} />;
    case 'nudge-photo':
      return <NudgePhotoStep status={step.status} take={props.nudge.take} />;
    case 'nudge-result':
      return (
        <NudgeResultStep
          offsetMm={step.offsetMm}
          apply={props.nudge.apply}
          ringBedUnknown={step.ringBedUnknown === true}
        />
      );
    default:
      return assertNever(step, 'camera calibration step');
  }
}

const stepsRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  margin: '0 0 12px',
  padding: 0,
  listStyle: 'none',
  fontSize: 12,
  flexWrap: 'wrap',
};
const stepStyle: React.CSSProperties = { color: 'var(--lf-text-faint)' };
const activeStepStyle: React.CSSProperties = { color: 'var(--lf-text)', fontWeight: 600 };
