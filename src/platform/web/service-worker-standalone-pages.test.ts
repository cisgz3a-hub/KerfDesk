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

// Workbox NavigationRoute matches pathname + search against allow and deny
// patterns. Test each exclusion as well as the resulting app-shell decision.
function deniedFromAppShell(pathAndQuery: string): boolean {
  const url = new URL(pathAndQuery, 'https://kerfdesk.com');
  return (workbox().navigateFallbackDenylist ?? []).some((pattern) =>
    pattern.test(url.pathname + url.search),
  );
}

function answeredByAppShell(pathAndQuery: string): boolean {
  const url = new URL(pathAndQuery, 'https://kerfdesk.com');
  return (
    (workbox().navigateFallbackAllowlist ?? []).some((pattern) =>
      pattern.test(url.pathname + url.search),
    ) && !deniedFromAppShell(pathAndQuery)
  );
}

describe('standalone checkout, download, support and legal pages under the service worker', () => {
  it.each([
    '/buy.html?_ptxn=txn_01h8zzzzzzzzzzzzzzzzzzzzzz',
    '/buy?_ptxn=txn_01h8zzzzzzzzzzzzzzzzzzzzzz',
    '/buy.html',
    '/download.html?version=0.2.0-preview.14',
    '/download?version=0.2.0-preview.14',
    '/download.html',
    '/support.html',
    '/support',
    '/privacy/',
    '/privacy/index.html',
    '/privacy/?version=2',
    '/pricing',
    '/pricing/',
    '/pricing/index.html',
    '/pricing/?country=ZA',
    '/refunds',
    '/refunds/',
    '/terms',
    '/terms/',
    '/terms/index.html',
    '/terms/?version=1',
    '/refunds/index.html?version=2',
  ])('excludes %s from the workspace fallback', (page) => {
    expect(deniedFromAppShell(page)).toBe(true);
    expect(answeredByAppShell(page)).toBe(false);
  });

  it.each(['/', '/index.html', '/?project=recent'])(
    'keeps the offline app shell for the entry %s',
    (page) => {
      expect(answeredByAppShell(page)).toBe(true);
    },
  );

  it.each([
    '/buyer-guide',
    '/downloads/help',
    '/supported-machines',
    '/pricing-guide',
    '/refunds-help',
    '/terms-help',
    '/privacy-tools',
  ])('does not deny the unrelated path %s by a partial name match', (page) => {
    expect(deniedFromAppShell(page)).toBe(false);
  });

  it('keeps standalone documents and their loaded modules/keys out of the precache', () => {
    expect(workbox().globIgnores).toEqual(
      expect.arrayContaining([
        'buy.html',
        'download.html',
        'support.html',
        'privacy/**',
        'pricing/**',
        'refunds/**',
        'terms/**',
        'desktop-*.{mjs,json,css}',
      ]),
    );
  });
});
