// The desktop app's serial adapter: the web one (the window runs Chromium's
// Web Serial), plus whether a pick outlives a restart. The Windows app
// remembers the ports picked in its Select dialog, as Chrome does (ADR-552).
// On macOS and Linux a pick lasts until KerfDesk closes (ADR-366), so Connect
// asks for the port again after each start.

import type { SerialAdapter } from '../types';

export function createDesktopSerialAdapter(
  serial: SerialAdapter,
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): SerialAdapter {
  // Chromium's user agent names Windows as "Windows NT" on every version.
  return { ...serial, picksEndOnRestart: !/\bWindows NT\b/.test(userAgent) };
}
