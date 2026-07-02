// JobRunControls — the in-flight operation controls JobControls mounts while
// something is moving: Pause/Resume/Stop (+ real-time overrides, ADR-102 G3)
// for a streaming job, cancel for jog/frame motion, and the passive label for
// controller operations. Extracted from JobControls.tsx (file line cap).

import { useLaserStore } from '../state/laser-store';
import { rowStyle, runningSafetyStyle, stopBtnStyle } from './JobControls.styles';
import { OverrideControls } from './OverrideControls';

const PAUSE_HOLD_SAFETY_MESSAGE = 'Pause is feed hold only. Use Stop or physical E-stop if unsafe.';

export function RunningControls(props: {
  readonly isStreaming: boolean;
  readonly isPaused: boolean;
}): JSX.Element {
  const pauseJob = useLaserStore((s) => s.pauseJob);
  const resumeJob = useLaserStore((s) => s.resumeJob);
  const stopJob = useLaserStore((s) => s.stopJob);
  return (
    <>
      <div style={rowStyle}>
        {props.isStreaming && (
          <button
            type="button"
            onClick={() => void pauseJob().catch(() => undefined)}
            title={PAUSE_HOLD_SAFETY_MESSAGE}
          >
            Pause
          </button>
        )}
        {props.isPaused && (
          <button
            type="button"
            onClick={() => void resumeJob().catch(() => undefined)}
            title="Release the feed hold and continue the job"
          >
            Resume
          </button>
        )}
        <button
          type="button"
          onClick={() => void stopJob().catch(() => undefined)}
          style={stopBtnStyle}
          title="Soft-reset the controller and halt the job (Ctrl+.)"
        >
          Stop
        </button>
        <span style={runningSafetyStyle}>{PAUSE_HOLD_SAFETY_MESSAGE}</span>
      </div>
      {shouldShowOverrides(props.isStreaming, props.isPaused) && <OverrideControls />}
    </>
  );
}

// Overrides are only meaningful while GRBL is consuming motion — mounted
// beside Pause/Resume/Stop for streaming and paused jobs (ADR-102 G3).
function shouldShowOverrides(isStreaming: boolean, isPaused: boolean): boolean {
  return isStreaming || isPaused;
}

export function MotionControls(props: { readonly operationKind: 'frame' | 'jog' }): JSX.Element {
  const cancelJog = useLaserStore((s) => s.cancelJog);
  const label = props.operationKind === 'frame' ? 'Cancel frame' : 'Cancel jog';
  return (
    <div style={rowStyle}>
      <button
        type="button"
        onClick={() => void cancelJog().catch(() => undefined)}
        title="Cancel the active framing or jog motion. Use physical E-stop if unsafe."
      >
        {label}
      </button>
      <span style={runningSafetyStyle}>Uses GRBL jog cancel. Use physical E-stop if unsafe.</span>
    </div>
  );
}

export function ControllerOperationControls({ label }: { readonly label: string }): JSX.Element {
  return (
    <div style={rowStyle}>
      <span style={runningSafetyStyle}>{label}</span>
    </div>
  );
}
