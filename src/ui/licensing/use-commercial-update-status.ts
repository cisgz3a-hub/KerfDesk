import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommercialUpdateStatus, LicenceAdapter } from '../../platform/types';
import { useCommercialUpdateStore } from '../state/commercial-update-store';
import { updateStatusSettled } from './update-status-text';

type UpdateAction = (() => Promise<CommercialUpdateStatus>) | undefined;

/** Manual checks can arrive later in the session, so keep reading settled status. */
export function useCommercialUpdateStatus(client: LicenceAdapter) {
  const status = useCommercialUpdateStore((state) => state.status);
  const setStatus = useCommercialUpdateStore((state) => state.setStatus);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const revision = useRef(0);
  useUpdatePolling(client, status, busy, revision);
  const run = useCallback(
    async (action: UpdateAction): Promise<void> => {
      if (action === undefined || pending.current) return;
      pending.current = true;
      revision.current += 1;
      setBusy(true);
      try {
        setStatus(await action());
      } catch {
        setStatus(unreadable(useCommercialUpdateStore.getState().status, 'failed'));
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
    [setStatus],
  );
  const check = useCallback(() => run(client.checkForUpdates), [client, run]);
  const download = useCallback(() => run(client.downloadUpdate), [client, run]);
  const installOnQuit = useCallback(() => run(client.installUpdateOnQuit), [client, run]);
  return { status, busy, check, download, installOnQuit };
}

function useUpdatePolling(
  client: LicenceAdapter,
  status: CommercialUpdateStatus | null,
  busy: boolean,
  revision: React.MutableRefObject<number>,
): void {
  const setStatus = useCommercialUpdateStore((state) => state.setStatus);
  useEffect(() => {
    if (busy || (status !== null && status.mode !== 'manual' && updateStatusSettled(status)))
      return undefined;
    let live = true;
    const current = revision.current;
    const wait =
      status === null ? 0 : ['checking', 'downloading'].includes(status.state) ? 3_000 : 30_000;
    const timer = window.setTimeout(() => {
      client.updateStatus().then(
        (next) => {
          if (live && revision.current === current) setStatus({ ...next });
        },
        () => {
          if (live && revision.current === current) setStatus(unreadable(status));
        },
      );
    }, wait);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [busy, client, revision, setStatus, status]);
}

function unreadable(
  status: CommercialUpdateStatus | null,
  state: 'unavailable' | 'failed' = 'unavailable',
): CommercialUpdateStatus {
  return {
    state,
    currentVersion: status?.currentVersion ?? __APP_VERSION__,
    version: null,
    checkedAt: null,
    ...(status?.mode === 'manual' ? { mode: 'manual', installOnQuit: false } : {}),
  };
}
