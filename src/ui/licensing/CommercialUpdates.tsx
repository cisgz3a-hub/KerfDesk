import { useCallback, useEffect, useState } from 'react';
import type { LicenceAdapter } from '../../platform/types';
import { useToastStore } from '../state/toast-store';
import { LICENCE_SETTINGS_EVENT } from './edition';
import { panelOverlay, useDismissOnEscape } from './panel-overlay';
import { CHECK_UPDATES_EVENT } from './update-status-text';
import { UpdatesPanel } from './UpdatesPanel';
import { useCommercialUpdateStatus } from './use-commercial-update-status';

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
  const { status, busy, check, download, installOnQuit, installAndClose } =
    useCommercialUpdateStatus(client);
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
        busy={busy}
        onDownload={download}
        onInstallOnQuit={installOnQuit}
        onInstallAndClose={installAndClose}
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
