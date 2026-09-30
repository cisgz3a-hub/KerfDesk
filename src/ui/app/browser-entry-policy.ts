export type BrowserEntryEnvironment = {
  readonly protocol: string;
  readonly userAgent: string;
  readonly platform: string;
  readonly maxTouchPoints: number;
  readonly coarsePointer: boolean;
  readonly screenWidth: number;
  readonly screenHeight: number;
};

export function isMobileBrowser(environment: BrowserEntryEnvironment): boolean {
  if (environment.protocol === 'app:' || /electron\//i.test(environment.userAgent)) return false;
  if (/iPhone|iPad|iPod|Android|Windows Phone|IEMobile/i.test(environment.userAgent)) return true;
  // iPadOS can present the Mac desktop UA, including with a trackpad attached.
  // Touch capacity supplements that cue; viewport width alone never reroutes a
  // desktop. Best effort: a browser hiding both its platform and touch signals
  // cannot be distinguished reliably from desktop hardware.
  // https://developer.apple.com/videos/play/wwdc2019/203/
  // https://developer.mozilla.org/en-US/docs/Web/API/Navigator/maxTouchPoints
  const mac = /Macintosh/i.test(environment.userAgent) || /Mac/i.test(environment.platform);
  if (mac) return environment.maxTouchPoints > 1;
  if (/Windows/i.test(environment.userAgent)) return false;
  const shortSide = Math.min(environment.screenWidth, environment.screenHeight);
  return environment.coarsePointer && shortSide > 0 && shortSide <= 600;
}

export async function openBrowserEntry(
  environment: BrowserEntryEnvironment,
  entry: {
    readonly openLicencePage: () => void;
    readonly openWorkspace: () => Promise<unknown>;
    readonly onWorkspaceError: () => void;
  },
): Promise<void> {
  if (isMobileBrowser(environment)) entry.openLicencePage();
  else {
    try {
      await entry.openWorkspace();
    } catch {
      entry.onWorkspaceError();
    }
  }
}
