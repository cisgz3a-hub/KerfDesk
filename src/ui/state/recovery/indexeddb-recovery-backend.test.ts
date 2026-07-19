import { describe, expect, it, vi } from 'vitest';
import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { DEFAULT_OUTPUT_SCOPE, createProject } from '../../../core/scene';
import type { PreparedOutput } from '../../../io/gcode';
import type { CanvasMotionPlan } from '../canvas-motion-plan';
import { createExecutionArtifact, type ExecutionArtifactV1 } from './execution-artifact';
import {
  IndexedDbRecoveryStorageBackend,
  migrateLegacyStoredArtifactOrigin,
} from './indexeddb-recovery-backend';
import { MemoryRecoveryGenerationStore } from './recovery-generation';
import {
  emptyRecoverySlots,
  LEGACY_CHECKPOINT_ARTIFACT_ORIGIN,
  MIGRATED_LEGACY_EXACT_ARTIFACT_ORIGIN,
} from './recovery-model';
import { RecoveryRepository } from './recovery-repository';

const DATABASE_NAME = 'laserforge-job-recovery-v1';
const NOW = '2026-07-19T03:00:00.000Z';

describe('IndexedDbRecoveryStorageBackend', () => {
  it('tags only artifacts that physically predate the provenance database upgrade', () => {
    const legacyExact = {
      runId: 'run-old-exact',
      generation: 0,
      artifact: { kind: 'exact-execution', schemaVersion: 1 },
    };
    const fingerprintOnly = {
      runId: 'run-old-fingerprint',
      generation: 0,
      artifact: { kind: 'legacy-fingerprint-only', schemaVersion: 1 },
    };
    const untaggedCurrent = {
      runId: 'run-untagged-current',
      generation: 0,
      artifact: { kind: 'exact-execution', schemaVersion: 2 },
    };

    expect(migrateLegacyStoredArtifactOrigin(legacyExact)).toEqual({
      ...legacyExact,
      origin: MIGRATED_LEGACY_EXACT_ARTIFACT_ORIGIN,
    });
    expect(migrateLegacyStoredArtifactOrigin(fingerprintOnly)).toEqual({
      ...fingerprintOnly,
      origin: LEGACY_CHECKPOINT_ARTIFACT_ORIGIN,
    });
    expect(migrateLegacyStoredArtifactOrigin(untaggedCurrent)).toBe(untaggedCurrent);
  });

  it('tags but does not hydrate a legacy exact artifact during the real v1-to-v2 upgrade', async () => {
    const factory = new FakeIDBFactory();
    const artifact = legacyExactArtifact('run-db-v1-exact');
    await seedVersionOneDatabase(factory, artifact);

    const backend = new IndexedDbRecoveryStorageBackend(factory);
    const stored = await backend.getArtifact(artifact.runId);
    expect(stored).toMatchObject({
      runId: artifact.runId,
      generation: 0,
      origin: MIGRATED_LEGACY_EXACT_ARTIFACT_ORIGIN,
      artifact: { schemaVersion: 1, kind: 'exact-execution', gcode: artifact.gcode },
    });

    const repository = new RecoveryRepository({
      backend,
      generationStore: new MemoryRecoveryGenerationStore(),
      legacyStorage: { read: () => null, clear: () => undefined },
      nowIso: () => NOW,
    });
    const initialized = await repository.initialize();

    expect(initialized.ok).toBe(true);
    if (!initialized.ok) throw new Error(`Recovery initialization failed: ${initialized.error}`);
    expect(initialized.value.recoveryCapsule).toBeNull();
    expect(await backend.getArtifact(artifact.runId)).toBeNull();
  });

  it('closes its successful connection when a later database version is requested', async () => {
    const factory = new FakeIDBFactory();
    const backend = new IndexedDbRecoveryStorageBackend(factory);
    await backend.readSlots();

    const next = await openDatabase(factory, 3);
    expect(next.version).toBe(3);
    next.close();
  });

  it('guards targeted deletion with live slots, generation, and staging identity', async () => {
    const factory = new FakeIDBFactory();
    const backend = new IndexedDbRecoveryStorageBackend(factory);
    const artifact = legacyExactArtifact('run-guarded-delete');
    const stagingLeaseExpiresAtEpochMs = Date.now() + 60_000;
    await backend.putArtifact({
      runId: artifact.runId,
      generation: 0,
      origin: MIGRATED_LEGACY_EXACT_ARTIFACT_ORIGIN,
      stagingLeaseExpiresAtEpochMs,
      artifact,
    });
    await backend.mutateSlots(() => ({
      slots: {
        ...emptyRecoverySlots(0),
        revision: 1,
        pendingStart: {
          runId: artifact.runId,
          kind: 'fresh',
          sendableLines: artifact.sendableLines,
          armedAtIso: NOW,
        },
      },
      value: undefined,
    }));

    expect(
      await backend.deleteArtifactIfUnreferenced(artifact.runId, {
        generation: 0,
        stagingLeaseExpiresAtEpochMs,
      }),
    ).toBe(false);
    await backend.mutateSlots(() => ({ slots: emptyRecoverySlots(0), value: undefined }));
    expect(await backend.deleteArtifactIfUnreferenced(artifact.runId, { generation: 1 })).toBe(
      false,
    );
    expect(
      await backend.deleteArtifactIfUnreferenced(artifact.runId, {
        generation: 0,
        stagingLeaseExpiresAtEpochMs: stagingLeaseExpiresAtEpochMs + 1,
      }),
    ).toBe(false);
    expect(
      await backend.deleteArtifactIfUnreferenced(artifact.runId, {
        generation: 0,
        stagingLeaseExpiresAtEpochMs,
      }),
    ).toBe(true);
    expect(await backend.artifactExists(artifact.runId)).toBe(false);
  });

  it('aborts and rejects when a cursor visitor throws synchronously', async () => {
    const failure = new Error('Cursor delete failed synchronously.');
    const cursor = {
      key: 'discard-me',
      delete: vi.fn(() => {
        throw failure;
      }),
      continue: vi.fn(),
    };
    const cursorRequest: {
      result: typeof cursor;
      onsuccess?: () => void;
      onerror?: () => void;
      error?: DOMException | null;
    } = { result: cursor };
    const store = {
      openCursor: vi.fn(() => {
        queueMicrotask(() => cursorRequest.onsuccess?.());
        return cursorRequest;
      }),
    };
    const slotRequest: {
      result?: undefined;
      onsuccess?: () => void;
      onerror?: () => void;
      error?: DOMException | null;
    } = {};
    const slotStore = {
      get: vi.fn(() => {
        queueMicrotask(() => slotRequest.onsuccess?.());
        return slotRequest;
      }),
    };
    const transaction = {
      objectStore: vi.fn((name: string) => (name === 'slots' ? slotStore : store)),
      abort: vi.fn(),
    };
    const database = {
      transaction: vi.fn(() => transaction),
    };
    const openRequest: {
      result: typeof database;
      onsuccess?: () => void;
      onerror?: () => void;
      onblocked?: () => void;
      onupgradeneeded?: () => void;
      error?: DOMException | null;
    } = { result: database };
    const factory = {
      open: vi.fn(() => {
        queueMicrotask(() => openRequest.onsuccess?.());
        return openRequest;
      }),
    };
    const backend = new IndexedDbRecoveryStorageBackend(factory as unknown as IDBFactory);

    await expect(backend.deleteArtifactsExcept(new Set())).rejects.toBe(failure);
    expect(transaction.abort).toHaveBeenCalledOnce();
    expect(cursor.continue).not.toHaveBeenCalled();
  });
});

