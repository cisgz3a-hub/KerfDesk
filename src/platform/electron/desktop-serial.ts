// The desktop app's serial adapter: the web one (the window runs Chromium's
// Web Serial), plus whether a pick outlives a restart. The desktop app on
// Windows, macOS and Linux remembers the ports picked in its Select dialog, as
// Chrome does (ADR-552, ADR-607). As in Chrome, macOS and Linux cannot
// remember an adapter with no serial number (most CH340 boards), so Connect
// asks for that one again after each start.

import type { SerialAdapter } from '../types';

export function createDesktopSerialAdapter(
  serial: SerialAdapter,
  userAgent: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
): SerialAdapter {
  // Chromium's user agent names Windows as "Windows NT" and a Mac as "Mac OS X"
  // on every version; desktop Linux says "Linux".
  return { ...serial, picksEndOnRestart: !/\b(?:Windows NT|Mac OS X|Linux)\b/.test(userAgent) };
}
