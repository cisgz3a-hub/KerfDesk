// @vitest-environment node
import type { VitePWAOptions } from 'vite-plugin-pwa';
import { describe, expect, it, vi } from 'vitest';

const capturePwa = vi.hoisted(() => vi.fn<(options: Partial<VitePWAOptions>) => []>(() => []));
vi.mock('vite-plugin-pwa', () => ({ VitePWA: capturePwa }));
import '../../../vite.config';

function workbox(): NonNullable<Partial<VitePWAOptions>['workbox']> {
  const options = capturePwa.mock.calls[0]?.[0];
  if (options?.workbox === undefined) throw new Error('Vite did not configure Workbox');
  return options.workbox;
}

// Workbox's NavigationRoute tests each deny pattern against pathname + search.
function answeredByAppShell(pathAndQuery: string): boolean {
  const url = new URL(pathAndQuery, 'https://kerfdesk.com');
  return !(workbox().navigateFallbackDenylist ?? []).some((pattern) =>
    pattern.test(url.pathname + url.search),
  );
}

describe('standalone checkout, download and support pages under the service worker', () => {
  it.each([
    '/buy.html?_ptxn=txn_01h8zzzzzzzzzzzzzzzzzzzzzz',
    '/buy?_ptxn=txn_01h8zzzzzzzzzzzzzzzzzzzzzz',
    '/buy.html',
    '/download.html?version=0.2.0-preview.14',
    '/download?version=0.2.0-preview.14',
    '/download.html',
    '/support.html',
    '/support',
  ])('never answers %s with the workspace', (page) => {
    expect(answeredByAppShell(page)).toBe(false);
  });

  it.each([
    '/',
    '/index.html',
    '/?project=recent',
    '/buyer-guide',
    '/downloads/help',
    '/supported-machines',
  ])('keeps the offline app shell for %s', (page) => {
    expect(answeredByAppShell(page)).toBe(true);
  });

  it('keeps the pages and the modules and keys they load out of the precache', () => {
    expect(workbox().globIgnores).toEqual(
      expect.arrayContaining([
        'buy.html',
        'download.html',
        'support.html',
        'desktop-*.{mjs,json,css}',
      ]),
    );
  });
});
