import type { UpdateCheckOutcome } from './commercial-update.js';

/**
 * What Help > Check for Updates shows (ADR-547). `unavailable` is a build that
 * does not update itself; `ready` is a verified download. In manual mode it
 * installs after an approved close only when installOnQuit was explicitly
 * armed. `not-covered` is a newer release this licence's updates do not cover.
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
  | 'failed';

export type UpdateStatus = {
  readonly state: UpdateState;
  readonly currentVersion: string;
  /** The newer version being downloaded, ready to install, not covered or not installed. */
  readonly version: string | null;
  /** When the last check finished, in milliseconds since 1970. */
  readonly checkedAt: number | null;
  readonly mode?: 'manual';
  readonly installOnQuit?: boolean;
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
    else if (outcome.kind === 'not-covered') set('not-covered', outcome.version, at);
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
