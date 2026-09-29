// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fixture, keySet, rawEnvelope } from '../scripts/preview-release-test-support.mjs';
import {
  checkForPreviewUpdate,
  createPreviewUpdateCheck,
  isExactPreviewUpdateApiRequest,
  PREVIEW_MANIFEST_URL,
  type PreviewUpdateCheckOptions,
} from './preview-update.js';
function options(
  fetchWorkflowRuns: PreviewUpdateCheckOptions['fetchWorkflowRuns'],
  overrides: Partial<PreviewUpdateCheckOptions> = {},
): PreviewUpdateCheckOptions {
  return {
    enabled: true,
    currentVersion: '0.2.0-preview.13',
    platform: 'win32',
    arch: 'x64',
    trustedKeys: keySet,
    fetchWorkflowRuns,
    ...overrides,
  };
}
describe('publisher-signed notify-only Preview update discovery', () => {
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

  it('makes one pinned anonymous request and exposes only the newer verified version', async () => {
    const request = vi.fn<PreviewUpdateCheckOptions['fetchWorkflowRuns']>(() =>
      Promise.resolve(new Response(rawEnvelope())),
    );
    const check = createPreviewUpdateCheck(options(request));
    expect(await check()).toEqual({ kind: 'available', version: '0.2.0-preview.14' });
    await check();
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      PREVIEW_MANIFEST_URL,
      expect.objectContaining({
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: { Accept: 'application/json', 'User-Agent': 'KerfDesk-Desktop-Preview' },
      }),
    );
  });
  it.each(['0.2.0-preview.13', '0.2.0-preview.12'])(
    'never offers same or older signed release %s',
    async (version) => {
      expect(
        await checkForPreviewUpdate(
          options(() => Promise.resolve(new Response(rawEnvelope(fixture(version).payload)))),
        ),
      ).toEqual({ kind: 'none' });
    },
  );
  it('fails closed for signature substitution, unknown key, malformed payload and oversized body', async () => {
    const tampered = JSON.parse(rawEnvelope());
    tampered.signature = Buffer.alloc(64).toString('base64');
    for (const body of [JSON.stringify(tampered), '{}', 'x'.repeat(128 * 1024 + 1)]) {
      expect(
        await checkForPreviewUpdate(options(() => Promise.resolve(new Response(body)))),
      ).toEqual({ kind: 'none' });
    }
    expect(
      await checkForPreviewUpdate(
        options(() => Promise.resolve(new Response(rawEnvelope())), {
          trustedKeys: { schemaVersion: 1, keys: [] },
        }),
      ),
    ).toEqual({ kind: 'none' });
  });
  it('silently ignores offline and HTTP errors, caching failure for this launch', async () => {
    const request = vi.fn(() => Promise.reject(new Error('offline')));
    const check = createPreviewUpdateCheck(options(request));
    expect(await check()).toEqual({ kind: 'none' });
    await check();
    expect(request).toHaveBeenCalledOnce();
    expect(
      await checkForPreviewUpdate(
        options(() => Promise.resolve(new Response('', { status: 503 }))),
      ),
    ).toEqual({ kind: 'none' });
  });
  it('does not request metadata for disabled, stable or unsupported installations', async () => {
    const request = vi.fn(() => Promise.resolve(new Response(rawEnvelope())));
    for (const override of [
      { enabled: false },
      { currentVersion: '1.0.0' },
      { platform: 'linux' as const },
      { platform: 'win32' as const, arch: 'arm64' },
    ])
      expect(await checkForPreviewUpdate(options(request, override))).toEqual({ kind: 'none' });
    expect(request).not.toHaveBeenCalled();
  });
  it.each(['x64', 'arm64'])('supports verified macOS %s notification', async (arch) => {
    expect(
      await checkForPreviewUpdate(
        options(() => Promise.resolve(new Response(rawEnvelope())), { platform: 'darwin', arch }),
      ),
    ).toEqual({ kind: 'available', version: '0.2.0-preview.14' });
  });
  it('aborts a stalled metadata request after eight seconds', async () => {
    vi.useFakeTimers();
    try {
      const check = checkForPreviewUpdate(
        options(
          (_url, init) =>
            new Promise((_resolve, reject) =>
              init.signal?.addEventListener('abort', () => reject(new Error('timeout'))),
            ),
        ),
      );
      await vi.advanceTimersByTimeAsync(8_000);
      expect(await check).toEqual({ kind: 'none' });
    } finally {
      vi.useRealTimers();
    }
  });
});
