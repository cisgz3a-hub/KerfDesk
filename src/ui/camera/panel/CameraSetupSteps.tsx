// CameraSetupSteps — the panel's guided order of operations. Setting up a
// camera is two steps since ADR-441 (start a camera, then calibrate it with
// one photo of an engraved target); this row says which is next and what is
// already done, driven by real state (active source, saved camera model).

import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { noteStyle } from './panel-styles';

type StepState = 'done' | 'next' | 'todo';

export function CameraSetupSteps(): JSX.Element {
  const sourceState = useCameraStore((s) => s.sourceState);
  const model = useStore((s) => s.project.device.cameraModel);

  const sourceLive = sourceState.kind === 'live';
  const steps: ReadonlyArray<{ readonly label: string; readonly done: boolean }> = [
    { label: 'Use a camera', done: sourceLive },
    { label: 'Calibrate', done: model !== undefined },
  ];
  const nextIndex = steps.findIndex((step) => !step.done);

  return (
    <div style={boxStyle}>
      <ol style={listStyle}>
        {steps.map((step, index) => (
          <li key={step.label} style={stepStyle(stateOf(step.done, index, nextIndex))}>
            {step.done ? '✓' : `${index + 1}.`} {step.label}
          </li>
        ))}
      </ol>
      <p style={noteStyle}>{nextHint(nextIndex, sourceLive)}</p>
    </div>
  );
}

function stateOf(done: boolean, index: number, nextIndex: number): StepState {
  if (done) return 'done';
  return index === nextIndex ? 'next' : 'todo';
}

function nextHint(nextIndex: number, sourceLive: boolean): string {
  switch (nextIndex) {
    case 0:
      return 'Next: press "Use this camera" on the machine camera, or start a USB camera.';
    case 1:
      return 'Next: "Calibrate camera…" engraves a ring target and fits the camera from one photo.';
    default:
      return sourceLive
        ? 'Ready: the corrected camera shows on the canvas. Update still, Trace from camera, or place artwork on the material.'
        : 'Calibrated. Start the camera to see the bed on the canvas.';
  }
}

const boxStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: '6px 8px',
  background: 'var(--lf-bg-1)',
  borderRadius: 6,
  fontSize: 12,
};
const listStyle: React.CSSProperties = {
  display: 'flex',
  gap: 12,
  margin: 0,
  padding: 0,
  listStyle: 'none',
};
function stepStyle(state: StepState): React.CSSProperties {
  return {
    color:
      state === 'done'
        ? 'var(--lf-accent-fg)'
        : state === 'next'
          ? 'var(--lf-text)'
          : 'var(--lf-text-faint)',
    fontWeight: state === 'next' ? 600 : 400,
  };
}
