import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PACKAGED_RENDERER_ORIGIN,
  makeTrustedRendererOrigins,
  resolveRendererRuntime,
  shouldAllowNavigation,
  shouldAllowWindowOpen,
  shouldGrantDevicePermission,
  shouldGrantPermissionCheck,
  shouldGrantPermissionRequest,
} from './trusted-renderer-policy';

function readMainProcessSource(): string {
  return readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');
}

describe('Electron trusted renderer policy', () => {
  const trustedOrigins = makeTrustedRendererOrigins('http://localhost:5173/dev');

  it('trusts only the packaged app origin and configured dev-server origin', () => {
    expect([...trustedOrigins]).toEqual([PACKAGED_RENDERER_ORIGIN, 'http://localhost:5173']);

    expect(shouldAllowNavigation('app://app/index.html', trustedOrigins)).toBe(true);
    expect(shouldAllowNavigation('http://localhost:5173/workspace', trustedOrigins)).toBe(true);
    expect(shouldAllowNavigation('http://localhost:5174/workspace', trustedOrigins)).toBe(false);
    expect(shouldAllowNavigation('https://laserforge.pages.dev/', trustedOrigins)).toBe(false);
  });

  it('ignores configured dev URLs when packaged', () => {
    const runtime = resolveRendererRuntime({
      devUrl: 'https://evil.example/app',
      isPackaged: true,
    });

    expect(runtime.rendererUrl).toBe('app://app/index.html');
    expect([...runtime.trustedOrigins]).toEqual([PACKAGED_RENDERER_ORIGIN]);
  });

  it('trusts only loopback dev-server origins when unpackaged', () => {
    const runtime = resolveRendererRuntime({
      devUrl: 'https://evil.example/app',
      isPackaged: false,
    });
    const local = resolveRendererRuntime({
      devUrl: 'http://127.0.0.1:5173/workspace',
      isPackaged: false,
    });

    expect(runtime.rendererUrl).toBe('app://app/index.html');
    expect([...runtime.trustedOrigins]).toEqual([PACKAGED_RENDERER_ORIGIN]);
    expect(local.rendererUrl).toBe('http://127.0.0.1:5173/workspace');
    expect([...local.trustedOrigins]).toEqual([PACKAGED_RENDERER_ORIGIN, 'http://127.0.0.1:5173']);
  });

  it('grants only app permissions requested by the trusted main renderer', () => {
    expect(
      shouldGrantPermissionCheck(
        {
          permission: 'serial',
          requestingOrigin: 'app://app',
          currentUrl: 'app://app/index.html',
        },
        trustedOrigins,
      ),
    ).toBe(true);
    expect(
      shouldGrantPermissionCheck(
        {
          permission: 'fileSystem-write',
          requestingOrigin: 'http://localhost:5173',
          currentUrl: 'http://localhost:5173/workspace',
        },
        trustedOrigins,
      ),
    ).toBe(true);
    expect(
      shouldGrantPermissionCheck(
        {
          permission: 'media',
          requestingOrigin: 'app://app',
          isMainFrame: true,
          mediaType: 'video',
          currentUrl: 'app://app/index.html',
        },
        trustedOrigins,
      ),
    ).toBe(true);
    expect(
      shouldGrantPermissionCheck(
        {
          permission: 'media',
          requestingOrigin: 'app://app',
          isMainFrame: true,
          mediaType: 'audio',
          currentUrl: 'app://app/index.html',
        },
        trustedOrigins,
      ),
    ).toBe(false);
    expect(
      shouldGrantPermissionCheck(
        {
          permission: 'serial',
          requestingOrigin: 'https://evil.example',
          currentUrl: 'app://app/index.html',
        },
        trustedOrigins,
      ),
    ).toBe(false);
    expect(
      shouldGrantPermissionCheck(
        {
          permission: 'serial',
          requestingOrigin: 'app://app',
          currentUrl: 'https://evil.example/',
        },
        trustedOrigins,
      ),
    ).toBe(false);
    expect(
      shouldGrantPermissionCheck(
        {
          permission: 'serial',
          requestingOrigin: 'app://app',
          embeddingOrigin: 'https://evil.example',
          currentUrl: 'app://app/index.html',
        },
        trustedOrigins,
      ),
    ).toBe(false);
    expect(
      shouldGrantPermissionCheck(
        {
          permission: 'geolocation',
          requestingOrigin: 'app://app',
          currentUrl: 'app://app/index.html',
        },
        trustedOrigins,
      ),
    ).toBe(false);
  });

  it('denies permission requests from untrusted URLs and subframes', () => {
    expect(
      shouldGrantPermissionRequest(
        {
          permission: 'serial',
          isMainFrame: true,
          requestingUrl: 'app://app/index.html',
          currentUrl: 'app://app/index.html',
        },
        trustedOrigins,
      ),
    ).toBe(true);
    expect(
      shouldGrantPermissionRequest(
        {
          permission: 'fileSystem-read-write',
          isMainFrame: true,
          requestingUrl: 'http://localhost:5173/workspace',
          currentUrl: 'http://localhost:5173/workspace',
        },
        trustedOrigins,
      ),
    ).toBe(true);
    expect(
      shouldGrantPermissionRequest(
        {
          permission: 'media',
          isMainFrame: true,
          requestingUrl: 'app://app/index.html',
          mediaTypes: ['video'],
          currentUrl: 'app://app/index.html',
        },
        trustedOrigins,
      ),
    ).toBe(true);
    expect(
      shouldGrantPermissionRequest(
        {
          permission: 'media',
          isMainFrame: true,
          requestingUrl: 'app://app/index.html',
          mediaTypes: ['audio'],
          currentUrl: 'app://app/index.html',
        },
        trustedOrigins,
      ),
    ).toBe(false);
    expect(
      shouldGrantPermissionRequest(
        {
          permission: 'serial',
          isMainFrame: false,
          requestingUrl: 'app://app/index.html',
          currentUrl: 'app://app/index.html',
        },
        trustedOrigins,
      ),
    ).toBe(false);
    expect(
      shouldGrantPermissionRequest(
        {
          permission: 'serial',
          isMainFrame: true,
          requestingUrl: 'https://evil.example/',
          currentUrl: 'app://app/index.html',
        },
        trustedOrigins,
      ),
    ).toBe(false);
    expect(
      shouldGrantPermissionRequest(
        {
          permission: 'serial',
          isMainFrame: true,
          requestingUrl: 'app://app/index.html',
          currentUrl: 'https://evil.example/',
        },
        trustedOrigins,
      ),
    ).toBe(false);
  });

  it('grants serial device permission only to trusted renderer origins', () => {
    expect(
      shouldGrantDevicePermission({ deviceType: 'serial', origin: 'app://app' }, trustedOrigins),
    ).toBe(true);
    expect(
      shouldGrantDevicePermission(
        { deviceType: 'serial', origin: 'http://localhost:5173' },
        trustedOrigins,
      ),
    ).toBe(true);
    expect(
      shouldGrantDevicePermission(
        { deviceType: 'serial', origin: 'https://evil.example' },
        trustedOrigins,
      ),
    ).toBe(false);
    expect(
      shouldGrantDevicePermission({ deviceType: 'hid', origin: 'app://app' }, trustedOrigins),
    ).toBe(false);
  });

  it('denies renderer popups even when the URL is otherwise trusted', () => {
    expect(shouldAllowWindowOpen('app://app/help', trustedOrigins)).toBe(false);
    expect(shouldAllowWindowOpen('https://evil.example/', trustedOrigins)).toBe(false);
  });
});

describe('Electron main-process security wiring', () => {
  it('uses trusted-origin permission handlers and navigation guards', () => {
    const main = readMainProcessSource();

    expect(main).toContain('TRUSTED_RENDERER_ORIGINS');
    expect(main).toContain('resolveRendererRuntime');
    expect(main).toContain('app.isPackaged');
    expect(main).toContain('shouldGrantPermissionCheck');
    expect(main).toContain('requestingOrigin');
    expect(main).toContain('details.requestingUrl');
    expect(main).toContain('shouldGrantDevicePermission');
    expect(main).toContain("webContents.on('will-navigate'");
    expect(main).toContain('setWindowOpenHandler');
  });
});
