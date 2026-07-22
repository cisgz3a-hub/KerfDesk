export const OFFICIAL_DESKTOP_RELEASE_BASE_URL =
  'https://github.com/cisgz3a-hub/KerfDesk/releases/tag/v';

const EXACT_PREVIEW_RELEASE_URL =
  /^https:\/\/github\.com\/cisgz3a-hub\/KerfDesk\/releases\/tag\/v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-preview\.(0|[1-9][0-9]*)$/;

// The only renderer-selected component is a strict Preview version already
// validated independently by main. API-provided URLs are never accepted.
export function canonicalOfficialDesktopDownloadUrl(url: string): string | null {
  const match = EXACT_PREVIEW_RELEASE_URL.exec(url);
  if (match === null) return null;
  const version = url.slice(OFFICIAL_DESKTOP_RELEASE_BASE_URL.length);
  return `${OFFICIAL_DESKTOP_RELEASE_BASE_URL}${version}`;
}

export function isOfficialDesktopDownloadUrl(url: string): boolean {
  return canonicalOfficialDesktopDownloadUrl(url) !== null;
}
