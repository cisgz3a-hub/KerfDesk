import type { LicensingConfig } from './licensing-config.js';
import { LicenceServiceError } from './licensing-http.js';
import { errorMessage } from './licensing-messages.js';
import { validLicenceKey, type LicensingStore } from './licensing-store.js';
import { record } from './licensing-verification.js';

// Help > Licence > Manage devices: the seats a licence key holds, and freeing
// one from here. The service already offers both to the key's owner
// (`/v1/licenses/activations`, `/v1/licenses/deactivate`); without this a lost
// or reinstalled computer kept its seat until support intervened.

export type LicenceDevice = {
  readonly activationId: string;
  readonly deviceName: string;
  /** Unix seconds when that computer activated. */
  readonly createdAt: number;
};
export type LicenceDevices = {
  /** Null when the list could not be read; `message` then says why. */
  readonly devices: readonly LicenceDevice[] | null;
  readonly message: string | null;
};

const ID = /^[A-Za-z0-9_-]{1,160}$/;
export const DEVICE_MESSAGES = {
  unsupported: 'Device management is unavailable in this build.',
  noKey: 'Enter your licence key to see the computers it is active on.',
  removed: 'That computer was removed from the licence. Its seat is free for another device.',
  unreadable:
    'The licence service answered in a form this app does not understand. Please try again later.',
  unavailable: 'Unable to reach the licence service. Check your connection and try again.',
} as const;

export function validActivationId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

/** The key to manage with: the one typed now, or else the one saved with this device's licence. */
export function deviceListKey(typed: string | undefined, saved: string | undefined): string | null {
  const key = typed?.trim();
  if (key !== undefined && key.length > 0) return validLicenceKey(key) ? key : null;
  return validLicenceKey(saved) ? saved : null;
}

export function parseLicenceDevices(value: unknown): readonly LicenceDevice[] {
  if (!record(value) || !Array.isArray(value.activations) || value.activations.length > 16)
    throw new Error('Invalid device list');
  return value.activations.map((item: unknown): LicenceDevice => {
    if (
      !record(item) ||
      !validActivationId(item.activationId) ||
      typeof item.deviceName !== 'string' ||
      typeof item.createdAt !== 'number' ||
      !Number.isSafeInteger(item.createdAt) ||
      item.createdAt < 0
    )
      throw new Error('Invalid device list');
    return {
      activationId: item.activationId,
      deviceName:
        item.deviceName
          .replace(/[\p{Cc}\p{Cf}]/gu, '')
          .trim()
          .slice(0, 80) || 'Device',
      createdAt: item.createdAt,
    };
  });
}

export function deviceFailure(error: unknown): LicenceDevices {
  if (error instanceof LicenceServiceError)
    return { devices: null, message: errorMessage(error.code) ?? DEVICE_MESSAGES.unreadable };
  return { devices: null, message: DEVICE_MESSAGES.unavailable };
}

type Request = (path: string, body: unknown) => Promise<unknown>;

export async function listLicenceDevices(
  request: Request,
  licenseKey: string,
): Promise<LicenceDevices> {
  try {
    const value = await request('/v1/licenses/activations', { licenseKey });
    return { devices: parseLicenceDevices(value), message: null };
  } catch (error) {
    return deviceFailure(error);
  }
}

/**
 * Lists the key's seats, or frees `activationId`, with the typed key or else the
 * saved one. An unreadable store simply means no saved key.
 */
export type DeviceInput = {
  readonly licenseKey?: string | undefined;
  readonly activationId?: string | undefined;
};
const NO_DEVICE_KEY: LicenceDevices = { devices: null, message: DEVICE_MESSAGES.noKey };
export async function manageLicenceDevices(
  config: LicensingConfig,
  store: LicensingStore,
  request: Request,
  input: DeviceInput,
): Promise<LicenceDevices> {
  if (config.channel !== 'commercial')
    return { devices: null, message: DEVICE_MESSAGES.unsupported };
  let saved: string | undefined;
  try {
    saved = (await store.read())?.licenseKey;
  } catch {
    saved = undefined;
  }
  const key = deviceListKey(input.licenseKey, saved);
  if (key === null) return NO_DEVICE_KEY;
  return input.activationId === undefined
    ? listLicenceDevices(request, key)
    : releaseLicenceDevice(request, key, input.activationId);
}

/** Frees one seat with the key, then re-reads the list so the panel shows the result. */
export async function releaseLicenceDevice(
  request: Request,
  licenseKey: string,
  activationId: string,
): Promise<LicenceDevices> {
  if (!validActivationId(activationId))
    return { devices: null, message: DEVICE_MESSAGES.unreadable };
  try {
    const value = await request('/v1/licenses/deactivate', { licenseKey, activationId });
    if (!record(value) || value.deactivated !== true) throw new Error('Invalid deactivation');
  } catch (error) {
    return deviceFailure(error);
  }
  const listed = await listLicenceDevices(request, licenseKey);
  return {
    ...listed,
    message:
      listed.devices === null
        ? `${DEVICE_MESSAGES.removed} The device list could not be refreshed. ${listed.message ?? ''}`.trim()
        : DEVICE_MESSAGES.removed,
  };
}
