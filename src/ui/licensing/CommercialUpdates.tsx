import { useCallback, useEffect, useState } from 'react';
import type { CommercialUpdateStatus, LicenceAdapter } from '../../platform/types';
import { useCommercialUpdateStore } from '../state/commercial-update-store';
import { useToastStore } from '../state/toast-store';
import { LICENCE_SETTINGS_EVENT } from './edition';
import { panelOverlay, useDismissOnEscape } from './panel-overlay';
import { CHECK_UPDATES_EVENT, updateStatusSettled } from './update-status-text';
import { UpdatesPanel } from './UpdatesPanel';

// The main process checks once after the window opens (ADR-547). Until the
// status settles the window asks again: often while a check or download runs,
// rarely while the first check has not started.
const BUSY_POLL_MS = 3_000;
const IDLE_POLL_MS = 30_000;

/**
 * Keeps the desktop app's update status for the status bar, and answers Help >
 * Check for Updates with the updates panel (ADR-547).
 */
export function CommercialUpdates({
  client,
  updatesUntil,
}: {
  readonly client: LicenceAdapter;
  readonly updatesUntil: number | null;
}): JSX.Element | null {
  const { status, check } = useCommercialUpdateStatus(client);
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  useEffect(() => {
    window.addEventListener(CHECK_UPDATES_EVENT, show);
    // The licence panel opens in the same place, so one replaces the other.
    window.addEventListener(LICENCE_SETTINGS_EVENT, close);
    return () => {
      window.removeEventListener(CHECK_UPDATES_EVENT, show);
      window.removeEventListener(LICENCE_SETTINGS_EVENT, close);
    };
  }, [close, show]);
  useDismissOnEscape(open, close);
  if (!open) return null;
  return (
    <div role="dialog" aria-modal="false" aria-label="KerfDesk updates" style={panelOverlay}>
      <UpdatesPanel
        client={client}
        status={status}
        updatesUntil={updatesUntil}
        onCheck={check}
        onClose={close}
      />
    </div>
  );
}

/** Help > Check for Updates in the web app, which updates itself. */
export function BrowserUpdatesNotice(): null {
  useEffect(() => {
    const explain = (): void => {
      useToastStore
        .getState()
        .pushToast(
          'KerfDesk in the browser updates itself. When a new version is ready, an Update button appears in the status bar.',
          'info',
        );
    };
    window.addEventListener(CHECK_UPDATES_EVENT, explain);
    return () => window.removeEventListener(CHECK_UPDATES_EVENT, explain);
  }, []);
  return null;
}

export function useCommercialUpdateStatus(client: LicenceAdapter): {
  readonly status: CommercialUpdateStatus | null;
  readonly check: () => Promise<void>;
} {
  const status = useCommercialUpdateStore((state) => state.status);
  const setStatus = useCommercialUpdateStore((state) => state.setStatus);
  useEffect(() => {
    if (status !== null && updateStatusSettled(status)) return undefined;
    let live = true;
    const wait = status === null ? 0 : status.state === 'idle' ? IDLE_POLL_MS : BUSY_POLL_MS;
    const timer = window.setTimeout(() => {
      client.updateStatus().then(
        (next) => {
          if (live) setStatus(next);
        },
        () => {
          // A window that cannot read the status shows this build as not
          // updating itself rather than asking again for ever.
          if (live) setStatus(unreadable(status));
        },
      );
    }, wait);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [client, setStatus, status]);
  const check = useCallback(async (): Promise<void> => {
    try {
      setStatus(await client.checkForUpdates());
    } catch {
      setStatus(unreadable(useCommercialUpdateStore.getState().status));
    }
  }, [client, setStatus]);
  return { status, check };
}

function unreadable(status: CommercialUpdateStatus | null): CommercialUpdateStatus {
  return {
    state: 'unavailable',
    currentVersion: status?.currentVersion ?? __APP_VERSION__,
    version: null,
    checkedAt: null,
  };
}
