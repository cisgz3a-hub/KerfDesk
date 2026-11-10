// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as LicensingDevice from './licensing-device';

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
    // v11: a Secret Service key, which Linux requires (licensing-store.ts).
    encryptStringAsync: async (value: string) => Buffer.from(`v11${value}`),
    decryptStringAsync: async (value: Buffer) => ({
      result: value.subarray(3).toString(),
      shouldReEncrypt: false,
    }),
  },
  shell: { openExternal: vi.fn() },
}));
vi.mock('./licensing-device.js', async (importOriginal) => ({
  ...(await importOriginal<typeof LicensingDevice>()),
  licensingDeviceId: () => mocks.readDevice(),
}));

import { FIRST_STATUS_GRACE_MS, createDesktopLicensing } from './desktop-licensing';

const temporary: string[] = [];
afterEach(async () => {
  mocks.quitHandlers.length = 0;
  mocks.readDevice.mockClear();
  for (const path of temporary.splice(0)) {
    if (dirname(path) !== tmpdir()) throw new Error('Unexpected test directory');
    await rm(path, { recursive: true, force: true });
  }
});

/** The renderer's status read, through the licensing route the licence window uses. */
async function readStatusRoute(licence: Awaited<ReturnType<typeof commercialLicensing>>) {
  const fallback = async () => new Response('app route');
  await licence.routes(fallback)(
    new Request('app://app/api/licensing/status', { headers: { 'X-KerfDesk-Licensing': '1' } }),
  );
}

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
  it('starts the quiet confirmation after the first status read, or after the grace', async () => {
    vi.useFakeTimers();
    const setTimer = vi.spyOn(globalThis, 'setInterval').mockImplementation((() => ({
      unref: () => undefined,
    })) as never);
    try {
      const read = await commercialLicensing();
      const readCheck = vi.spyOn(read.runtime, 'refreshInBackground');
      read.start();
      await vi.advanceTimersByTimeAsync(FIRST_STATUS_GRACE_MS - 1);
      expect(readCheck).not.toHaveBeenCalled();
      await readStatusRoute(read);
      await vi.advanceTimersByTimeAsync(0);
      expect(readCheck).toHaveBeenCalledOnce();

      const unread = await commercialLicensing();
      const unreadCheck = vi.spyOn(unread.runtime, 'refreshInBackground');
      unread.start();
      await vi.advanceTimersByTimeAsync(FIRST_STATUS_GRACE_MS - 1);
      expect(unreadCheck).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(unreadCheck).toHaveBeenCalledOnce();
    } finally {
      setTimer.mockRestore();
      vi.useRealTimers();
    }
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
      // The licence window's first read goes ahead of the quiet confirmation (ADR-623).
      await readStatusRoute(licence);
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
