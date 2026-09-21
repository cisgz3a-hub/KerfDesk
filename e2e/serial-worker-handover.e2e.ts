import { expect, test } from '@playwright/test';
import type {
  SerialWorkerRequest,
  SerialWorkerResponse,
} from '../src/platform/web/serial-worker-protocol';

type Scenario = 'before-prepare' | 'at-barrier' | 'across-release' | 'timeout' | 'invalidate';

test.beforeEach(async ({ page }) => {
  // A same-origin document for Vite imports, without mounting the machine UI.
  await page.route('**/serial-worker-probe', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Serial worker probe</title>',
    }),
  );
  await page.goto('/serial-worker-probe');
});

for (const scenario of ['before-prepare', 'at-barrier', 'across-release'] as const) {
  test(`real serial Worker streams each line once through ${scenario}`, async ({ page }) => {
    const workerUrls: string[] = [];
    page.on('worker', (worker) => workerUrls.push(worker.url()));
    const result = await page.evaluate(runWorkerScenario, { scenario });
    expect(
      workerUrls.some((url) => url.includes('/src/platform/web/serial-stream-worker.ts')),
    ).toBe(true);
    expect(result.transferredStreams).toBe(2);
    expect(result.streamsLockedAfterTransfer).toBe(true);
    expect(result.writes).toEqual(result.programLines);
    expect(result.delivered).toEqual(result.expectedInbound);
    expect(result.completed).toBe(6);
    expect(result.status).toBe('done');
    expect(result.capturedCompleted).toEqual([scenario === 'before-prepare' ? 1 : 0]);
    expect(result.responses).toContain('ready');
    expect(result.responses).toContain('armed');
    expect(result.responses).toContain('released');
    expect(result.blockedLineCount).toBe(0);
    expect(result.writeErrors).toEqual([]);
    expect(result.closed && result.terminated && result.portClosed).toBe(true);
  });
}

test('real serial Worker timeout closes uncertain ownership without fallback writes', async ({
  page,
}) => {
  const result = await page.evaluate(runWorkerScenario, { scenario: 'timeout' } as const);
  expect(result.writes).toEqual(result.programLines.slice(0, 2));
  expect(result.delivered).toEqual(['ok']);
  expect(result.closed && result.terminated && result.portClosed).toBe(true);
  expect(result.writeRejectedAfterClose).toBe(true);
});

for (const [label, invalidation] of [
  ['reboot', "Grbl 1.1h ['$' for help]"],
  ['MPG takeover', '<Run|MPos:1,0,0|FS:100,0|MPG:1>'],
  ['Alarm status', '<Alarm|MPos:1,0,0|FS:0,0>'],
] as const) {
  test(`real serial Worker stops before same-chunk acknowledgements after ${label}`, async ({
    page,
  }) => {
    const result = await page.evaluate(runWorkerScenario, {
      scenario: 'invalidate',
      invalidation,
    } as const);
    expect(result.writes).toEqual(result.programLines.slice(0, 1));
    expect(result.delivered).toEqual([invalidation, 'ok', 'ok']);
    expect(result.responses.indexOf('refill-stopped')).toBeGreaterThan(
      result.responses.indexOf('line'),
    );
    expect(result.armedAfterInvalidation).toBe(false);
    expect(result.writeErrors).toEqual([]);
  });
}

/** Runs wholly in Chromium: the production module Worker owns transferred
 * streams. Only selected outbound handover messages are delayed so both sides
 * of each ownership boundary are exercised deterministically. */
