import { describe, expect, it } from 'vitest';
import { mainWindowWebPreferences } from './desktop-window-options.js';

describe('main window web preferences', () => {
  // Controller audit electron-native-2: a minimized window must stay visible
  // to the page, or the running job's screen wake lock is released.
  it('keeps the page visible while the window is minimized', () => {
    expect(mainWindowWebPreferences(false).backgroundThrottling).toBe(false);
  });

  it('keeps the renderer isolated and sandboxed', () => {
    expect(mainWindowWebPreferences(true)).toEqual({
      contextIsolation: true,
      devTools: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
    });
  });
});
