import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStreamer, step } from '../../core/controllers/grbl';
import { DEFAULT_OUTPUT_SCOPE } from '../../core/scene';
import { useLaserStore } from '../state/laser-store';
import { buildPortClosePatch, initialLaserState } from '../state/laser-store-helpers';
import { RecoveryRepository } from '../state/recovery';
import { MemoryRecoveryStorageBackend } from '../state/recovery/recovery-backend';
import { MemoryRecoveryGenerationStore } from '../state/recovery/recovery-generation';
import { createStartIntent } from '../state/recovery/start-intent';
import { createCurrentTestExecutionArtifact } from '../state/recovery/testing';
import { installJobCheckpointTracking } from './use-job-checkpoint';

const NOW = '2026-09-22T01:00:00.000Z';
const RUN = 'disconnect-during-archive';
const GCODE = 'G21\nG90\nG1 X10 S100\nM5\n';
let uninstall = (): void => undefined;
let releaseWrite = (): void => undefined;

function deferred() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

afterEach(() => {
  releaseWrite();
  uninstall();
  useLaserStore.setState(initialLaserState());
  vi.restoreAllMocks();
});

describe('disconnect during post-accept archive persistence', () => {
  it.each(['before commit', 'after commit'] as const)(
    'settles the real port-close transition when the artifact write pauses %s',
    async (boundary) => {
      const backend = new MemoryRecoveryStorageBackend();
      const repository = new RecoveryRepository({
        backend,
        generationStore: new MemoryRecoveryGenerationStore(),
        legacyStorage: { read: () => null, clear: () => undefined },
        nowIso: () => NOW,
      });
      await repository.initialize();
      const reportFailure = vi.fn();
      uninstall = installJobCheckpointTracking(() => NOW, repository, reportFailure);
      const intent = createStartIntent({
        gcode: GCODE,
        machineKind: 'laser',
        outputScope: DEFAULT_OUTPUT_SCOPE,
        nowIso: NOW,
      });
      expect(await repository.armFreshStartIntent(RUN, intent)).toEqual({ ok: true, value: true });
      useLaserStore.setState({
        activeRunId: RUN,
        streamer: { ...step(createStreamer(GCODE)).state, completed: 2 },
        connection: { kind: 'connected' },
      });

      const enteredWrite = deferred();
      const writeGate = deferred();
      releaseWrite = writeGate.resolve;
      const putArtifact = backend.putArtifact.bind(backend);
      vi.spyOn(backend, 'putArtifact').mockImplementationOnce(async (record) => {
        const committed = boundary === 'after commit' ? await putArtifact(record) : undefined;
        enteredWrite.resolve();
        await writeGate.promise;
        return committed ?? putArtifact(record);
      });
      const staging = repository.stageArtifact(
        await createCurrentTestExecutionArtifact({ runId: RUN, gcode: GCODE, createdAtIso: NOW }),
      );
      await enteredWrite.promise;
      const interrupt = vi.spyOn(repository, 'interruptRun');
      useLaserStore.setState(buildPortClosePatch(useLaserStore.getState()));
      await vi.waitFor(() => expect(interrupt).toHaveBeenCalledOnce());
      await interrupt.mock.results[0]?.value;
      const disconnectedState = useLaserStore.getState();
      expect(disconnectedState.connection.kind).toBe('disconnected');
      expect(disconnectedState.streamer?.status).toBe('disconnected');
      expect(repository.getSnapshot().recoveryCapsule).toBeNull();

      releaseWrite();
      expect(await staging).toEqual({ ok: true, value: RUN });
      expect(await repository.activateFreshRun(RUN)).toEqual({ ok: true, value: true });
      // A disconnected controller produces no later status poll or cleanup
      // event. Only the repository's archive activation can retry the terminal.
      await vi.waitFor(() =>
        expect(repository.getSnapshot().recoveryCapsule).toMatchObject({
          runId: RUN,
          artifactKind: 'exact-execution',
          ackedLines: 2,
          interruption: { kind: 'disconnect' },
        }),
      );
      expect(repository.getSnapshot().activeRun).toBeNull();
      expect(repository.getSnapshot().pendingStart).toBeNull();
      expect(await repository.getArchivedExecution(RUN)).toMatchObject({
        ok: true,
        value: { runId: RUN, gcode: GCODE },
      });
      expect(useLaserStore.getState()).toBe(disconnectedState);
      expect(reportFailure).not.toHaveBeenCalled();
    },
  );
});
