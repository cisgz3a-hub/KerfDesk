// The Preview update notice opens KerfDesk's own download page for one exact
// version. The source repository is private, so customers can no longer reach
// GitHub release pages; downloads come from kerfdesk.com and dl.kerfdesk.com.
export const OFFICIAL_DESKTOP_RELEASE_BASE_URL = 'https://kerfdesk.com/download.html?version=';

const EXACT_PREVIEW_RELEASE_URL =
  /^https:\/\/kerfdesk\.com\/download\.html\?version=(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-preview\.(0|[1-9][0-9]*)$/;

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
