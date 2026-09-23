// Recovery slots are shared by every KerfDesk window of one origin, but each
// window keeps its own snapshot. A window whose recovery card another window
// had already claimed, started or discarded kept showing it until reload; its
// attempt was refused safely, but the card was stale (ADR-341 Amendment 3).
// Committed slot changes are announced on a BroadcastChannel and every other
// window refreshes. Progress writes are not announced.

export const RECOVERY_WINDOW_CHANNEL = 'kerfdesk-recovery-slots-v1';

export type RecoveryWindowChannel = {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent) => void) | null;
  close(): void;
};

export type RecoveryWindowLink = {
  /** Tell the other windows that this window changed the recovery slots. */
  readonly announce: () => void;
  readonly close: () => void;
};

export function openRecoveryWindowChannel(): RecoveryWindowChannel | null {
  // Vitest shares one Node BroadcastChannel namespace across its worker
  // threads, and an open channel keeps a Node process alive: unit tests of
  // the default repository run unlinked. Browser and Electron windows link.
  if (import.meta.env.MODE === 'test') return null;
  try {
    return typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(RECOVERY_WINDOW_CHANNEL);
  } catch {
    return null;
  }
}

/** Refresh `repository` whenever another window announces a change; bursts of
 * announcements coalesce into one refresh at a time plus one trailing pass. */
export function linkRecoveryWindows(
  repository: { refresh(): Promise<unknown> },
  channel: RecoveryWindowChannel | null,
): RecoveryWindowLink {
  if (channel === null) return { announce: () => undefined, close: () => undefined };
  let refreshing = false;
  let again = false;
  const refresh = async (): Promise<void> => {
    if (refreshing) {
      again = true;
      return;
    }
    refreshing = true;
    try {
      do {
        again = false;
        await repository.refresh().catch(() => undefined);
      } while (again);
    } finally {
      refreshing = false;
    }
  };
  channel.onmessage = () => void refresh();
  return {
    announce: () => {
      try {
        channel.postMessage('slots-changed');
      } catch {
        // A closed channel only loses the courtesy refresh in other windows.
      }
    },
    close: () => channel.close(),
  };
}
