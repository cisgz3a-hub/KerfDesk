// Cross-platform desktop Preview affordance (ADR-248/249). Go straight to the
// public source repository so a legacy cached service worker cannot substitute
// an old mutable download page. Hidden inside the desktop app.

import { usePlatformOptional } from '../app/platform-context';

const DOWNLOAD_PAGE_URL = 'https://github.com/cisgz3a-hub/KerfDesk/releases';

const linkStyle: React.CSSProperties = { textDecoration: 'none' };

export function DownloadDesktopLink(): JSX.Element | null {
  const platform = usePlatformOptional();
  if (platform?.id === 'electron') return null;
  return (
    <a
      className="lf-btn"
      style={linkStyle}
      href={DOWNLOAD_PAGE_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="Download the KerfDesk desktop Preview for Windows or macOS"
    >
      Download desktop app
    </a>
  );
}
