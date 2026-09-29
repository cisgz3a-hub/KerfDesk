// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  quitHandlers: [] as Array<() => void>,
  readDevice: vi.fn(async () => 'd'.repeat(43)),
}));
vi.mock('electron', () => ({
  app: {
    once: (event: string, handler: () => void) => {
      if (event === 'will-quit') mocks.quitHandlers.push(handler);
    },
  },
  net: { fetch: vi.fn() },
  Notification: { isSupported: () => false },
  // Deliberately fake the OS boundary; this is not a claim about native crypto.
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptStringAsync: async (value: string) => Buffer.from(value),
    decryptStringAsync: async (value: Buffer) => ({
      result: value.toString(),
      shouldReEncrypt: false,
    }),
  },
  shell: { openExternal: vi.fn() },
}));
vi.mock('./licensing-device.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./licensing-device')>()),
  licensingDeviceId: () => mocks.readDevice(),
}));

import { createDesktopLicensing } from './desktop-licensing';

const temporary: string[] = [];
afterEach(async () => {
  mocks.quitHandlers.length = 0;
  mocks.readDevice.mockClear();
  for (const path of temporary.splice(0)) {
    if (dirname(path) !== tmpdir()) throw new Error('Unexpected test directory');
    await rm(path, { recursive: true, force: true });
  }
});

async function commercialLicensing() {
  const folder = await mkdtemp(join(tmpdir(), 'kerfdesk-desktop-licensing-test-'));
  temporary.push(folder);
  const keys = { test: 'A'.repeat(44) };
  await writeFile(
    join(folder, 'package.json'),
    JSON.stringify({
      kerfdeskCommercialLicense: {
        schema: 1,
        apiOrigin: 'https://licensing.example',
        entitlementKeys: keys,
        releaseKeys: keys,
      },
    }),
  );
  return createDesktopLicensing({
    appPath: folder,
    userDataPath: folder,
    version: '1.0.0',
    packaged: false,
    trustedUpdates: false,
    updater: { autoInstallOnAppQuit: false } as never,
  });
}

describe('desktop licensing wiring (ADR-523 Amendment 2)', () => {
  it('reads the device identity once for every licence read and action', async () => {
    const licence = await commercialLicensing();
    expect(licence.config.channel).toBe('commercial');
    await licence.runtime.status();
    await licence.runtime.status();
    await licence.runtime.refresh();
    await licence.runtime.isReleaseEligible(null, '1.0.1');
    expect(mocks.readDevice).toHaveBeenCalledOnce();
  });
  it('repeats the quiet check every 30 minutes without holding the app open, and stops at quit', async () => {
    const licence = await commercialLicensing();
    const handle = { unref: vi.fn() };
    let tick: () => void = () => undefined;
    const setTimer = vi.spyOn(globalThis, 'setInterval').mockImplementation(((run: () => void) => {
      tick = run;
      return handle;
    }) as never);
    const clearTimer = vi.spyOn(globalThis, 'clearInterval').mockImplementation(() => undefined);
    const check = vi.spyOn(licence.runtime, 'refreshInBackground');
    try {
      licence.start();
      expect(setTimer).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 30 * 60_000);
      expect(handle.unref).toHaveBeenCalledOnce();
      await vi.waitFor(() => expect(check).toHaveBeenCalledOnce());
      tick();
      await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(2));
      licence.start();
      expect(setTimer).toHaveBeenCalledOnce();
      expect(mocks.quitHandlers).toHaveLength(1);
      mocks.quitHandlers[0]?.();
      expect(clearTimer).toHaveBeenCalledExactlyOnceWith(handle);
    } finally {
      setTimer.mockRestore();
      clearTimer.mockRestore();
    }
  });
});
