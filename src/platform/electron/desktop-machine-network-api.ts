export type MachineNetworkRequest = (
  action: 'open' | 'read' | 'write' | 'close',
  body: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

export function machineNetworkRequest(fetcher: typeof fetch = fetch): MachineNetworkRequest {
  return async (action, body) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), action === 'open' ? 8000 : 5000);
    try {
      const response = await fetcher(`app://app/api/machine-network/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-KerfDesk-Machine-Network': '1' },
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