async function runWorkerScenario(args: {
  readonly scenario: Scenario;
  readonly invalidation?: string;
}) {
  const connectionPath = '/src/platform/web/worker-serial-connection.ts';
  const streamerPath = '/src/core/controllers/grbl/streamer.ts';
  const pumpPath = '/src/core/controllers/grbl/stream-pump.ts';
  const { createWorkerSerialConnection } = (await import(
    /* @vite-ignore */ connectionPath
  )) as typeof import('../src/platform/web/worker-serial-connection');
  const { createStreamer, step } = (await import(
    /* @vite-ignore */ streamerPath
  )) as typeof import('../src/core/controllers/grbl/streamer');
  const { pumpInboundLine } = (await import(
    /* @vite-ignore */ pumpPath
  )) as typeof import('../src/core/controllers/grbl/stream-pump');
  const worker = new Worker('/src/platform/web/serial-stream-worker.ts', { type: 'module' });
  const written: string[] = [];
  const delivered: string[] = [];
  const expectedInbound: string[] = [];
  const responses: string[] = [];
  const writeErrors: string[] = [];
  const capturedCompleted: number[] = [];
  const listeners = new Set<(response: SerialWorkerResponse) => void>();
  const waiters = new Set<() => void>();
  const changed = () => {
    for (const check of waiters) check();
  };
  const until = (predicate: () => boolean, label: string) =>
    new Promise<void>((resolve, reject) => {
      if (predicate()) return resolve();
      const timer = setTimeout(() => {
        waiters.delete(check);
        reject(
          new Error(
            `Timed out: ${label}; writes=${JSON.stringify(written)}; inbound=${JSON.stringify(delivered)}; errors=${JSON.stringify(writeErrors)}`,
          ),
        );
      }, 10_000);
      const check = () => {
        if (!predicate()) return;
        clearTimeout(timer);
        waiters.delete(check);
        resolve();
      };
      waiters.add(check);
    });
  let incoming: ReadableStreamDefaultController<Uint8Array> | undefined;
  const readable = new ReadableStream<Uint8Array>({
    start: (controller) => {
      incoming = controller;
    },
  });
  const writable = new WritableStream<Uint8Array>({
    write: (bytes) => {
      written.push(new TextDecoder().decode(bytes));
      changed();
    },
  });
  let deferKind: SerialWorkerRequest['kind'] | null = null;
  const held: SerialWorkerRequest[] = [];
  let transferredStreams = 0;
  let terminated = false;
  let closed = false;
  let portClosed = false;
  worker.onmessage = (event: MessageEvent<SerialWorkerResponse>) => {
    responses.push(event.data.kind);
    for (const listener of listeners) listener(event.data);
    changed();
  };
  worker.onerror = (event) => {
    writeErrors.push(event.message);
    changed();
  };
  const connection = createWorkerSerialConnection({
    timeoutMs: args.scenario === 'timeout' ? 500 : 5_000,
    bridge: {
      postMessage: (message, transfer) => {
        if (message.kind === deferKind) held.push(message);
        else {
          transferredStreams += transfer?.length ?? 0;
          worker.postMessage(message, (transfer ?? []) as Transferable[]);
        }
        changed();
      },
      onMessage: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      terminate: () => {
        terminated = true;
        worker.terminate();
      },
    },
    port: {
      readable,
      writable,
      close: async () => {
        portClosed = true;
      },
    },
  });
  const streamsLockedAfterTransfer = readable.locked && writable.locked;
  connection.onClose(() => {
    closed = true;
    changed();
  });
  const programLines = Array.from({ length: 6 }, (_, index) => `G1 X${index + 1}.000\n`);
  const first = step(createStreamer(programLines.join(''), { rxBufferBytes: 11 }));
  let main = first.state;
  connection.onLine((line) => {
    delivered.push(line);
    // Worker-only invalidation check: the consumer retires its own queue, as
    // the separately tested production renderer containment does.
    if (line === args.invalidation) main = { ...main, status: 'cancelled' };
    const pumped = pumpInboundLine(main, line);
    main = pumped.streamer;
    if (!connection.hostedStreaming?.isArmed() && pumped.toSend !== '')
      void connection
        .write(pumped.toSend)
        .catch((error: unknown) => writeErrors.push(String(error)));
    changed();
  });
  const hosted = connection.hostedStreaming;
  if (hosted === undefined) throw new Error('Worker connection has no hosted refill');
  const snapshot = () => {
    capturedCompleted.push(main.completed);
    return main;
  };
  const receive = (...lines: string[]) => {
    expectedInbound.push(...lines);
    incoming?.enqueue(new TextEncoder().encode(`${lines.join('\r\n')}\r\n`));
  };
  const deliverHeld = () => {
    deferKind = null;
    for (const message of held.splice(0)) worker.postMessage(message);
  };
  const nextAck = async () => {
    const expectedCompleted = main.completed + 1;
    receive(`[MSG:ack ${expectedCompleted}]`, 'ok');
    await until(
      () =>
        main.completed === expectedCompleted &&
        written.filter((value) => value !== '?').length === Math.min(expectedCompleted + 1, 6),
      'acknowledgement and next write',
    );
  };
  let blockedLineCount = 0;
  let writeRejectedAfterClose = false;
  let armedAfterInvalidation = false;
  try {
    await connection.write(first.toSend);
    if (args.scenario === 'before-prepare') {
      deferKind = 'prepare-arm';
      const arming = hosted.arm(snapshot);
      receive('ok');
      await until(
        () => main.completed === 1 && written.length === 2,
        'pre-barrier renderer refill',
      );
      deliverHeld();
      await arming;
    } else if (args.scenario === 'at-barrier') {
      deferKind = 'arm';
      const arming = hosted.arm(snapshot);
      await until(() => held.length === 1, 'captured snapshot waiting for arm');
      const bytes = new TextEncoder().encode('[MSG:café]\r\nok\n');
      expectedInbound.push('[MSG:café]', 'ok');
      const split = new TextEncoder().encode('[MSG:caf').length + 1;
      incoming?.enqueue(bytes.slice(0, split));
      incoming?.enqueue(bytes.slice(split));
      // Round-trip an unrelated realtime write while the read barrier is held.
      await connection.write('?');
      blockedLineCount = delivered.length;
      deliverHeld();
      await arming;
      await until(
        () => main.completed === 1 && written.length === 3,
        'buffered barrier acknowledgement',
      );
    } else {
      await hosted.arm(snapshot);
    }
    if (args.scenario === 'invalidate') {
      receive(args.invalidation ?? '', 'ok', 'ok');
      await until(() => delivered.length === 3, 'same-chunk invalidation lines');
      // A queued write acknowledgement also drains any preceding worker writes.
      await connection.write('?');
      armedAfterInvalidation = hosted.isArmed();
    } else if (args.scenario === 'timeout' || args.scenario === 'across-release') {
      deferKind = 'release';
      const releasing = hosted.release();
      receive('ok');
      await until(
        () => main.completed === 1 && written.length === 2,
        'worker refill before release',
      );
      if (args.scenario === 'timeout') {
        await releasing;
        try {
          await connection.write(programLines[1] ?? '');
        } catch {
          writeRejectedAfterClose = true;
        }
      } else {
        deliverHeld();
        await releasing;
      }
    } else {
      await nextAck();
      await hosted.release();
    }
    if (args.scenario !== 'timeout' && args.scenario !== 'invalidate') {
      while (main.completed < main.total) await nextAck();
    }
  } finally {
    await connection.close();
    worker.terminate();
  }
  return {
    programLines,
    writes: written.filter((value) => value !== '?'),
    delivered,
    expectedInbound,
    responses,
    writeErrors,
    capturedCompleted,
    transferredStreams,
    streamsLockedAfterTransfer,
    completed: main.completed,
    status: main.status,
    blockedLineCount,
    writeRejectedAfterClose,
    armedAfterInvalidation,
    closed,
    terminated,
    portClosed,
  };
}
