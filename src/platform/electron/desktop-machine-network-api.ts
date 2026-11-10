export type MachineNetworkRequest = (
  action: 'open' | 'read' | 'write' | 'close',
  body: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** The desktop main process's network routes (electron/machine-network-routes.ts).
 * The streaming worker is told this route, since it cannot import this file
 * (platform/web; ADR-676). */
export const MACHINE_NETWORK_ROUTE = {
  url: 'app://app/api/machine-network/',
  header: 'X-KerfDesk-Machine-Network',
} as const;

// The request deadline counts time in steps, and one step adds at most
// REQUEST_DEADLINE_STEP_MAX_MS: a step that ran late measured the window's own
// stall (a long task, system sleep), during which a reply that had already
// arrived waits behind the timer for its body to be read (ADR-356 Amendment 2).
const REQUEST_DEADLINE_STEP_MS = 250;
const REQUEST_DEADLINE_STEP_MAX_MS = 500;

/** Calls `expire` once `timeoutMs` of time this thread was running has passed. */
export function runningTimeDeadline(timeoutMs: number, expire: () => void): () => void {
  let remaining = timeoutMs;
  let last = Date.now();
  let timer: ReturnType<typeof setTimeout>;
  const step = (): void => {
    const now = Date.now();
    remaining -= Math.min(Math.max(0, now - last), REQUEST_DEADLINE_STEP_MAX_MS);
    last = now;
    if (remaining <= 0) expire();
    else timer = setTimeout(step, Math.min(REQUEST_DEADLINE_STEP_MS, remaining));
  };
  timer = setTimeout(step, Math.min(REQUEST_DEADLINE_STEP_MS, timeoutMs));
  return () => clearTimeout(timer);
}

/** The desktop main process's Ruida UDP routes (electron/ruida-network-routes.ts, ADR-697). */
export const RUIDA_NETWORK_ROUTE = {
  url: 'app://app/api/ruida-network/',
  header: 'X-KerfDesk-Ruida-Network',
} as const;

export function machineNetworkRequest(
  fetcher: typeof fetch = fetch,
  route: { readonly url: string; readonly header: string } = MACHINE_NETWORK_ROUTE,
): MachineNetworkRequest {
  return async (action, body) => {
    const controller = new AbortController();
    const cancelDeadline = runningTimeDeadline(action === 'open' ? 8000 : 5000, () =>
      controller.abort(),
    );
    try {
      const response = await fetcher(`${route.url}${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [route.header]: '1' },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: 'no-store',
      });
      const text = await response.text();
      if (text.length > 800_000) throw new Error('Network response exceeds its local limit.');
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        throw new Error('Invalid network response.');
      const record = parsed as Record<string, unknown>;
      if (!response.ok)
        throw new Error(
          typeof record['error'] === 'string' ? record['error'] : 'Desktop network request failed.',
        );
      return record;
    } finally {
      cancelDeadline();
    }
  };
}
