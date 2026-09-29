import { describe, expect, it, vi } from 'vitest';
import { desktopWindowCommandContext } from './desktop-window-command-context';

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('the desktop window commands in the menu (ADR-554)', () => {
  it('offers nothing where the platform has no desktop window', () => {
    expect(desktopWindowCommandContext({}, vi.fn())).toEqual({});
  });

  it('runs Exit and Open Data Folder through the desktop window', async () => {
    const desktopWindow = {
      exit: vi.fn(async () => undefined),
      openDataFolder: vi.fn(async () => undefined),
    };
    const pushToast = vi.fn();
    const context = desktopWindowCommandContext({ desktopWindow }, pushToast);
    context.exitApp?.();
    context.openDataFolder?.();
    await settle();
    expect(desktopWindow.exit).toHaveBeenCalledOnce();
    expect(desktopWindow.openDataFolder).toHaveBeenCalledOnce();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it('says in a toast when a command fails', async () => {
    const desktopWindow = {
      exit: vi.fn(async () => {
        throw new Error('KerfDesk could not be closed (404).');
      }),
      openDataFolder: vi.fn(async () => {
        throw new Error('The data folder could not be opened. It is C:\\Data\\laserforge');
      }),
    };
    const pushToast = vi.fn();
    const context = desktopWindowCommandContext({ desktopWindow }, pushToast);
    context.exitApp?.();
    context.openDataFolder?.();
    await settle();
    expect(pushToast.mock.calls).toEqual([
      ['KerfDesk could not be closed (404).', 'error'],
      ['The data folder could not be opened. It is C:\\Data\\laserforge', 'error'],
    ]);
  });
});
