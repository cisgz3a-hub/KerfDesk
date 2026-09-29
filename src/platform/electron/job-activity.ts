type FetchActivity = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Tells the main process whether a job runs (ADR-548), through the same-origin
 * route electron/session-end-guard.ts serves, so a Windows restart, shutdown
 * or sign-out can be asked to wait until the job is over.
 */
export function createDesktopJobActivityReporter(
  fetchActivity: FetchActivity = (input, init) => fetch(input, init),
): (busy: boolean) => Promise<void> {
  return async (busy) => {
    const response = await fetchActivity('./api/desktop/activity', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-KerfDesk-Desktop': '1' },
      body: JSON.stringify({ busy }),
    });
    if (!response.ok) throw new Error(`The job report was refused (${response.status}).`);
  };
}
