import { beforeEach, expect, it } from 'vitest';
import { createLayer } from '../../core/scene';
import { prepareProjectForPersistence } from '../../io/project/prepare-project-persistence';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { expectUnchanged, lastToast, loadScene, rect } from './testing/scene-limit-fixtures';
import { useToastStore } from './toast-store';

function fullProject(count = 256) {
  const layers = Array.from({ length: count }, (_, index) =>
    createLayer({ id: `operation-${index}`, color: `#${index.toString(16).padStart(6, '0')}` }),
  );
  return loadScene([{ ...rect('art'), operationIds: ['operation-0'] }], ['art'], [], layers);
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
});

it.each([
  ['manual operation', () => useStore.getState().createManualLayer('#abcdef')],
  ['additional operation', () => useStore.getState().addOperationForSelection()],
  ['unique operation', () => useStore.getState().makeSelectedOperationUnique('operation-0')],
] as const)('%s cannot make a project unsaveable', (_name, insert) => {
  const before = fullProject();
  insert();
  expectUnchanged(before);
  expect(useStore.getState().selectedObjectId).toBe('art');
  expect(lastToast()?.message).toContain('256 operations');
  expect(prepareProjectForPersistence(useStore.getState().project).kind).toBe('ok');
  fullProject(255);
  insert();
  expect(useStore.getState().project.scene.layers).toHaveLength(256);
  expect(prepareProjectForPersistence(useStore.getState().project).kind).toBe('ok');
});

it('still edits and removes operations when the project is at capacity', () => {
  fullProject();
  useStore.getState().renameOperation('operation-0', 'Renamed');
  expect(useStore.getState().project.scene.layers[0]?.name).toBe('Renamed');
  useStore.getState().deleteLayerAndObjects('operation-255');
  useStore.getState().createManualLayer('#abcdef');
  expect(useStore.getState().project.scene.layers).toHaveLength(256);
  expect(lastToast()).toBeUndefined();
});
