import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  checkForPreviewUpdate,
  createPreviewUpdateCheck,
  isExactPreviewUpdateApiRequest,
  PREVIEW_RELEASES_API_URL,
  type PreviewUpdateCheckOptions,
} from './preview-update.js';

function release(
  tag: string,
  options: {
    readonly asset?: string;
    readonly omitAsset?: string;
    readonly draft?: boolean;
    readonly immutable?: boolean;
    readonly prerelease?: boolean;
  } = {},
): unknown {
  const version = tag.startsWith('v') ? tag.slice(1) : tag;
  const canonicalAssets = [
    `KerfDesk-${version}-windows-x64-setup.exe`,
    `KerfDesk-${version}-macos-x64.dmg`,
    `KerfDesk-${version}-macos-arm64.dmg`,
    `KerfDesk-${version}-SHA256SUMS.txt`,
    `KerfDesk-${version}-release-manifest.json`,
    `KerfDesk-${version}-sbom.cdx.json`,
  ];
  return {
    tag_name: tag,
    draft: options.draft ?? false,
    prerelease: options.prerelease ?? true,
    immutable: options.immutable ?? true,
    assets: (options.asset === undefined ? canonicalAssets : [options.asset])
      .filter((name) => name !== options.omitAsset)
      .map((name) => ({ name })),
  };
}

function response(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), init);
}

function options(
  fetchReleases: PreviewUpdateCheckOptions['fetchReleases'],
  overrides: Partial<PreviewUpdateCheckOptions> = {},
): PreviewUpdateCheckOptions {
  return {
    enabled: true,
    currentVersion: '1.2.3-preview.4',
    platform: 'win32',
    arch: 'x64',
    fetchReleases,
    ...overrides,
  };
}

