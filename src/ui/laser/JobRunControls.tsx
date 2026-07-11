// JobRunControls — the in-flight operation controls JobControls mounts while
// something is moving: Pause/Resume/Stop (+ real-time overrides, ADR-103 G3)
// for a streaming job, cancel for jog/frame motion, and the passive label for
// controller operations. Extracted from JobControls.tsx (file line cap).
// Capability-aware per ADR-098: Marlin-class firmwares pause stream-side
// (no realtime feed hold) and may lack jog cancel — the copy says so.

import { useLaserStore } from '../state/laser-store';
import { rowStyle, runningSafetyStyle, stopBtnStyle } from './JobControls.styles';
import { OverrideControls } from './OverrideControls';

const PAUSE_HOLD_SAFETY_MESSAGE = 'Pause is feed hold only. Use Stop or physical E-stop if unsafe.';
const PAUSE_STREAM_SIDE_MESSAGE =
  'Pause stops sending; moves already buffered in the firmware finish first. Use Stop or physical E-stop if unsafe.';

// Name the bit at the hold when the compiled program identified it (R5); fall
// back to the generic prompt for a single-tool / imported / resume-tail job.
function toolChangeMessage(bitLabel: string | null): string {
  const bit = bitLabel === null ? 'the next bit' : bitLabel;
  return `Job paused for a tool change. Load ${bit} and re-zero Z on the stock top (jog, then Zero Z), then Continue to resume.`;
}

export function RunningControls(props: {
  readonly isStreaming: boolean;
  readonly isPaused: boolean;
  readonly isToolChange: boolean;
}): JSX.Element {
  const pauseJob = useLaserStore((s) => s.pauseJob);
  const resumeJob = useLaserStore((s) => s.resumeJob);
  const continueToolChange = useLaserStore((s) => s.continueToolChange);
  const stopJob = useLaserStore((s) => s.stopJob);
  const hasRealtimePause = useLaserStore((s) => s.capabilities.realtimePause);
  const hasOverrides = useLaserStore((s) => s.capabilities.overrides);
  const pendingToolLabel = useLaserStore((s) => s.pendingToolLabel);
  const pauseMessage = hasRealtimePause ? PAUSE_HOLD_SAFETY_MESSAGE : PAUSE_STREAM_SIDE_MESSAGE;
  const safetyMessage = props.isToolChange ? toolChangeMessage(pendingToolLabel) : pauseMessage;
  return (
    <>
      <div style={rowStyle}>
        {props.isStreaming && (
          <button
            type="button"
            onClick={() => void pauseJob().catch(() => undefined)}
            title={pauseMessage}
          >
            Pause
          </button>
        )}
        {props.isPaused && (
          <button
            type="button"
            onClick={() => void resumeJob().catch(() => undefined)}
            title={
              hasRealtimePause
                ? 'Release the feed hold and continue the job'
                : 'Continue sending the remaining job lines'
            }
          >
            Resume
          </button>
        )}
        {props.isToolChange && (
          <button
            type="button"
            onClick={() => void continueToolChange().catch(() => undefined)}
            title="Resume the job after loading and re-zeroing the new bit"
          >
            Continue
          </button>
        )}
        <button
          type="button"
          onClick={() => void stopJob().catch(() => undefined)}
          style={stopBtnStyle}
          title="Halt the job and force the beam off (Ctrl+.)"
        >
          Stop
        </button>
        <span style={runningSafetyStyle}>{safetyMessage}</span>
      </div>
      {shouldShowOverrides(props.isStreaming, props.isPaused, hasOverrides) && <OverrideControls />}
    </>
  );
}

// Overrides are only meaningful while the controller is consuming motion AND its
// firmware speaks GRBL 1.1 realtime override bytes — mounted beside
// Pause/Resume/Stop for streaming and paused jobs (ADR-103 G3), never for a
// controller without the capability (Marlin/Smoothieware/Ruida), whose line
// buffer the bytes would corrupt (CTL-01). Exported for direct unit testing.
export function shouldShowOverrides(
  isStreaming: boolean,
  isPaused: boolean,
  hasOverrides: boolean,
): boolean {
  return (isStreaming || isPaused) && hasOverrides;
}

export function MotionControls(props: { readonly operationKind: 'frame' | 'jog' }): JSX.Element {
  const cancelJog = useLaserStore((s) => s.cancelJog);
  const hasJogCancel = useLaserStore((s) => s.capabilities.jogCancel);
  const label = props.operationKind === 'frame' ? 'Cancel frame' : 'Cancel jog';
  if (!hasJogCancel) {
    return (
      <div style={rowStyle}>
        <span style={runningSafetyStyle}>
          This firmware has no jog cancel — buffered motion finishes on its own. Use physical E-stop
          if unsafe.
        </span>
      </div>
    );
  }
  return (
    <div style={rowStyle}>
      <button
        type="button"
        onClick={() => void cancelJog().catch(() => undefined)}
        title="Cancel the active framing or jog motion. Use physical E-stop if unsafe."
      >
        {label}
      </button>
      <span style={runningSafetyStyle}>
        Uses the firmware jog cancel. Use physical E-stop if unsafe.
      </span>
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
