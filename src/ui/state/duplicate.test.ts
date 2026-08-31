import { beforeEach, describe, expect, it } from 'vitest';
import { operationIdsForObject } from '../../core/scene';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

describe('useStore — duplicateSelection (Cmd+D)', () => {
  beforeEach(() => {
    resetStore();
  });

  it('clones the selected object in place (LightBurn parity — no stagger)', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject('O1');
    const before = useStore.getState().project.scene.objects[0];
    useStore.getState().duplicateSelection();
    const after = useStore.getState().project.scene.objects;
    expect(after).toHaveLength(2);
    const clone = after[1];
    expect(clone).toBeDefined();
    if (clone === undefined || before === undefined) return;
    expect(clone.id).not.toBe(before.id);
    // LightBurn's Duplicate places the clone exactly over the source; the
    // operator then moves it. (The old 10 mm stagger was an unrecorded divergence.)
    expect(clone.transform.x).toBeCloseTo(before.transform.x, 5);
    expect(clone.transform.y).toBeCloseTo(before.transform.y, 5);
    // New clone becomes the selection.
    expect(useStore.getState().selectedObjectId).toBe(clone.id);
    const layers = useStore.getState().project.scene.layers;
    expect(operationIdsForObject(clone, layers)).toEqual(operationIdsForObject(before, layers));
    expect(layers).toHaveLength(1);
  });

  it('on multi-select clones every selected object', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('O2', ['#0000ff']));
    useStore.getState().selectObject('O1');
    useStore.getState().toggleSelectObject('O2');
    useStore.getState().duplicateSelection();
    const objs = useStore.getState().project.scene.objects;
    expect(objs).toHaveLength(4);
    // Selection resets to the new clones — confirm the new primary is one
    // of the clones (not O1 / O2), and the extras set has the other.
    const sel = useStore.getState().selectedObjectId;
    expect(sel === 'O1' || sel === 'O2').toBe(false);
    expect(useStore.getState().additionalSelectedIds.size).toBe(1);
  });

  it('is a no-op with no selection', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().selectObject(null);
    const before = useStore.getState().project.scene.objects.length;
    useStore.getState().duplicateSelection();
    expect(useStore.getState().project.scene.objects).toHaveLength(before);
  });

  it('keeps every added operation without manufacturing stacked sibling operations', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.getState().addOperationForSelection();

    useStore.getState().duplicateSelection();

    const { objects, layers } = useStore.getState().project.scene;
    const sourceIds = operationIdsForObject(objects[0]!, layers);
    const cloneIds = operationIdsForObject(objects[1]!, layers);
    expect(sourceIds).toHaveLength(2);
    expect(cloneIds).toHaveLength(2);
    expect(cloneIds).toEqual(sourceIds);
    expect(layers).toHaveLength(2);
  });

  it('keeps duplicated artwork on the source operation and its sublayers', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    const sourceId = useStore.getState().project.scene.layers[0]?.id;
    if (sourceId === undefined) throw new Error('source operation missing');
    useStore.getState().addLayerSubLayer(sourceId);
    useStore.getState().selectObject('O1');

    useStore.getState().duplicateSelection();

    const { objects, layers } = useStore.getState().project.scene;
    const cloneId = operationIdsForObject(objects[1]!, layers)[0];
    const source = layers.find((layer) => layer.id === sourceId);
    const clone = layers.find((layer) => layer.id === cloneId);
    expect(cloneId).toBe(sourceId);
    expect(clone).toBe(source);
  });

  it('preserves object-local overrides without promoting them to the operation', () => {
    useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          objects: state.project.scene.objects.map((object) =>
            object.id === 'O1' ? { ...object, operationOverride: { speed: 321 } } : object,
          ),
        },
      },
    }));
    useStore.getState().selectObject('O1');

    useStore.getState().duplicateSelection();

    const { objects, layers } = useStore.getState().project.scene;
    expect(objects[1]?.operationOverride).toEqual({ speed: 321 });
    expect(layers).toHaveLength(1);
    expect(layers[0]?.speed).not.toBe(321);
    const source = objects[0];
    const clone = objects[1];
    if (source?.kind !== 'imported-svg' || clone?.kind !== 'imported-svg') {
      throw new Error('expected imported SVG artwork');
    }
    expect(clone.paths).not.toBe(source.paths);
  });
});
