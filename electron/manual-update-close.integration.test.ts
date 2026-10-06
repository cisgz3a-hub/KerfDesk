// @vitest-environment node
import { EventEmitter } from 'node:events';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createManualUpdates } from './manual-update';
import { createDesktopUpdateClose } from './desktop-update-close';
import { installManualUpdateQuit } from './manual-update-quit';
import { withLicensingRoutes } from './licensing-routes';
import type { LicensingRuntime } from './licensing-runtime';

vi.mock('electron', () => ({ dialog: { showMessageBoxSync: vi.fn(() => 2) } }));

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) {
    if (dirname(folder) !== tmpdir()) throw new Error('Unexpected test directory');
    await rm(folder, { recursive: true, force: true });
  }
});

async function harness() {
  const key = generateKeyPairSync('ed25519');
  const keys = { test: key.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
  const bytes = Buffer.from('nonexecutable synthetic installer fixture');
  const payload = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      product: 'kerfdesk-desktop',
      kind: 'manual-download',
      channel: 'stable',
      version: '1.0.1',
      sourceSha: 'a'.repeat(40),
      sourceRef: 'refs/heads/main',
      publishedAt: '2026-10-01T00:00:00.000Z',
      codeSigning: 'unsigned',
      updates: 'manual',
      artifacts: [
        {
          name: 'KerfDesk-1.0.1-windows-x64-setup.exe',
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      ],
    }),
  );
  const envelope = JSON.stringify({
    schemaVersion: 1,
    algorithm: 'Ed25519',
    keyId: 'test',
    payload: payload.toString('base64'),
    signature: sign(null, payload, key.privateKey).toString('base64'),
  });
  const folder = await mkdtemp(join(tmpdir(), 'kerfdesk-update-close-regression-'));
  folders.push(folder);
  const updates = createManualUpdates({
    currentVersion: '1.0.0',
    currentPublishedAt: Date.parse('2026-09-30T00:00:00Z'),
    userDataPath: folder,
    keys,
    now: () => Date.parse('2026-10-06T00:00:00Z'),
    eligible: async () => true,
    fetch: async (url) =>
      url.endsWith('latest.json')
        ? new Response(envelope)
        : url.endsWith('release-notes.json')
          ? new Response(null, { status: 404 })
          : new Response(bytes),
  });
  updates.check();
  await updates.settled();
  updates.download?.();
  await updates.settled();
  expect(updates.status()).toMatchObject({ state: 'ready', installOnQuit: false });

  let quitting = false;
  let closed = false;
  let prepareUpdate = async (): Promise<unknown> => ({ status: 'cancelled' });
  const target = Object.assign(new EventEmitter(), {
    webContents: Object.assign(new EventEmitter(), {
      getURL: () => 'app://app/index.html',
      executeJavaScript: vi.fn(async (script: string) => {
        if (script.includes('"operation":"prepare-update"')) return prepareUpdate();
        if (script.includes('"operation":"prepare"')) return { status: 'ready', dirty: false };
        return { status: script.includes('"operation":"approve"') ? 'approved' : 'cancelled' };
      }),
    }),
    isDestroyed: () => closed,
    destroy: vi.fn(),
    close: () => {
      const event = { preventDefault: vi.fn() };
      target.emit('close', event);
      if (event.preventDefault.mock.calls.length === 0) {
        closed = true;
        target.emit('closed');
        if (!quitting) app.quit();
      }
    },
  });
  const app = Object.assign(new EventEmitter(), {
    relaunch: vi.fn(),
    quit: vi.fn(() => {
      quitting = true;
      if (!closed) target.close();
      if (closed) app.emit('will-quit', { preventDefault: vi.fn() });
    }),
  });
  const owner = createDesktopUpdateClose(app, () =>
    closed ? [] : [target as unknown as BrowserWindow],
  );
  const cancelQuit = vi.fn(() => {
    quitting = false;
  });
  owner.install(target as unknown as BrowserWindow, {
    isTrustedRenderer: () => true,
    isQuitRequested: () => quitting,
    cancelQuit,
    quit: app.quit,
  });
  installManualUpdateQuit(app, updates, { canInstall: owner.canInstall });
  const route = withLicensingRoutes(
    async () => new Response(null, { status: 404 }),
    {} as LicensingRuntime,
    undefined,
    updates,
    owner.request,
  );
  const request = (action = 'install-update-and-close') =>
    route(
      new Request(`app://app/api/licensing/${action}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'app://app',
          'X-KerfDesk-Licensing': '1',
        },
        body: '{}',
      }),
    );
  return {
    updates,
    target,
    app,
    folder,
    cancelQuit,
    request,
    closed: () => closed,
    setPreparation: (next: typeof prepareUpdate) => {
      prepareUpdate = next;
    },
  };
}

describe('manual update consent through the whole guarded close flow', () => {
  it.each(['cancelled', 'unavailable', 'unsaved-cancel'])(
    'retains the app on %s and never installs on a later ordinary close',
    async (reason) => {
      const h = await harness();
      h.setPreparation(async () =>
        reason === 'unsaved-cancel' ? { status: 'ready', dirty: true } : { status: reason },
      );
      await h.request();
      await vi.waitFor(() => expect(h.cancelQuit).toHaveBeenCalledOnce());
      expect(h.closed()).toBe(false);
      expect(h.updates.status()).toMatchObject({ state: 'ready', installOnQuit: false });
      h.target.close();
      await vi.waitFor(() => expect(h.closed()).toBe(true));
      expect(h.app.relaunch).not.toHaveBeenCalled();
    },
  );
  it('allows a fresh explicit install-and-close choice after a cancelled attempt', async () => {
    const h = await harness();
    await h.request();
    await vi.waitFor(() => expect(h.cancelQuit).toHaveBeenCalledOnce());
    h.setPreparation(async () => ({ status: 'ready', dirty: false }));
    await h.request();
    await vi.waitFor(() => expect(h.app.relaunch).toHaveBeenCalledOnce());
    expect(h.app.relaunch.mock.calls[0]?.[0]).toEqual({
      execPath: expect.stringContaining(h.folder),
      args: [],
    });
  });
  it('preserves an explicit deferred install through an ordinary approved close', async () => {
    const h = await harness();
    await h.request('install-update-on-quit');
    expect(h.app.quit).not.toHaveBeenCalled();
    expect(h.updates.status().installOnQuit).toBe(true);
    h.target.close();
    await vi.waitFor(() => expect(h.app.relaunch).toHaveBeenCalledOnce());
  });
  it('does not retire a newer deferred choice when an older update close is cancelled', async () => {
    const h = await harness();
    let cancel: (reply: unknown) => void = () => undefined;
    h.setPreparation(
      () =>
        new Promise((resolve) => {
          cancel = resolve;
        }),
    );
    await h.request();
    await vi.waitFor(() => expect(h.target.webContents.executeJavaScript).toHaveBeenCalledOnce());
    await h.request('install-update-on-quit');
    cancel({ status: 'cancelled' });
    await vi.waitFor(() => expect(h.cancelQuit).toHaveBeenCalledOnce());
    expect(h.updates.status().installOnQuit).toBe(true);
    h.target.close();
    await vi.waitFor(() => expect(h.app.relaunch).toHaveBeenCalledOnce());
  });
});
