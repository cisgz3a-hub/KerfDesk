// ADR-688: the web app is Chromium-only (PROJECT.md "Delivery targets"), with
// no second persistence path. Firefox and Safari load and draw, then fail at
// the first Open, Import or Save, so the app says so as it opens, says what
// still works, and points at a browser or the desktop app that can save.

import { useState } from 'react';
import { Button } from '../kit';
import { DESKTOP_DOWNLOAD_URL } from '../licensing/edition-policy';
import { platformCanPickFiles } from './browser-file-access';
import { usePlatformOptional } from './platform-context';
import {
  noticeBannerActionsStyle,
  noticeBannerStyle,
  noticeBannerTextStyle,
} from './notice-banner-style';

export function BrowserFilesNotice(): JSX.Element | null {
  const platform = usePlatformOptional();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || platform === null || platformCanPickFiles(platform)) return null;
  return (
    <section role="status" aria-label="Browser file support" style={noticeBannerStyle}>
      <span style={noticeBannerTextStyle}>
        <strong>This browser can&apos;t open or save files.</strong> Use Chrome or Edge, or the
        desktop app. You can still drag files onto the canvas to import them, and your work is
        autosaved in this browser.
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
