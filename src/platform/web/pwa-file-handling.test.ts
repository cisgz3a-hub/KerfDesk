// @vitest-environment node
import type { VitePWAOptions } from 'vite-plugin-pwa';
import { describe, expect, it, vi } from 'vitest';

const capturePwa = vi.hoisted(() => vi.fn<(options: Partial<VitePWAOptions>) => []>(() => []));
vi.mock('vite-plugin-pwa', () => ({ VitePWA: capturePwa }));
import '../../../vite.config';

function manifest() {
  const value = capturePwa.mock.calls[0]?.[0].manifest;
  if (value === undefined || value === false) throw new Error('The PWA manifest is missing');
  return value;
}

describe('installed web app file handling (ADR-378)', () => {
  it('opens KerfDesk projects from the file manager in the window already open', () => {
    expect(manifest().file_handlers).toEqual([
      { action: '.', accept: { 'application/x-kerfdesk-project': ['.lf2'] } },
    ]);
    expect(manifest().launch_handler).toEqual({ client_mode: 'focus-existing' });
  });

  it('hands launched files to the app page itself', () => {
    expect(manifest().start_url).toBe('.');
    for (const handler of manifest().file_handlers ?? []) {
      expect(handler.action).toBe(manifest().start_url);
    }
  });

  it('leaves LightBurn files to LightBurn', () => {
    expect(JSON.stringify(manifest().file_handlers)).not.toMatch(/lbrn/i);
  });
});
