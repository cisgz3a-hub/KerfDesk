import { vi } from 'vitest';
import { createStreamer, step, type StreamerState } from '../../core/controllers/grbl';
import type { SerialConnection } from '../../platform/types';
import type { SerialWorkerRequest } from '../../platform/web/serial-worker-protocol';
import { createWorkerRefillHandover } from '../../platform/web/worker-refill-handover';
import { cancelControllerLifecycleRefs } from '../../ui/state/laser-interactive-command';
import { jobActions } from '../../ui/state/laser-job-actions';
import { handleLine } from '../../ui/state/laser-line-handler';
import { makeLineHandlerHarness } from '../../ui/state/laser-line-handler.test-support';
import { cancelResetCleanup } from '../../ui/state/laser-reset-cleanup';

export function deferredWrite() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

export async function flushRefillTasks(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

export function refillResumeHarness() {
  const { refs, set, get } = makeLineHandlerHarness();
  const sent: SerialWorkerRequest[] = [];
  const adopted: StreamerState[] = [];
  let onWrite: ((data: string) => Promise<void> | void) | null = null;
  let controllerState = 'Run';
  let releaseHeld = false;
  const handover = createWorkerRefillHandover({
    timeoutMs: 2_000,
    fail: () => {
      throw new Error('Unexpected test handover timeout.');
    },
    onWriteError: () => () => undefined,
    post: (message) => {
      sent.push(message);
      if (message.kind === 'release' && !releaseHeld)
        handover.receive({ kind: 'released', id: message.id });
      if (message.kind === 'arm') {
        adopted.push(message.streamer);
        handover.receive({ kind: 'armed', id: message.id });
      }
    },
  });
  const emitLine = (line: string): void => handleLine(set, get, refs, safeWrite, line);
  const safeWrite = vi.fn(async (data: string) => {
    await onWrite?.(data);
    if (data === '\x84') controllerState = 'Door:0';
    if (data === '~') controllerState = 'Run';
    if (data === '?') emitLine(`<${controllerState}|MPos:0,0,0|FS:0,0|Ov:100,100,100>`);
  });
  const connection: SerialConnection = {
    write: safeWrite,
    onLine: () => () => undefined,
    onClose: () => () => undefined,
    close: async () => undefined,
    hostedStreaming: handover.refill,
  };
  refs.connection = connection;
  refs.writeEpoch = 3;
  set({
    controllerSessionEpoch: 3,
    streamerEpoch: 7,
    activeRunId: 'refill-resume-run',
    activeJobMachineKind: 'laser',
    streamer: step(createStreamer(longRefillJob(), { rxBufferBytes: 11 })).state,
  });
  const ready = (): void => {
    const request = sent.findLast((message) => message.kind === 'prepare-arm');
    if (request?.kind !== 'prepare-arm') throw new Error('Expected a prepare-arm barrier.');
    handover.receive({ kind: 'ready', id: request.id });
  };
  return {
    refs,
    set,
    get,
    connection,
    sent,
    adopted,
    safeWrite,
    emitLine,
    ready,
    hosted: handover.refill,
    actions: jobActions(set, get, refs, safeWrite, () => refs.driver),
    setWrite: (write: typeof onWrite) => {
      onWrite = write;
    },
    holdRelease: () => {
      releaseHeld = true;
    },
    finishRelease: () => {
      const request = sent.findLast((message) => message.kind === 'release');
      if (request?.kind !== 'release') throw new Error('Expected a release barrier.');
      handover.receive({ kind: 'released', id: request.id });
      releaseHeld = false;
    },
    close: () => {
      handover.close();
      cancelControllerLifecycleRefs(refs);
      cancelResetCleanup(refs);
    },
  };
}

export function longRefillJob(): string {
  return Array.from({ length: 8 }, (_, index) => `G1 X${index + 1}.000`).join('\n');
}

export async function pausedRefillHarness() {
  const harness = refillResumeHarness();
  const arming = harness.hosted.arm(() => harness.get().streamer);
  harness.ready();
  await arming;
  await harness.actions.pauseJob();
  harness.emitLine('ok');
  harness.safeWrite.mockClear();
  harness.sent.length = 0;
  harness.adopted.length = 0;
  return harness;
}
