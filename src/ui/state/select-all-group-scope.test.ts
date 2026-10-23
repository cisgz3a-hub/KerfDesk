import { beforeEach, expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { focusDesignHierarchy, useDesignHierarchyStore } from './design-hierarchy-store';
import { resetStore } from './test-helpers';
import { useStore } from './store';
import { deleteSelection } from '../commands/selection-delete-action';

function artwork(id: string): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    operationIds: ['cut'],
    paths: [],
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
  };
}

beforeEach(() => {
  resetStore();
  useDesignHierarchyStore.setState({ focusId: null, documentEpoch: -1 });
});

it('Select All and Delete inside a group leave outside artwork intact, with exact Undo and Redo', () => {
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      scene: {
        ...project.scene,
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        objects: ['a', 'b', 'outside'].map(artwork),
        groups: [{ id: 'group', name: 'Group', objectIds: ['a', 'b'] }],
      },
    },
  });
  focusDesignHierarchy('group', useStore.getState().projectDocumentEpoch);
  useStore.getState().selectAllObjects();
  expect(
    [useStore.getState().selectedObjectId, ...useStore.getState().additionalSelectedIds].sort(),
  ).toEqual(['a', 'b']);
  deleteSelection();
  expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual(['outside']);
  useStore.getState().undo();
  expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
    'a',
    'b',
    'outside',
  ]);
  useStore.getState().redo();
  expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual(['outside']);
});