describe('unsigned Preview update discovery', () => {
  it('serves the reserved API response as non-cacheable nosniff JSON', () => {
    const main = readFileSync(join(process.cwd(), 'electron/main.ts'), 'utf8');
    expect(main).toContain("'Cache-Control': 'no-store'");
    expect(main).toContain("'Content-Type': 'application/json; charset=utf-8'");
    expect(main).toContain("'X-Content-Type-Options': 'nosniff'");
  });

  it('accepts only the exact same-origin GET endpoint', () => {
    expect(
      isExactPreviewUpdateApiRequest({
        method: 'GET',
        url: 'app://app/api/desktop-preview-update',
      }),
    ).toBe(true);
    for (const request of [
      { method: 'POST', url: 'app://app/api/desktop-preview-update' },
      { method: 'GET', url: 'app://evil/api/desktop-preview-update' },
      { method: 'GET', url: 'https://app/api/desktop-preview-update' },
      { method: 'GET', url: 'app://app/api/desktop-preview-update?again=1' },
      { method: 'GET', url: 'app://app/api/desktop-preview-update#fragment' },
      { method: 'GET', url: 'not a url' },
    ]) {
      expect(isExactPreviewUpdateApiRequest(request)).toBe(false);
    }
  });

  it('uses one pinned anonymous no-cache GitHub metadata request', async () => {
    const fetchReleases = vi.fn(() => Promise.resolve(response([])));
    await checkForPreviewUpdate(options(fetchReleases));
    expect(fetchReleases).toHaveBeenCalledOnce();
    const [url, init] = fetchReleases.mock.calls[0] ?? [];
    expect(url).toBe(PREVIEW_RELEASES_API_URL);
    expect(init).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    expect(init?.headers).toEqual({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'KerfDesk-Desktop-Preview',
    });
  });

  it('selects the highest newer immutable prerelease regardless of API order', async () => {
    const fetchReleases = vi.fn(() =>
      Promise.resolve(
        response([
          release('v1.2.3-preview.5'),
          release('v2.0.0-preview.1'),
          release('v1.9.9-preview.99'),
        ]),
      ),
    );
    await expect(checkForPreviewUpdate(options(fetchReleases))).resolves.toEqual({
      kind: 'available',
      version: '2.0.0-preview.1',
    });
  });

  it.each([
    ['win32', 'x64', 'KerfDesk-1.2.3-preview.5-windows-x64-setup.exe'],
    ['darwin', 'x64', 'KerfDesk-1.2.3-preview.5-macos-x64.dmg'],
    ['darwin', 'arm64', 'KerfDesk-1.2.3-preview.5-macos-arm64.dmg'],
  ] as const)(
    'requires the complete release and matching %s/%s binary',
    async (platform, arch, targetAsset) => {
      const complete = vi.fn(() => Promise.resolve(response([release('v1.2.3-preview.5')])));
      await expect(checkForPreviewUpdate(options(complete, { platform, arch }))).resolves.toEqual({
        kind: 'available',
        version: '1.2.3-preview.5',
      });

      const missingTarget = vi.fn(() =>
        Promise.resolve(response([release('v1.2.3-preview.5', { omitAsset: targetAsset })])),
      );
      await expect(
        checkForPreviewUpdate(options(missingTarget, { platform, arch })),
      ).resolves.toEqual({ kind: 'none' });
    },
  );

  it('compares arbitrarily large numeric identifiers without precision loss', async () => {
    const fetchReleases = vi.fn(() =>
      Promise.resolve(response([release('v9007199254740993.0.0-preview.0')])),
    );
    await expect(
      checkForPreviewUpdate(
        options(fetchReleases, { currentVersion: '9007199254740992.0.0-preview.999' }),
      ),
    ).resolves.toEqual({
      kind: 'available',
      version: '9007199254740993.0.0-preview.0',
    });
  });

  it.each([
    ['draft', release('v1.2.3-preview.5', { draft: true })],
    ['non-prerelease', release('v1.2.3-preview.5', { prerelease: false })],
    ['mutable', release('v1.2.3-preview.5', { immutable: false })],
    ['stable tag', release('v1.2.4')],
    ['leading zero', release('v1.2.3-preview.05')],
    ['incomplete asset set', release('v1.2.3-preview.5', { asset: 'wrong.exe' })],
  ])('rejects a %s release', async (_label, candidate) => {
    const fetchReleases = vi.fn(() => Promise.resolve(response([candidate])));
    await expect(checkForPreviewUpdate(options(fetchReleases))).resolves.toEqual({ kind: 'none' });
  });

  it('requires the current package itself to be a strict Preview build', async () => {
    const fetchReleases = vi.fn(() => Promise.resolve(response([release('v1.2.3-preview.5')])));
    await expect(
      checkForPreviewUpdate(options(fetchReleases, { currentVersion: '1.2.3' })),
    ).resolves.toEqual({ kind: 'none' });
    expect(fetchReleases).not.toHaveBeenCalled();
  });

  it('is inert when disabled or built for an unsupported target', async () => {
    const fetchReleases = vi.fn(() => Promise.resolve(response([])));
    await expect(
      checkForPreviewUpdate(options(fetchReleases, { enabled: false })),
    ).resolves.toEqual({ kind: 'none' });
    await expect(
      checkForPreviewUpdate(options(fetchReleases, { platform: 'linux' })),
    ).resolves.toEqual({ kind: 'none' });
    expect(fetchReleases).not.toHaveBeenCalled();
  });

  it('fails silently for HTTP, malformed, oversized, and network failures', async () => {
    const onError = vi.fn();
    const cases = [
      vi.fn(() => Promise.resolve(response([], { status: 403 }))),
      vi.fn(() => Promise.resolve(new Response('{bad-json'))),
      vi.fn(() =>
        Promise.resolve(new Response('[]', { headers: { 'content-length': String(513 * 1024) } })),
      ),
      vi.fn(() => Promise.resolve(new Response('x'.repeat(513 * 1024)))),
      vi.fn(() => Promise.reject(new Error('offline'))),
    ];
    for (const fetchReleases of cases) {
      await expect(checkForPreviewUpdate(options(fetchReleases, { onError }))).resolves.toEqual({
        kind: 'none',
      });
    }
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('coalesces repeated renderer requests to one check per app launch', async () => {
    const fetchReleases = vi.fn(() => Promise.resolve(response([])));
    const check = createPreviewUpdateCheck(options(fetchReleases));
    await Promise.all([check(), check(), check()]);
    expect(fetchReleases).toHaveBeenCalledOnce();
  });
});
