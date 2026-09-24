import { afterEach, describe, expect, it } from 'vitest';
import { cancel, createStreamer, step } from '../../core/controllers/grbl';
import { cancelPauseResumeTransition } from './laser-pause-resume-transition';
import {
  deferredWrite,
  flushRefillTasks,
  pausedRefillHarness,
  type refillResumeHarness,
} from '../../__fixtures__/controllers/hosted-refill-resume';

const opened: Array<ReturnType<typeof refillResumeHarness>> = [];
afterEach(() => {
  for (const harness of opened.splice(0)) harness.close();
});

async function paused() {
  const harness = await pausedRefillHarness();
  opened.push(harness);
  return harness;
}

describe('hosted refill after confirmed Pause and Resume', () => {
  it('re-arms only after the owned resume window settles, retaining immediate ACK accounting', async () => {
    const harness = await paused();
    const write = deferredWrite();
    harness.setWrite((data) => {
      if (data === 'G1 X2.000\n') {
        harness.emitLine('ok');
        return write.promise;
      }
      return undefined;
    });

    const resume = harness.actions.resumeJob();
    await flushRefillTasks();
    expect(harness.get().streamer).toMatchObject({ status: 'paused', completed: 2 });
    expect(harness.sent).toEqual([]);
    expect(harness.safeWrite.mock.calls.map(([data]) => data)).toEqual(['~', '?', 'G1 X2.000\n']);

    write.resolve();
    await flushRefillTasks();
    expect(harness.sent).toMatchObject([{ kind: 'prepare-arm' }]);
    expect(harness.adopted).toEqual([]);
    expect(harness.get().pauseResumeTransition?.action).toBe('resume');
    harness.ready();
    await resume;

    expect(harness.adopted).toHaveLength(1);
    expect(harness.adopted[0]).toMatchObject({
      status: 'streaming',
      completed: 2,
      queueIndex: 3,
      inFlight: [{ line: 'G1 X3.000\n' }],
    });
    expect(harness.get().pauseResumeTransition).toBeNull();
    expect(harness.hosted.isArmed()).toBe(true);
    const writes = harness.safeWrite.mock.calls.length;
    harness.emitLine('ok');
    expect(harness.safeWrite).toHaveBeenCalledTimes(writes);
    expect(harness.get().streamer?.completed).toBe(3);
  });

  it('captures an ACK crossing prepare/ready and suppresses duplicate refills after arm', async () => {
    const harness = await paused();
    const resume = harness.actions.resumeJob();
    await flushRefillTasks();
    harness.emitLine('ok');
    await flushRefillTasks();
    expect(harness.safeWrite.mock.calls.map(([data]) => data)).toEqual([
      '~',
      '?',
      'G1 X2.000\n',
      'G1 X3.000\n',
    ]);
    harness.ready();
    await resume;
    expect(harness.adopted[0]).toMatchObject({ completed: 2, queueIndex: 3 });
    harness.emitLine('ok');
    expect(harness.safeWrite).toHaveBeenCalledTimes(4);
  });

  it('never re-arms a transition cancelled while its resume write is pending', async () => {
    const harness = await paused();
    const write = deferredWrite();
    harness.setWrite((data) => (data === 'G1 X2.000\n' ? write.promise : undefined));
    const resume = harness.actions.resumeJob();
    const rejected = expect(resume).rejects.toThrow('cancelled');
    await flushRefillTasks();
    cancelPauseResumeTransition(harness.refs);
    harness.set((state) => ({ streamer: state.streamer === null ? null : cancel(state.streamer) }));
    await rejected;
    write.resolve();
    await flushRefillTasks();
    expect(harness.sent).toEqual([]);
    expect(harness.adopted).toEqual([]);
  });

  it('does not adopt a cancelled stream when ready arrives after Abort', async () => {
    const harness = await paused();
    const resume = harness.actions.resumeJob();
    const rejected = expect(resume).rejects.toThrow(/cancelled|no longer owns/);
    await flushRefillTasks();
    await harness.actions.stopJob();
    await rejected;
    harness.ready();
    await flushRefillTasks();
    expect(harness.adopted).toEqual([]);
    expect(harness.hosted.isArmed()).toBe(false);
    expect(harness.sent.at(-1)?.kind).toBe('release');
    expect(harness.get().streamer?.status).toBe('cancelled');
    expect(harness.safeWrite.mock.calls.filter(([data]) => data === '\x18')).toHaveLength(1);
  });

  it.each(['session', 'stream', 'run', 'connection', 'write epoch'] as const)(
    'does not hand over a replacement %s when its ready barrier arrives late',
    async (replacement) => {
      const harness = await paused();
      const resume = harness.actions.resumeJob();
      await flushRefillTasks();
      const next = step(createStreamer('G1 X99\nG1 X98\n', { rxBufferBytes: 8 })).state;
      if (replacement === 'session') harness.set({ controllerSessionEpoch: 4 });
      if (replacement === 'stream') harness.set({ streamerEpoch: 8, streamer: next });
      if (replacement === 'run') harness.set({ activeRunId: 'replacement-run', streamer: next });
      if (replacement === 'connection') harness.refs.connection = { ...harness.connection };
      if (replacement === 'write epoch') harness.refs.writeEpoch = 4;
      harness.ready();
      await resume;
      expect(harness.adopted).toEqual([]);
      expect(harness.hosted.isArmed()).toBe(false);
    },
  );
});
