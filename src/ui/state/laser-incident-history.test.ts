import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INCIDENT_AT,
  SAFETY_NOTICE,
  incidentEntry,
  incidentHistory,
  resetIncidentState,
  seedIncidentHistory,
  type IncidentEntry,
  type IncidentState,
} from '../../__fixtures__/controller-incidents';
import { RT_SOFT_RESET } from '../../core/controllers/grbl';
import { useLaserStore, type LaserState } from './laser-store';
import {
  connectWith,
  makeConnection,
  type FakeConnection,
} from './laser-store-console.test-support';
import {
  TRANSCRIPT_MAX,
  inboundTranscriptEntry,
  outboundTranscriptEntry,
  systemTranscriptEntry,
} from './laser-transcript';
import {
  bufferTranscriptEntry,
  publishTranscriptPatch,
  type TranscriptBufferRefs,
} from './laser-transcript-buffer';
import { recoveryRepository } from './recovery';
import { useToastStore } from './toast-store';

type HistorySnapshot = Pick<LaserState, 'log' | 'transcript'> & {
  readonly incidentHistory: ReadonlyArray<IncidentEntry>;
};

function controller(options: { readonly failClose?: boolean; readonly failStop?: boolean } = {}) {
  const closeHandlers = new Set<() => void>();
  const recordedClose: Array<() => void> = [];
  const writes: string[] = [];
  const connection: FakeConnection = {
    ...makeConnection(async (data) => {
      writes.push(data);
      if (data === RT_SOFT_RESET) {
        queueMicrotask(() => connection.emitLine('Grbl 1.1f'));
      }
      if (data === 'M5\n' && options.failStop === true) {
        throw new Error('D1 stop write failed');
      }
    }),
    onClose: (handler) => {
      closeHandlers.add(handler);
      recordedClose.push(handler);
      return () => closeHandlers.delete(handler);
    },
    close: vi.fn(async () => {
      if (options.failClose === true) throw new Error('D1 transport close failed');
    }),
    forget: vi.fn(async () => undefined),
  };
  return {
    connection,
    writes,
    recordedClose,
    emitClose: () => {
      for (const handler of closeHandlers) handler();
    },
  };
}

beforeEach(async () => {
  vi.useRealTimers();
  useLaserStore.setState({ autofocusBusy: false });
  await useLaserStore
    .getState()
    .disconnect()
    .catch(() => undefined);
  resetIncidentState();
  useToastStore.setState({ toasts: [] });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.restoreAllMocks();
  useLaserStore.setState({ autofocusBusy: false });
  await useLaserStore
    .getState()
    .disconnect()
    .catch(() => undefined);
  resetIncidentState();
  useToastStore.setState({ toasts: [] });
});

