import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerialConnection } from '../../platform/types';
import type { StatusReport } from '../../core/controllers/grbl';
import { describeAutofocusResult, runAutofocus } from './autofocus-action';

type MockConn = SerialConnection & {
  readonly received: string[];
  emit: (line: string) => void;
};

function mockConnection(): MockConn {
  const received: string[] = [];
  const lineHandlers = new Set<(line: string) => void>();
  const closeHandlers = new Set<() => void>();
  const conn: MockConn = {
    received,
    write: async (data: string) => {
      received.push(data);
    },
    onLine: (handler) => {
      lineHandlers.add(handler);
      return () => lineHandlers.delete(handler);
    },
    onClose: (handler) => {
      closeHandlers.add(handler);
      return () => closeHandlers.delete(handler);
    },
    close: async () => {
      /* test stub — no-op */
    },
    emit: (line: string) => {
      for (const h of lineHandlers) h(line);
    },
  };
  return conn;
}

function idleStatus(): StatusReport {
  return {
    state: 'Idle',
    subState: null,
    mPos: { x: 0, y: 0, z: 0 },
    wPos: null,
    feed: 0,
    spindle: 0,
    wco: null,
  };
}

describe('runAutofocus — preflight', () => {
  it('rejects when not connected', async () => {
    const r = await runAutofocus({
      connection: null,
      statusReport: idleStatus(),
      command: '$HZ1',
    });
    expect(r.kind).toBe('preflight-failed');
    if (r.kind === 'preflight-failed') expect(r.reason).toMatch(/not connected/i);
  });

  it('rejects when command is empty', async () => {
    const r = await runAutofocus({
      connection: mockConnection(),
      statusReport: idleStatus(),
      command: '   ',
    });
    expect(r.kind).toBe('preflight-failed');
  });

  it('rejects multi-line commands ($HZ1 must be single-line)', async () => {
    const r = await runAutofocus({
      connection: mockConnection(),
      statusReport: idleStatus(),
      command: '$HZ1\nG1 Z0',
    });
    expect(r.kind).toBe('preflight-failed');
    if (r.kind === 'preflight-failed') expect(r.reason).toMatch(/single line/i);
  });

  it('rejects when controller is not idle', async () => {
    const r = await runAutofocus({
      connection: mockConnection(),
      statusReport: { ...idleStatus(), state: 'Run' },
      command: '$HZ1',
    });
    expect(r.kind).toBe('preflight-failed');
    if (r.kind === 'preflight-failed') expect(r.reason).toMatch(/Idle/i);
  });
});

describe('runAutofocus — wire protocol', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends the command + a status query', async () => {
    const conn = mockConnection();
    const p = runAutofocus({ connection: conn, statusReport: idleStatus(), command: '$HZ1' });
    // Let the write microtask drain.
    await Promise.resolve();
    await Promise.resolve();
    expect(conn.received[0]).toBe('$HZ1\n');
    expect(conn.received[1]).toBe('?');
    // Cycle to completion so the test cleans up.
    conn.emit('ok');
    conn.emit('<Run|MPos:0.000,0.000,0.000|FS:0,0>');
    conn.emit('<Idle|MPos:0.000,0.000,-8.000|FS:0,0>');
    const r = await p;
    expect(r.kind).toBe('ok');
  });

  it('resolves ok after Idle → Run → Idle cycle', async () => {
    const conn = mockConnection();
    const p = runAutofocus({ connection: conn, statusReport: idleStatus(), command: '$HZ1' });
    await Promise.resolve();
    conn.emit('ok');
    conn.emit('<Run|MPos:0.000,0.000,0.000|FS:0,0>');
    conn.emit('<Idle|MPos:0.000,0.000,-8.000|FS:0,0>');
    expect((await p).kind).toBe('ok');
  });

  it('treats unknown status tokens (Falcon Focus) as active', async () => {
    const conn = mockConnection();
    const p = runAutofocus({ connection: conn, statusReport: idleStatus(), command: '$HZ1' });
    await Promise.resolve();
    conn.emit('ok');
    conn.emit('<Focus|MPos:0.000,0.000,-2.000|FS:0,0>');
    conn.emit('<Idle|MPos:0.000,0.000,-8.000|FS:0,0>');
    expect((await p).kind).toBe('ok');
  });

  it('resolves ok on Falcon firmwares that ack + skip straight to Idle', async () => {
    const conn = mockConnection();
    const p = runAutofocus({ connection: conn, statusReport: idleStatus(), command: '$HZ1' });
    await Promise.resolve();
    conn.emit('ok');
    // No Run/Home/Focus phase — just Idle after ack.
    conn.emit('<Idle|MPos:0.000,0.000,-8.000|FS:0,0>');
    expect((await p).kind).toBe('ok');
  });

  it('rejects on error: response with the error code', async () => {
    const conn = mockConnection();
    const p = runAutofocus({ connection: conn, statusReport: idleStatus(), command: '$HZ1' });
    await Promise.resolve();
    conn.emit('error:20');
    const r = await p;
    expect(r.kind).toBe('rejected');
    if (r.kind === 'rejected') {
      expect(r.errorCode).toBe(20);
      expect(r.raw).toBe('error:20');
    }
  });

  it('rejects on Alarm status', async () => {
    const conn = mockConnection();
    const p = runAutofocus({ connection: conn, statusReport: idleStatus(), command: '$HZ1' });
    await Promise.resolve();
    conn.emit('ok');
    conn.emit('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
    expect((await p).kind).toBe('alarm');
  });

  it('times out when no response after timeoutMs', async () => {
    const conn = mockConnection();
    const p = runAutofocus({
      connection: conn,
      statusReport: idleStatus(),
      command: '$HZ1',
      timeoutMs: 1000,
    });
    await Promise.resolve();
    vi.advanceTimersByTime(1500);
    expect((await p).kind).toBe('timeout');
  });
});

describe('describeAutofocusResult', () => {
  it('maps error:20 to a helpful firmware hint', () => {
    const t = describeAutofocusResult({ kind: 'rejected', errorCode: 20, raw: 'error:20' });
    expect(t.variant).toBe('error');
    expect(t.message).toMatch(/firmware/i);
  });

  it('maps error:9 to the no-probe-pin hint', () => {
    const t = describeAutofocusResult({ kind: 'rejected', errorCode: 9, raw: 'error:9' });
    expect(t.message).toMatch(/probe pin/i);
  });

  it('maps timeout to a warning', () => {
    const t = describeAutofocusResult({ kind: 'timeout' });
    expect(t.variant).toBe('warning');
  });

  it('maps ok to a success toast', () => {
    const t = describeAutofocusResult({ kind: 'ok' });
    expect(t.variant).toBe('success');
  });
});
