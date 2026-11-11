// The status bar's Update button (ADR-227). Replaces the fixed-position update
// popup: update readiness (published by PwaUpdateWatcher via pwa-update-store)
// sits passively at the right edge of the status bar until the operator clicks
// it, and clicking applies the update through the callback the watcher staged.
// Applying a web update reloads the page, and a reload stops a job streaming
// from this tab. So while machine work runs the button reads "Update after
// job" and does nothing, exactly like the desktop toolbar button (ADR-227
// Amendment 2, ADR-561 Amendment 7). It gates the update, never Start. A
// visually-hidden polite live region announces readiness to screen-reader
// users (the deleted banner was role="alert"; a passive button is otherwise
// silent) — audio-only, never a visual popup (ADR-227 amendment, audit #22
// P3-3).

import { APP_DISPLAY_NAME } from '../../core/app-branding';
import { updateInstallWaitsNow, useUpdateInstallWaits } from '../licensing/update-install-waits';
import { usePwaUpdateStore } from '../state/pwa-update-store';
import { useToastStore } from '../state/toast-store';

const UPDATE_READY_ANNOUNCEMENT = `A new version of ${APP_DISPLAY_NAME} is ready. Use the Update button in the status bar to reload and apply it.`;

export const WEB_UPDATE_WAITS_FOR_MACHINE = `Machine work is running, and updating reloads ${APP_DISPLAY_NAME}, which would stop it. Use Update again when the machine is idle.`;

const WEB_UPDATE_WAITS_TOAST_KEY = 'web-update-waits-for-machine';

export function PwaUpdateButton(): JSX.Element {
  const availability = usePwaUpdateStore((s) => s.availability);
  const waits = useUpdateInstallWaits();
  const stagedApply = availability.kind === 'ready' ? availability.applyUpdate : null;
  const apply = (): void => {
    if (stagedApply === null) return;
    // Read at click time: work that started after the last render still wins.
    if (updateInstallWaitsNow()) {
      useToastStore
        .getState()
        .pushToast(WEB_UPDATE_WAITS_FOR_MACHINE, 'warning', { key: WEB_UPDATE_WAITS_TOAST_KEY });
      return;
    }
    void stagedApply();
  };
  return (
    <>
      {/* Mounted persistently even while empty: a live region announces text
          CHANGES, so it must already exist in the DOM before readiness lands —
          one inserted together with its text can be skipped by the reader. */}
      <span role="status" style={visuallyHiddenStyle}>
        {stagedApply !== null ? UPDATE_READY_ANNOUNCEMENT : ''}
      </span>
      {stagedApply !== null && (
        <button
          type="button"
          className="lf-btn lf-btn--primary"
          aria-label={waits ? 'Apply app update after the job' : 'Apply app update'}
          aria-disabled={waits}
          title={
            waits
              ? `A new version of ${APP_DISPLAY_NAME} is ready. ${WEB_UPDATE_WAITS_FOR_MACHINE}`
              : `A new version of ${APP_DISPLAY_NAME} is ready — click to reload and apply it.`
          }
          style={waits ? waitingButtonStyle : buttonStyle}
          onClick={apply}
        >
          {waits ? 'Update after job' : 'Update'}
        </button>
      )}
    </>
  );
}

const buttonStyle: React.CSSProperties = {
  // Right edge of the status bar, compact enough not to grow the 12px bar.
  fontSize: 12,
  padding: '1px 10px',
  whiteSpace: 'nowrap',
};

const waitingButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  opacity: 0.6,
  cursor: 'not-allowed',
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