describe('D1 retained controller incident history', () => {
  it.each(['ALARM:2', 'error:20'])(
    'retains live %s with its original timestamp after 500 ACKs',
    async (raw) => {
      const h = controller();
      await connectWith(h.connection);
      useLaserStore.getState().clearTranscript();
      vi.spyOn(Date, 'now').mockReturnValue(INCIDENT_AT);
      h.connection.emitLine(raw);
      const original = useLaserStore.getState().transcript.find((entry) => entry.raw === raw);
      expect(original).toBeDefined();
      for (let i = 0; i < TRANSCRIPT_MAX; i += 1) h.connection.emitLine('ok');

      expect(useLaserStore.getState().transcript).toHaveLength(TRANSCRIPT_MAX);
      expect(useLaserStore.getState().transcript.some((entry) => entry.raw === raw)).toBe(false);
      expect(incidentHistory()).toContainEqual(original);
      expect(incidentHistory().find((entry) => entry.raw === raw)?.at).toBe(INCIDENT_AT);
    },
  );

  it('captures a command blocked by the actual disconnected console action', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(INCIDENT_AT);
    await expect(useLaserStore.getState().sendConsoleCommand('$I')).rejects.toThrow(/connect/i);
    const original = useLaserStore.getState().transcript.find((entry) => entry.kind === 'blocked');
    expect(original).toMatchObject({ at: INCIDENT_AT, kind: 'blocked', direction: 'system' });
    expect(incidentHistory()).toContainEqual(original);
  });

  it('retains a published alarm through the buffered job-owned ACK flood', () => {
    const refs: TranscriptBufferRefs = {};
    const alarm = inboundTranscriptEntry(1, INCIDENT_AT, 'ALARM:2');
    let state: HistorySnapshot = { log: [], transcript: [], incidentHistory: [] };
    state = { ...state, ...publishTranscriptPatch(refs, state, alarm, alarm.raw) };
    for (let i = 0; i < TRANSCRIPT_MAX; i += 1) {
      bufferTranscriptEntry(
        refs,
        inboundTranscriptEntry(i + 2, INCIDENT_AT + i + 1, 'ok', undefined, 'grbl-v1.1', 'job'),
        'ok',
      );
    }
    state = { ...state, ...publishTranscriptPatch(refs, state) };

    expect(state.transcript).toHaveLength(TRANSCRIPT_MAX);
    expect(state.transcript.every((entry) => entry.kind === 'ok' && entry.source === 'job')).toBe(
      true,
    );
    expect(incidentHistory(state)).toEqual([alarm]);
  });

  it('bounds incident retention independently and retains the latest incident', () => {
    const refs: TranscriptBufferRefs = {};
    let state: HistorySnapshot = { log: [], transcript: [], incidentHistory: [] };
    const entries = Array.from({ length: TRANSCRIPT_MAX + 100 }, (_, i) =>
      inboundTranscriptEntry(i + 1, INCIDENT_AT + i, 'error:20'),
    );
    for (const entry of entries) {
      state = { ...state, ...publishTranscriptPatch(refs, state, entry, entry.raw) };
    }
    const retained = incidentHistory(state);
    expect(retained.length).toBeGreaterThan(0);
    expect(retained.length).toBeLessThanOrEqual(TRANSCRIPT_MAX);
    expect(retained).toContainEqual(entries.at(-1));
    expect(retained.some((entry) => entry.id === entries[0]?.id)).toBe(false);
    expect(new Set(retained.map((entry) => entry.id)).size).toBe(retained.length);
  });

  it('does not turn routine controller, poll, or job traffic into incidents', () => {
    const refs: TranscriptBufferRefs = {};
    let state: HistorySnapshot = { log: [], transcript: [], incidentHistory: [] };
    const entries = [
      inboundTranscriptEntry(1, INCIDENT_AT, 'ok'),
      inboundTranscriptEntry(2, INCIDENT_AT + 1, '<Idle|MPos:0,0,0|FS:0,0>'),
      inboundTranscriptEntry(3, INCIDENT_AT + 2, '$32=1'),
      inboundTranscriptEntry(4, INCIDENT_AT + 3, '[MSG:Ready]'),
      outboundTranscriptEntry(5, INCIDENT_AT + 4, '?', 'poll'),
      outboundTranscriptEntry(6, INCIDENT_AT + 5, 'G1X1Y1\n', 'job'),
    ];
    for (const entry of entries)
      state = { ...state, ...publishTranscriptPatch(refs, state, entry, entry.raw) };
    expect(state.transcript).toEqual(entries);
    expect(incidentHistory(state)).toEqual([]);
  });

  it('does not archive the same incident ID twice when a batch is republished', () => {
    const refs: TranscriptBufferRefs = {};
    const blocked = systemTranscriptEntry(1, INCIDENT_AT, 'Connect to the controller first.');
    let state: HistorySnapshot = { log: [], transcript: [], incidentHistory: [blocked] };
    state = { ...state, ...publishTranscriptPatch(refs, state, blocked) };
    expect(incidentHistory(state)).toEqual([blocked]);
  });

  it('retains seeded incident timestamps through a real connection replacement', async () => {
    const first = controller();
    const second = controller();
    await connectWith(first.connection);
    const old = incidentEntry(800, { at: INCIDENT_AT, raw: 'ALARM:2' });
    seedIncidentHistory([old], { safetyNotice: SAFETY_NOTICE });
    await connectWith(second.connection);
    expect(useLaserStore.getState().connection.kind).toBe('connected');
    expect(first.connection.close).toHaveBeenCalledOnce();
    expect(incidentHistory()).toContainEqual(old);
    expect(useLaserStore.getState().safetyNotice).toEqual(SAFETY_NOTICE);
  });

  it.each(['disconnect', 'forget'] as const)(
    'keeps transcript/incident IDs monotonic across %s and reconnect',
    async (action) => {
      const first = controller();
      const second = controller();
      await connectWith(first.connection);
      for (let i = 0; i < TRANSCRIPT_MAX + 50; i += 1) first.connection.emitLine('ok');
      first.connection.emitLine('error:20');
      const old = useLaserStore.getState().transcript.find((entry) => entry.raw === 'error:20');
      expect(old).toBeDefined();
      if (old === undefined)
        throw new Error('Initial error was not recorded on the live line path.');
      seedIncidentHistory([old]);
      if (action === 'forget') {
        vi.spyOn(recoveryRepository, 'purgeControllerData').mockResolvedValue({
          ok: true,
          value: 1,
        });
        await useLaserStore.getState().forgetDevice?.();
      } else {
        await useLaserStore.getState().disconnect();
      }
      await connectWith(second.connection);
      second.connection.emitLine('error:9');
      const next = useLaserStore.getState().transcript.find((entry) => entry.raw === 'error:9');
      expect(next).toBeDefined();
      expect(next?.id).toBeGreaterThan(old.id);
      expect(incidentHistory()).toContainEqual(old);
    },
  );

  it('retains incidents through Forget while clearing only controller-owned state', async () => {
    const h = controller();
    await connectWith(h.connection);
    const old = incidentEntry(800, { at: INCIDENT_AT, raw: 'ALARM:2' });
    seedIncidentHistory([old]);
    vi.spyOn(recoveryRepository, 'purgeControllerData').mockResolvedValue({ ok: true, value: 1 });
    const forget = useLaserStore.getState().forgetDevice;
    expect(forget).toBeTypeOf('function');
    await forget?.();
    expect(h.connection.forget).toHaveBeenCalledOnce();
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(useLaserStore.getState().transcript).toEqual([]);
    expect(incidentHistory()).toContainEqual(old);
  });

  it('offline Forget retains the unresolved physical-stop notice and incident timestamps', async () => {
    const old = incidentEntry(800, { at: INCIDENT_AT, raw: 'ALARM:2' });
    seedIncidentHistory([old], { safetyNotice: SAFETY_NOTICE });
    vi.spyOn(recoveryRepository, 'purgeControllerData').mockResolvedValue({ ok: true, value: 1 });
    await useLaserStore.getState().forgetDevice?.();
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    expect(incidentHistory()).toContainEqual(old);
    expect(useLaserStore.getState().safetyNotice).toEqual(SAFETY_NOTICE);
  });

  it('captures an unexpected port close with the original event timestamp', async () => {
    const h = controller();
    await connectWith(h.connection);
    vi.spyOn(Date, 'now').mockReturnValue(INCIDENT_AT);
    h.emitClose();
    expect(useLaserStore.getState().connection.kind).toBe('disconnected');
    const closes = incidentHistory().filter((entry) => entry.kind === 'disconnect');
    expect(closes).toHaveLength(1);
    expect(closes[0]).toMatchObject({ at: INCIDENT_AT, direction: 'system', source: 'system' });
    expect(closes[0]?.raw).toMatch(/disconnect|closed|lost/i);
  });

  it('deduplicates a repeated close callback for one retired transport', async () => {
    const h = controller();
    await connectWith(h.connection);
    const callback = h.recordedClose[0];
    expect(callback).toBeTypeOf('function');
    callback?.();
    callback?.();
    expect(incidentHistory().filter((entry) => entry.kind === 'disconnect')).toHaveLength(1);
  });

  it('ignores the retired close callback after a replacement connects', async () => {
    const first = controller();
    const second = controller();
    await connectWith(first.connection);
    const staleClose = first.recordedClose[0];
    await connectWith(second.connection);
    const before = incidentHistory();
    staleClose?.();
    expect(useLaserStore.getState().connection.kind).toBe('connected');
    expect(incidentHistory()).toEqual(before);
    expect(second.connection.close).not.toHaveBeenCalled();
  });

  it.each([
    { failClose: true, failStop: false, reason: 'D1 transport close failed' },
    { failClose: false, failStop: true, reason: 'D1 stop write failed' },
  ])(
    'retains failed intentional disconnect diagnostics: $reason',
    async ({ failClose, failStop, reason }) => {
      const h = controller({ failClose, failStop });
      await connectWith(h.connection);
      const disconnect = useLaserStore.getState().disconnect();
      if (failClose) await expect(disconnect).rejects.toThrow(reason);
      else await disconnect;
      expect(useLaserStore.getState().connection.kind).toBe('disconnected');
      expect(useLaserStore.getState().safetyNotice).toMatchObject({
        kind: 'write-failed',
        action: 'disconnect',
      });
      expect(incidentHistory().some((entry) => entry.raw.includes(reason))).toBe(true);
    },
  );

  it('clearIncidentHistory is explicit and never acknowledges SafetyNotice or Frame', () => {
    const old = incidentEntry(1);
    const frameVerification = {
      boundsSignature: 'unchanged-footprint',
      wco: null,
      workOriginActive: false,
    };
    seedIncidentHistory([old], {
      safetyNotice: SAFETY_NOTICE,
      frameVerification,
      controllerSessionEpoch: 77,
      pendingUntrackedAcks: 3,
    });
    const clear = (useLaserStore.getState() as IncidentState).clearIncidentHistory;
    expect(clear).toBeTypeOf('function');
    clear?.();
    expect(incidentHistory()).toEqual([]);
    expect(useLaserStore.getState()).toMatchObject({
      safetyNotice: SAFETY_NOTICE,
      frameVerification,
      controllerSessionEpoch: 77,
      pendingUntrackedAcks: 3,
    });
  });

  it('clearing the rolling console leaves incidents and SafetyNotice intact', () => {
    const old = incidentEntry(1);
    seedIncidentHistory([old], {
      transcript: [inboundTranscriptEntry(2, INCIDENT_AT, 'ok')],
      log: ['ok'],
      safetyNotice: SAFETY_NOTICE,
    });
    useLaserStore.getState().clearTranscript();
    expect(useLaserStore.getState().transcript).toEqual([]);
    expect(useLaserStore.getState().log).toEqual([]);
    expect(incidentHistory()).toEqual([old]);
    expect(useLaserStore.getState().safetyNotice).toEqual(SAFETY_NOTICE);
  });

  it('explicit SafetyNotice acknowledgment does not delete incident evidence', () => {
    const old = incidentEntry(1);
    seedIncidentHistory([old], { safetyNotice: SAFETY_NOTICE });
    useLaserStore.getState().clearSafetyNotice();
    expect(useLaserStore.getState().safetyNotice).toBeNull();
    expect(incidentHistory()).toEqual([old]);
  });
});
