import { describe, expect, it, vi } from 'vitest';
import {
  installLicenceLink,
  isLicenceLink,
  LICENCE_LINK_SIGNAL,
  licenceLinkInArgv,
} from './licence-link';

const KEY = `KD1.0f8fad5b-d9cb-469f-a165-70867728950e.${'a'.repeat(43)}`;

function fakeApp() {
  const listeners = new Map<string, (...args: unknown[]) => void>();
  return {
    listeners,
    app: {
      setAsDefaultProtocolClient: vi.fn(() => true),
      on: vi.fn((name: string, listener: (...args: unknown[]) => void) => {
        listeners.set(name, listener);
      }),
    },
  };
}
function fakeWindow(url = 'app://app/index.html') {
  return {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: { getURL: () => url, executeJavaScript: vi.fn(async () => undefined) },
  };
}

describe('the kerfdesk://licence link', () => {
  it('accepts only the one data-free form, never a key or anything else', () => {
    for (const link of ['kerfdesk://licence', 'kerfdesk://licence/', 'KERFDESK://licence'])
      expect(isLicenceLink(link)).toBe(true);
    for (const link of [
      `kerfdesk://licence?key=${KEY}`,
      `kerfdesk://licence/${KEY}`,
      'kerfdesk://licence#key',
      'kerfdesk://user@licence',
      'kerfdesk://activate',
      'https://licence',
      'C:\\Projects\\sign.lf2',
      `kerfdesk://licence/${'x'.repeat(80)}`,
      null,
    ])
      expect(isLicenceLink(link)).toBe(false);
    expect(licenceLinkInArgv(['KerfDesk.exe', '--flag', 'kerfdesk://licence'])).toBe(true);
    expect(licenceLinkInArgv(['KerfDesk.exe', 'sign.lf2'])).toBe(false);
  });

  it('registers the scheme and opens the panel once, with only a KerfDesk key from the clipboard', async () => {
    const { app } = fakeApp();
    let clipboard = `Licence key: ${KEY}`;
    const link = installLicenceLink(app as never, {
      enabled: true,
      argv: ['KerfDesk.exe', 'kerfdesk://licence'],
      readClipboard: async () => clipboard,
      primaryWindow: () => undefined,
      isTrustedRenderer: () => true,
    });
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledExactlyOnceWith('kerfdesk');
    expect(await link?.consume()).toEqual({ open: true, licenseKey: KEY });
    expect(await link?.consume()).toEqual({ open: false, licenseKey: null });
    clipboard = 'not a key';
    const plain = installLicenceLink(app as never, {
      enabled: true,
      argv: ['KerfDesk.exe', 'kerfdesk://licence'],
      readClipboard: async () => clipboard,
      primaryWindow: () => undefined,
      isTrustedRenderer: () => true,
    });
    expect(await plain?.consume()).toEqual({ open: true, licenseKey: null });
  });

  it('raises the running window and signals it, without data, when a second launch carries the link', async () => {
    const { app, listeners } = fakeApp();
    const window = fakeWindow();
    const link = installLicenceLink(app as never, {
      enabled: true,
      argv: ['KerfDesk.exe'],
      readClipboard: () => KEY,
      primaryWindow: () => window as never,
      isTrustedRenderer: (url) => url.startsWith('app://'),
    });
    expect((await link?.consume())?.open).toBe(false);
    listeners.get('second-instance')?.({}, ['KerfDesk.exe', 'sign.lf2'], 'C:\\');
    expect(window.webContents.executeJavaScript).not.toHaveBeenCalled();
    listeners.get('second-instance')?.({}, ['KerfDesk.exe', 'kerfdesk://licence'], 'C:\\');
    expect(window.focus).toHaveBeenCalled();
    expect(window.webContents.executeJavaScript).toHaveBeenCalledExactlyOnceWith(
      LICENCE_LINK_SIGNAL,
    );
    expect(LICENCE_LINK_SIGNAL).not.toContain('KD1');
    expect(await link?.consume()).toEqual({ open: true, licenseKey: KEY });
  });

  it('does nothing in builds that do not take a licence link', () => {
    const { app } = fakeApp();
    expect(
      installLicenceLink(app as never, {
        enabled: false,
        argv: ['KerfDesk.exe', 'kerfdesk://licence'],
        readClipboard: () => KEY,
        primaryWindow: () => undefined,
        isTrustedRenderer: () => true,
      }),
    ).toBeNull();
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
    expect(app.on).not.toHaveBeenCalled();
  });
});
