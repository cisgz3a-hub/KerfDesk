import { describe, expect, it, vi } from 'vitest';
import { configureAutoUpdater, type DesktopUpdater } from './auto-update.js';

type FakeUpdater = DesktopUpdater & { readonly quitAndInstall: () => void };

function makeFakeUpdater(check: () => Promise<unknown> = () => Promise.resolve(null)): FakeUpdater {
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    checkForUpdatesAndNotify: vi.fn(check),
    quitAndInstall: vi.fn(),
  };
}

describe('configureAutoUpdater', () => {
  it('does nothing in a dev (unpackaged) run — no updater singleton is touched', () => {
    const updater = makeFakeUpdater();
    configureAutoUpdater(updater, { isPackaged: false, isChannelTrusted: true });
    expect(updater.checkForUpdatesAndNotify).not.toHaveBeenCalled();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });

  it('does nothing while the update channel is unsigned', () => {
    const updater = makeFakeUpdater();
    configureAutoUpdater(updater, { isPackaged: true, isChannelTrusted: false });
    expect(updater.checkForUpdatesAndNotify).not.toHaveBeenCalled();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });

  it('enables background download + install-on-quit only for a trusted packaged channel', () => {
    const updater = makeFakeUpdater();
    configureAutoUpdater(updater, { isPackaged: true, isChannelTrusted: true });
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.checkForUpdatesAndNotify).toHaveBeenCalledTimes(1);
  });

  it('never force-installs — quitAndInstall is not called (burn-safety, non-negotiable #9)', () => {
    const updater = makeFakeUpdater();
    configureAutoUpdater(updater, { isPackaged: true, isChannelTrusted: true });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('routes a failed update check to onError instead of rejecting startup', async () => {
    const onError = vi.fn();
    const updater = makeFakeUpdater(() => Promise.reject(new Error('offline')));
    configureAutoUpdater(updater, { isPackaged: true, isChannelTrusted: true, onError });
    // Flush the fire-and-forget `.catch` microtask chain.
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
  });
});
