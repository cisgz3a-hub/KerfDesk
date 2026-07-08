// CameraSetupSteps — the panel's guided order of operations. The camera flow
// has a strict sequence (source → lens → alignment → use), but the panel is a
// toolbox of buttons; this row tells the operator which one is next and what
// is already done, driven by real state (active source, persisted
// calibration/alignment on the device profile).

import { useStore } from '../../state';
import { useCameraStore } from '../../state/camera-store';
import { noteStyle } from './panel-styles';

type StepState = 'done' | 'next' | 'todo';

export function CameraSetupSteps(): JSX.Element {
  const sourceState = useCameraStore((s) => s.sourceState);
  const calibration = useStore((s) => s.project.device.cameraCalibration);
  const alignment = useStore((s) => s.project.device.cameraAlignment);

  const sourceLive = sourceState.kind === 'live';
  const steps: ReadonlyArray<{ readonly label: string; readonly done: boolean }> = [
    { label: 'Use a camera', done: sourceLive },
    { label: 'Calibrate lens', done: calibration !== undefined },
    { label: 'Align to bed', done: alignment !== undefined },
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
      return 'Next: press "Use this camera" on the detected machine camera (or start a USB camera).';
    case 1:
      return 'Next: "Calibrate lens…" — the wizard saves a printable checkerboard and captures poses automatically.';
    case 2:
      return 'Next: "Align to bed…" — burn the marker target (or reuse one) so the camera knows where the bed is.';
    default:
      return sourceLive
        ? 'Ready: the overlay tracks the bed — Update still, Trace from camera, or use the crosshair tool to move the laser to a click.'
        : 'Set up complete — start a camera to use the overlay, trace, and positioning.';
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
        ? 'var(--lf-accent)'
        : state === 'next'
          ? 'var(--lf-text)'
          : 'var(--lf-text-faint)',
    fontWeight: state === 'next' ? 600 : 400,
  };
}
