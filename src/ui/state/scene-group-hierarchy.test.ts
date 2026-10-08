import { beforeEach, describe, expect, it } from 'vitest';
import { createProject, type SceneGroup } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';
import { currentHierarchyFocus, useDesignHierarchyStore } from './design-hierarchy-store';
import { designTreeRows } from '../layers/design-tree-rows';
const child: SceneGroup = {
  id: 'child',
  name: 'Letter pair',
  objectIds: ['A', 'B'],
  parentId: 'outer',
};
const outer: SceneGroup = { id: 'outer', name: 'Sign', objectIds: ['A', 'B', 'C'] };
function seed(groups: ReadonlyArray<SceneGroup> = [outer, child]): void {
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      scene: {
        ...project.scene,
        objects: ['A', 'B', 'C'].map((id) => svgObj(id, ['#000000'])),
        groups,
      },
    },
  });
}
const selected = () => [
  useStore.getState().selectedObjectId,
  ...useStore.getState().additionalSelectedIds,
];
beforeEach(() => {
  resetStore();
  useDesignHierarchyStore.setState({ focusId: null, documentEpoch: -1 });
});
describe('nested design groups', () => {
  it('selects the outer group normally and child groups or objects within focus', () => {
    seed();
    useStore.getState().selectObject('A');
    expect(selected()).toEqual(['A', 'B', 'C']);
    useStore.getState().focusDesignGroup('outer');
    useStore.getState().selectObject('A');
    expect(selected()).toEqual(['A', 'B']);
    useStore.getState().focusDesignGroup('child');
    useStore.getState().selectObject('A');
    expect(selected()).toEqual(['A']);
    useStore.getState().selectObject('C');
    expect(useStore.getState().selectedObjectId).toBeNull();
    useStore.getState().focusDesignGroup(null);
    useStore.getState().selectObject('B');
    expect(selected()).toEqual(['A', 'B', 'C']);
  });
  it('wraps existing groups without flattening them and ungroups one outer level', () => {
    seed([{ id: child.id, name: child.name, objectIds: child.objectIds }]);
    useStore.getState().selectObjects(['A', 'C']);
    const before = useStore.getState().project;
    useStore.getState().groupSelection();
    const groups = useStore.getState().project.scene.groups!;
    const newOuter = groups.find((group) => group.id !== 'child')!;
    expect(groups.find((group) => group.id === 'child')?.parentId).toBe(newOuter.id);
    expect(groups.find((group) => group.id === 'child')?.objectIds).toEqual(['A', 'B']);
    useStore.getState().ungroupSelection();
    expect(useStore.getState().project.scene.groups).toEqual([
      { id: 'child', name: 'Letter pair', objectIds: ['A', 'B'] },
    ]);
    useStore.getState().undo();
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });
  it('groups selected children inside the focused parent and preserves containment', () => {
    seed();
    useStore.getState().focusDesignGroup('outer');
    useStore.getState().selectObjects(['A', 'C']);
    useStore.getState().groupSelection();
    const project = useStore.getState().project;
    const group = project.scene.groups!.find(
      (candidate) => candidate.id !== 'outer' && candidate.id !== 'child',
    )!;
    expect(group.parentId).toBe('outer');
    expect(group.objectIds).toEqual(['A', 'B', 'C']);
    expect(project.scene.groups!.find((candidate) => candidate.id === 'child')?.parentId).toBe(
      group.id,
    );
    expect(deserializeProject(serializeProject(project)).kind).toBe('ok');
  });
  it('promotes surviving children when deletion removes their parent', () => {
    seed([
      { id: 'root', name: 'Root', objectIds: ['A', 'B'] },
      { id: 'child', name: 'Child', objectIds: ['A', 'B'], parentId: 'root' },
    ]);
    useStore.getState().removeSceneObject('B');
    expect(useStore.getState().project.scene.groups).toEqual([]);
    expect(deserializeProject(serializeProject(useStore.getState().project)).kind).toBe('ok');
  });
  it('clears focus on document replacement and makes tree leaves unique for overlapping groups', () => {
    seed();
    useStore.getState().focusDesignGroup('child');
    useStore.getState().newProject();
    expect(useDesignHierarchyStore.getState().focusId).toBeNull();
    expect(
      currentHierarchyFocus(
        useStore.getState().project.scene,
        useStore.getState().projectDocumentEpoch,
      ),
    ).toBeNull();
    seed([
      { id: 'one', name: 'One', objectIds: ['A', 'B'] },
      { id: 'two', name: 'Two', objectIds: ['B', 'C'] },
    ]);
    expect(
      designTreeRows(useStore.getState().project.scene, null).flatMap((row) =>
        row.kind === 'object' ? [row.object.id] : [],
      ),
    ).toEqual(['A', 'B', 'C']);
  });
  it('persists undoable artwork and group names without changing operation or output order', () => {
    seed();
    const before = useStore.getState().project;
    useStore.getState().renameArtwork('A', '  Front label  ');
    useStore.getState().renameDesignGroup('outer', 'Assembly');
    const project = useStore.getState().project;
    expect(project.scene.layers).toBe(before.scene.layers);
    expect(project.scene.artworkOrder).toBe(before.scene.artworkOrder);
    const loaded = deserializeProject(serializeProject(project));
    expect(loaded.kind).toBe('ok');
    if (loaded.kind === 'ok') {
      expect(loaded.project.scene.objects[0]?.name).toBe('Front label');
      expect(loaded.project.scene.groups?.[0]?.name).toBe('Assembly');
    }
    expect(useStore.getState().undoStack).toHaveLength(2);
    useStore.getState().undo();
    useStore.getState().undo();
    expect(useStore.getState().project).toBe(before);
  });
  it('detaches a copied child from the uncopied parent without altering the original hierarchy', () => {
    seed();
    useStore.getState().focusDesignGroup('outer');
    useStore.getState().selectObject('A');
    useStore.getState().duplicateSelection();
    const groups = useStore.getState().project.scene.groups!;
    const copy = groups.find((group) => group.id !== 'outer' && group.id !== 'child')!;
    expect(copy.parentId).toBeUndefined();
    expect(groups.find((group) => group.id === 'child')?.parentId).toBe('outer');
    expect(deserializeProject(serializeProject(useStore.getState().project)).kind).toBe('ok');
  });
  it('keeps design names through re-import and conversion to ordinary paths', () => {
    seed();
    useStore.getState().renameArtwork('A', 'Front label');
    useStore.getState().reimportSvgObject('A', svgObj('replacement-source', ['#000000']));
    expect(
      useStore.getState().project.scene.objects.find((object) => object.id === 'A')?.name,
    ).toBe('Front label');
    useStore.getState().selectDesignArtwork('A');
    useStore.getState().convertSelectionToPath();
    expect(
      useStore.getState().project.scene.objects.find((object) => object.id === 'A')?.name,
    ).toBe('Front label');
  });

  it.each(['duplicate', 'paste', 'array'] as const)(
    'preserves parent links wholly within a %s clone',
    (action) => {
      seed();
      useStore.getState().selectDesignGroup('outer');
      if (action === 'duplicate') useStore.getState().duplicateSelection();
      if (action === 'paste') {
        useStore.getState().copySelection();
        useStore.getState().pasteClipboardInPlace();
      }
      if (action === 'array')
        useStore.getState().placeSelectionCopies([
          { dx: 0, dy: 0, rotationDeg: 0 },
          { dx: 25, dy: 0, rotationDeg: 0 },
        ]);
      const project = useStore.getState().project;
      const copied = project.scene.groups!.filter(
        (group) => group.id !== 'outer' && group.id !== 'child',
      );
      expect(copied).toHaveLength(2);
      const copiedChild = copied.find((group) => group.name === child.name)!;
      expect(copied.map((group) => group.id)).toContain(copiedChild.parentId);
      expect(copiedChild.parentId).not.toBe('outer');
      expect(copiedChild.objectIds.every((id) => !child.objectIds.includes(id))).toBe(true);
      expect(deserializeProject(serializeProject(project)).kind).toBe('ok');
    },
  );
});
