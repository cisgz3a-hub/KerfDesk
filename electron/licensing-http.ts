import { record } from './licensing-verification.js';

export class LicenceServiceError extends Error {
  constructor(readonly code: string) {
    super('Licence service request failed');
  }
}

export function licensingRequest(
  apiOrigin: string,
  fetchRequest: (url: string, init: RequestInit) => Promise<Response>,
) {
  return async (path: string, body: unknown): Promise<unknown> => {
    const response = await fetchRequest(`${apiOrigin}${path}`, {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const value: unknown = JSON.parse(await readBoundedResponse(response));
    if (!response.ok) {
      const code = record(value) && record(value.error) ? value.error.code : null;
      throw new LicenceServiceError(typeof code === 'string' ? code : 'unavailable');
    }
    return value;
  };
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (response.body === null) throw new Error('Empty licence response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65_536) {
        await reader.cancel();
        throw new Error('Licence response too large');
      }
      chunks.push(part.value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
  } finally {
    reader.releaseLock();
  }
}
