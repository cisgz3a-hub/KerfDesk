import { expect, test } from '@playwright/test';
import type { SerialWorkerResponse } from '../src/platform/web/serial-worker-protocol';

test('real serial Worker discards an oversized record across transferred-stream reads', async ({
  page,
}) => {
  await page.route('**/serial-framing-probe', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Framing probe</title>',
    }),
  );
  await page.goto('/serial-framing-probe');
  const result = await page.evaluate(async () => {
    const streamerPath = '/src/core/controllers/grbl/streamer.ts';
    const { createStreamer, step } = (await import(
      /* @vite-ignore */ streamerPath
    )) as typeof import('../src/core/controllers/grbl/streamer');
    const worker = new Worker('/src/platform/web/serial-stream-worker.ts', { type: 'module' });
    const messages: SerialWorkerResponse[] = [];
    const writes: string[] = [];
    const errors: string[] = [];
    let incoming: ReadableStreamDefaultController<Uint8Array> | undefined;
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        incoming = controller;
      },
    });
    const writable = new WritableStream<Uint8Array>({
      write(bytes) {
        writes.push(new TextDecoder().decode(bytes));
      },
    });
    worker.onmessage = (event: MessageEvent<SerialWorkerResponse>) => messages.push(event.data);
    worker.onerror = (event) => errors.push(event.message);
    const waitFor = async (predicate: () => boolean) => {
      const deadline = performance.now() + 10_000;
      while (!predicate()) {
        if (errors.length > 0 || performance.now() > deadline)
          throw new Error(JSON.stringify({ messages, writes, errors }));
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };
    const lines = () =>
      messages.flatMap((message) => (message.kind === 'line' ? [message.line] : []));
    try {
      worker.postMessage({ kind: 'attach', readable, writable }, [readable, writable]);
      const transferred = readable.locked && writable.locked;
      worker.postMessage({ kind: 'prepare-arm', id: 1 });
      await waitFor(() => messages.some((message) => message.kind === 'ready'));
      worker.postMessage({
        kind: 'arm',
        id: 1,
        streamer: step(createStreamer('G1 X1.000\nG1 X2.000\n', { rxBufferBytes: 11 })).state,
      });
      await waitFor(() => messages.some((message) => message.kind === 'armed'));

      incoming?.enqueue(new TextEncoder().encode('A'.repeat(65_537)));
      incoming?.enqueue(new TextEncoder().encode('ok\n[MSG:record boundary]\n'));
      await waitFor(() => lines().includes('[MSG:record boundary]'));
      const afterDiscard = { lines: lines(), writes: [...writes] };

      incoming?.enqueue(new TextEncoder().encode('ok\n'));
      await waitFor(() => writes.length === 1 && lines().includes('ok'));
      incoming?.close();
      await waitFor(() => messages.some((message) => message.kind === 'closed'));
      return { transferred, afterDiscard, lines: lines(), writes, errors };
    } finally {
      worker.terminate();
    }
  });

  expect(result.transferred).toBe(true);
  expect(result.afterDiscard).toEqual({ lines: ['[MSG:record boundary]'], writes: [] });
  expect(result.lines).toEqual(['[MSG:record boundary]', 'ok']);
  expect(result.writes).toEqual(['G1 X2.000\n']);
  expect(result.errors).toEqual([]);
});
