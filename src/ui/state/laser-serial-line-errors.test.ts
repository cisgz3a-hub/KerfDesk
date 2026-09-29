// A UART line error the transport survives loses the bytes at the error: Web
// Serial raises BreakError, BufferOverrunError, FramingError or ParityError
// and leaves the port open (serial-read-recovery.ts). GRBL answers every line
// with exactly one `ok` or `error:N`
// (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/interface.md#L9),
// so a reply lost there leaves its line unacknowledged with no other trace.
// The error used to reach only the developer console (controller audit T-3,
// ADR-375).

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SerialConnection } from '../../platform/types';
import type { LaserState } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { inboundTranscriptEntry } from './laser-transcript';
import { bufferTranscriptEntry, type TranscriptBufferRefs } from './laser-transcript-buffer';
import {
  currentJobLineError,
  LINE_ERROR_NOTICE_INTERVAL_MS,
  observeSerialLineErrors,
  sessionSawLineError,
} from './laser-serial-line-errors';

function lineErrorConnection() {
  const handlers: Array<(name: string) => void> = [];
  const connection: SerialConnection = {
    write: async () => undefined,
    onLine: () => () => undefined,
    onClose: () => () => undefined,
    onLineError: (handler) => {
      handlers.push(handler);
      return () => undefined;
    },
    close: async () => undefined,
  };
  return { connection, raise: (name: string) => handlers.forEach((handler) => handler(name)) };
}

function harness() {
  const link = lineErrorConnection();
  const h = {
    state: {
      ...initialLaserState(),
      controllerSessionEpoch: 3,
      streamerEpoch: 2,
    } as LaserState,
    refs: { connection: link.connection, nextTranscriptId: 7 } as TranscriptBufferRefs & {
      connection: SerialConnection | null;
      nextTranscriptId: number;
    },
    sets: 0,
  };
  const set = (
    partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
  ): void => {
    h.sets += 1;
    h.state = { ...h.state, ...(typeof partial === 'function' ? partial(h.state) : partial) };
  };
  observeSerialLineErrors(set, () => h.state, h.refs, link.connection);
  return { h, raise: link.raise, set };
}

function notices(state: LaserState): string[] {
  return state.transcript.filter((entry) => entry.direction === 'system').map((entry) => entry.raw);
}

afterEach(() => {
  vi.useRealTimers();
});

describe('serial line errors in the Console (controller audit T-3, ADR-375)', () => {
  it('names a line error and what it costs, then one notice per window with a count', () => {
    vi.useFakeTimers({ now: 10_000 });
    const { h, raise } = harness();

    raise('FramingError');
    expect(h.state.log).toHaveLength(1);
    expect(h.state.log[0]).toContain('Serial line error (FramingError)');
    expect(h.state.log[0]).toContain('a line may stay unacknowledged');
    // The Console renders the transcript, so the notice is there as well.
    expect(notices(h.state)).toEqual([h.state.log[0]]);

    vi.setSystemTime(11_000);
    raise('ParityError');
    vi.setSystemTime(12_000);
    raise('FramingError');
    expect(h.state.log).toHaveLength(1);

    vi.setSystemTime(10_000 + LINE_ERROR_NOTICE_INTERVAL_MS);
    raise('BreakError');
    expect(h.state.log).toHaveLength(2);
    expect(h.state.log[1]).toContain('Serial line error (BreakError)');
    expect(h.state.log[1]).toContain('2 more line errors since the last report.');
    expect(notices(h.state)).toHaveLength(2);
  });

  it('starts over in a new controller session', () => {
    vi.useFakeTimers({ now: 10_000 });
    const { h, raise } = harness();
    raise('FramingError');

    h.state = { ...h.state, controllerSessionEpoch: 4 };
    vi.setSystemTime(10_500);
    raise('ParityError');

    expect(h.state.log).toHaveLength(2);
    expect(h.state.log[1]).not.toContain('since the last report');
  });

  it('publishes the job acknowledgements held back before it first, in wire order', () => {
    vi.useFakeTimers({ now: 10_000 });
    const { h, raise } = harness();
    const ack = inboundTranscriptEntry(5, 9_990, 'ok', { kind: 'ok' }, 'grbl-v1.1', 'job');
    bufferTranscriptEntry(h.refs, ack, 'ok');

    raise('FramingError');

    expect(h.state.transcript.map((entry) => entry.raw)).toEqual(['ok', h.state.log[1]]);
    expect(h.state.transcript.at(-1)?.id).toBe(7);
  });

  it('belongs to the job, session and connection it happened in', () => {
    const { h, raise } = harness();
    expect(sessionSawLineError(h.refs, h.state)).toBe(false);
    raise('BufferOverrunError');

    expect(currentJobLineError(h.refs, h.state)).toBe('BufferOverrunError');
    expect(currentJobLineError(h.refs, { ...h.state, streamerEpoch: 3 })).toBeNull();
    expect(sessionSawLineError(h.refs, h.state)).toBe(true);
    expect(sessionSawLineError(h.refs, { ...h.state, controllerSessionEpoch: 4 })).toBe(false);
    h.refs.connection = lineErrorConnection().connection;
    expect(sessionSawLineError(h.refs, h.state)).toBe(false);
    expect(currentJobLineError(h.refs, h.state)).toBeNull();
  });

  it('records errors from the current connection only', () => {
    const { h, raise, set } = harness();
    const stale = lineErrorConnection();
    observeSerialLineErrors(set, () => h.state, h.refs, stale.connection);

    stale.raise('FramingError');
    expect(h.sets).toBe(0);
    raise('ParityError');
    expect(h.sets).toBe(1);

    h.refs.connection = null;
    raise('ParityError');
    expect(h.sets).toBe(1);
  });
});
