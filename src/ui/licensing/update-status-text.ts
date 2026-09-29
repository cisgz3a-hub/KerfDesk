import type { CommercialUpdateStatus } from '../../platform/types';

/** Help > Check for Updates and the status bar's Update ready button (ADR-547). */
export const CHECK_UPDATES_EVENT = 'kerfdesk:check-updates';

/** A status that will not change until the owner checks again. */
export function updateStatusSettled(status: CommercialUpdateStatus): boolean {
  return !['idle', 'checking', 'downloading'].includes(status.state);
}

/** Whether Check now can start a check. */
export function updateCheckAllowed(status: CommercialUpdateStatus | null): boolean {
  return status !== null && ['idle', 'up-to-date', 'not-covered', 'failed'].includes(status.state);
}

type Describe = (
  status: CommercialUpdateStatus,
  updatesUntil: number | null,
  formatTime: (milliseconds: number) => string,
) => string;

const version = (status: CommercialUpdateStatus): string => status.version ?? 'a newer version';

const DESCRIBE: Record<CommercialUpdateStatus['state'], Describe> = {
  unavailable: () =>
    "This copy of KerfDesk doesn't update itself. Get new versions from kerfdesk.com.",
  idle: () => "KerfDesk hasn't checked for updates since it opened.",
  checking: () => 'Checking for updates...',
  downloading: (status) => `Downloading KerfDesk ${version(status)}...`,
  'up-to-date': (status, _until, formatTime) =>
    `KerfDesk is up to date.${checked(status, formatTime)}`,
  ready: (status) => `KerfDesk ${version(status)} is ready. It installs when you close KerfDesk.`,
  'not-covered': (status, updatesUntil) =>
    `KerfDesk ${version(status)} is out, but ${coverage(updatesUntil)} The version you have keeps working.`,
  failed: (status) =>
    status.version === null
      ? "KerfDesk couldn't check for updates. Check the internet connection, then try again."
      : `KerfDesk ${status.version} couldn't be prepared. KerfDesk tries again next time it opens.`,
};

/**
 * One plain sentence for where updates stand. `updatesUntil` is the licence's
 * end of updates, in seconds, when the licence has one.
 */
export function updateStatusText(
  status: CommercialUpdateStatus | null,
  updatesUntil: number | null,
  formatTime: (milliseconds: number) => string = defaultTime,
): string {
  if (status === null) return 'Reading the update status...';
  return DESCRIBE[status.state](status, updatesUntil, formatTime);
}

function checked(
  status: CommercialUpdateStatus,
  formatTime: (milliseconds: number) => string,
): string {
  return status.checkedAt === null ? '' : ` Checked at ${formatTime(status.checkedAt)}.`;
}

function coverage(updatesUntil: number | null): string {
  return updatesUntil === null
    ? "your licence's updates don't cover it."
    : `your licence's updates ended on ${new Date(updatesUntil * 1000).toLocaleDateString()}.`;
}

function defaultTime(milliseconds: number): string {
  return new Date(milliseconds).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
