import { findFontEntry } from '../../core/text/font-registry';
import type { TextRenderResult } from '../../core/text/text-to-polylines';
import { applyTextWeld } from './apply-text-weld';
import type { TextWeldWorkerResponse } from './text-weld-worker-protocol';

const PROCESSING_FAILED = 'Text outline processing failed. Try again or turn off Weld overlaps.';

/** One owned worker per draft/save, so cancellation interrupts the synchronous
 * geometry engine without blocking canvas input or retaining obsolete work. */
export async function applyTextWeldInWorker(
  rendered: TextRenderResult,
  fontKey: string,
  enabled: boolean | undefined,
  signal?: AbortSignal,
): Promise<TextRenderResult> {
  signal?.throwIfAborted();
  if (!enabled || findFontEntry(fontKey)?.geometry === 'single-line') return rendered;
  if (typeof Worker === 'undefined') {
    // SSR and Vitest have no browser worker runtime. A real browser must never
    // silently move this expensive union back onto its input thread.
    const nodeTest =
      import.meta.env.MODE === 'test' &&
      typeof process !== 'undefined' &&
      process.versions?.node !== undefined;
    if (import.meta.env.SSR || nodeTest) return applyTextWeld(rendered, fontKey, enabled);
    throw new Error(PROCESSING_FAILED);
  }
  return dispatchTextWeld(rendered, signal);
}

function dispatchTextWeld(
  rendered: TextRenderResult,
  signal: AbortSignal | undefined,
): Promise<TextRenderResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./text-weld-worker.ts', import.meta.url), { type: 'module' });
    } catch {
      reject(new Error(PROCESSING_FAILED));
      return;
    }
    let settled = false;
    const dispose = (): void => {
      settled = true;
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      signal?.removeEventListener('abort', abort);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      dispose();
      reject(error);
    };
    const abort = (): void => fail(new DOMException('Text editing cancelled.', 'AbortError'));
    worker.onmessage = (event: MessageEvent<TextWeldWorkerResponse>): void => {
      if (settled) return;
      const response = event.data;
      if (response.kind === 'error') {
        fail(
          new Error(
            `Could not weld this text. ${response.error.message} Adjust the text or turn off Weld overlaps.`,
          ),
        );
        return;
      }
      dispose();
      resolve(response.value);
    };
    worker.onerror = (): void => fail(new Error(PROCESSING_FAILED));
    worker.onmessageerror = (): void => fail(new Error(PROCESSING_FAILED));
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    try {
      worker.postMessage(rendered);
    } catch {
      fail(new Error(PROCESSING_FAILED));
    }
  });
}
