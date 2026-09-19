import { describe, expect, it } from 'vitest';
import { makeTrustedRendererOrigins, shouldGrantPermissionCheck } from './trusted-renderer-policy';

describe('Electron file-system grants without a WebContents', () => {
  const trusted = makeTrustedRendererOrigins('http://localhost:5173');
  const fileCheck = {
    permission: 'fileSystem',
    requestingOrigin: 'app://app/',
    currentUrl: null,
    // Electron 42 passes a null frame when checking an existing file grant.
    isMainFrame: false,
  };

  it('allows the documented origin-scoped file grant for the packaged renderer', () => {
    expect(shouldGrantPermissionCheck(fileCheck, trusted)).toBe(true);
  });

  it('allows the configured development origin through the same file-grant path', () => {
    expect(
      shouldGrantPermissionCheck(
        { ...fileCheck, requestingOrigin: 'http://localhost:5173/' },
        trusted,
      ),
    ).toBe(true);
  });

  it.each(['https://evil.example/', 'app://other/', 'http://localhost:5174/', '', 'null'])(
    'rejects a missing or untrusted file-grant origin: %s',
    (requestingOrigin) => {
      expect(shouldGrantPermissionCheck({ ...fileCheck, requestingOrigin }, trusted)).toBe(false);
    },
  );

  it('rejects an untrusted embedding origin and an existing untrusted or empty window URL', () => {
    expect(
      shouldGrantPermissionCheck(
        { ...fileCheck, embeddingOrigin: 'https://evil.example/' },
        trusted,
      ),
    ).toBe(false);
    for (const currentUrl of ['', 'about:blank', 'https://evil.example/']) {
      expect(shouldGrantPermissionCheck({ ...fileCheck, currentUrl }, trusted)).toBe(false);
    }
  });

  it.each(['serial', 'media', 'screen-wake-lock', 'fileSystem-write', 'geolocation'])(
    'does not grant another permission without a window: %s',
    (permission) => {
      expect(shouldGrantPermissionCheck({ ...fileCheck, permission }, trusted)).toBe(false);
    },
  );
});
