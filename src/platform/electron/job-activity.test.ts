import { describe, expect, it, vi } from 'vitest';
import { createDesktopJobActivityReporter } from './job-activity';

describe('the desktop job report (ADR-548)', () => {
  it('posts whether a job runs, and how far, to the main process', async () => {
    const fetchActivity = vi.fn(async () => new Response(null, { status: 204 }));
    await createDesktopJobActivityReporter(fetchActivity)({
      busy: true,
      job: { progress: 0.5, state: 'running' },
    });

    expect(fetchActivity).toHaveBeenCalledWith('./api/desktop/activity', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-KerfDesk-Desktop': '1' },
      body: '{"busy":true,"job":{"progress":0.5,"state":"running"}}',
    });
  });

  it('fails when the main process refuses the report', async () => {
    const report = createDesktopJobActivityReporter(
      async () => new Response(null, { status: 404 }),
    );
    await expect(report({ busy: false })).rejects.toThrow('The job report was refused (404).');
  });
});
