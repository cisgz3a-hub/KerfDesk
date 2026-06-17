// OriginRow — Set / Reset work origin (ADR-021) + Release motors (ADR-053 P4),
// extracted from JobControls.tsx when it hit the ADR-015 size cap.

import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { hasCustomOrigin, useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { rowStyle } from './JobControls.styles';

// ADR-053 P4 — releasing motors ($SLP) is hard to undo cleanly (waking needs a
// soft-reset that clears G92), so confirm and spell out the correct order:
// release -> hand-move -> reconnect/reset -> Set origin LAST.
const RELEASE_MOTORS_CONFIRM =
  'Release motors?\n\n' +
  'This sends $SLP to put the controller to sleep so you can push the head by hand. ' +
  'The controller will ignore commands until you reconnect (or soft-reset), which clears ' +
  'the work origin. Move the head first, then reconnect, then Set origin again. ' +
  'Do not release motors during a job.';

// F.3 — Set / Reset the work-coordinate origin to the current head
// position. See ADR-021. Buttons:
//   - "Set origin here" sends G92 X0 Y0. Always enabled (subject to
//     `busy`) — the operator can re-set the origin whenever the head
//     is at a new corner.
//   - "Reset origin" sends G92.1. Only enabled when wcoCache shows a
//     non-trivial offset; disabled otherwise (nothing to clear).
//   - "Release motors" sends $SLP for hand-positioning (ADR-053 P4).
export function OriginRow(props: {
  readonly disabled: boolean;
  readonly streaming: boolean;
}): JSX.Element {
  const setOrigin = useLaserStore((s) => s.setOriginHere);
  const resetOrigin = useLaserStore((s) => s.resetOrigin);
  const releaseMotors = useLaserStore((s) => s.releaseMotors);
  const wcoCache = useLaserStore((s) => s.wcoCache);
  const workOriginActive = useLaserStore((s) => s.workOriginActive);
  const setJobPlacement = useStore((s) => s.setJobPlacement);
  const pushToast = useToastStore((s) => s.pushToast);
  const busy = props.disabled || props.streaming;
  const hasCustom = workOriginActive || hasCustomOrigin(wcoCache);
  // Toast on ack covers the WCO-frame latency gap — GRBL reports WCO
  // intermittently (every Nth status per `$10`), so the StatusDisplay
  // readout may take 1-30 frames (~0.25-7.5s) to update after a G92.
  // The toast gives instant feedback so the user doesn't re-click.
  const onSet = (): void => {
    void setOrigin().then(() => {
      setJobPlacement({ startFrom: 'user-origin' });
      pushToast('Origin set to current head position (G92).', 'success');
    });
  };
  const onReset = (): void => {
    void resetOrigin().then(() =>
      pushToast('Work origin cleared — back to machine zero (G92.1).', 'success'),
    );
  };
  const onRelease = (): void => {
    if (!jobAwareConfirm(RELEASE_MOTORS_CONFIRM)) return;
    void releaseMotors().then(() =>
      pushToast(
        'Motors released ($SLP). Move the head by hand, then reconnect and Set origin again.',
        'success',
      ),
    );
  };
  return (
    <div style={rowStyle}>
      <button
        type="button"
        onClick={onSet}
        disabled={busy}
        title="Declare the current head position as the workpiece (0, 0). Cleared on alarm or stop."
      >
        Set origin here
      </button>
      <button
        type="button"
        onClick={onReset}
        disabled={busy || !hasCustom}
        title={
          hasCustom
            ? 'Clear the custom work origin (G92.1) — coordinates return to machine zero.'
            : 'No custom origin active. Set one with "Set origin here" first.'
        }
      >
        Reset origin
      </button>
      <button
        type="button"
        onClick={onRelease}
        disabled={busy}
        title="Release the motors ($SLP) so you can move the head by hand. Clears the work origin — reconnect and Set origin again afterward."
      >
        Release motors
      </button>
    </div>
  );
}
