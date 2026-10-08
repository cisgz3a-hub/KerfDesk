import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, type SceneGroup } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { designTreeRows, designRowId } from '../layers/design-tree-rows';
import { resetStore, svgObj } from './test-helpers';
import { useStore } from './store';
import { useDesignHierarchyStore } from './design-hierarchy-store';

function seed(
  groups: ReadonlyArray<SceneGroup> = [
    { id: 'outer', name: 'Outer', objectIds: ['A', 'B', 'C', 'D', 'E'] },
    { id: 'child', name: 'Child', objectIds: ['A', 'B', 'C'], parentId: 'outer' },
    { id: 'target', name: 'Target', objectIds: ['F', 'G'] },
  ],
): void {
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      scene: {
        ...project.scene,
        objects: [...'ABCDEFGH'].map((id) => svgObj(id, ['#000000'])),
        groups,
        artworkOrder: ['H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'],
      },
    },
    selectedObjectId: 'C',
    additionalSelectedIds: new Set(['D']),
  });
}
beforeEach(() => {
  resetStore();
  useDesignHierarchyStore.setState({ focusId: null, documentEpoch: -1 });
  seed();
});
describe('hierarchy action ownership and persistence', () => {
  it('reparents as one undoable edit, persisting design order and preserving selection/output ownership', () => {
    const before = useStore.getState();
    const result = before.moveDesignNode(
      { node: { kind: 'group', id: 'child' }, parentId: 'target' },
      before,
    );
    expect(result).toEqual({ kind: 'ok', changed: true });
    const after = useStore.getState();
    expect(after.project.scene.groups?.find((group) => group.id === 'outer')?.objectIds).toEqual([
      'D',
      'E',
    ]);
    expect(after.project.scene.groups?.find((group) => group.id === 'target')?.objectIds).toEqual([
      'F',
      'G',
      'A',
      'B',
      'C',
    ]);
    expect(after.project.scene.objects).toBe(before.project.scene.objects);
    expect(after.project.scene.artworkOrder).toBe(before.project.scene.artworkOrder);
    expect(after.project.scene.layers).toBe(before.project.scene.layers);
    expect(after.selectedObjectId).toBe(before.selectedObjectId);
    expect(after.additionalSelectedIds).toBe(before.additionalSelectedIds);
    expect(after.undoStack).toHaveLength(1);
    const loaded = deserializeProject(serializeProject(after.project));
    expect(loaded.kind).toBe('ok');
    if (loaded.kind === 'ok') {
      expect(loaded.project.scene.designTreeOrder).toEqual(after.project.scene.designTreeOrder);
      expect(loaded.project.scene.groups).toEqual(after.project.scene.groups);
    }
    after.undo();
    expect(useStore.getState().project).toBe(before.project);
    useStore.getState().redo();
    expect(useStore.getState().project).toBe(after.project);
  });
  it('reorders mixed root rows and shows the persisted order in the renderer', () => {
    const before = useStore.getState();
    expect(
      before.moveDesignNode(
        {
          node: { kind: 'object', id: 'H' },
          parentId: null,
          before: { kind: 'group', id: 'outer' },
        },
        before,
      ).kind,
    ).toBe('ok');
    expect(
      designTreeRows(useStore.getState().project.scene, null)
        .filter((row) => row.depth === 0)
        .map(designRowId),
    ).toEqual(['H', 'outer', 'target']);
    expect(useStore.getState().project.scene.objects).toBe(before.project.scene.objects);
  });
  it.each(['project', 'epoch'] as const)(
    'rejects stale %s ownership without changing project, Undo or selection',
    (change) => {
      const owner = useStore.getState();
      if (change === 'project') useStore.setState({ project: { ...owner.project } });
      else useStore.setState({ projectDocumentEpoch: owner.projectDocumentEpoch + 1 });
      const before = useStore.getState();
      const result = before.moveDesignNode(
        { node: { kind: 'object', id: 'H' }, parentId: 'target' },
        owner,
      );
      expect(result).toEqual({
        kind: 'error',
        message: expect.stringContaining('project changed'),
      });
      expect(useStore.getState()).toBe(before);
    },
  );
  it('preserves all state on a singleton rejection and still allows a valid subsequent move', () => {
    seed([{ id: 'pair', name: 'Pair', objectIds: ['A', 'B'] }]);
    const before = useStore.getState();
    expect(
      before.moveDesignNode({ node: { kind: 'object', id: 'A' }, parentId: null }, before).kind,
    ).toBe('error');
    expect(useStore.getState()).toBe(before);
    expect(
      before.moveDesignNode({ node: { kind: 'object', id: 'H' }, parentId: 'pair' }, before),
    ).toEqual({ kind: 'ok', changed: true });
    expect(useStore.getState().project.scene.groups?.[0]?.objectIds).toEqual(['A', 'B', 'H']);
  });
  it('tolerates new duplicate rows and removes deleted ranks without changing manufacturing priorities', () => {
    const owner = useStore.getState();
    owner.moveDesignNode(
      { node: { kind: 'object', id: 'H' }, parentId: null, before: { kind: 'group', id: 'outer' } },
      owner,
    );
    useStore.getState().selectDesignArtwork('H');
    useStore.getState().duplicateSelection();
    const clone = useStore.getState().selectedObjectId;
    expect(clone).not.toBe('H');
    const beforeDelete = useStore.getState().project;
    const rootRows = designTreeRows(beforeDelete.scene, null)
      .filter((row) => row.depth === 0)
      .map(designRowId);
    expect(rootRows).toEqual(['H', 'outer', 'target', clone]);
    useStore.getState().removeSceneObject('H');
    const project = useStore.getState().project;
    expect(
      project.scene.designTreeOrder?.some((ref) => ref.kind === 'object' && ref.id === 'H'),
    ).toBe(false);
    expect(
      designTreeRows(project.scene, null)
        .filter((row) => row.depth === 0)
        .map(designRowId),
    ).toEqual(['outer', 'target', clone]);
    expect(project.scene.artworkOrder).toEqual(
      beforeDelete.scene.artworkOrder?.filter((id) => id !== 'H'),
    );
    expect(deserializeProject(serializeProject(project)).kind).toBe('ok');
  });
  it('rejects ancestor membership amplification at the existing persistence budget', () => {
    const project = createProject();
    const memberIds = Array.from({ length: 2500 }, (_, i) => `member-${i}`);
    const groups = Array.from({ length: 20 }, (_, i) => ({
      id: `group-${i}`,
      name: `Group ${i}`,
      objectIds: memberIds,
      ...(i === 0 ? {} : { parentId: `group-${i - 1}` }),
    }));
    useStore.setState({
      project: {
        ...project,
        scene: {
          ...project.scene,
          groups,
          objects: [...memberIds, 'root-object'].map((id) => svgObj(id, ['#000000'])),
        },
      },
    });
    const before = useStore.getState();
    expect(deserializeProject(serializeProject(before.project)).kind).toBe('ok');
    expect(
      before.moveDesignNode(
        { node: { kind: 'object', id: 'root-object' }, parentId: 'group-19' },
        before,
      ),
    ).toEqual({ kind: 'error', message: expect.stringContaining('scene.groups.objectIds') });
    expect(useStore.getState()).toBe(before);
  });
  it('prunes a removed group rank during explicit ungroup while retaining artwork ranks', () => {
    seed([{ id: 'pair', name: 'Pair', objectIds: ['A', 'B'] }]);
    const owner = useStore.getState();
    owner.moveDesignNode({ node: { kind: 'group', id: 'pair' }, parentId: null }, owner);
    useStore.getState().selectDesignGroup('pair');
    const before = useStore.getState().project;
    useStore.getState().ungroupSelection();
    const next = useStore.getState().project;
    expect(next.scene.groups).toEqual([]);
    expect(next.scene.designTreeOrder?.some((ref) => ref.kind === 'group')).toBe(false);
    expect(next.scene.designTreeOrder?.filter((ref) => ref.kind === 'object')).toEqual(
      before.scene.designTreeOrder?.filter((ref) => ref.kind === 'object'),
    );
    expect(next.scene.objects).toBe(before.scene.objects);
    expect(next.scene.artworkOrder).toBe(before.scene.artworkOrder);
    expect(deserializeProject(serializeProject(next)).kind).toBe('ok');
  });
});
