import {
  parseAiDraft,
  type AiAssistant,
  type AiRequest,
  type AiStatus,
} from '../../core/ai/assistant';

type RouteFetch = (input: string, init: RequestInit) => Promise<Response>;
export function createDesktopAiAssistant(fetchRoute: RouteFetch = fetch): AiAssistant {
  const call = async (
    action: string,
    body?: unknown,
    signal?: AbortSignal,
    requestId?: string,
  ): Promise<unknown> => {
    const response = await fetchRoute(`./api/assistant/${action}`, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'X-KerfDesk-Assistant': '1',
        'Content-Type': 'application/json',
        ...(requestId === undefined ? {} : { 'X-KerfDesk-Assistant-Request': requestId }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    });
    const value: unknown = await response.json();
    if (!response.ok) throw new Error(failure(value));
    return value;
  };
  return {
    status: async () => parseStatus(await call('status')),
    configure: async (apiKey, model) => parseStatus(await call('configure', { apiKey, model })),
    forget: async () => parseStatus(await call('forget', {})),
    async generate(request: AiRequest, signal: AbortSignal) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const requestId = crypto.randomUUID();
      const cancel = () => {
        void call('cancel', { requestId }).catch(() => undefined);
      };
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const value = await call('generate', { requestId, request }, signal, requestId);
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        return parseAiDraft(value, request);
      } finally {
        signal.removeEventListener('abort', cancel);
      }
    },
  };
}
function parseStatus(value: unknown): AiStatus {
  if (
    !record(value) ||
    typeof value['configured'] !== 'boolean' ||
    typeof value['secureStorage'] !== 'boolean' ||
    typeof value['model'] !== 'string' ||
    value['model'].length > 200
  )
    throw new Error('Assistant status is unavailable.');
  return {
    configured: value['configured'],
    secureStorage: value['secureStorage'],
    model: value['model'],
  };
}
function failure(value: unknown): string {
  return record(value) && typeof value['error'] === 'string' && value['error'].length <= 300
    ? value['error']
    : 'Assistant is unavailable in this app. No changes were applied.';
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
