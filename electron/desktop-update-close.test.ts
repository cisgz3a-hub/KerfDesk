import { EventEmitter } from 'node:events';
import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { createDesktopUpdateClose } from './desktop-update-close';

vi.mock('electron', () => ({ dialog: { showMessageBoxSync: vi.fn(() => 0) } }));

function harness() {
  let quitting = false;
  const webContents = Object.assign(new EventEmitter(), {
    getURL: () => 'app://app/index.html',
    executeJavaScript: vi.fn(
      async (script: string): Promise<unknown> =>
        script.includes('"operation":"prepare')
          ? { status: 'ready', dirty: false }
          : { status: script.includes('"operation":"approve"') ? 'approved' : 'cancelled' },
    ),
  });
  const allowed = vi.fn();
  const target = Object.assign(new EventEmitter(), {
    webContents,
    isDestroyed: () => false,
    destroy: vi.fn(),
    close: vi.fn(() => {
      const event = { preventDefault: vi.fn() };
      target.emit('close', event);
      if (event.preventDefault.mock.calls.length === 0) {
        allowed();
        target.emit('closed');
      }
    }),
  });
  const window = target as unknown as BrowserWindow;
  const app = {
    quit: vi.fn(() => {
      quitting = true;
      target.close();
    }),
  };
  const owner = createDesktopUpdateClose(app, () => [window]);
  const cancelQuit = vi.fn(() => {
    quitting = false;
  });
  const cancelInstall = vi.fn();
  owner.install(window, {
    isTrustedRenderer: () => true,
    isQuitRequested: () => quitting,
    cancelQuit,
    quit: app.quit,
  });
  return { owner, target, webContents, app, allowed, cancelQuit, cancelInstall };
}

describe('explicit desktop update close ownership', () => {
  it('requests a guarded update close and grants installation only after approved closure', async () => {
    const h = harness();
    expect(h.owner.canInstall()).toBe(false);
    h.owner.request(h.cancelInstall);
    await vi.waitFor(() => expect(h.allowed).toHaveBeenCalledOnce());
    expect(h.webContents.executeJavaScript.mock.calls[0]?.[0]).toContain(
      '"operation":"prepare-update"',
    );
    expect(h.owner.canInstall()).toBe(true);
    expect(h.cancelInstall).not.toHaveBeenCalled();
  });
  it('does not convert an already owned ordinary close into an update close or reissue quit', async () => {
    const h = harness();
    let finish: (value: unknown) => void = () => undefined;
    h.webContents.executeJavaScript.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    h.target.close();
    h.owner.request(h.cancelInstall);
    expect(h.app.quit).not.toHaveBeenCalled();
    expect(h.cancelInstall).toHaveBeenCalledOnce();
    expect(h.webContents.executeJavaScript).toHaveBeenCalledOnce();
    expect(h.webContents.executeJavaScript.mock.calls[0]?.[0]).toContain('"operation":"prepare"');
    finish({ status: 'cancelled' });
    await vi.waitFor(() => expect(h.cancelQuit).toHaveBeenCalledOnce());
    h.webContents.executeJavaScript.mockClear();
    h.target.close();
    await vi.waitFor(() => expect(h.allowed).toHaveBeenCalledOnce());
    expect(h.webContents.executeJavaScript.mock.calls[0]?.[0]).toContain('"operation":"prepare"');
  });
  it('clears a rejected update close so the next ordinary close retains its usual purpose', async () => {
    const h = harness();
    h.webContents.executeJavaScript.mockResolvedValueOnce({ status: 'cancelled' });
    h.owner.request(h.cancelInstall);
    await vi.waitFor(() => expect(h.cancelQuit).toHaveBeenCalledOnce());
    expect(h.allowed).not.toHaveBeenCalled();
    expect(h.owner.canInstall()).toBe(false);
    expect(h.cancelInstall).toHaveBeenCalledOnce();
    h.webContents.executeJavaScript.mockClear();
    h.target.close();
    await vi.waitFor(() => expect(h.allowed).toHaveBeenCalledOnce());
    expect(h.webContents.executeJavaScript.mock.calls[0]?.[0]).toContain('"operation":"prepare"');
  });
  it('retires the install choice when no guarded window can own the close', () => {
    const app = { quit: vi.fn() };
    const cancel = vi.fn();
    createDesktopUpdateClose(app, () => []).request(cancel);
    expect(cancel).toHaveBeenCalledOnce();
    expect(app.quit).not.toHaveBeenCalled();
  });
});
