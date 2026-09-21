import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AppThemeModule from './app-theme';

// Each case needs a FRESH module: app-theme caches the stored preference in
// module state (it sits on the canvas draw path), so a shared instance would
// carry one case's choice into the next and hide a broken load.
async function freshModule(): Promise<typeof AppThemeModule> {
  vi.resetModules();
  return import('./app-theme');
}

function stubDesktopDark(dark: boolean): Set<() => void> {
  const listeners = new Set<() => void>();
  vi.stubGlobal('matchMedia', (query: string) => ({
    media: query,
    matches: dark,
    addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
  }));
  return listeners;
}

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => vi.unstubAllGlobals());

describe('app theme preference (ADR-339)', () => {
  it('opens light even when the desktop is dark', async () => {
    stubDesktopDark(true);
    const theme = await freshModule();
    expect(theme.appThemePreference()).toBe('light');
    expect(theme.resolvedTheme()).toBe('light');
  });

  it('stamps the resolved theme on the root element for the chrome to key off', async () => {
    stubDesktopDark(false);
    const theme = await freshModule();
    theme.initAppTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
    theme.setAppThemePreference('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('persists the choice so the next launch opens on it', async () => {
    stubDesktopDark(false);
    const first = await freshModule();
    first.setAppThemePreference('dark');
    const relaunched = await freshModule();
    expect(relaunched.appThemePreference()).toBe('dark');
    expect(relaunched.resolvedTheme()).toBe('dark');
  });

  it('follows the desktop only when the operator asks for system', async () => {
    stubDesktopDark(true);
    const theme = await freshModule();
    expect(theme.resolvedTheme()).toBe('light');
    theme.setAppThemePreference('system');
    expect(theme.resolvedTheme()).toBe('dark');
  });

  it('notifies subscribers and releases the desktop listener on unsubscribe', async () => {
    const listeners = stubDesktopDark(false);
    const theme = await freshModule();
    const onChange = vi.fn();
    const unsubscribe = theme.subscribeAppTheme(onChange);
    expect(listeners.size).toBe(1);
    theme.setAppThemePreference('dark');
    expect(onChange).toHaveBeenCalledTimes(1);
    unsubscribe();
    expect(listeners.size).toBe(0);
    theme.setAppThemePreference('light');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('falls back to light rather than throwing when a stored value is junk', async () => {
    stubDesktopDark(true);
    localStorage.setItem('kerfdesk.theme.v1', 'chartreuse');
    const theme = await freshModule();
    expect(theme.appThemePreference()).toBe('light');
  });

  it('still switches when storage is denied, it just will not survive reload', async () => {
    stubDesktopDark(false);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const theme = await freshModule();
    expect(() => theme.setAppThemePreference('dark')).not.toThrow();
    expect(theme.resolvedTheme()).toBe('dark');
    setItem.mockRestore();
  });
});
