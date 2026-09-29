// @vitest-environment node
// The service worker answers a navigation its precache cannot with the app
// shell only at the deploy root. Anywhere deeper, index.html's relative chunk
// URLs (base './') resolve under that path and the page hangs on its splash.
// Node environment for the same reason as tutorial-image-delivery.test.ts.
import type { VitePWAOptions } from 'vite-plugin-pwa';
import { describe, expect, it, vi } from 'vitest';

const capturePwa = vi.hoisted(() => vi.fn<(options: Partial<VitePWAOptions>) => []>(() => []));
vi.mock('vite-plugin-pwa', () => ({ VitePWA: capturePwa }));
import '../../../vite.config';

// Workbox's NavigationRoute tests each allowlist pattern against the URL's
// pathname plus search (workbox-routing/NavigationRoute.js, _match).
function getsAppShell(path: string): boolean {
  const allowlist = capturePwa.mock.calls[0]?.[0].workbox?.navigateFallbackAllowlist;
  if (allowlist === undefined) throw new Error('The navigation fallback has no allowlist');
  const url = new URL(path, 'https://kerfdesk.example');
  return allowlist.some((pattern) => pattern.test(url.pathname + url.search));
}

describe('service-worker navigation fallback', () => {
  it.each(['/', '/?ref=newsletter', '/index.html', '/index.html?source=pwa'])(
    'serves the app shell for the entry at %s',
    (path) => {
      expect(getsAppShell(path)).toBe(true);
    },
  );

  it.each(['/projects/coaster', '/projects/?source=pwa', '/download/', '/eula.txt'])(
    'leaves %s to the server',
    (path) => {
      expect(getsAppShell(path)).toBe(false);
    },
  );
});
