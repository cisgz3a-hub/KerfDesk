import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver, marlinDriver, type ControllerDriver } from '../../core/controllers';
import { createStreamer, onAck, parseStatusReport, step } from '../../core/controllers/grbl';
import { makeLineHandlerHarness } from './laser-line-handler.test-support';
import { createLaserStoreRefs } from './laser-store-refs';
import { initialLaserState } from './laser-store-helpers';
import { beginJobTransportWrite } from './laser-job-transport-ledger';
import { runGrblDisconnectTransaction } from './laser-disconnect-transaction';
import type * as DisconnectTransaction from './laser-disconnect-transaction';
import { acknowledgementStalledNotice, writeFailedNotice } from './laser-safety-notice';
import { containStalledStreamAcknowledgements } from './laser-stream-heartbeat-containment';

// Exercise real containment/publication with isolated state and the real local ledger.
// The reset transaction is a boundary spy; upstream reset/cleanup suites exercise its wire flow.
vi.mock('./laser-disconnect-transaction', async (importOriginal) => {
  const actual = await importOriginal<typeof DisconnectTransaction>();
  return { ...actual, runGrblDisconnectTransaction: vi.fn(async () => undefined) };
});

const AT = Date.parse('2026-10-09T08:00:00.000Z');
const PROGRAM = ['G1 X10 S100', 'G1 X20 S100', 'G1 X30 S100', 'G1 X40 S100'].join('\n');

function stalledHarness(driver: ControllerDriver = grblDriver) {
  const harness = makeLineHandlerHarness();
  const refs = createLaserStoreRefs();
  refs.driver = driver;
  refs.nextTranscriptId = 70;
  refs.writeEpoch = 12;
  const safeWrite = vi.fn(async () => undefined);
  refs.connection = {
    write: safeWrite,
    onLine: () => () => undefined,
    onClose: () => () => undefined,
    close: async () => undefined,
  };
  const sent = step(createStreamer(PROGRAM));
  expect(sent.toSend).toBe(PROGRAM + '\n');
  const acknowledged = onAck(sent.state, 'ok');
  expect(acknowledged.acked).toBe('G1 X10 S100\n');
  beginJobTransportWrite(refs);
  harness.set({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    capabilities: driver.capabilities,
    activeControllerKind: driver.kind,
    controllerSessionEpoch: 41,
    controllerQualification: { kind: 'qualified', epoch: 41, settings: 'verified' },
    statusSequence: 18,
    statusReport: parseStatusReport('<Run|MPos:10,20,0|FS:1000,100>'),
    activeRunId: 'ack-stall-original-run',
    activeJobMachineKind: 'laser',
    streamerEpoch: 72,
    streamer: acknowledged.state,
    pendingUntrackedAcks: 2,
    pendingTransportWrites: 2,
    connectedBaudRate: 115200,
  });
  return { ...harness, refs, safeWrite };
}

