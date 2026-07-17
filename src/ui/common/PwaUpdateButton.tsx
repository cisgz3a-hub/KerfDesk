// The status bar's Update button (ADR-227). Replaces the fixed-position update
// popup: update readiness (published by PwaUpdateWatcher via pwa-update-store)
// sits passively at the right edge of the status bar until the operator clicks
// it, and clicking applies the update through the callback the watcher staged.
// Hidden — not disabled — while a job or machine operation is pending, exactly
// as the old banner was (ADR-060: a reload can abort motion or hide a terminal
// job state that still needs operator handling); readiness persists in the
// store, so the button reappears once the machine clears. A visually-hidden
// polite live region announces readiness to screen-reader users (the deleted
// banner was role="alert"; a passive button is otherwise silent) — audio-only,
// never a visual popup (ADR-227 amendment, audit #22 P3-3).

import { APP_DISPLAY_NAME } from '../../core/app-branding';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { usePwaUpdateStore } from '../state/pwa-update-store';

const UPDATE_READY_ANNOUNCEMENT = `A new version of ${APP_DISPLAY_NAME} is ready. Use the Update button in the status bar to reload and apply it.`;

export function PwaUpdateButton(): JSX.Element {
  const availability = usePwaUpdateStore((s) => s.availability);
  const machineRecoveryPending = useLaserStore(
    (s) =>
      isActiveJob(s.streamer) ||
      s.safetyNotice !== null ||
      s.motionOperation !== null ||
      s.controllerOperation !== null,
  );
  const stagedApply = availability.kind === 'ready' ? availability.applyUpdate : null;
  const shownApply = machineRecoveryPending ? null : stagedApply;
  return (
    <>
      {/* Mounted persistently even while empty: a live region announces text
          CHANGES, so it must already exist in the DOM before readiness lands —
          one inserted together with its text can be skipped by the reader. */}
      <span role="status" style={visuallyHiddenStyle}>
        {shownApply !== null ? UPDATE_READY_ANNOUNCEMENT : ''}
      </span>
      {shownApply !== null && (
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          aria-label="Apply app update"
          title={`A new version of ${APP_DISPLAY_NAME} is ready — click to reload and apply it.`}
          style={buttonStyle}
          onClick={() => void shownApply()}
        >
          Update
        </button>
      )}
    </>
  );
}

const buttonStyle: React.CSSProperties = {
  // Right edge of the status bar, compact enough not to grow the 12px bar.
  marginLeft: 'auto',
  fontSize: 12,
  padding: '1px 10px',
  whiteSpace: 'nowrap',
};

// Standard screen-reader-only pattern. position:absolute also keeps the empty
// span from becoming a status-bar flex item (which would add a phantom gap).
const visuallyHiddenStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};
