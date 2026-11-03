// HeldResumeTailNotice — the machine-rail warning after a laser Resume left
// grblHAL Idle at the end of a job (ADR-684). Older grblHAL builds can still
// hold the paused move's tail and run it, at its laser power, at the next
// motion. The warning stays until a reset or any motion retires it; the
// Reset button is the operator's choice, and nothing else is blocked.

import { HELD_RESUME_TAIL_MESSAGE } from '../../core/controllers/grblhal/held-resume-tail';
import { currentHeldResumeTail } from '../state/held-resume-tail';
import { useLaserStore } from '../state/laser-store';

export function HeldResumeTailNotice(props: { readonly onReset: () => void }): JSX.Element | null {
  const held = useLaserStore((s) => currentHeldResumeTail(s) !== null);
  const busy = useLaserStore((s) => s.streamer !== null || s.controllerOperation !== null);
  if (!held) return null;
  return (
    <div role="status" style={noticeStyle}>
      <p style={textStyle}>{HELD_RESUME_TAIL_MESSAGE}</p>
      <button
        type="button"
        onClick={props.onReset}
        disabled={busy}
        title="Send Ctrl-X soft reset. It empties the controller's motion buffer and ends the current Frame, so Frame again before Start; home again if the controller asks."
      >
        Reset (Ctrl-X)
      </button>
    </div>
  );
}

const noticeStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 'var(--lf-space-2)',
};

const textStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-warning-fg)',
  fontSize: 'var(--lf-text-sm)',
  fontWeight: 600,
};
