import type { DesktopLicenceAdapter, DesktopLicenceStatus } from '../types';

type FetchLicence = (input: string, init: RequestInit) => Promise<Response>;
const STATES: ReadonlyArray<DesktopLicenceStatus['state']> = [
  'ready',
  'activation-required',
  'trial-expired',
  'updates-expired',
  'invalid-licence',
  'unavailable',
  'clock-error',
];

function parseStatus(value: unknown): DesktopLicenceStatus {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid licence response.');
  const status = value as DesktopLicenceStatus;
  if (
    !['free', 'commercial'].includes(status.channel) ||
    !STATES.includes(status.state) ||
    ![
      status.sessionAuthorized,
      status.perpetualUpdates,
      status.deactivationPending,
      status.paymentPending,
    ].every((flag) => typeof flag === 'boolean') ||
    !validRights(status) ||
    (status.message !== null && typeof status.message !== 'string')
  )
    throw new Error('Invalid licence response.');
  return status;
}

function validRights(status: DesktopLicenceStatus): boolean {
  return (
    (status.tier === null || ['trial', 'paid', 'developer'].includes(status.tier)) &&
    [status.accessExpiresAt, status.updatesUntil].every(
      (time) => time === null || Number.isSafeInteger(time),
    )
  );
}

export function createDesktopLicenceAdapter(
  fetchLicence: FetchLicence = (input, init) => fetch(input, init),
): DesktopLicenceAdapter {
  const request = async (action: string, body?: unknown): Promise<DesktopLicenceStatus> => {
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
    return parseStatus(await response.json());
  };
  return {
    status: () => request('status'),
    activate: (licenseKey) => request('activate', { licenseKey }),
    startTrial: () => request('trial', {}),
    refresh: () => request('refresh', {}),
    deactivate: () => request('deactivate', {}),
    launch: () => request('launch', {}),
    checkout: (operation, licenseKey) =>
      request('checkout', { operation, ...(licenseKey === undefined ? {} : { licenseKey }) }),
    claimPayment: () => request('claim-payment', {}),
  };
}
