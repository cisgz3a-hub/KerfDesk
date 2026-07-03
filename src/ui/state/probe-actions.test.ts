// Probe protocol runner (ADR-103 G2): line-by-line ok pacing, probe-alarm
// decoding (ALARM:4/5), rejection, timeout watchdog, and preflight.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerialConnection } from '../../platform/types';
import type { StatusReport } from '../../core/controllers/grbl';
import { describeProbeResult, runProbeSequence } from './probe-actions';

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

const LINES = ['G21', 'G91', 'G38.2 Z-25.000 F150.000'] as const;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(0);
  return promise;
}

describe('runProbeSequence', () => {
  it('sends lines one at a time, gated on ok, and resolves ok at the end', async () => {
    const conn = mockConnection();
    const promise = runProbeSequence({
      connection: conn,
      statusReport: idleStatus(),
      lines: LINES,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(conn.received).toEqual(['G21\n']);
    conn.emit('ok');
    await vi.advanceTimersByTimeAsync(0);
    expect(conn.received).toEqual(['G21\n', 'G91\n']);
    conn.emit('ok');
    await vi.advanceTimersByTimeAsync(0);
    conn.emit('ok');
    const result = await settle(promise);
    expect(result).toEqual({ kind: 'ok' });
    expect(conn.received).toHaveLength(3);
  });

  it('decodes ALARM:5 as probe-failed (no contact)', async () => {
    const conn = mockConnection();
    const promise = runProbeSequence({
      connection: conn,
      statusReport: idleStatus(),
      lines: LINES,
    });
    await vi.advanceTimersByTimeAsync(0);
    conn.emit('ALARM:5');
    const result = await settle(promise);
    expect(result).toEqual({ kind: 'probe-failed', alarmCode: 5 });
    expect(describeProbeResult(result).message).toMatch(/never touched/i);
  });

  it('decodes ALARM:4 as probe-failed (already triggered)', async () => {
    const conn = mockConnection();
    const promise = runProbeSequence({
      connection: conn,
      statusReport: idleStatus(),
      lines: LINES,
    });
    await vi.advanceTimersByTimeAsync(0);
    conn.emit('ALARM:4');
    const result = await settle(promise);
    expect(result).toEqual({ kind: 'probe-failed', alarmCode: 4 });
  });

  it('stops on error:N without sending further lines', async () => {
    const conn = mockConnection();
    const promise = runProbeSequence({
      connection: conn,
      statusReport: idleStatus(),
      lines: LINES,
    });
    await vi.advanceTimersByTimeAsync(0);
    conn.emit('error:9');
    const result = await settle(promise);
    expect(result.kind).toBe('rejected');
    expect(conn.received).toHaveLength(1);
  });

  it('times out naming the line it was waiting on, timer reset per ok', async () => {
    const conn = mockConnection();
    const promise = runProbeSequence({
      connection: conn,
      statusReport: idleStatus(),
      lines: LINES,
      lineTimeoutMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(900);
    conn.emit('ok'); // G21 acked at t=900; watchdog re-arms
    await vi.advanceTimersByTimeAsync(900);
    conn.emit('ok'); // G91 acked; probe line goes out
    await vi.advanceTimersByTimeAsync(1001); // no ok for the probe itself
    const result = await promise;
    expect(result).toEqual({ kind: 'timeout', pendingLine: 'G38.2 Z-25.000 F150.000' });
  });

  it('preflight-fails when disconnected or not idle', async () => {
    const disconnected = await runProbeSequence({
      connection: null,
      statusReport: idleStatus(),
      lines: LINES,
    });
    expect(disconnected.kind).toBe('preflight-failed');
    const running = await runProbeSequence({
      connection: mockConnection(),
      statusReport: { ...idleStatus(), state: 'Run' },
      lines: LINES,
    });
    expect(running.kind).toBe('preflight-failed');
  });

  it('treats an Alarm status report as a lock even without an ALARM line', async () => {
    const conn = mockConnection();
    const promise = runProbeSequence({
      connection: conn,
      statusReport: idleStatus(),
      lines: LINES,
    });
    await vi.advanceTimersByTimeAsync(0);
    conn.emit('<Alarm|MPos:0.000,0.000,0.000|FS:0,0>');
    const result = await settle(promise);
    expect(result).toEqual({ kind: 'alarm', alarmCode: null });
  });
});
