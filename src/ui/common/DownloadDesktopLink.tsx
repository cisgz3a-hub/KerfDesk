// The download page verifies publisher metadata before enabling versioned links.
// It remains accessible when the source repository is private.

import { usePlatformOptional } from '../app/platform-context';

const DOWNLOAD_PAGE_URL = 'https://kerfdesk.com/download.html';

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
