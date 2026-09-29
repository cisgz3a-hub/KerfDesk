import { describe, expect, it, vi } from 'vitest';
import { createDesktopSupportLogReader } from './support-log';

describe('desktop support log reader', () => {
  it('asks the main process for the log with the support header', async () => {
    const fetchLog = vi.fn(async () => new Response('INFO  [app] KerfDesk started.\n'));
    await expect(createDesktopSupportLogReader(fetchLog)()).resolves.toBe(
      'INFO  [app] KerfDesk started.\n',
    );
    expect(fetchLog).toHaveBeenCalledExactlyOnceWith('./api/support/log', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'text/plain', 'X-KerfDesk-Support': '1' },
    });
  });

  it('reports a refused read instead of returning the error page as the log', async () => {
    const fetchLog = vi.fn(async () => new Response('Not Found', { status: 404 }));
    await expect(createDesktopSupportLogReader(fetchLog)()).rejects.toThrow(
      'The desktop log could not be read (404).',
    );
  });
});