function legacyExactArtifact(runId: string): ExecutionArtifactV1 {
  const project = createProject(DEFAULT_DEVICE_PROFILE);
  const created = createExecutionArtifact({
    artifactSchemaVersion: 1,
    runId,
    gcode: 'G21\nG90\nG1 X1\nM5\n',
    prepared: {
      ok: true,
      project,
      job: { groups: [] },
      jobOriginOffset: { x: 0, y: 0 },
    } satisfies Extract<PreparedOutput, { readonly ok: true }>,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan: { retentionKey: `signature-${runId}` } as CanvasMotionPlan,
    controllerSettings: null,
    createdAtIso: NOW,
  });
  const { estimatedArtifactBytes: _currentOnlyEstimate, ...legacy } = created;
  return legacy;
}

async function seedVersionOneDatabase(
  factory: IDBFactory,
  artifact: ExecutionArtifactV1,
): Promise<void> {
  const database = await openDatabase(factory, 1, (upgrade) => {
    upgrade.createObjectStore('artifacts', { keyPath: 'runId' });
    upgrade.createObjectStore('slots', { keyPath: 'key' });
  });
  const transaction = database.transaction(['artifacts', 'slots'], 'readwrite');
  transaction.objectStore('artifacts').add({ runId: artifact.runId, generation: 0, artifact });
  transaction.objectStore('slots').put({
    key: 'current',
    value: {
      schemaVersion: 2,
      generation: 0,
      revision: 1,
      activeRun: null,
      recoveryCapsule: {
        runId: artifact.runId,
        artifactKind: artifact.kind,
        revision: 1,
        ackedLines: 2,
        sendableLines: artifact.sendableLines,
        interruption: { kind: 'disconnect', message: 'Cable removed.' },
        updatedAtIso: NOW,
      },
      lastCompletedReceipt: null,
      pendingStart: null,
    },
  });
  await transactionDone(transaction);
  database.close();
}

function openDatabase(
  factory: IDBFactory,
  version: number,
  upgrade?: (database: IDBDatabase) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const pending = factory.open(DATABASE_NAME, version);
    pending.onupgradeneeded = () => upgrade?.(pending.result);
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error ?? new Error('Could not open test database.'));
    pending.onblocked = () => reject(new Error('Test database upgrade was blocked.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Test database transaction failed.'));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error('Test database transaction aborted.'));
  });
}
