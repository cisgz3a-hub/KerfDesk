import { AiFailure } from './failure.js';
/** Bound streams as they arrive, including chunked bodies with no Content-Length. */
export async function readBoundedJson(
  source: Request | Response,
  limit: number,
  signal?: AbortSignal,
): Promise<unknown> {
  assertNotAborted(signal);
  assertDeclaredSize(source, limit);
  const reader = source.body?.getReader();
  if (reader === undefined) throw new AiFailure('Assistant payload is missing.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  const cancel = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) throw new AiFailure('Assistant payload too large.');
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    assertNotAborted(signal);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } finally {
    signal?.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}
function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new AiFailure('Assistant request cancelled or timed out.');
}
function assertDeclaredSize(source: Request | Response, limit: number): void {
  const declared = Number(source.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > limit)
    throw new AiFailure('Assistant payload too large.');
}
