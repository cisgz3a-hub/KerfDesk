// "Download for Windows" affordance (ADR-024). Links to the static /download
// page, which carries the installer link and the unsigned-build SmartScreen
// note. A plain anchor — no fetch — so it respects the renderer CSP
// (connect-src 'self'); the browser downloads the R2-hosted .exe from the
// download page, not from here. Opens in a new tab so the operator never loses
// their working scene. Hidden inside the desktop app, where downloading the
// installer is pointless.

import { usePlatformOptional } from '../app/platform-context';

const DOWNLOAD_PAGE_PATH = '/download.html';

const linkStyle: React.CSSProperties = { textDecoration: 'none' };

export function DownloadDesktopLink(): JSX.Element | null {
  const platform = usePlatformOptional();
  if (platform?.id === 'electron') return null;
  return (
    <a
      className="lf-btn"
      style={linkStyle}
      href={DOWNLOAD_PAGE_PATH}
      target="_blank"
      rel="noopener noreferrer"
      title="Download the KerfDesk desktop app for Windows (10/11, 64-bit)"
    >
      Download for Windows
    </a>
  );
}
