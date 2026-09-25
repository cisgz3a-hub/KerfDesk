import { IDBFactory } from 'fake-indexeddb';
import { expect, it } from 'vitest';
import { capturePersonalArtwork } from './personal-artwork-model';
import { personalArtworkRepository } from './personal-artwork-storage';
import { artworkProject } from './personal-artwork-test-fixtures';

async function entry(name = 'Logo') {
  return capturePersonalArtwork(
    {
      project: artworkProject(),
      projectDocumentEpoch: 1,
      selectedObjectId: 'text',
      additionalSelectedIds: new Set(['image']),
    },
    name,
    'Jigs',
  );
}

it('persists across repository instances and atomically appends imported entries', async () => {
  const factory = new IDBFactory();
  const first = personalArtworkRepository(factory, 'library');
  const saved = await entry();
  await first.add([saved]);
  const second = personalArtworkRepository(factory, 'library');
  expect(await second.list()).toEqual([saved]);
  const imported = await entry('Another');
  await second.add([imported]);
  expect(await first.list()).toHaveLength(2);
  await first.remove(saved.id);
  expect(await second.list()).toEqual([imported]);
});

it('keeps previous data and rolls back the whole batch on a duplicate or invalid import', async () => {
  const repository = personalArtworkRepository(new IDBFactory(), 'atomic');
  const saved = await entry();
  await repository.add([saved]);
  const other = await entry('Other');
  await expect(repository.add([other, saved])).rejects.toThrow();
  expect(await repository.list()).toEqual([saved]);
  await expect(
    repository.add([other, { ...saved, id: 'bad', projectJson: '{}' }]),
  ).rejects.toThrow();
  expect(await repository.list()).toEqual([saved]);
});

it('does not lose entries from concurrent independent library writers', async () => {
  const factory = new IDBFactory();
  const one = await entry('One');
  const two = await entry('Two');
  await Promise.all([
    personalArtworkRepository(factory, 'shared').add([one]),
    personalArtworkRepository(factory, 'shared').add([two]),
  ]);
  expect(await personalArtworkRepository(factory, 'shared').list()).toHaveLength(2);
});
