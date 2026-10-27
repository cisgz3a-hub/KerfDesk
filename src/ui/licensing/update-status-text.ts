import type { CommercialUpdateStatus } from '../../platform/types';

/** Help > Check for Updates and the status bar's Update ready button (ADR-547). */
export const CHECK_UPDATES_EVENT = 'kerfdesk:check-updates';

/** No check or download is pending. Manual builds still poll for later checks. */
export function updateStatusSettled(status: CommercialUpdateStatus): boolean {
  return !['idle', 'checking', 'downloading'].includes(status.state);
}

/** Whether Check now can start a check. */
export function updateCheckAllowed(status: CommercialUpdateStatus | null): boolean {
  return (
    status !== null &&
    ['idle', 'up-to-date', 'not-covered', 'licence-unconfirmed', 'failed'].includes(status.state)
  );
}

type Describe = (
  status: CommercialUpdateStatus,
  updatesUntil: number | null,
  formatTime: (milliseconds: number) => string,
  now: number,
) => string;

const version = (status: CommercialUpdateStatus): string => status.version ?? 'a newer version';

const DESCRIBE: Record<CommercialUpdateStatus['state'], Describe> = {
  unavailable: (status) =>
    status.mode === 'manual'
      ? 'The update status is unavailable. You can check for new versions at kerfdesk.com.'
      : "This copy of KerfDesk doesn't update itself. Get new versions from kerfdesk.com.",
  idle: () => "KerfDesk hasn't checked for updates since it opened.",
  checking: () => 'Checking for updates...',
  available: (status) =>
    status.delivery === 'download-page'
      ? `KerfDesk ${version(status)} is available. Open its download page to get it, then install it after you close KerfDesk.`
      : `KerfDesk ${version(status)} is available. Download it when you are ready.`,
  downloading: downloadText,
  'up-to-date': (status, _until, formatTime) =>
    `KerfDesk is up to date.${checked(status, formatTime)}`,
  ready: readyText,
  'not-covered': (status, updatesUntil, _formatTime, now) =>
    `KerfDesk ${version(status)} is out, but ${coverage(updatesUntil, now)} The version you have keeps working.`,
  // The licence covers the version, but its last confirmation failed, so the
  // update waits (ADR-561 item 5). Its updates have not ended (ADR-547 Amd 1).
  'licence-unconfirmed': (status) =>
    `KerfDesk ${version(status)} is out and your licence covers it, but KerfDesk couldn't confirm your licence just now, so the update waits until it does. Check your connection, then open Help > Licence, choose Refresh licence and try Check now again. The version you have keeps working.`,
  failed: (status) =>
    status.delivery === 'download-page'
      ? "KerfDesk couldn't check for updates or open the download page. Check your connection and try Check now again. Your current version keeps working."
      : status.mode === 'manual'
        ? 'The update could not be prepared. Check your connection and try Check now again. Your current version keeps working.'
        : status.version === null
          ? "KerfDesk couldn't check for updates. Check the internet connection, then try again."
          : `KerfDesk ${status.version} couldn't be prepared. KerfDesk tries again next time it opens.`,
};

function downloadText(status: CommercialUpdateStatus): string {
  const progress = status.downloadProgress;
  if (progress?.phase === 'starting') return `Preparing to download KerfDesk ${version(status)}...`;
  if (progress?.phase === 'verifying')
    return `Verifying download for KerfDesk ${version(status)}...`;
  const prefix = `Downloading KerfDesk ${version(status)}...`;
  if (progress === undefined) return prefix;
  const percent = Math.floor((progress.receivedBytes / progress.totalBytes) * 100);
  const received = (progress.receivedBytes / 1_000_000).toFixed(1);
  const total = (progress.totalBytes / 1_000_000).toFixed(1);
  return `${prefix} ${percent}% (${received} of ${total} MB).`;
}

function readyText(status: CommercialUpdateStatus): string {
  const start = `KerfDesk ${version(status)} is ready.`;
  if (status.mode !== 'manual') return `${start} It installs when you close KerfDesk.`;
  return status.installOnQuit === true
    ? `${start} The installer will open after you close KerfDesk normally. Save your work and finish any running job first.`
    : `${start} Choose Install when I close KerfDesk to open the installer after a normal close.`;
}

/**
 * One plain sentence for where updates stand. `updatesUntil` is the licence's
 * end of updates, in seconds, when the licence has one.
 */
export function updateStatusText(
  status: CommercialUpdateStatus | null,
  updatesUntil: number | null,
  formatTime: (milliseconds: number) => string = defaultTime,
  now: number = Date.now(),
): string {
  if (status === null) return 'Reading the update status...';
  return DESCRIBE[status.state](status, updatesUntil, formatTime, now);
}

function checked(
  status: CommercialUpdateStatus,
  formatTime: (milliseconds: number) => string,
): string {
  return status.checkedAt === null ? '' : ` Checked at ${formatTime(status.checkedAt)}.`;
}

/** Names the date updates ended only once it has passed (ADR-547 Amendment 1). */
function coverage(updatesUntil: number | null, now: number): string {
  return updatesUntil === null || updatesUntil * 1000 > now
    ? "your licence's updates don't cover it."
    : `your licence's updates ended on ${new Date(updatesUntil * 1000).toLocaleDateString()}.`;
}

function defaultTime(milliseconds: number): string {
  return new Date(milliseconds).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
