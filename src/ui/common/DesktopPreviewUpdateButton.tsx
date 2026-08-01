// Passive, notify-only Preview update control (ADR-249). Unlike the PWA
// Update button, this cannot reload the app or mutate machine state: it opens
// KerfDesk's fixed download page for an operator-led manual installation.

import { useEffect, useState } from 'react';
import type { DesktopUpdateAvailability } from '../../platform/types';
import { usePlatformOptional } from '../app/platform-context';

const NONE: DesktopUpdateAvailability = { kind: 'none' };

export function DesktopPreviewUpdateButton(): JSX.Element {
  const platform = usePlatformOptional();
  const updates = platform?.desktopUpdates;
  const [availability, setAvailability] = useState<DesktopUpdateAvailability>(NONE);

  useEffect(() => {
    let mounted = true;
    if (updates === undefined) return () => undefined;
    void updates.checkForUpdate().then((next) => {
      if (mounted) setAvailability(next);
    });
    return () => {
      mounted = false;
    };
  }, [updates]);

  const version = availability.kind === 'available' ? availability.version : null;
  return (
    <>
      <span role="status" style={visuallyHiddenStyle}>
        {version === null
          ? ''
          : `KerfDesk ${version} is available. Use Download update in the status bar.`}
      </span>
      {version !== null && updates !== undefined && (
        <a
          className="lf-btn lf-btn--primary"
          href={updates.downloadPageUrl(version)}
          target="_blank"
          rel="noreferrer"
          aria-label={`Download KerfDesk ${version}`}
          title={`KerfDesk ${version} is available. Open the official download page.`}
          style={buttonStyle}
        >
          Download update
        </a>
      )}
    </>
  );
}

const buttonStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: 12,
  padding: '1px 10px',
  whiteSpace: 'nowrap',
  textDecoration: 'none',
};

const visuallyHiddenStyle: React.CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
  border: 0,
};
