import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job';
import { createProject, operationIdsForObject } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';
import {
  allObjectDependenciesResolve,
  dependencyProject,
  dependentText,
  projectWithVariants,
  rasterDependencyChain,
  shapeObject,
  textDependencyChain,
} from './testing/scene-clipboard-fixtures';

describe('scene clipboard actions', () => {
  beforeEach(() => resetStore());

  it('copies all selected SceneObject variants without dirtying the project', () => {
    useStore.setState({ project: projectWithVariants(), dirty: false, undoStack: [] });
    useStore.getState().selectAllObjects();
    const beforeProject = useStore.getState().project;

    useStore.getState().copySelection();

    const state = useStore.getState();
    expect(state.project).toBe(beforeProject);
    expect(state.dirty).toBe(false);
    expect(state.undoStack).toHaveLength(0);
    expect(state.sceneClipboard?.objects.map((object) => object.kind)).toEqual([
      'imported-svg',
      'text',
      'traced-image',
      'raster-image',
      'shape',
    ]);
  });

  it('pastes copied objects with fresh ids, offset transforms, selection, and layers', () => {
    useStore.setState({ project: projectWithVariants(), dirty: false, undoStack: [] });
    useStore.getState().selectAllObjects();
    useStore.getState().copySelection();
    useStore.setState({
      project: createProject(),
      selectedObjectId: null,
      additionalSelectedIds: new Set(),
      dirty: false,
      undoStack: [],
    });

    useStore.getState().pasteClipboard();

    const state = useStore.getState();
    const pasted = state.project.scene.objects;
    expect(pasted).toHaveLength(5);
    expect(pasted.map((object) => object.id)).not.toEqual([
      'svg-1',
      'text-1',
      'trace-1',
      'raster-1',
      'shape-1',
    ]);
    expect(pasted[0]?.transform).toMatchObject({ x: 10, y: 10 });
    expect(state.selectedObjectId).toBe(pasted[0]?.id);
    expect(state.additionalSelectedIds.size).toBe(4);
    expect(state.project.scene.layers).toHaveLength(4);
    expect(new Set(state.project.scene.layers.map((layer) => layer.color)).size).toBe(4);
    expect(
      pasted.every(
        (object) => operationIdsForObject(object, state.project.scene.layers).length > 0,
      ),
    ).toBe(true);
    expect(state.undoStack).toHaveLength(1);
    expect(state.dirty).toBe(true);
  });

  it('preserves sublayers when copied artwork is pasted into another project', () => {
    useStore.getState().importSvgObject(svgObj('with-sublayer', ['#ff0000']));
    const sourceId = useStore.getState().project.scene.layers[0]?.id;
    if (sourceId === undefined) throw new Error('source operation missing');
    useStore.getState().addLayerSubLayer(sourceId);
    useStore.getState().selectObject('with-sublayer');
    useStore.getState().copySelection();
    useStore.setState({
      project: createProject(),
      selectedObjectId: null,
      additionalSelectedIds: new Set(),
    });

    useStore.getState().pasteClipboard();

    const [pasted] = useStore.getState().project.scene.layers;
    expect(pasted?.subLayers).toHaveLength(1);
    expect(pasted?.subLayers[0]?.label).toBe('Sub-layer 1');
  });

  it('keeps same-project paste on the existing operation instead of double-emitting it', () => {
    useStore.getState().importSvgObject(svgObj('same-project', ['#ff0000']));
    useStore.getState().selectObject('same-project');
    useStore.getState().copySelection();
    const sourceOperationId = useStore.getState().project.scene.layers[0]?.id;

    useStore.getState().pasteClipboard();

    const { objects, layers } = useStore.getState().project.scene;
    expect(layers).toHaveLength(1);
    expect(operationIdsForObject(objects[1]!, layers)).toEqual([sourceOperationId]);
  });

  it('cut copies the selection, removes it as one undoable edit, and can paste it back', () => {
    useStore.setState({ project: projectWithVariants(), dirty: false, undoStack: [] });
    useStore.getState().selectObjects(['svg-1', 'raster-1']);

    useStore.getState().cutSelection();

    expect(useStore.getState().sceneClipboard?.objects.map((object) => object.id)).toEqual([
      'svg-1',
      'raster-1',
    ]);
    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
      'text-1',
      'trace-1',
      'shape-1',
    ]);
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().pasteClipboard();

    const state = useStore.getState();
    expect(state.project.scene.objects).toHaveLength(5);
    const pastedRaster = state.project.scene.objects.find(
      (object) => object.kind === 'raster-image' && object.id !== 'raster-1',
    );
    expect(pastedRaster).toBeDefined();
    expect(
      pastedRaster === undefined
        ? []
        : operationIdsForObject(pastedRaster, state.project.scene.layers),
    ).toHaveLength(1);
    const pastedRasterOperation = state.project.scene.layers.find(
      (operation) =>
        pastedRaster !== undefined &&
        operationIdsForObject(pastedRaster, state.project.scene.layers).includes(operation.id),
    );
    expect(pastedRasterOperation?.mode).toBe('image');
    expect(pastedRasterOperation?.color).not.toBe('#808080');
  });

  it.each([
    ['text guide', textDependencyChain()],
    ['raster mask', rasterDependencyChain()],
  ])('copies every hop in a %s chain into an empty project', (_name, fixture) => {
    useStore.setState({ project: fixture.project });
    useStore.getState().selectObject(fixture.rootId);

    useStore.getState().copySelection();

    expect(useStore.getState().sceneClipboard?.objects.map((object) => object.id)).toEqual(
      fixture.project.scene.objects.map((object) => object.id),
    );
    useStore.setState({
      project: createProject(),
      selectedObjectId: null,
      additionalSelectedIds: new Set(),
    });
    useStore.getState().pasteClipboard();
    const pasted = useStore.getState().project;
    expect(allObjectDependenciesResolve(pasted.scene.objects)).toBe(true);

    const reopened = deserializeProject(serializeProject(pasted));
    expect(reopened.kind).toBe('ok');
    if (reopened.kind !== 'ok') throw new Error(reopened.kind);
    expect(allObjectDependenciesResolve(reopened.project.scene.objects)).toBe(true);
    expect(compileJob(reopened.project.scene, DEFAULT_DEVICE_PROFILE)).toEqual(
      compileJob(pasted.scene, DEFAULT_DEVICE_PROFILE),
    );
  });

  it('selects only the user-owned root after pasting a dependency closure', () => {
    const fixture = textDependencyChain();
    useStore.setState({ project: fixture.project });
    useStore.getState().selectObject(fixture.rootId);
    useStore.getState().copySelection();
    useStore.setState((state) => ({
      project: createProject(),
      projectDocumentEpoch: state.projectDocumentEpoch + 1,
      selectedObjectId: null,
      additionalSelectedIds: new Set(),
    }));

    useStore.getState().pasteClipboard();

    const state = useStore.getState();
    const pastedRoot = state.project.scene.objects.find(
      (object) => object.kind === 'text' && object.content === fixture.rootId,
    );
    expect(state.selectedObjectId).toBe(pastedRoot?.id);
    expect(state.additionalSelectedIds).toEqual(new Set());
  });

  it('cuts only the user selection while carrying its dependency closure on the clipboard', () => {
    const fixture = textDependencyChain();
    useStore.setState({ project: fixture.project });
    useStore.getState().selectObject(fixture.rootId);

    useStore.getState().cutSelection();

    expect(useStore.getState().sceneClipboard?.objects.map((object) => object.id)).toEqual(
      fixture.project.scene.objects.map((object) => object.id),
    );
    expect(useStore.getState().project.scene.objects.map((object) => object.id)).toEqual([
      'guide-c',
      'text-b',
    ]);
    useStore.getState().pasteClipboard();
    expect(allObjectDependenciesResolve(useStore.getState().project.scene.objects)).toBe(true);
  });

  it('uses canonical dependency repair when a cut removes a selected mask', () => {
    const fixture = rasterDependencyChain();
    useStore.setState({ project: fixture.project });
    useStore.getState().selectObject('mask-c');

    useStore.getState().cutSelection();

    const raster = useStore
      .getState()
      .project.scene.objects.find((object) => object.kind === 'raster-image');
    expect(raster?.kind === 'raster-image' ? raster.imageMaskId : 'missing').toBeUndefined();
    expect(allObjectDependenciesResolve(useStore.getState().project.scene.objects)).toBe(true);
  });

  it('keeps materialized text and removes its path link when a cut removes the guide', () => {
    const fixture = textDependencyChain();
    useStore.setState({ project: fixture.project });
    useStore.getState().selectObject('guide-c');

    useStore.getState().cutSelection();

    const middle = useStore
      .getState()
      .project.scene.objects.find((object) => object.id === 'text-b');
    expect(middle?.kind === 'text' ? middle.pathText : 'missing').toBeUndefined();
    expect(allObjectDependenciesResolve(useStore.getState().project.scene.objects)).toBe(true);
  });

  it('does not clone a partial unrelated group reached only through dependencies', () => {
    const fixture = textDependencyChain();
    const unrelated = { ...shapeObject(), id: 'unrelated' };
    useStore.setState({
      project: {
        ...fixture.project,
        scene: {
          ...fixture.project.scene,
          objects: [...fixture.project.scene.objects, unrelated],
          groups: [
            {
              id: 'dependency-group',
              name: 'Partially reached',
              objectIds: ['guide-c', 'text-b', unrelated.id],
            },
          ],
        },
      },
    });
    useStore.getState().selectObject(fixture.rootId);

    useStore.getState().copySelection();

    expect(useStore.getState().sceneClipboard?.groups).toEqual([]);
  });

  it('keeps a missing dependency unresolved across a target id collision', () => {
    const source = dependencyProject([dependentText('source-root', 'missing-guide')]);
    useStore.setState({ project: source });
    useStore.getState().selectObject('source-root');
    useStore.getState().copySelection();

    const target = createProject();
    const collidingTarget = { ...shapeObject(), id: 'missing-guide' };
    useStore.getState().setProject({
      ...target,
      scene: { ...target.scene, objects: [collidingTarget] },
    });
    useStore.getState().pasteClipboard();

    const scene = useStore.getState().project.scene;
    const pasted = scene.objects.find(
      (object) => object.kind === 'text' && object.content === 'source-root',
    );
    expect(pasted?.kind).toBe('text');
    if (pasted?.kind !== 'text') throw new Error('pasted text missing');
    expect(pasted.pathText?.guideObjectId).not.toBe(collidingTarget.id);
    expect(scene.objects.some((object) => object.id === pasted.pathText?.guideObjectId)).toBe(
      false,
    );
  });

  it('keeps a pasted multi-hop chain isolated after deleting every source object', () => {
    const fixture = rasterDependencyChain();
    useStore.setState({ project: fixture.project });
    useStore.getState().selectObject(fixture.rootId);
    useStore.getState().copySelection();
    useStore.getState().pasteClipboard();

    for (const object of fixture.project.scene.objects)
      useStore.getState().removeSceneObject(object.id);

    const remaining = useStore.getState().project.scene.objects;
    expect(remaining).toHaveLength(3);
    expect(allObjectDependenciesResolve(remaining)).toBe(true);
  });

  it('remaps complete copied group ownership across projects', () => {
    const fixture = textDependencyChain();
    const group = {
      id: 'dependency-group',
      name: 'Dependency group',
      objectIds: fixture.project.scene.objects.map((object) => object.id),
    };
    useStore.setState({
      project: {
        ...fixture.project,
        scene: { ...fixture.project.scene, groups: [group] },
      },
    });
    useStore.getState().selectObject(fixture.rootId);
    useStore.getState().copySelection();
    useStore.setState({
      project: createProject(),
      selectedObjectId: null,
      additionalSelectedIds: new Set(),
    });

    useStore.getState().pasteClipboard();

    const scene = useStore.getState().project.scene;
    expect(scene.groups).toHaveLength(1);
    expect(scene.groups?.[0]?.name).toBe(group.name);
    expect(scene.groups?.[0]?.objectIds).toEqual(scene.objects.map((object) => object.id));
  });
});
