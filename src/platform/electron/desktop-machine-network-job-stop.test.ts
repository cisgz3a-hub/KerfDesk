// Rolling audit v6 K2-P2-1 (ADR-398 Amendment 6): the real store over the
// window's desktop network connection. When that connection can no longer
// read, or a job write fails, the session may still take writes, so the job's
// reset must go out through it before the session closes. A fake main process
// stands behind the request API: it long-polls reads for up to a second and
// answers like GRBL, except that it never acknowledges the job's moves.
//
// Rolling audit v9 R1-P2-2 (ADR-398 Amendment 7): the same on the default route,
// the real network worker runtime and connection, with the worker's thread faked
// by a queued message hop and the same main process behind its fetch.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '../types';
import { createNetworkSessionOpener } from '../web/network-serial-connection';
import { createNetworkSerialWorkerRuntime } from '../web/network-serial-worker-runtime';
import type { NetworkSerialWorkerRequest } from '../web/network-serial-worker-protocol';
import { createDesktopMachineNetwork } from './desktop-machine-network';
import type { MachineNetworkRequest } from './desktop-machine-network-api';
import { useLaserStore } from '../../ui/state/laser-store';
import { initialLaserState } from '../../ui/state/laser-store-helpers';
import {
  captureTestLaserStartFenceAck,
  respondToTestGrblHandshake,
} from '../../ui/state/laser-test-start-helpers';
import { startTestLaserJobOnClock } from '../../ui/state/laser-test-command-control';

const ID = '12345678-1234-1234-1234-123456789abc';
const RUN_REPORT = '<Run|MPos:1.000,0.000,0.000|FS:1000,100>';

type FakeMain = {
  readonly request: MachineNetworkRequest;
  /** Each request in order: `read`, `close`, or `write <bytes>`. */
  readonly calls: string[];
  readonly emit: (line: string) => void;
  /** The pending read and every later one fail in the renderer. */
  readonly failReads: () => void;
  /** Writes whose bytes match fail with uncertain delivery. */
  readonly failWrites: (matches: (data: string) => boolean) => void;
};

function fakeMain(): FakeMain {
  const calls: string[] = [];
  let queued = '';
  let waiting: {
    resolve: (body: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  } | null = null;
  let readsFail = false;
  let writeFails: (data: string) => boolean = () => false;
  const take = (): Record<string, unknown> => {
    const data = btoa(queued);
    queued = '';
    return { data, closed: false };
  };
  const emit = (line: string): void => {
    queued += `${line}\r\n`;
    const pending = waiting;
    waiting = null;
    pending?.resolve(take());
  };
  const respond = (data: string): void => {
    const acknowledgeStartFence = captureTestLaserStartFenceAck(data, emit);
    acknowledgeStartFence();
    respondToTestGrblHandshake(data, emit);
    if (data === '?') emit(RUN_REPORT);
    if (data === '\x18') setTimeout(() => emit('Grbl 1.1f'), 0);
  };
  const request: MachineNetworkRequest = async (action, body) => {
    if (action === 'open') return { sessionId: ID };
    calls.push(action === 'write' ? `write ${atob(String(body['data']))}` : action);
    if (action === 'close') return {};
    if (action === 'write') {
      const data = atob(String(body['data']));
      if (writeFails(data)) throw new Error('Network write failed; delivery may be uncertain.');
      respond(data);
      return {};
    }
    if (readsFail) throw new Error('Desktop network request failed.');
    if (queued.length > 0) return take();
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject };
      waiting = entry;
      setTimeout(() => {
        if (waiting !== entry) return;
        waiting = null;
        resolve(take());
      }, 1_000);
    });
  };
  return {
    request,
    calls,
    emit,
    failReads: () => {
      readsFail = true;
      const pending = waiting;
      waiting = null;
      pending?.reject(new Error('Desktop network request failed.'));
    },
    failWrites: (matches) => {
      writeFails = matches;
    },
  };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 40; index += 1) await Promise.resolve();
}

