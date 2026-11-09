// ADR-688: Firefox and Safari have no file pickers, so the app says so as it
// opens. Save and Export download there (ADR-688 Amendment 2), and the banner
// says plainly that work not yet downloaded lives only in this browser's
// autosave, which the browser may delete (Safari after 7 days without a visit)
// and no other browser or the desktop app can see.

import { useState } from 'react';
import { Button } from '../kit';
import { DESKTOP_DOWNLOAD_URL } from '../licensing/edition-policy';
import { platformCanPickFiles, platformCanSaveFiles } from './browser-file-access';
import { usePlatformOptional } from './platform-context';
import {
  noticeBannerActionsStyle,
  noticeBannerStyle,
  noticeBannerTextStyle,
} from './notice-banner-style';

/** What work that lives only in a no-picker browser's autosave risks (W9-P2-2). */
export const UNSAVED_WORK_WARNING =
  "Until you save, your work is only in this browser's autosave: the browser can delete it (Safari does after 7 days without a visit), and no other browser or the desktop app can see it.";

export function BrowserFilesNotice(): JSX.Element | null {
  const platform = usePlatformOptional();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || platform === null || platformCanPickFiles(platform)) return null;
  const downloads = platformCanSaveFiles(platform);
  return (
    <section role="status" aria-label="Browser file support" style={noticeBannerStyle}>
      <span style={noticeBannerTextStyle}>
        {downloads ? (
          <>
            <strong>This browser saves by downloading.</strong> Save and Export download a copy to
            your Downloads folder; drag a file onto the canvas to open or import it.
          </>
        ) : (
          <>
            <strong>This browser can&apos;t open or save files.</strong> Drag files onto the canvas
            to import them.
          </>
        )}{' '}
        {UNSAVED_WORK_WARNING} Chrome, Edge and the desktop app save in place.
      </span>
      <span style={noticeBannerActionsStyle}>
        <a
          className="lf-btn lf-btn--primary"
          style={{ textDecoration: 'none' }}
          href={DESKTOP_DOWNLOAD_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Get the desktop app
        </a>
        <Button title="Hide this until KerfDesk next starts." onClick={() => setDismissed(true)}>
          Not now
        </Button>
      </span>
    </section>
  );
}
