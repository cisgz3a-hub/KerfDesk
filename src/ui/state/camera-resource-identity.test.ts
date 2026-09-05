import { createHmac, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const URL_WITH_QUERY = 'rtsp://operator:password@camera.local/live?channel=1&password=0042#frame';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal('crypto', webcrypto);
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function identityModule() {
  return import('./camera-resource-identity');
}

describe('app-local camera resource identity', () => {
  it('uses platform HMAC and survives a module/app reload with the same local key', async () => {
    const { cameraQueryFingerprint } = await identityModule();
    const first = await cameraQueryFingerprint(URL_WITH_QUERY);
    const keyName = localStorage.key(0);
    expect(keyName).toBe('laserforge.camera.resourceIdentityKey.v1');
    const secret = localStorage.getItem(keyName ?? '') ?? '';
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    const expected = createHmac('sha256', Buffer.from(secret, 'hex'))
      .update(JSON.stringify(['rtsp://camera.local/live', '?channel=1&password=0042']))
      .digest('hex');
    expect(first).toBe(`hmac-sha256:${expected}`);
    vi.resetModules();
    const reloaded = await identityModule();
    expect(await reloaded.cameraQueryFingerprint(URL_WITH_QUERY)).toBe(first);
  });

  it('changes identity in another app or after losing the persisted local key', async () => {
    const original = await identityModule();
    const first = await original.cameraQueryFingerprint(URL_WITH_QUERY);
    localStorage.clear();
    vi.resetModules();
    const otherApp = await identityModule();
    const second = await otherApp.cameraQueryFingerprint(URL_WITH_QUERY);
    expect(first).toMatch(/^hmac-sha256:/);
    expect(second).toMatch(/^hmac-sha256:/);
    expect(second).not.toBe(first);
  });

  it.each(['getItem', 'setItem'] as const)(
    'retains a secure session identity when localStorage %s is denied',
    async (method) => {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException('Storage denied', 'SecurityError');
      });
      const firstSession = await identityModule();
      const first = await firstSession.cameraQueryFingerprint(URL_WITH_QUERY);
      expect(first).toMatch(/^hmac-sha256:/);
      expect(await firstSession.cameraQueryFingerprint(URL_WITH_QUERY)).toBe(first);
      vi.resetModules();
      const nextSession = await identityModule();
      expect(await nextSession.cameraQueryFingerprint(URL_WITH_QUERY)).not.toBe(first);
    },
  );

  it('keeps an existing session key when storage later becomes unavailable', async () => {
    const { cameraQueryFingerprint } = await identityModule();
    const first = await cameraQueryFingerprint(URL_WITH_QUERY);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Storage denied', 'SecurityError');
    });
    expect(await cameraQueryFingerprint(URL_WITH_QUERY)).toBe(first);
  });

  it('returns unknown identity when secure randomness or crypto is unavailable', async () => {
    const { cameraQueryFingerprint } = await identityModule();
    vi.stubGlobal('crypto', { subtle: webcrypto.subtle });
    expect(await cameraQueryFingerprint(URL_WITH_QUERY)).toBeUndefined();
    vi.stubGlobal('crypto', undefined);
    expect(await cameraQueryFingerprint(URL_WITH_QUERY)).toBeUndefined();
    expect(localStorage.length).toBe(0);
  });

  it('identifies a known empty query, ignores userinfo/fragments, and retains channel distinctions', async () => {
    const { cameraQueryFingerprint } = await identityModule();
    const empty = await cameraQueryFingerprint('rtsp://camera.local/live');
    expect(empty).toMatch(/^hmac-sha256:/);
    expect(await cameraQueryFingerprint('rtsp://other:changed@camera.local/live#other')).toBe(
      empty,
    );
    expect(await cameraQueryFingerprint('rtsp://camera.local/live?channel=1')).not.toBe(empty);
    expect(await cameraQueryFingerprint('rtsp://camera.local/live?channel=1')).not.toBe(
      await cameraQueryFingerprint('rtsp://camera.local/live?channel=2'),
    );
  });
});
