export type MachineNetworkRequest = (
  action: 'open' | 'read' | 'write' | 'close',
  body: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** The desktop main process's network routes (electron/machine-network-routes.ts).
 * The streaming worker is told this route, since it cannot import this file
 * (platform/web; ADR-675). */
export const MACHINE_NETWORK_ROUTE = {
  url: 'app://app/api/machine-network/',
  header: 'X-KerfDesk-Machine-Network',
} as const;

export function machineNetworkRequest(fetcher: typeof fetch = fetch): MachineNetworkRequest {
  return async (action, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), action === 'open' ? 8000 : 5000);
    try {
      const response = await fetcher(`${MACHINE_NETWORK_ROUTE.url}${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [MACHINE_NETWORK_ROUTE.header]: '1' },
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
      clearTimeout(timer);
    }
  };
}
