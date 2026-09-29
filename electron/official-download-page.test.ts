import { describe, expect, it } from 'vitest';
import {
  canonicalOfficialDesktopDownloadUrl,
  isOfficialDesktopDownloadUrl,
} from './official-download-page.js';

const PAGE = 'https://kerfdesk.com/download.html?version=';

describe('official desktop download page policy', () => {
  it('accepts only the exact pinned HTTPS page for one Preview version', () => {
    const exact = `${PAGE}1.2.3-preview.4`;
    expect(isOfficialDesktopDownloadUrl(exact)).toBe(true);
    expect(canonicalOfficialDesktopDownloadUrl(exact)).toBe(exact);
    for (const url of [
      'http://kerfdesk.com/download.html?version=1.2.3-preview.4',
      'https://kerfdesk.com.evil.test/download.html?version=1.2.3-preview.4',
      'https://user@kerfdesk.com/download.html?version=1.2.3-preview.4',
      'https://kerfdesk.com:443/download.html?version=1.2.3-preview.4',
      `${PAGE}1.2.3-preview.4&next=evil`,
      `${PAGE}1.2.3-preview.4#preview`,
      `${PAGE}1.2.3-preview.04`,
      `${PAGE}1.2.3`,
      'https://kerfdesk.com/download.html',
    ])
      expect(isOfficialDesktopDownloadUrl(url), url).toBe(false);
  });

  it('never sends customers to GitHub, whose repository is private', () => {
    expect(
      isOfficialDesktopDownloadUrl(
        'https://github.com/cisgz3a-hub/KerfDesk/releases/tag/v1.2.3-preview.4',
      ),
    ).toBe(false);
  });

  it('matches the page the Preview update notice opens', async () => {
    const { createDesktopPreviewUpdateAdapter } =
      await import('../src/platform/electron/preview-updates');
    const url = createDesktopPreviewUpdateAdapter().downloadPageUrl('1.2.3-preview.4');
    expect(isOfficialDesktopDownloadUrl(url)).toBe(true);
  });
});
