import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step, type StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import { createStartIntent } from '../state/recovery/start-intent';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing';
import { installJobCheckpointTracking } from './use-job-checkpoint';

const NOW = '2026-09-22T01:00:00.000Z';
const LATER = '2026-09-22T01:01:00.000Z';
const RUN = 'prearchive-terminal';
const GCODE = 'G1 X10 S100';
const IDLE: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};
type Terminal = 'completed' | 'interrupted';
let uninstall = (): void => undefined;
let releaseResponse = (): void => undefined;

afterEach(() => {
  releaseResponse();
  uninstall();
  useLaserStore.setState(initialLaserState());
  vi.restoreAllMocks();
});

async function fixture() {
  const backend = new MemoryRecoveryStorageBackend();
  const repository = new RecoveryRepository({
    backend,
    generationStore: new MemoryRecoveryGenerationStore(),
    legacyStorage: { read: () => null, clear: () => undefined },
  });
  await repository.initialize();
  const reportFailure = vi.fn();
  const onCompleted = vi.fn();
  uninstall = installJobCheckpointTracking(() => LATER, repository, reportFailure, onCompleted);
  return { repository, backend, reportFailure, onCompleted };
}

async function arm(repository: RecoveryRepository, runId = RUN, armedAtIso = NOW) {
  const intent = createStartIntent({
    gcode: GCODE,
    machineKind: 'laser',
    outputScope: DEFAULT_OUTPUT_SCOPE,
    nowIso: armedAtIso,
  });
  expect(await repository.armFreshStartIntent(runId, intent, armedAtIso)).toEqual({
    ok: true,
    value: true,
  });
}

function begin(runId = RUN) {
  useLaserStore.setState({
    activeRunId: runId,
    streamer: step(createStreamer(GCODE)).state,
    connection: { kind: 'connected' },
    statusReport: IDLE,
  });
}

function end(terminal: Terminal) {
  const streamer = useLaserStore.getState().streamer;
  if (streamer === null) throw new Error('Expected current stream.');
  if (terminal === 'interrupted') {
    useLaserStore.setState({
      streamer: { ...streamer, status: 'disconnected' },
      connection: { kind: 'disconnected' },
    });
    return;
  }
  useLaserStore.setState({
    streamer: { ...streamer, status: 'done' },
    controllerOperation: { kind: 'post-job-settle', phase: 'awaiting-idle', idleReports: 2 },
  });
  useLaserStore.setState({ streamer: null, controllerOperation: null });
}

async function activate(repository: RecoveryRepository) {
  const artifact = await createCurrentTestExecutionArtifact({
    runId: RUN,
    gcode: GCODE,
    createdAtIso: NOW,
  });
  expect((await repository.stageArtifact(artifact)).ok).toBe(true);
  expect(await repository.activateFreshRun(RUN, NOW)).toEqual({ ok: true, value: true });
}

