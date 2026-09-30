import type { CommercialUpdateStatus, EarlyUpdates, LicenceAdapter, LicenceStatus } from '../types';

type FetchLicence = (input: string, init: RequestInit) => Promise<Response>;
const STATES: ReadonlyArray<LicenceStatus['state']> = [
  'ready',
  'activation-required',
  'trial-expired',
  'updates-expired',
  'invalid-licence',
  'unavailable',
  'clock-error',
];

function nullableText(value: unknown, max: number): boolean {
  return value === null || (typeof value === 'string' && value.length <= max);
}

export function parseLicenceStatus(value: unknown): LicenceStatus {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid licence response.');
  const status = value as LicenceStatus;
  if (
    !['free', 'commercial'].includes(status.channel) ||
    !['pro', 'free'].includes(status.edition) ||
    !STATES.includes(status.state) ||
    ![
      status.perpetualUpdates,
      status.deactivationPending,
      status.paymentPending,
      status.storeUnreadable,
    ].every((flag) => typeof flag === 'boolean') ||
    !validRights(status) ||
    !nullableText(status.licenseKey, 256) ||
    !nullableText(status.paymentOrderId, 160) ||
    !nullableText(status.message, 1000)
  )
    throw new Error('Invalid licence response.');
  return status;
}

function validRights(status: LicenceStatus): boolean {
  return (
    (status.tier === null || ['trial', 'paid', 'developer'].includes(status.tier)) &&
    [status.accessExpiresAt, status.updatesUntil].every(
      (time) => time === null || Number.isSafeInteger(time),
    )
  );
}

export function parseEarlyUpdates(value: unknown): EarlyUpdates {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid update setting.');
  const setting = value as EarlyUpdates;
  if (
    typeof setting.available !== 'boolean' ||
    typeof setting.enabled !== 'boolean' ||
    (!setting.available && setting.enabled)
  )
    throw new Error('Invalid update setting.');
  return { available: setting.available, enabled: setting.enabled };
}
const UPDATE_STATES: ReadonlyArray<CommercialUpdateStatus['state']> = [
  'unavailable',
  'idle',
  'checking',
  'available',
  'downloading',
  'up-to-date',
  'ready',
  'not-covered',
  'failed',
];
const RELEASE_VERSION = /^\d{1,16}\.\d{1,16}\.\d{1,16}$/;

/** The main process's answer to Help > Check for Updates (ADR-547). */
export function parseCommercialUpdateStatus(value: unknown): CommercialUpdateStatus {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid update status.');
  const status = value as CommercialUpdateStatus;
  if (!validUpdateFields(status) || !validManualUpdateStatus(status))
    throw new Error('Invalid update status.');
  const { state, currentVersion, version, checkedAt } = status;
  return {
    state,
    currentVersion,
    version,
    checkedAt,
    ...(status.mode === undefined ? {} : { mode: status.mode }),
    ...(status.installOnQuit === undefined ? {} : { installOnQuit: status.installOnQuit }),
  };
}

function validUpdateFields(status: CommercialUpdateStatus): boolean {
  return !(
    !UPDATE_STATES.includes(status.state) ||
    typeof status.currentVersion !== 'string' ||
    status.currentVersion.length > 100 ||
    !(
      status.version === null ||
      (typeof status.version === 'string' && RELEASE_VERSION.test(status.version))
    ) ||
    !(status.checkedAt === null || Number.isSafeInteger(status.checkedAt))
  );
}

function validManualUpdateStatus(status: CommercialUpdateStatus): boolean {
  if (status.mode === undefined)
    return status.installOnQuit === undefined && status.state !== 'available';
  if (status.mode !== 'manual') return false;
  if (![undefined, false, true].includes(status.installOnQuit)) return false;
  if (status.installOnQuit === true && status.state !== 'ready') return false;
  return !['available', 'ready'].includes(status.state) || status.version !== null;
}

export function createDesktopLicenceAdapter(
  fetchLicence: FetchLicence = (input, init) => fetch(input, init),
): LicenceAdapter {
  const send = async (action: string, body?: unknown): Promise<unknown> => {
    const response = await fetchLicence(`./api/licensing/${action}`, {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        'X-KerfDesk-Licensing': '1',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error('The desktop licence service is unavailable. Please restart KerfDesk.');
    return response.json() as Promise<unknown>;
  };
  const request = async (action: string, body?: unknown): Promise<LicenceStatus> =>
    parseLicenceStatus(await send(action, body));
  return {
    status: () => request('status'),
    activate: (licenseKey) => request('activate', { licenseKey }),
    startTrial: () => request('trial', {}),
    refresh: () => request('refresh', {}),
    deactivate: () => request('deactivate', {}),
    resetStore: () => request('reset', {}),
    checkout: (operation, licenseKey) =>
      request('checkout', { operation, ...(licenseKey === undefined ? {} : { licenseKey }) }),
    claimPayment: () => request('claim-payment', {}),
    discardPayment: () => request('discard-payment', {}),
    earlyUpdates: async () => parseEarlyUpdates(await send('early-updates')),
    setEarlyUpdates: async (enabled) => parseEarlyUpdates(await send('early-updates', { enabled })),
    updateStatus: async () => parseCommercialUpdateStatus(await send('update-status')),
    checkForUpdates: async () => parseCommercialUpdateStatus(await send('check-updates', {})),
    downloadUpdate: async () => parseCommercialUpdateStatus(await send('download-update', {})),
    installUpdateOnQuit: async () =>
      parseCommercialUpdateStatus(await send('install-update-on-quit', {})),
  };
}
