// JobRunControls — the in-rail status and real-time overrides JobControls mounts
// while something is moving. Canonical Pause/Resume/Continue/Abort actions live
// in LiveMotionBar (ADR-207); the rail keeps the detailed safety explanation.
// Capability-aware per ADR-098: Marlin-class firmwares pause stream-side
// (no realtime feed hold) and may lack jog cancel — the copy says so.

import { useLaserStore } from '../state/laser-store';
import { cncResumeAdvisoryNotice } from '../state/cnc-pause-resume-policy';
import { rowStyle, runningSafetyStyle } from './JobControls.styles';
import { OverrideControls } from './OverrideControls';
import { pauseControlMessage } from './job-control-copy';

// Name the bit at the hold when the compiled program identified it (R5); fall
// back to the generic prompt for a single-tool / imported / resume-tail job.
function toolChangeMessage(bitLabel: string | null): string {
  const bit = bitLabel === null ? 'the next bit' : bitLabel;
  return `Job paused for a tool change. Load ${bit}, select it as the Active bit, and re-zero Z on the stock top (jog, then Zero Z), then Continue to resume.`;
}

export function RunningControls(props: {
  readonly isStreaming: boolean;
  readonly isPaused: boolean;
  readonly isToolChange: boolean;
  /** Every line acknowledged while the controller still reports Run/Hold/Door. */
  readonly isFinishingTail?: boolean;
}): JSX.Element {
  const hasRealtimePause = useLaserStore((s) => s.capabilities.realtimePause);
  const hasOverrides = useLaserStore((s) => s.capabilities.overrides);
  const pendingToolLabel = useLaserStore((s) => s.pendingToolLabel);
  const activeJobMachineKind = useLaserStore((s) => s.activeJobMachineKind);
  const laserModeEnabled = useLaserStore((s) => s.controllerSettings?.laserModeEnabled);
  const resumeAdvisory = cncResumeAdvisoryNotice(activeJobMachineKind, laserModeEnabled);
  const pauseMessage = pauseControlMessage(activeJobMachineKind, hasRealtimePause);
  const safetyMessage = runningSafetyMessage({
    isToolChange: props.isToolChange,
    isPaused: props.isPaused,
    pendingToolLabel,
    pauseMessage,
    resumeAdvisory,
  });
  return (
    <>
      <div style={rowStyle}>
        <span style={runningSafetyStyle}>
          {safetyMessage}{' '}
          {props.isToolChange
            ? 'Continue unlocks only after fresh Idle and tool-matched Z zero; it lifts to safe Z before spindle start.'
            : ''}
        </span>
      </div>
      {shouldShowOverrides(
        props.isStreaming,
        props.isPaused,
        hasOverrides,
        props.isFinishingTail === true,
      ) && <OverrideControls />}
    </>
  );
}

function runningSafetyMessage(options: {
  readonly isToolChange: boolean;
  readonly isPaused: boolean;
  readonly pendingToolLabel: string | null;
  readonly pauseMessage: string;
  readonly resumeAdvisory: string | null;
}): string {
  if (options.isToolChange) return toolChangeMessage(options.pendingToolLabel);
  if (options.isPaused && options.resumeAdvisory !== null) return options.resumeAdvisory;
  return options.pauseMessage;
}

// Overrides are only meaningful while the controller is consuming motion AND its
// firmware speaks GRBL 1.1 realtime override bytes — mounted beside
// the live-job explanation for streaming and paused jobs (ADR-103 G3), never for a
// controller without the capability (Marlin/Smoothieware/Ruida), whose line
// buffer the bytes would corrupt (CTL-01). Exported for direct unit testing.
// The finishing tail counts too: 'done' means every line was acknowledged, not
// executed, and the firmware still honours override bytes while its planner
// drains (the Live Motion bar keeps Pause there for the same reason; audit
// realtime-2).
export function shouldShowOverrides(
  isStreaming: boolean,
  isPaused: boolean,
  hasOverrides: boolean,
  isFinishingTail = false,
): boolean {
  return (isStreaming || isPaused || isFinishingTail) && hasOverrides;
}

export function MotionControls(props: { readonly operationKind: 'frame' | 'jog' }): JSX.Element {
  const hasJogCancel = useLaserStore((s) => s.capabilities.jogCancel);
  const motionLabel = props.operationKind === 'frame' ? 'Frame' : 'Jog';
  return (
    <div style={rowStyle}>
      <span style={runningSafetyStyle}>
        {motionLabel} motion is active. Use ABORT MOTION in the Live Motion bar
        {hasJogCancel ? '.' : '; this firmware has no separate jog-cancel command.'} Use the
        physical E-stop if unsafe.
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
