import { describe, expect, it, vi } from 'vitest';
import {
  isMobileBrowser,
  openBrowserEntry,
  type BrowserEntryEnvironment,
} from './browser-entry-policy';
import { showWorkspaceStartupError } from './workspace-startup-error';

const desktop: BrowserEntryEnvironment = {
  protocol: 'https:',
  userAgent: 'Mozilla/5.0 Windows Chrome/144',
  platform: 'Win32',
  maxTouchPoints: 0,
  coarsePointer: false,
  screenWidth: 1440,
  screenHeight: 900,
};

describe('browser entry', () => {
  it.each([
    { userAgent: 'Mozilla/5.0 (iPhone) Safari', screenWidth: 390, screenHeight: 844 },
    { userAgent: 'Mozilla/5.0 (iPhone) Safari', screenWidth: 844, screenHeight: 390 },
    {
      userAgent: 'Mozilla/5.0 (Linux; Android) Chrome Mobile',
      screenWidth: 915,
      screenHeight: 412,
    },
    {
      userAgent: 'Mozilla/5.0',
      platform: '',
      coarsePointer: true,
      screenWidth: 932,
      screenHeight: 430,
    },
    { userAgent: 'Mozilla/5.0 (iPad)', screenWidth: 1024, screenHeight: 768 },
    { userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome', screenWidth: 1280, screenHeight: 800 },
    {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari',
      platform: 'MacIntel',
      maxTouchPoints: 5,
      screenWidth: 1366,
      screenHeight: 1024,
    },
  ])('routes phones and tablets before importing workspace modules: %j', async (phone) => {
    const entry = { openLicencePage: vi.fn(), openWorkspace: vi.fn(), onWorkspaceError: vi.fn() };
    await openBrowserEntry({ ...desktop, ...phone }, entry);
    expect(entry.openLicencePage).toHaveBeenCalledOnce();
    expect(entry.openWorkspace).not.toHaveBeenCalled();
  });

  it.each([
    desktop,
    { ...desktop, screenWidth: 390, screenHeight: 844 },
    { ...desktop, coarsePointer: true, screenWidth: 1024, screenHeight: 768 },
    { ...desktop, coarsePointer: true, maxTouchPoints: 10, screenWidth: 390, screenHeight: 844 },
    {
      ...desktop,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari',
      platform: 'MacIntel',
    },
    { ...desktop, protocol: 'app:', userAgent: 'iPhone' },
    { ...desktop, userAgent: 'Electron/44.4.5 Android Mobile' },
  ])('keeps desktop and Electron on the workspace: %j', async (environment) => {
    expect(isMobileBrowser(environment)).toBe(false);
    const entry = {
      openLicencePage: vi.fn(),
      openWorkspace: vi.fn().mockResolvedValue(undefined),
      onWorkspaceError: vi.fn(),
    };
    await openBrowserEntry(environment, entry);
    expect(entry.openWorkspace).toHaveBeenCalledOnce();
    expect(entry.openLicencePage).not.toHaveBeenCalled();
  });

  it('replaces the splash with an accessible explicit retry if the first workspace chunk fails', async () => {
    document.body.innerHTML = '<div id="app-root"></div><div id="app-splash">Loading</div>';
    const reload = vi.fn();
    await openBrowserEntry(desktop, {
      openLicencePage: vi.fn(),
      openWorkspace: vi.fn().mockRejectedValue(new Error('Chunk unavailable')),
      onWorkspaceError: () => showWorkspaceStartupError(document, reload),
    });
    expect(document.getElementById('app-splash')).toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'could not finish opening',
    );
    expect(reload).not.toHaveBeenCalled();
    document.querySelector('button')?.click();
    expect(reload).toHaveBeenCalledOnce();
    document.body.innerHTML = '';
  });
});
