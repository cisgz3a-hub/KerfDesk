// Rolling audit v6 K2-P2-1 and K2-P1-1 (ADR-356 Amendment 2, ADR-398
// Amendment 6): the window's desktop network transport against a page stall.
// A stall is modelled as one task: no timer runs until it ends, then every
// timer that fell due runs at once and reads the same late clock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopMachineNetwork } from './desktop-machine-network';
import {
  machineNetworkRequest,
  runningTimeDeadline,
  type MachineNetworkRequest,
} from './desktop-machine-network-api';
import type { SerialConnection } from '../types';

const ID = '12345678-1234-1234-1234-123456789abc';

async function stallPage(ms: number): Promise<void> {
  const end = Date.now() + ms;
  const clock = vi.spyOn(Date, 'now').mockReturnValue(end);
  await vi.advanceTimersByTimeAsync(ms);
  clock.mockRestore();
}

async function flush(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

/** A fetch whose answer the test releases, and which honours its abort signal. */
function heldFetch(): { readonly fetcher: typeof fetch; readonly answer: (body: object) => void } {
  let answer: (body: object) => void = () => undefined;
  const fetcher = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      init?.signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      );
      answer = (body) => resolve(new Response(JSON.stringify(body)));
    })) as typeof fetch;
  return { fetcher, answer: (body) => answer(body) };
}

async function openConnection(request: MachineNetworkRequest): Promise<SerialConnection> {
  const adapter = createDesktopMachineNetwork(request).serialForTarget('127.0.0.1', 23);
  const port = await adapter.requestPort();
  if (port === null) throw new Error('Missing network port');
  return port.open({ baudRate: 115200 });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the network request deadline counts time the window was running', () => {
  it('keeps a read whose reply arrived during a 5.4 s stall', async () => {
    const held = heldFetch();
    const read = machineNetworkRequest(held.fetcher)('read', { sessionId: ID });
    const outcome = read.then(
      (body) => ({ body }),
      (error: unknown) => ({ error }),
    );
    await stallPage(5_400);
    // The reply's body is read on a task behind the timers that fell due.
    held.answer({ data: btoa('ok\n'), closed: false });
    expect(await outcome).toEqual({ body: { data: btoa('ok\n'), closed: false } });
  });

  it('still aborts a request the main process leaves unanswered for 5 s of running time', async () => {
    const held = heldFetch();
    const read = machineNetworkRequest(held.fetcher)('read', { sessionId: ID });
    const outcome = read.then(
      () => 'resolved',
      (error: unknown) => (error instanceof DOMException ? error.name : String(error)),
    );
    await vi.advanceTimersByTimeAsync(4_999);
    await flush();
    let settled = false;
    void outcome.then(() => {
      settled = true;
    });
    await flush();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toBe('AbortError');
  });

  it('counts a late step only up to half a second', async () => {
    const expired = vi.fn();
    runningTimeDeadline(1_000, expired);
    await stallPage(10_000);
    expect(expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(499);
    expect(expired).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(expired).toHaveBeenCalledTimes(1);
  });
});

describe('the window network connection', () => {
  // The main process answers a read with every byte it had queued, so all
  // that reached it before the read was issued has been delivered.
  it('reports when the last completed read was issued', async () => {
    const reads: Array<(body: Record<string, unknown>) => void> = [];
    const request: MachineNetworkRequest = (action) =>
      action === 'open'
        ? Promise.resolve({ sessionId: ID })
        : action === 'read'
          ? new Promise((resolve) => reads.push(resolve))
          : Promise.resolve({});
    const serial = await openConnection(request);
    const lines: string[] = [];
    serial.onLine((line) => lines.push(line));
    const firstIssued = Date.now();
    await flush();
    await vi.advanceTimersByTimeAsync(900);
    reads.shift()?.({ data: btoa('<Run|MPos:0,0,0>\n'), closed: false });
    await flush();
    expect(lines).toEqual(['<Run|MPos:0,0,0>']);
    expect(serial.inputReadThrough?.()).toBe(firstIssued);
    // The next read is outstanding: silence after it was issued is unread.
    const secondIssued = Date.now();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(serial.inputReadThrough?.()).toBe(firstIssued);
    reads.shift()?.({ data: '', closed: false });
    await flush();
    expect(serial.inputReadThrough?.()).toBe(secondIssued);
    await serial.close();
  });

  it('lets the store write its stop before closing a session whose read failed', async () => {
    const calls: string[] = [];
    const request: MachineNetworkRequest = async (action, body) => {
      calls.push(action === 'write' ? `write ${atob(String(body['data']))}` : action);
      if (action === 'open') return { sessionId: ID };
      if (action === 'read') throw new Error('Desktop network request failed.');
      return {};
    };
    const serial = await openConnection(request);
    const closed = vi.fn(() => calls.push('<closed>'));
    serial.onClose(closed);
    serial.beforeReadFailureClose?.(async () => {
      await serial.write('\x18');
    });
    serial.onLine(() => undefined);
    await flush();
    expect(calls).toEqual(['open', 'read', 'write \x18', '<closed>', 'close']);
    expect(closed).toHaveBeenCalledTimes(1);
  });

  it('closes a failed session after three seconds of running time if the stop never settles', async () => {
    const calls: string[] = [];
    const request: MachineNetworkRequest = async (action) => {
      calls.push(action);
      if (action === 'open') return { sessionId: ID };
      if (action === 'read') throw new Error('Invalid network read response.');
      return {};
    };
    const serial = await openConnection(request);
    serial.beforeReadFailureClose?.(() => new Promise<void>(() => undefined));
    serial.onLine(() => undefined);
    await flush();
    await stallPage(10_000);
    expect(calls).not.toContain('close');
    await vi.advanceTimersByTimeAsync(3_000);
    await flush();
    expect(calls).toContain('close');
  });
});