function delayedTerminalResponse(
  repository: RecoveryRepository,
  terminal: Terminal,
  storageFailure = false,
) {
  let ready = (): void => undefined;
  const awaitingResponse = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const complete = repository.completeRun.bind(repository);
  const interrupt = repository.interruptRun.bind(repository);
  const response = async () => {
    const result =
      terminal === 'completed'
        ? await complete(RUN, LATER)
        : await interrupt(RUN, 0, { kind: 'disconnect', message: 'Disconnected.' }, LATER);
    if (storageFailure) expect(result).toMatchObject({ ok: false });
    else expect(result).toEqual({ ok: true, value: false });
    ready();
    await gate;
    return result;
  };
  const spy =
    terminal === 'completed'
      ? vi.spyOn(repository, 'completeRun').mockImplementationOnce(response)
      : vi.spyOn(repository, 'interruptRun').mockImplementationOnce(response);
  return { awaitingResponse, spy };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe.each(['completed', 'interrupted'] as const)('prearchive %s ownership', (terminal) => {
  it.each(['unknown', 'another pending run'] as const)(
    'reports a no-op for %s instead of treating it as an owned handoff',
    async (identity) => {
      const input = await fixture();
      if (identity === 'another pending run') await arm(input.repository, 'another');
      begin();
      end(terminal);
      await vi.waitFor(() =>
        expect(input.reportFailure).toHaveBeenCalledWith({ ok: true, value: false }),
      );
      expect(input.onCompleted).not.toHaveBeenCalled();
    },
  );

  it.each(['new live run', 'new pending run', 'new arm', 'generation reset'] as const)(
    'does not suppress an old response after %s supersedes its ownership',
    async (replacement) => {
      const input = await fixture();
      await arm(input.repository);
      const delayed = delayedTerminalResponse(input.repository, terminal);
      begin();
      end(terminal);
      await delayed.awaitingResponse;
      if (replacement === 'new live run') begin('newer-run');
      else {
        if (replacement === 'generation reset') await input.repository.purgeControllerData();
        else await input.repository.cancelPendingStart(RUN);
        await arm(input.repository, replacement === 'new pending run' ? 'newer-run' : RUN, LATER);
      }
      releaseResponse();
      await vi.waitFor(() =>
        expect(input.reportFailure).toHaveBeenCalledWith({ ok: true, value: false }),
      );
      expect(input.onCompleted).not.toHaveBeenCalled();
      expect(delayed.spy).toHaveBeenCalledOnce();
    },
  );

  it('retries activation that happens while the terminal response is still pending', async () => {
    const input = await fixture();
    await arm(input.repository);
    const delayed = delayedTerminalResponse(input.repository, terminal);
    begin();
    end(terminal);
    await delayed.awaitingResponse;
    await activate(input.repository);
    // The real ordinary Start finally emits this one cleanup update. It lands
    // while the terminal attempt is queued; there are no subsequent reports.
    useLaserStore.setState({ framedRunStartClaim: null });
    releaseResponse();
    await vi.waitFor(() => expect(input.repository.getSnapshot().activeRun).toBeNull());
    expect(delayed.spy).toHaveBeenCalledTimes(2);
    expect(input.reportFailure).not.toHaveBeenCalled();
    if (terminal === 'completed') {
      expect(input.repository.getSnapshot().lastCompletedReceipt?.runId).toBe(RUN);
      expect(input.onCompleted.mock.calls).toEqual([[RUN]]);
    } else {
      expect(input.repository.getSnapshot().recoveryCapsule?.runId).toBe(RUN);
      expect(input.onCompleted).not.toHaveBeenCalled();
    }
    await input.repository.refresh();
    await flush();
    expect(delayed.spy).toHaveBeenCalledTimes(2);
  });

  it('refuses an activated re-arm that overtakes an older terminal response', async () => {
    const input = await fixture();
    await arm(input.repository);
    const delayed = delayedTerminalResponse(input.repository, terminal);
    begin();
    end(terminal);
    await delayed.awaitingResponse;
    await input.repository.cancelPendingStart(RUN);
    await arm(input.repository, RUN, LATER);
    await activate(input.repository);
    releaseResponse();
    await vi.waitFor(() =>
      expect(input.reportFailure).toHaveBeenCalledWith({ ok: true, value: false }),
    );
    expect(delayed.spy).toHaveBeenCalledOnce();
    expect(input.repository.getSnapshot().activeRun?.runId).toBe(RUN);
    expect(input.onCompleted).not.toHaveBeenCalled();
    useLaserStore.setState({ statusReport: { ...IDLE } });
    useLaserStore.setState({ streamer: null });
    await input.repository.refresh();
    await flush();
    expect(delayed.spy).toHaveBeenCalledOnce();
    expect(input.repository.getSnapshot().activeRun?.runId).toBe(RUN);
    expect(input.onCompleted).not.toHaveBeenCalled();
  });

  it('preserves reporting of a real storage failure after the expected prearchive no-op', async () => {
    const input = await fixture();
    await arm(input.repository);
    const spy =
      terminal === 'completed'
        ? vi.spyOn(input.repository, 'completeRun')
        : vi.spyOn(input.repository, 'interruptRun');
    begin();
    end(terminal);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
    await flush();
    expect(input.reportFailure).not.toHaveBeenCalled();
    input.backend.failNext('mutate-slots');
    useLaserStore.setState({ statusReport: { ...IDLE } });
    await vi.waitFor(() =>
      expect(input.reportFailure).toHaveBeenCalledWith(expect.objectContaining({ ok: false })),
    );
    expect(input.onCompleted).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'retries a first real storage failure on activation without a controller update (held=%s)',
    async (heldResponse) => {
      const input = await fixture();
      await arm(input.repository);
      const delayed = heldResponse
        ? delayedTerminalResponse(input.repository, terminal, true)
        : null;
      const spy =
        delayed?.spy ??
        (terminal === 'completed'
          ? vi.spyOn(input.repository, 'completeRun')
          : vi.spyOn(input.repository, 'interruptRun'));
      input.backend.failNext('mutate-slots');
      begin();
      end(terminal);
      if (delayed !== null) await delayed.awaitingResponse;
      else
        await vi.waitFor(() =>
          expect(input.reportFailure).toHaveBeenCalledWith(expect.objectContaining({ ok: false })),
        );
      expect(spy).toHaveBeenCalledOnce();
      expect(input.onCompleted).not.toHaveBeenCalled();
      await activate(input.repository);
      releaseResponse();
      await vi.waitFor(() => expect(input.repository.getSnapshot().activeRun).toBeNull());
      expect(spy).toHaveBeenCalledTimes(2);
      expect(input.reportFailure).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
      expect(input.reportFailure).toHaveBeenCalledOnce();
      expect(input.onCompleted.mock.calls).toEqual(terminal === 'completed' ? [[RUN]] : []);
      expect(
        terminal === 'completed'
          ? input.repository.getSnapshot().lastCompletedReceipt?.runId
          : input.repository.getSnapshot().recoveryCapsule?.runId,
      ).toBe(RUN);
    },
  );

  it.each(['new live run', 'new arm', 'generation reset', 'uninstalled tracker'] as const)(
    'does not wake a deferred terminal after %s',
    async (replacement) => {
      const input = await fixture();
      await arm(input.repository);
      const spy =
        terminal === 'completed'
          ? vi.spyOn(input.repository, 'completeRun')
          : vi.spyOn(input.repository, 'interruptRun');
      begin();
      end(terminal);
      await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
      await flush();
      expect(input.reportFailure).not.toHaveBeenCalled();
      if (replacement === 'new live run') begin('newer-run');
      else if (replacement === 'uninstalled tracker') uninstall();
      else {
        if (replacement === 'generation reset') await input.repository.purgeControllerData();
        else await input.repository.cancelPendingStart(RUN);
        await arm(input.repository, RUN, replacement === 'new arm' ? LATER : NOW);
      }
      await activate(input.repository);
      await flush();
      expect(spy).toHaveBeenCalledOnce();
      expect(input.repository.getSnapshot().activeRun?.runId).toBe(RUN);
      expect(input.onCompleted).not.toHaveBeenCalled();
      useLaserStore.setState({ statusReport: { ...IDLE } });
      await flush();
      expect(spy).toHaveBeenCalledOnce();
      expect(input.repository.getSnapshot().activeRun?.runId).toBe(RUN);
      expect(input.onCompleted).not.toHaveBeenCalled();
    },
  );

  it.each([
    { ok: true, value: false } as const,
    { ok: false, error: 'storage-unavailable' } as const,
  ])('reports a failed activation retry without looping on refresh ($ok)', async (failure) => {
    const input = await fixture();
    await arm(input.repository);
    const spy =
      terminal === 'completed'
        ? vi.spyOn(input.repository, 'completeRun')
        : vi.spyOn(input.repository, 'interruptRun');
    begin();
    end(terminal);
    await vi.waitFor(() => expect(spy).toHaveBeenCalledOnce());
    await flush();
    spy.mockResolvedValueOnce(failure);
    await activate(input.repository);
    await vi.waitFor(() => expect(input.reportFailure).toHaveBeenCalledWith(failure));
    for (let refresh = 0; refresh < 3; refresh += 1) await input.repository.refresh();
    await flush();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(input.onCompleted).not.toHaveBeenCalled();
    expect(input.repository.getSnapshot().activeRun?.runId).toBe(RUN);
    useLaserStore.setState({ statusReport: { ...IDLE } });
    await vi.waitFor(() => expect(input.repository.getSnapshot().activeRun).toBeNull());
    expect(spy).toHaveBeenCalledTimes(3);
    expect(input.reportFailure).toHaveBeenCalledOnce();
    expect(input.onCompleted.mock.calls).toEqual(terminal === 'completed' ? [[RUN]] : []);
  });
});
