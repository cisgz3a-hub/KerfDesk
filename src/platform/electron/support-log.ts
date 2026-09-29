type FetchLog = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Reads the newest part of the desktop support log (ADR-546) from the main
 * process, through the same-origin route electron/support-routes.ts serves.
 */
export function createDesktopSupportLogReader(
  fetchLog: FetchLog = (input, init) => fetch(input, init),
): () => Promise<string> {
  return async () => {
    const response = await fetchLog('./api/support/log', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'text/plain', 'X-KerfDesk-Support': '1' },
    });
    if (!response.ok) throw new Error(`The desktop log could not be read (${response.status}).`);
    return response.text();
  };
}
