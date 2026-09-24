import { afterEach, describe, expect, it } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import {
  deferredWrite,
  flushRefillTasks,
  longRefillJob,
  refillResumeHarness,
} from '../../__fixtures__/controllers/hosted-refill-resume';

const opened: Array<ReturnType<typeof refillResumeHarness>> = [];
afterEach(() => {
  for (const harness of opened.splice(0)) harness.close();
});

function atToolChange(gcode = `M0\n${longRefillJob()}`) {
  const harness = refillResumeHarness();
  opened.push(harness);
  harness.set({
    streamer: step(createStreamer(gcode, { rxBufferBytes: 11, toolChangePause: true })).state,
    activeJobMachineKind: 'cnc',
    toolChangeIdleSeen: true,
    workZZeroEvidence: { source: 'manual-zero', referenceEpoch: 0, toolId: 'bit-2' },
    pendingToolId: 'bit-2',
  });
  return harness;
}

describe('hosted refill after tool-change Continue', () => {
  it('arms after the first continued window and takes the fresh ACK ledger at ready', async () => {
    const harness = atToolChange();
    const write = deferredWrite();
    harness.setWrite((data) => (data === 'G1 X1.000\n' ? write.promise : undefined));
    const continuing = harness.actions.continueToolChange();
    await flushRefillTasks();
    expect(harness.sent).toEqual([]);
    write.resolve();
    await flushRefillTasks();
    expect(harness.sent).toMatchObject([{ kind: 'prepare-arm' }]);
    harness.emitLine('ok');
    await flushRefillTasks();
    harness.ready();
    await continuing;

    expect(harness.adopted[0]).toMatchObject({
      status: 'streaming',
      completed: 2,
      queueIndex: 3,
      inFlight: [{ line: 'G1 X2.000\n' }],
    });
    const writes = harness.safeWrite.mock.calls.length;
    harness.emitLine('ok');
    expect(harness.safeWrite).toHaveBeenCalledTimes(writes);
  });

  it('does not host a section that enters the next M0 hold within its first window', async () => {
    const harness = atToolChange('M0\nM5\nM0\nG1 X8.000');
    await harness.actions.continueToolChange();
    expect(harness.get().streamer?.status).toBe('tool-change');
    expect(harness.safeWrite).toHaveBeenCalledWith('M5\n', 'resume');
    expect(harness.sent).toEqual([]);
    expect(harness.adopted).toEqual([]);
  });

  it('waits for an outstanding worker release before continuing and re-arming', async () => {
    const harness = atToolChange();
    const oldStream = step(createStreamer(longRefillJob(), { rxBufferBytes: 11 })).state;
    const arming = harness.hosted.arm(() => oldStream);
    harness.ready();
    await arming;
    harness.holdRelease();
    const releasing = harness.hosted.release();
    const continuing = harness.actions.continueToolChange();
    await flushRefillTasks();
    expect(harness.safeWrite).not.toHaveBeenCalled();
    expect(harness.get().streamer?.status).toBe('tool-change');

    harness.finishRelease();
    await releasing;
    await flushRefillTasks();
    expect(harness.safeWrite).toHaveBeenCalledWith('G1 X1.000\n', 'resume');
    harness.ready();
    await continuing;
    expect(harness.adopted).toHaveLength(2);
    expect(harness.hosted.isArmed()).toBe(true);
  });

  it('consumes a held M0 once when two Continue requests cross the release await', async () => {
    const harness = atToolChange();
    const first = harness.actions.continueToolChange();
    const second = harness.actions.continueToolChange();
    await flushRefillTasks();
    harness.ready();
    await Promise.all([first, second]);
    expect(harness.safeWrite).toHaveBeenCalledTimes(1);
    expect(harness.safeWrite).toHaveBeenCalledWith('G1 X1.000\n', 'resume');
    expect(harness.adopted).toHaveLength(1);
    expect(harness.adopted[0]?.completed).toBe(1);
  });

  it.each(['session', 'stream', 'run', 'connection', 'write epoch'] as const)(
    'does not hand over a replacement %s after an old Continue write settles',
    async (replacement) => {
      const harness = atToolChange();
      const write = deferredWrite();
      harness.setWrite(() => write.promise);
      const continuing = harness.actions.continueToolChange();
      await flushRefillTasks();
      const next = step(createStreamer('G1 X99\nG1 X98\n', { rxBufferBytes: 8 })).state;
      if (replacement === 'session') harness.set({ controllerSessionEpoch: 4 });
      if (replacement === 'stream') harness.set({ streamerEpoch: 8, streamer: next });
      if (replacement === 'run') harness.set({ activeRunId: 'replacement-run', streamer: next });
      if (replacement === 'connection') harness.refs.connection = { ...harness.connection };
      if (replacement === 'write epoch') harness.refs.writeEpoch = 4;
      write.resolve();
      await continuing;
      expect(harness.sent).toEqual([]);
      expect(harness.adopted).toEqual([]);
    },
  );

  it('rejects a replacement run introduced while Continue waits at ready', async () => {
    const harness = atToolChange();
    const continuing = harness.actions.continueToolChange();
    await flushRefillTasks();
    harness.set({ activeRunId: 'replacement-run' });
    harness.ready();
    await continuing;
    expect(harness.adopted).toEqual([]);
    expect(harness.hosted.isArmed()).toBe(false);
  });
});
