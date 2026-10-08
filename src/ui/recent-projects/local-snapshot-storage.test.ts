import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { createLocalSnapshotStorage } from './local-snapshot-storage';
import type { LocalProjectSnapshot } from './local-project-snapshot';

function copy(id: string, createdAt = 1): LocalProjectSnapshot {
  return {
    version: 1,
    id,
    createdAt,
    name: `Copy ${id}`,
    notesExcerpt: 'Focus test',
    bytes: 2,
    projectJson: '{}',
  };
}

describe('local named snapshot storage', () => {
  it('persists complete copies across repository instances while listing only metadata', async () => {
    const factory = new FakeIDBFactory();
    const first = createLocalSnapshotStorage(factory);
    await first.add(copy('old'));
    await first.add(copy('new', 2));
    const reopened = createLocalSnapshotStorage(factory);
    const list = await reopened.list();
    expect(list.map((header) => header.id)).toEqual(['new', 'old']);
    expect(list[0]).not.toHaveProperty('projectJson');
    expect(await reopened.read('old')).toEqual(copy('old'));
    await reopened.remove('old');
    expect(await first.read('old')).toBeNull();
    expect(await first.read('new')).toEqual(copy('new', 2));
  });

  it('caps concurrent writers atomically and preserves every committed copy', async () => {
    const factory = new FakeIDBFactory();
    const first = createLocalSnapshotStorage(factory);
    const second = createLocalSnapshotStorage(factory);
    for (let index = 0; index < 11; index++) await first.add(copy(`copy-${index}`));
    const results = await Promise.allSettled([first.add(copy('a')), second.add(copy('b'))]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await first.list()).toHaveLength(12);
    for (let index = 0; index < 11; index++)
      expect(await second.read(`copy-${index}`)).toEqual(copy(`copy-${index}`));
  });

  it('reports unavailable storage without claiming a persistent save', async () => {
    const storage = createLocalSnapshotStorage();
    await expect(storage.add(copy('a'))).rejects.toThrow('unavailable');
    await expect(storage.list()).rejects.toThrow('unavailable');
  });
});
