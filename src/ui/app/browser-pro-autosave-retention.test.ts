import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { serializeProject } from '../../io/project/serialize-project';
import { writeAutosave } from '../state/autosave';
import { AutosaveDurableService } from '../state/autosave-durable';
import { IndexedDbAutosaveRepository } from '../state/autosave-indexeddb';
import { currentAutosaveSessionId } from '../state/autosave-local-storage';
import { AutosaveSessionLocks } from '../state/autosave-session-lock';
import { usePendingProProjectStore } from '../state/pending-pro-project';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { proProject } from './pro-project-test-fixtures';
import { runAutosaveRecovery } from './use-autosave';

vi.mock('../../platform/build-capabilities', () => ({ BROWSER_FREE_BUILD: true }));

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetStore();
  usePendingProProjectStore.setState({ pending: null });
});

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

it.each(['indexeddb', 'local'] as const)(
  'detaches a refused current-session %s autosave through Free edits, unload and manual-save cleanup',
  async (backend) => {
    const repository = new IndexedDbAutosaveRepository({
      factory: backend === 'indexeddb' ? new IDBFactory() : undefined,
      databaseName: `pro-retention-${crypto.randomUUID()}`,
    });
    const service = new AutosaveDurableService({
      repository,
      locks: new AutosaveSessionLocks(null),
    });
    const original = proProject();
    const written = await service.write(original, 100);
    expect(written).toMatchObject({ kind: 'ok', backend });
    if (written.kind !== 'ok') throw new Error('Fixture was not persisted');
    const sourceSession = (await service.session()).sessionId;
    const originalLocal = localStorage.getItem(written.storageKey);
    const originalSlots = backend === 'indexeddb' ? await repository.readAllSlots() : [];
    const chooseRestore = vi.fn(() => false);
    const current = useStore.getState();

    await runAutosaveRecovery(chooseRestore, service);

    expect(chooseRestore).not.toHaveBeenCalled();
    expect(useStore.getState()).toBe(current);
    expect(usePendingProProjectStore.getState().pending?.source).toBe('autosave');
    expect((await service.session()).sessionId).not.toBe(sourceSession);
    expect(currentAutosaveSessionId()).not.toBe(sourceSession);
    const free = { ...createProject(), notes: 'New Free work after dismissing the Pro dialog' };
    useStore.getState().setProject(free);
    useStore.setState({ dirty: true });
    await service.write(free, 200);
    expect(writeAutosave(free, 300).kind).toBe('ok');
    useStore.getState().markLoaded('saved-free.lf2');
    await service.clearCurrent();

    expect(localStorage.getItem(written.storageKey)).toBe(originalLocal);
    if (backend === 'indexeddb') {
      const retained = (await repository.readAllSlots()).find(
        (slot) => slot.storageKey === written.storageKey,
      );
      expect(retained).toEqual(originalSlots[0]);
    }
    const recovered = (await service.readLatest()).snapshot;
    expect(recovered?.storageKey).toBe(written.storageKey);
    expect(JSON.parse(serializeProject(recovered!.project))).toEqual(
      JSON.parse(serializeProject(original)),
    );
    await service.stop();
  },
);

it('keeps refused legacy recovery bytes through saving an unrelated Free document', async () => {
  const original = proProject();
  const raw = JSON.stringify({
    schemaVersion: 1,
    savedAt: 100,
    projectJson: serializeProject(original),
  });
  const sourceKey = 'lf2:autosave:v1';
  localStorage.setItem(sourceKey, raw);
  const service = new AutosaveDurableService({
    repository: new IndexedDbAutosaveRepository({ factory: new IDBFactory() }),
    locks: new AutosaveSessionLocks(null),
  });
  await runAutosaveRecovery(() => false, service);
  const free = { ...createProject(), notes: 'Another document' };
  await service.write(free, 200);
  writeAutosave(free, 300);
  await service.clearCurrent();
  expect(localStorage.getItem(sourceKey)).toBe(raw);
  expect((await service.readLatest()).snapshot?.storageKey).toBe(sourceKey);
  await service.stop();
});
