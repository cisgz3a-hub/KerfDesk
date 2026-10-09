import { describe, expect, it, vi } from 'vitest';
import { LicenceServiceError } from './licensing-http';
import {
  DEVICE_MESSAGES,
  deviceListKey,
  listLicenceDevices,
  parseLicenceDevices,
  releaseLicenceDevice,
} from './licensing-devices';

const KEY = `KD1.${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}.${'a'.repeat(43)}`;
const listing = {
  activations: [
    { activationId: 'act-1', deviceName: 'Windows computer', createdAt: 1_800_000_000 },
    { activationId: 'act-2', deviceName: ' Old laptop\u0000 ', createdAt: 1_800_000_500 },
  ],
};

describe('the key that manages devices', () => {
  it('prefers a typed key, falls back to the saved one and refuses malformed keys', () => {
    expect(deviceListKey(` ${KEY} `, 'saved-key-1')).toBe(KEY);
    expect(deviceListKey(undefined, KEY)).toBe(KEY);
    expect(deviceListKey('', KEY)).toBe(KEY);
    expect(deviceListKey('short', KEY)).toBeNull();
    expect(deviceListKey(undefined, undefined)).toBeNull();
  });
});

describe('device listing', () => {
  it('accepts only the documented list shape and strips control characters from names', () => {
    expect(parseLicenceDevices(listing)).toEqual([
      { activationId: 'act-1', deviceName: 'Windows computer', createdAt: 1_800_000_000 },
      { activationId: 'act-2', deviceName: 'Old laptop', createdAt: 1_800_000_500 },
    ]);
    for (const bad of [
      null,
      { activations: 'none' },
      { activations: [{ activationId: 'a b', deviceName: 'x', createdAt: 1 }] },
      { activations: [{ activationId: 'a', deviceName: 1, createdAt: 1 }] },
      { activations: [{ activationId: 'a', deviceName: 'x', createdAt: -1 }] },
      { activations: Array.from({ length: 17 }, () => listing.activations[0]) },
    ])
      expect(() => parseLicenceDevices(bad)).toThrow();
  });
  it('sends the key in the body and reports service refusals in the panel’s words', async () => {
    const request = vi.fn(async () => listing);
    expect(await listLicenceDevices(request, KEY)).toEqual({
      devices: parseLicenceDevices(listing),
      message: null,
    });
    expect(request).toHaveBeenCalledWith('/v1/licenses/activations', { licenseKey: KEY });
    const refused = vi.fn(async () => {
      throw new LicenceServiceError('invalid_credentials');
    });
    expect(await listLicenceDevices(refused, KEY)).toMatchObject({
      devices: null,
      message: expect.stringContaining('not accepted'),
    });
    const offline = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await listLicenceDevices(offline, KEY)).toEqual({
      devices: null,
      message: DEVICE_MESSAGES.unavailable,
    });
  });
});

describe('freeing a seat', () => {
  it('deactivates by key, then re-reads the list and confirms', async () => {
    const request = vi.fn(async (path: string) =>
      path === '/v1/licenses/deactivate'
        ? { deactivated: true }
        : { activations: listing.activations.slice(0, 1) },
    );
    expect(await releaseLicenceDevice(request, KEY, 'act-2')).toEqual({
      devices: [listing.activations[0]],
      message: DEVICE_MESSAGES.removed,
    });
    expect(request.mock.calls[0]).toEqual([
      '/v1/licenses/deactivate',
      { licenseKey: KEY, activationId: 'act-2' },
    ]);
  });
  it('explains a release the service refuses and never claims the seat was freed', async () => {
    const request = vi.fn(async () => {
      throw new LicenceServiceError('release_limit_reached');
    });
    const result = await releaseLicenceDevice(request, KEY, 'act-2');
    expect(result.devices).toBeNull();
    expect(result.message).toContain('too often');
    expect(request).toHaveBeenCalledOnce();
    const malformed = vi.fn(async () => ({ deactivated: true }));
    expect(await releaseLicenceDevice(malformed, KEY, 'not valid!')).toEqual({
      devices: null,
      message: DEVICE_MESSAGES.unreadable,
    });
    expect(malformed).not.toHaveBeenCalled();
  });
});
