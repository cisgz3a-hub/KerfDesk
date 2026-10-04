import { useCallback, useEffect, useRef, useState } from 'react';
import type { CommercialUpdateStatus, LicenceAdapter } from '../../platform/types';
import { useCommercialUpdateStore } from '../state/commercial-update-store';
import { updateStatusSettled } from './update-status-text';

type UpdateAction = (() => Promise<CommercialUpdateStatus>) | undefined;
type ActionKind = 'check' | 'download' | 'install';
const ACTION_FEEDBACK: Record<ActionKind, string> = {
  check: 'Checking for updates...',
  download: 'Starting the download...',
  install: 'Verifying the downloaded update...',
};

/** Manual checks can arrive later in the session, so keep reading settled status. */
export function useCommercialUpdateStatus(client: LicenceAdapter) {
  const status = useCommercialUpdateStore((state) => state.status);
  const setStatus = useCommercialUpdateStore((state) => state.setStatus);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const pending = useRef(false);
  const revision = useRef(0);
  useUpdatePolling(client, status, busy, revision, unconfirmed, setFeedback, setUnconfirmed);
  const run = useCallback(
    async (action: UpdateAction, kind: ActionKind): Promise<void> => {
      if (action === undefined || pending.current) return;
      pending.current = true;
      revision.current += 1;
      setBusy(true);
      setFeedback(ACTION_FEEDBACK[kind]);
      try {
        const next = await action();
        setStatus(next);
        setUnconfirmed(false);
        setFeedback(
          kind === 'download' && next.state === 'available'
            ? 'The download has not started. Try Download update again.'
            : null,
        );
      } catch {
        setStatus(unreadable(useCommercialUpdateStore.getState().status));
        setUnconfirmed(kind !== 'install');
        setFeedback(
          kind === 'download'
            ? 'The download request could not be confirmed. KerfDesk may still be downloading. Check now to read its current status before retrying.'
            : kind === 'check'
              ? 'The update service did not answer. Check your connection and try Check now again.'
              : null,
        );
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
    [setStatus],
  );
  const check = useCallback(() => run(client.checkForUpdates, 'check'), [client, run]);
  const download = useCallback(() => run(client.downloadUpdate, 'download'), [client, run]);
  const installOnQuit = useCallback(
    () => run(client.installUpdateOnQuit, 'install'),
    [client, run],
  );
  const installAndClose = useCallback(
    () => run(client.installUpdateAndClose, 'install'),
    [client, run],
  );
  return { status, busy, feedback, check, download, installOnQuit, installAndClose };
}

function useUpdatePolling(
  client: LicenceAdapter,
  status: CommercialUpdateStatus | null,
  busy: boolean,
  revision: React.MutableRefObject<number>,
  unconfirmed: boolean,
  setFeedback: React.Dispatch<React.SetStateAction<string | null>>,
  setUnconfirmed: React.Dispatch<React.SetStateAction<boolean>>,
): void {
  const setStatus = useCommercialUpdateStore((state) => state.setStatus);
  useEffect(() => {
    if (busy || (status !== null && status.mode !== 'manual' && updateStatusSettled(status)))
      return undefined;
    let live = true;
    const current = revision.current;
    const wait =
      status === null
        ? 0
        : unconfirmed || ['checking', 'downloading'].includes(status.state)
          ? 3_000
          : 30_000;
    const timer = window.setTimeout(() => {
      client.updateStatus().then(
        (next) => {
          if (live && revision.current === current) {
            setStatus({ ...next });
            setFeedback(null);
            setUnconfirmed(false);
          }
        },
        () => {
          if (live && revision.current === current) {
            setStatus(unreadable(status));
            setUnconfirmed(true);
            setFeedback(
              'The update status could not be read. KerfDesk may still be downloading. Check your connection and try Check now again.',
            );
          }
        },
      );
    }, wait);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [busy, client, revision, setStatus, status, unconfirmed, setFeedback, setUnconfirmed]);
}

function unreadable(status: CommercialUpdateStatus | null): CommercialUpdateStatus {
  return {
    state: 'failed',
    currentVersion: status?.currentVersion ?? __APP_VERSION__,
    version: null,
    checkedAt: null,
    ...(status?.mode === 'manual' ? { mode: 'manual', installOnQuit: false } : {}),
  };
}
