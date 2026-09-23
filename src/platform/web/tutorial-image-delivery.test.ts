// @vitest-environment node
import type { VitePWAOptions } from 'vite-plugin-pwa';
import { describe, expect, it, vi } from 'vitest';

const capturePwa = vi.hoisted(() => vi.fn<(options: Partial<VitePWAOptions>) => []>(() => []));
vi.mock('vite-plugin-pwa', () => ({ VitePWA: capturePwa }));
import '../../../vite.config';

function pwaOptions(): Partial<VitePWAOptions> {
  const options = capturePwa.mock.calls[0]?.[0];
  if (options === undefined) throw new Error('Vite did not configure the PWA plugin');
  return options;
}

function imageRoute() {
  const route = pwaOptions().workbox?.runtimeCaching?.find(
    (entry) => entry.options?.cacheName === 'kerfdesk-tutorial-images-v1',
  );
  if (route === undefined) throw new Error('Tutorial image route missing');
  return route;
}

function matches(path: string, destination: RequestDestination = 'image', sameOrigin = true) {
  const matcher = imageRoute().urlPattern;
  if (typeof matcher !== 'function') throw new Error('Expected a request-aware route');
  const url = new URL(path, 'https://kerfdesk.example');
  const request = new Request(url);
  Object.defineProperty(request, 'destination', { value: destination });
  // This route only reads request, URL and origin; no FetchEvent methods are needed.
  return matcher({ request, url, sameOrigin } as Parameters<typeof matcher>[0]) === true;
}

describe('tutorial picture delivery', () => {
  it('excludes the entire picture directory without changing the existing offline app policy', () => {
    const options = pwaOptions();
    expect(options.workbox?.globIgnores).toContain('**/tutorial-images/**');
    expect(options.workbox?.globIgnores).toContain('**/node_modules/**/*');
    expect(options.workbox?.globPatterns).toEqual([
      '**/*.{js,mjs,css,html,svg,ico,png,json,ttf,woff,woff2,bcmap,pfb}',
      'pdf-resources/**/LICENSE*',
      'third-party-notices.txt',
    ]);
    expect(options.includeAssets).not.toEqual(
      expect.arrayContaining([expect.stringContaining('tutorial-images')]),
    );
    expect(options.registerType).toBe('prompt');
    expect(options.injectRegister).toBe(false);
    expect(options.workbox?.maximumFileSizeToCacheInBytes).toBe(6 * 1024 * 1024);
  });

  it.each([
    '/tutorial-images/rectangle-960-a1b2.webp',
    '/tutorial-images/v1/text-640.webp',
    '/preview/tutorial-images/text-1280.webp?v=2',
  ])('matches a displayed same-origin WebP picture at %s', (url) => {
    expect(matches(url)).toBe(true);
  });

  it.each([
    '/tutorial-images/rectangle.png',
    '/tutorial-images/index.json',
    '/assets/rectangle.webp',
    '/other-tutorial-images/rectangle.webp',
    '/tutorial-images/rectangle.webp/script.js',
  ])('leaves non-tutorial-WebP requests alone at %s', (url) => {
    expect(matches(url)).toBe(false);
  });

  it('does not catch cross-origin pictures, navigations or generic fetches', () => {
    const path = '/tutorial-images/rectangle.webp';
    expect(matches(path, 'image', false)).toBe(false);
    expect(matches(path, 'document')).toBe(false);
    expect(matches(path, '')).toBe(false);
    expect(imageRoute().method).toBe('GET');
  });

  it('caches only successful WebP responses on demand with bounded storage', () => {
    const route = imageRoute();
    expect(route.handler).toBe('CacheFirst');
    expect(route.options?.cacheableResponse).toEqual({
      statuses: [200],
      headers: { 'Content-Type': 'image/webp' },
    });
    expect(route.options?.expiration).toEqual({
      maxEntries: 64,
      maxAgeSeconds: 30 * 24 * 60 * 60,
      purgeOnQuotaError: true,
    });
    expect(pwaOptions().workbox?.additionalManifestEntries).toBeUndefined();
    expect(route.options?.backgroundSync).toBeUndefined();
  });
});