// The worker's thread, as a hop per message: the real runtime behind the Worker
// the production opener asks for, reaching the fake main process by fetch.
function workerOver(main: FakeMain): () => Worker {
  return () => {
    const worker = {
      onmessage: null as ((event: MessageEvent) => void) | null,
      onerror: null,
      onmessageerror: null,
      postMessage: (message: NetworkSerialWorkerRequest) => {
        queueMicrotask(() => runtime.handle(message));
      },
      terminate: () => undefined,
    };
    const runtime = createNetworkSerialWorkerRuntime({
      post: (message) => {
        queueMicrotask(() => worker.onmessage?.({ data: message } as MessageEvent));
      },
      fetch: (async (input: unknown, init?: { readonly body?: unknown }) => {
        const action = String(input).split('/').pop() ?? '';
        const reply = await main.request(
          action as never,
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        );
        return { ok: true, text: async () => JSON.stringify(reply) };
      }) as unknown as typeof fetch,
    });
    return worker as unknown as Worker;
  };
}

type Route = 'window' | 'worker';

async function streamOverNetwork(main: FakeMain, route: Route = 'window'): Promise<void> {
  const platform: PlatformAdapter = {
    id: 'mock',
    pickFilesForOpen: async () => [],
    pickFileForSave: async () => null,
    serial: createDesktopMachineNetwork(
      main.request,
      route === 'worker' ? createNetworkSessionOpener(workerOver(main)) : undefined,
    ).serialForTarget('127.0.0.1', 23),
  };
  const connecting = useLaserStore
    .getState()
    .connect(platform, { hostedStreaming: route === 'worker' });
  // The worker takes the session only after its first read, up to a second.
  await vi.advanceTimersByTimeAsync(1_100);
  await connecting;
  const settle = async (): Promise<void> => {
    await flush();
    await vi.advanceTimersByTimeAsync(5);
    await flush();
  };
  main.emit('Grbl 1.1f');
  await settle();
  main.emit('<Idle|MPos:0.000,0.000,0.000|FS:0,0>');
  await settle();
  main.emit('$32=1');
  main.emit('ok');
  await settle();
  await settle();
  await startTestLaserJobOnClock(
    ['M4 S0', ...Array.from({ length: 30 }, (_, i) => `G1 X${i} S100`), 'M5'].join('\n'),
  );
  await vi.advanceTimersByTimeAsync(1_000);
  expect(useLaserStore.getState().streamer?.status).toBe('streaming');
  expect(useLaserStore.getState().serialPortInfo?.transport).toBe('tcp');
  expect(useLaserStore.getState().jobStreamHost).toBe(route === 'worker' ? 'worker' : 'window');
  main.calls.length = 0;
}

beforeEach(() => {
  vi.useFakeTimers();
  useLaserStore.setState(initialLaserState());
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  const disconnect = useLaserStore.getState().disconnect();
  await vi.advanceTimersByTimeAsync(2_000);
  await disconnect.catch(() => undefined);
  useLaserStore.setState(initialLaserState());
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(['window', 'worker'] as const)(
  'a desktop network job on the %s route whose connection fails',
  (route) => {
    it('sends the reset through the session before closing it when reads fail', async () => {
      const main = fakeMain();
      await streamOverNetwork(main, route);

      main.failReads();
      await flush();
      await vi.advanceTimersByTimeAsync(1_500);
      await flush();

      const reset = main.calls.indexOf('write \x18');
      expect(reset).toBeGreaterThanOrEqual(0);
      expect(main.calls.indexOf('close')).toBeGreaterThan(reset);
      expect(main.calls.slice(reset)).toEqual(
        expect.arrayContaining(['write M5\n', 'write M9\n', 'close']),
      );
      const state = useLaserStore.getState();
      expect(state.connection.kind).toBe('disconnected');
      expect(state.safetyNotice?.kind).toBe('disconnect-during-job');
      expect(state.safetyNotice?.message).toContain('could no longer read the network connection');
    });

    it('sends the reset through the session when a job write fails', async () => {
      const main = fakeMain();
      await streamOverNetwork(main, route);

      main.failWrites((data) => data.includes('G1 X'));
      // Acknowledgements free buffer space, so the stream writes its next moves.
      for (let index = 0; index < 5; index += 1) main.emit('ok');
      await flush();
      await vi.advanceTimersByTimeAsync(1_500);
      await flush();

      const failed = main.calls.findIndex((call) => call.includes('G1 X'));
      const reset = main.calls.indexOf('write \x18');
      expect(failed).toBeGreaterThanOrEqual(0);
      expect(reset).toBeGreaterThan(failed);
      expect(main.calls.indexOf('close')).toBeGreaterThan(reset);
      // Nothing queued behind the uncertain write was sent.
      expect(main.calls.filter((call) => call.includes('G1 X'))).toHaveLength(1);
      expect(useLaserStore.getState().safetyNotice?.kind).toBe('write-failed');
      expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    });
  },
);
