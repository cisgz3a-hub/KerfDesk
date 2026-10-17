// Which desktop system the window runs on, from what Chromium reports, for
// wording that differs by system (ADR-606). The web app and the desktop app
// both run Chromium, so the same answer holds in either.

export type PlatformSignals = { readonly platform: string; readonly userAgent: string };

/** True on a Mac (and an iPad with a keyboard), in Chrome or the desktop app. */
export function isApplePlatform(signals: PlatformSignals | undefined = browserSignals()): boolean {
  if (signals === undefined) return false;
  return /^(?:Mac|iPhone|iPad)/.test(signals.platform) || /\bMac OS X\b/.test(signals.userAgent);
}

/** True on desktop Linux. Android and ChromeOS also run a Linux kernel but are not it. */
export function isLinuxDesktop(signals: PlatformSignals | undefined = browserSignals()): boolean {
  if (signals === undefined) return false;
  return /\bLinux\b/.test(signals.userAgent) && !/\b(?:Android|CrOS)\b/.test(signals.userAgent);
}

function browserSignals(): PlatformSignals | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return { platform: navigator.platform, userAgent: navigator.userAgent };
}
