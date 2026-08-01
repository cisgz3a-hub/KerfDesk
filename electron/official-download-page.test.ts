import { describe, expect, it } from 'vitest';
import {
  canonicalOfficialDesktopDownloadUrl,
  isOfficialDesktopDownloadUrl,
} from './official-download-page.js';

describe('official desktop download page policy', () => {
  it('accepts only the exact pinned HTTPS page', () => {
    const exact = 'https://github.com/cisgz3a-hub/KerfDesk/releases/tag/v1.2.3-preview.4';
    expect(isOfficialDesktopDownloadUrl(exact)).toBe(true);
    expect(canonicalOfficialDesktopDownloadUrl(exact)).toBe(exact);
    expect(isOfficialDesktopDownloadUrl('http://github.com/cisgz3a-hub/KerfDesk/releases')).toBe(
      false,
    );
    expect(
      isOfficialDesktopDownloadUrl(
        'https://github.com.evil.test/cisgz3a-hub/KerfDesk/releases/tag/v1.2.3-preview.4',
      ),
    ).toBe(false);
    expect(
      isOfficialDesktopDownloadUrl(
        'https://user@github.com/cisgz3a-hub/KerfDesk/releases/tag/v1.2.3-preview.4',
      ),
    ).toBe(false);
    expect(
      isOfficialDesktopDownloadUrl(
        'https://github.com:443/cisgz3a-hub/KerfDesk/releases/tag/v1.2.3-preview.4',
      ),
    ).toBe(false);
    expect(
      isOfficialDesktopDownloadUrl(
        'https://github.com/cisgz3a-hub/KerfDesk/releases/tag/v1.2.3-preview.4/',
      ),
    ).toBe(false);
    expect(
      isOfficialDesktopDownloadUrl(
        'https://github.com/cisgz3a-hub/KerfDesk/releases/tag/v1.2.3-preview.4?next=evil',
      ),
    ).toBe(false);
    expect(
      isOfficialDesktopDownloadUrl(
        'https://github.com/cisgz3a-hub/KerfDesk/releases/tag/v1.2.3-preview.4#preview',
      ),
    ).toBe(false);
    expect(
      isOfficialDesktopDownloadUrl(
        'https://github.com/cisgz3a-hub/KerfDesk/releases/tag/v1.2.3-preview.04',
      ),
    ).toBe(false);
  });
});
