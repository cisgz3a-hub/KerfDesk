/// <reference lib="es2023" />
/// <reference lib="dom.iterable" />

import { expect, test } from '@playwright/test';
import type { NativeSerialFixtureSnapshot } from './fixtures/native-serial-worker';

test('native worker refills through a blocked window, releases for pause, and resumes in wire order', async ({
  page,
}, testInfo) => {
  await page.route('**/native-serial-background-probe', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Native serial ownership probe</title>',
    }),
  );
  await page.goto('/native-serial-background-probe');
  const result = await page.evaluate(async () => {
    const transportPath = '/src/platform/web/native-serial-connection.ts';
    const streamerPath = '/src/core/controllers/grbl/streamer.ts';
    const handlerPath = '/src/ui/state/laser-line-handler.ts';
    const supportPath = '/src/ui/state/laser-line-handler.test-support.ts';
    const safeWritePath = '/src/ui/state/laser-safe-write.ts';
    const hostingPath = '/src/ui/state/laser-hosted-refill.ts';
    const [transport, streaming, handlers, support, safeWrites, hosting] = await Promise.all([
      import(/* @vite-ignore */ transportPath) as Promise<
        typeof import('../src/platform/web/native-serial-connection')
      >,
      import(/* @vite-ignore */ streamerPath) as Promise<
        typeof import('../src/core/controllers/grbl/streamer')
      >,
      import(/* @vite-ignore */ handlerPath) as Promise<
        typeof import('../src/ui/state/laser-line-handler')
      >,
      import(/* @vite-ignore */ supportPath) as Promise<
        typeof import('../src/ui/state/laser-line-handler.test-support')
      >,
      import(/* @vite-ignore */ safeWritePath) as Promise<
        typeof import('../src/ui/state/laser-safe-write')
      >,
      import(/* @vite-ignore */ hostingPath) as Promise<
        typeof import('../src/ui/state/laser-hosted-refill')
      >,
    ]);
    const worker = new Worker('/e2e/fixtures/native-serial-worker.ts', { type: 'module' });
    let requestId = 0;
    const pendingSnapshots = new Map<number, (value: NativeSerialFixtureSnapshot) => void>();
    const errors: string[] = [];
    worker.addEventListener('error', (event) => errors.push(event.message));
    worker.addEventListener(
      'message',
      (
        event: MessageEvent<{
          kind: string;
          id: number;
          snapshot: NativeSerialFixtureSnapshot;
        }>,
      ) => {
        if (event.data.kind !== 'fixture-snapshot') return;
        pendingSnapshots.get(event.data.id)?.(event.data.snapshot);
        pendingSnapshots.delete(event.data.id);
      },
    );
    const snapshot = (): Promise<NativeSerialFixtureSnapshot> =>
      new Promise((resolve) => {
        const id = ++requestId;
        pendingSnapshots.set(id, resolve);
        worker.postMessage({ kind: 'fixture-snapshot', id });
      });
    const waitFor = async (predicate: () => boolean): Promise<void> => {
      const deadline = performance.now() + 15_000;
      while (!predicate()) {
        if (errors.length > 0 || performance.now() > deadline) {
          throw new Error(`Serial probe did not settle: ${errors.join('; ')}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };
    let windowOpenCount = 0;
    const selected: SerialPort = Object.assign(new EventTarget(), {
      readable: null,
      writable: null,
      getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
      open: async () => {
        windowOpenCount++;
        throw new Error('The picker handle must never open the port on the window.');
      },
      close: async () => undefined,
    });
    const connection = await transport.tryOpenNativeSerialConnection({
      port: selected,
      options: { baudRate: 115_200, bufferSize: 4096 },
      serial: { getPorts: async () => [selected] },
      createWorker: () => worker,
      timeoutMs: 10_000,
    });
    if (connection?.hostedStreaming === undefined) throw new Error('Native worker not available.');
    const h = support.makeLineHandlerHarness();
    const refs = { ...h.refs, connection, nextTranscriptId: 1 };
    const safeWrite = safeWrites.createSafeWrite(h.set, h.get, refs);
    const lines = Array.from(
      { length: 1000 },
      (_, i) => `G1 X${(i / 10).toFixed(3)} S${i % 2 === 0 ? 0 : 1000}\n`,
    );
    const first = streaming.step(streaming.createStreamer(lines.join(''), { rxBufferBytes: 128 }));
    h.set({ streamer: first.state, activeJobMachineKind: 'laser' });
    connection.onLine((line) => handlers.handleLine(h.set, h.get, refs, safeWrite, line));
    try {
      await safeWrite(first.toSend, undefined, 'job');
      await hosting.armHostedRefill(refs, () => h.get().streamer);
      await waitFor(() => (h.get().streamer?.completed ?? 0) >= 5);
      const before = await snapshot();
      const stallStart = performance.timeOrigin + performance.now();
      const stallUntil = performance.now() + 2000;
      while (performance.now() < stallUntil) {
        // Deliberately starve the window. A window-owned stream cannot refill.
      }
      const stallEnd = performance.timeOrigin + performance.now();
      const after = await snapshot();

      await hosting.releaseHostedRefill(refs);
      const running = h.get().streamer;
      if (running === null) throw new Error('The fixture job finished before its pause.');
      h.set({ streamer: streaming.pause(running) });
      await waitFor(() => h.get().streamer?.inFlight.length === 0);
      const paused = await snapshot();
      await new Promise((resolve) => setTimeout(resolve, 200));
      const stillPaused = await snapshot();
      const pausedState = h.get().streamer;
      if (pausedState === null) throw new Error('The paused stream was lost.');
      const resumed = streaming.step(streaming.resume(pausedState));
      h.set({ streamer: resumed.state });
      await safeWrite(resumed.toSend, undefined, 'job');
      await hosting.armHostedRefill(refs, () => h.get().streamer);
      const rearmed = connection.hostedStreaming.isArmed();
      await waitFor(() => (h.get().streamer?.completed ?? 0) === lines.length);
      const finished = await snapshot();
      return {
        before,
        after,
        paused,
        stillPaused,
        finished,
        stallStart,
        stallEnd,
        windowOpenCount,
        rearmed,
        expectedLines: lines.map((line) => line.trimEnd()),
        completed: h.get().streamer?.completed,
        errors,
      };
    } finally {
      await connection.close();
      worker.terminate();
    }
  });

  const duringStall = result.after.writes.filter(
    (write) => write.time >= result.stallStart && write.time <= result.stallEnd,
  );
  await testInfo.attach('native-serial-continuity.json', {
    contentType: 'application/json',
    body: JSON.stringify({
      blockedWindowMs: result.stallEnd - result.stallStart,
      linesWrittenDuringBlock: duringStall.length,
      controllerAcksDuringBlock:
        result.after.acknowledgements.length - result.before.acknowledgements.length,
      controllerHeartbeatsDuringBlock:
        result.after.heartbeats.length - result.before.heartbeats.length,
      completed: result.completed,
      windowOpenCount: result.windowOpenCount,
      nativeOpenOptions: result.finished.openOptions,
      pausedPendingLines: result.paused.pending,
      writesWhilePaused: result.stillPaused.writes.length - result.paused.writes.length,
      rearmed: result.rearmed,
    }),
  });
  expect(duringStall.length).toBeGreaterThan(50);
  expect(duringStall.some((write) => write.time > result.stallStart + 1500)).toBe(true);
  expect(result.before.protocol.some((message) => message.kind === 'armed')).toBe(true);
  expect(result.after.protocol.filter((message) => message.kind !== 'line')).toEqual(
    result.before.protocol.filter((message) => message.kind !== 'line'),
  );
  expect(
    result.after.acknowledgements.length - result.before.acknowledgements.length,
  ).toBeGreaterThan(50);
  expect(result.after.heartbeats.length - result.before.heartbeats.length).toBeGreaterThan(50);
  expect(result.paused.pending).toBe(0);
  expect(result.stillPaused.writes).toEqual(result.paused.writes);
  expect(result.rearmed).toBe(true);
  expect(
    result.finished.writes
      .filter((write) => write.line.startsWith('G1 '))
      .map((write) => write.line),
  ).toEqual(result.expectedLines);
  expect(result.completed).toBe(1000);
  expect(result.windowOpenCount).toBe(0);
  expect(result.finished.openOptions).toEqual([{ baudRate: 115_200, bufferSize: 4096 }]);
  expect(result.errors).toEqual([]);
});