function retainedIncident(harness: ReturnType<typeof stalledHarness>) {
  const entries = harness.get().incidentHistory;
  expect(entries).toHaveLength(1);
  const entry = entries?.[0];
  if (entry === undefined) throw new Error('Expected the retained ACK-stall incident');
  return entry;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(AT);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('upstream acknowledgement-stall retained incident integration', () => {
  it('retains original run and ACK facts before the reset/Frame patch can replace them', () => {
    const harness = stalledHarness();
    containStalledStreamAcknowledgements(harness.set, harness.refs, harness.safeWrite);

    const state = harness.get();
    expect(state.streamer?.status).toBe('errored');
    expect(state.streamReset).not.toBeNull();
    expect(state.incidentHistory).toHaveLength(1);
    const entry = retainedIncident(harness);
    expect(entry).toMatchObject({
      id: 70,
      at: AT,
      direction: 'system',
      source: 'system',
      kind: 'error',
      incident: true,
      raw: acknowledgementStalledNotice(true).message,
      incidentContext: {
        controller: {
          sessionEpoch: 41,
          connection: 'connected',
          status: 'Run',
          statusSequence: 18,
        },
        run: {
          id: 'ack-stall-original-run',
          machineKind: 'laser',
          streamerEpoch: 72,
          status: 'streaming',
          completed: 1,
          total: 4,
          queueIndex: 4,
          inFlightLines: 3,
          inFlightBytes: 36,
          pendingUntrackedAcks: 2,
          storePendingTransportWrites: 2,
          refillPendingTransportWrites: 1,
          pendingTransportWrites: 3,
        },
      },
    });
    expect(state.transcript).toContainEqual(entry);
    expect(runGrblDisconnectTransaction).toHaveBeenCalledExactlyOnceWith(
      harness.set,
      harness.refs,
      harness.safeWrite,
      { retainConnection: true, action: 'stop' },
    );

    harness.set({
      connection: { kind: 'disconnected' },
      controllerSessionEpoch: 42,
      activeRunId: 'replacement-run',
      streamer: null,
      pendingUntrackedAcks: 0,
      pendingTransportWrites: 0,
    });
    harness.refs.writeEpoch = (harness.refs.writeEpoch ?? 0) + 1;
    beginJobTransportWrite(harness.refs);
    expect(harness.get().incidentHistory?.[0]).toBe(entry);
    expect(entry.incidentContext?.controller.sessionEpoch).toBe(41);
    expect(entry.incidentContext?.run).toMatchObject({
      id: 'ack-stall-original-run',
      status: 'streaming',
      inFlightLines: 3,
      pendingUntrackedAcks: 2,
      pendingTransportWrites: 3,
    });
    expect(Object.isFrozen(entry.incidentContext?.run)).toBe(true);
    expect(JSON.stringify(entry.incidentContext)).not.toContain('G1 X10');
  });

  it('publishes one occurrence when repeated containment calls see the same stalled sender', () => {
    const harness = stalledHarness();
    containStalledStreamAcknowledgements(harness.set, harness.refs, harness.safeWrite);
    const entry = retainedIncident(harness);
    containStalledStreamAcknowledgements(harness.set, harness.refs, harness.safeWrite);
    expect(harness.get().incidentHistory).toEqual([entry]);
    expect(harness.get().transcript.filter((row) => row.incident)).toEqual([entry]);
    expect(harness.refs.nextTranscriptId).toBe(71);
    expect(runGrblDisconnectTransaction).toHaveBeenCalledTimes(1);
  });

  it('retains the stall diagnosis while preserving an earlier physical-stop SafetyNotice', () => {
    const harness = stalledHarness();
    const precedingNotice = writeFailedNotice('disconnect');
    harness.set({ safetyNotice: precedingNotice });
    containStalledStreamAcknowledgements(harness.set, harness.refs, harness.safeWrite);
    expect(harness.get().safetyNotice).toBe(precedingNotice);
    expect(harness.get().incidentHistory).toHaveLength(1);
    expect(retainedIncident(harness).raw).toBe(acknowledgementStalledNotice(true).message);
    expect(retainedIncident(harness).raw).not.toBe(precedingNotice.message);
  });

  it.each([
    'idle',
    'paused',
    'done',
    'tool-change',
    'cancelled',
    'errored',
    'disconnected',
    null,
  ] as const)('does not manufacture a stall incident or reset for a %s sender', (status) => {
    const harness = stalledHarness();
    const streamer = harness.get().streamer!;
    harness.set({ streamer: status === null ? null : { ...streamer, status } });
    const before = harness.get();
    containStalledStreamAcknowledgements(harness.set, harness.refs, harness.safeWrite);
    expect(harness.get()).toEqual(before);
    expect(harness.get().incidentHistory).toEqual([]);
    expect(harness.refs.nextTranscriptId).toBe(70);
    expect(runGrblDisconnectTransaction).not.toHaveBeenCalled();
    expect(harness.safeWrite).not.toHaveBeenCalled();
  });

  it('retains the no-reset diagnosis and preserves the real Marlin queued shutdown sequence', async () => {
    const harness = stalledHarness(marlinDriver);
    harness.set({ airAssistOn: true });
    containStalledStreamAcknowledgements(harness.set, harness.refs, harness.safeWrite);
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(harness.safeWrite.mock.calls).toEqual([
      ['M107\n', 'stop', 'system'],
      ['M410\n', 'stop', 'system'],
      ['M5 I\n', 'stop', 'system'],
      ['M9\n', 'stop', 'system'],
    ]);
    expect(runGrblDisconnectTransaction).not.toHaveBeenCalled();
    expect(harness.get().streamer?.status).toBe('errored');
    expect(harness.get().incidentHistory).toHaveLength(1);
    expect(retainedIncident(harness)).toMatchObject({
      raw: acknowledgementStalledNotice(false).message,
      incidentContext: {
        controller: { selectedKind: 'marlin' },
        run: { status: 'streaming', completed: 1, inFlightLines: 3 },
      },
    });
  });
});
