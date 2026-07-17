// The status bar's Update button (ADR-227). Replaces the fixed-position update
// popup: update readiness (published by PwaUpdateWatcher via pwa-update-store)
// sits passively at the right edge of the status bar until the operator clicks
// it, and clicking applies the update through the callback the watcher staged.
// Hidden — not disabled — while a job or machine operation is pending, exactly
// as the old banner was (ADR-060: a reload can abort motion or hide a terminal
// job state that still needs operator handling); readiness persists in the
// store, so the button reappears once the machine clears.

import { APP_DISPLAY_NAME } from '../../core/app-branding';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { usePwaUpdateStore } from '../state/pwa-update-store';

export function PwaUpdateButton(): JSX.Element | null {
  const availability = usePwaUpdateStore((s) => s.availability);
  const machineRecoveryPending = useLaserStore(
    (s) =>
      isActiveJob(s.streamer) ||
      s.safetyNotice !== null ||
      s.motionOperation !== null ||
      s.controllerOperation !== null,
  );
  if (availability.kind !== 'ready' || machineRecoveryPending) return null;
  return (
    <button
      type="button"
      className="lf-btn lf-btn--primary"
      aria-label="Apply app update"
      title={`A new version of ${APP_DISPLAY_NAME} is ready — click to reload and apply it.`}
      style={buttonStyle}
      onClick={() => void availability.applyUpdate()}
    >
      Update
    </button>
  );
}

const buttonStyle: React.CSSProperties = {
  // Right edge of the status bar, compact enough not to grow the 12px bar.
  marginLeft: 'auto',
  fontSize: 12,
  padding: '1px 10px',
  whiteSpace: 'nowrap',
};
