// Web links the renderer opens in a new window (ADR-482). Help > Report a Bug,
// Discussions, a CNC preset's sources and a library design's source and
// licence are ordinary <a target="_blank"> links. A browser opens them in a
// new tab; Electron would open a second app window, which the navigation
// policy denies, so on the desktop they did nothing. Main hands them to the
// operator's own browser instead.
//
// Only credential-free https: links qualify. shell.openExternal passes a URL
// to whatever the operating system registered for its scheme, so file:, smb:,
// custom protocol handlers and plain http: never reach it (Electron security
// checklist: do not use openExternal with untrusted content).

export function externalBrowserUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.hostname === '') return null;
  return url.href;
}
