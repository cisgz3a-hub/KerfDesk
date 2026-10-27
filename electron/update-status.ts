import type { UpdateCheckOutcome } from './commercial-update.js';

/**
 * What Help > Check for Updates shows (ADR-547). `unavailable` is a build that
 * does not update itself; `ready` is a verified download. In manual mode it
 * installs after an approved close only when installOnQuit was explicitly
 * armed. `not-covered` is a newer release this licence's updates do not cover;
 * `licence-unconfirmed` is one they cover that waits for a licence
 * confirmation to succeed (ADR-547 Amendment 1).
 */
export type UpdateState =
  | 'unavailable'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'up-to-date'
  | 'ready'
  | 'not-covered'
  | 'licence-unconfirmed'
  | 'failed';

/**
 * Why a newer, ineligible release is held back (ADR-547 Amendment 1). A failed
 * licence confirmation still blocks the update (ADR-561 item 5), but the saved
 * rights cover the release, so it is unconfirmed, not out of the update period.
 */
export async function heldReleaseState<Envelope>(
  awaitsConfirmation: ((envelope: Envelope, version: string) => Promise<boolean>) | undefined,
  envelope: Envelope,
  version: string,
): Promise<'not-covered' | 'licence-unconfirmed'> {
  return (await awaitsConfirmation?.(envelope, version)) === true
    ? 'licence-unconfirmed'
    : 'not-covered';
}

export type UpdateStatus = {
  readonly state: UpdateState;
  readonly currentVersion: string;
  /** The newer version being downloaded, ready to install, held back or not installed. */
  readonly version: string | null;
  /** When the last check finished, in milliseconds since 1970. */
  readonly checkedAt: number | null;
  readonly mode?: 'manual';
  /**
   * macOS and Linux (ADR-613): the action opens the verified download page in
   * the browser, and the app never downloads or installs the update itself.
   */
  readonly delivery?: 'download-page';
  readonly installOnQuit?: boolean;
  /** Verified, release-bound plain text; absent in older update services. */
  readonly releaseNotes?: readonly string[];
  readonly releaseNotesState?: 'loading' | 'available' | 'unavailable';
  readonly downloadProgress?: UpdateDownloadProgress;
};

export type UpdateDownloadProgress = {
  readonly phase: 'starting' | 'receiving' | 'verifying';
  readonly receivedBytes: number;
  readonly totalBytes: number;
};

export type DesktopUpdates = {
  readonly status: () => UpdateStatus;
  /**
   * Starts a check unless one is running or an update is already waiting to
   * install, and returns the status at once. The renderer asks again for the
   * result, so a long download never holds a request open.
   */
  readonly check: () => UpdateStatus;
  /** Settles when the check running now, if any, ends. */
  readonly settled: () => Promise<void>;
  readonly download?: () => UpdateStatus;
  readonly installOnQuit?: () => Promise<UpdateStatus>;
  /** Retire only the explicit install choice whose close was cancelled. */
  readonly cancelInstallOnQuit?: (armed: UpdateStatus) => void;
};

const BUSY: ReadonlySet<UpdateState> = new Set(['checking', 'downloading', 'ready']);

export function createDesktopUpdates(options: {
  /** False in builds without commercial updates: nothing is ever checked. */
  readonly offered: boolean;
  readonly currentVersion: string;
  readonly run: (onDownloading: (version: string) => void) => Promise<UpdateCheckOutcome>;
  readonly now?: () => number;
}): DesktopUpdates {
  const now = options.now ?? Date.now;
  let status: UpdateStatus = {
    state: options.offered ? 'idle' : 'unavailable',
    currentVersion: options.currentVersion,
    version: null,
    checkedAt: null,
  };
  let running: Promise<void> = Promise.resolve();
  const set = (state: UpdateState, version: string | null, checkedAt = status.checkedAt): void => {
    status = { state, currentVersion: options.currentVersion, version, checkedAt };
  };
  const finish = (outcome: UpdateCheckOutcome): void => {
    const at = now();
    if (outcome.kind === 'up-to-date') set('up-to-date', null, at);
    else if (outcome.kind === 'ready') set('ready', outcome.version, at);
    else if (outcome.kind === 'not-covered' || outcome.kind === 'licence-unconfirmed')
      set(outcome.kind, outcome.version, at);
    else if (outcome.kind === 'not-installed') set('failed', outcome.version, at);
    else set('unavailable', null, at);
  };
  return {
    status: () => status,
    check: () => {
      if (status.state === 'unavailable' || BUSY.has(status.state)) return status;
      set('checking', null);
      running = options
        .run((version) => set('downloading', version))
        .then(finish, () => set('failed', status.version, now()));
      return status;
    },
    settled: () => running,
  };
}
