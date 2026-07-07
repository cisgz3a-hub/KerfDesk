import { describe, expect, it } from 'vitest';
import { isElectronRenderer } from './is-electron';

describe('isElectronRenderer', () => {
  it('is true when the user-agent carries the Electron token (dev:desktop over http)', () => {
    expect(
      isElectronRenderer({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Electron/42.3.0 Safari/537.36',
        protocol: 'http:',
      }),
    ).toBe(true);
  });

  it('is true when served over the packaged app:// scheme', () => {
    expect(isElectronRenderer({ userAgent: 'irrelevant', protocol: 'app:' })).toBe(true);
  });

  it('is false in a normal browser (no Electron token, https origin)', () => {
    expect(
      isElectronRenderer({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36',
        protocol: 'https:',
      }),
    ).toBe(false);
  });

  it('defaults to false in the jsdom test environment (browser-like)', () => {
    expect(isElectronRenderer()).toBe(false);
  });
});
