export const CONNECT_BROWSER_GUIDANCE_ACK_KEY = 'laserforge_connect_browser_guidance_acknowledged';

export type BrowserFamily = 'chrome' | 'edge' | 'opera' | 'firefox' | 'safari' | 'electron' | 'unknown';

export interface BrowserCompatibility {
  readonly family: BrowserFamily;
  readonly name: string;
  readonly version: string | null;
  readonly webSerialSupported: boolean;
  readonly canUseUsbLaser: boolean;
  readonly recommendedBrowser: boolean;
}

export interface BrowserCompatibilityInput {
  readonly userAgent?: string;
  readonly hasWebSerial?: boolean;
  readonly isElectron?: boolean;
}

function firstVersion(match: RegExpMatchArray | null): string | null {
  return match?.[1] ?? null;
}

export function parseBrowserFromUserAgent(userAgent: string): Pick<BrowserCompatibility, 'family' | 'name' | 'version' | 'recommendedBrowser'> {
  const ua = userAgent || '';
  const edge = firstVersion(ua.match(/Edg\/([0-9.]+)/));
  if (edge) return { family: 'edge', name: 'Edge', version: edge, recommendedBrowser: true };

  const opera = firstVersion(ua.match(/OPR\/([0-9.]+)/));
  if (opera) return { family: 'opera', name: 'Opera', version: opera, recommendedBrowser: true };

  const firefox = firstVersion(ua.match(/Firefox\/([0-9.]+)/));
  if (firefox) return { family: 'firefox', name: 'Firefox', version: firefox, recommendedBrowser: false };

  const chrome = firstVersion(ua.match(/Chrome\/([0-9.]+)/));
  if (chrome) return { family: 'chrome', name: 'Chrome', version: chrome, recommendedBrowser: true };

  const safari = /Safari\//.test(ua) ? firstVersion(ua.match(/Version\/([0-9.]+)/)) : null;
  if (safari) return { family: 'safari', name: 'Safari', version: safari, recommendedBrowser: false };

  return { family: 'unknown', name: 'This browser', version: null, recommendedBrowser: false };
}

export function detectBrowserCompatibility(input: BrowserCompatibilityInput = {}): BrowserCompatibility {
  const userAgent = input.userAgent ?? (() => {
    try { return typeof navigator !== 'undefined' ? navigator.userAgent : ''; } catch { return ''; }
  })();
  const isElectron = input.isElectron ?? (() => {
    try { return typeof window !== 'undefined' && !!window.electronAPI?.isElectron; } catch { return false; }
  })();
  const parsed = isElectron
    ? { family: 'electron' as const, name: 'Electron', version: null, recommendedBrowser: true }
    : parseBrowserFromUserAgent(userAgent);
  const hasWebSerial = input.hasWebSerial ?? (() => {
    try { return typeof navigator !== 'undefined' && 'serial' in navigator; } catch { return false; }
  })();
  const webSerialSupported = isElectron || hasWebSerial;

  return {
    ...parsed,
    webSerialSupported,
    canUseUsbLaser: webSerialSupported,
  };
}

export function browserLabel(compatibility: BrowserCompatibility): string {
  return compatibility.version
    ? `${compatibility.name} ${compatibility.version}`
    : compatibility.name;
}

export function shouldShowConnectBrowserGuidance(storage?: Pick<Storage, 'getItem'>): boolean {
  try {
    const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    return target?.getItem(CONNECT_BROWSER_GUIDANCE_ACK_KEY) !== 'true';
  } catch {
    return true;
  }
}

export function markConnectBrowserGuidanceAcknowledged(storage?: Pick<Storage, 'setItem'>): void {
  try {
    const target = storage ?? (typeof localStorage !== 'undefined' ? localStorage : null);
    target?.setItem(CONNECT_BROWSER_GUIDANCE_ACK_KEY, 'true');
  } catch {
    /* ignore unavailable storage */
  }
}
