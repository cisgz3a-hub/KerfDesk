import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CNC_LAYER_SETTINGS, operationIdsForObject } from '../../core/scene';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

afterEach(resetStore);

describe('artwork operation actions', () => {
  it('gives fresh same-colored artwork independent named operations', () => {
    useStore.getState().importSvgObject(svgObj('Johann', ['#000000']));
    useStore.getState().importSvgObject(svgObj('Box', ['#000000']));
    const { objects, layers } = useStore.getState().project.scene;
    expect(layers.map((layer) => [layer.name, layer.color])).toEqual([
      ['Johann', '#000000'],
      ['Box', '#2563eb'],
    ]);
    expect(operationIdsForObject(objects[0]!, layers)).not.toEqual(
      operationIdsForObject(objects[1]!, layers),
    );
  });

  it('keeps a multicolor import as one artwork with path-specific operations', () => {
    useStore.getState().importSvgObject(svgObj('Logo', ['#ff0000', '#0000ff']));
    const { objects, layers } = useStore.getState().project.scene;
    const logo = objects[0];
    expect(layers.map((operation) => operation.name)).toEqual(['Logo 1', 'Logo 2']);
    expect(operationIdsForObject(logo!, layers)).toHaveLength(2);
    expect(
      logo !== undefined && 'paths' in logo ? logo.paths.map((path) => path.operationIds) : [],
    ).toEqual([[layers[0]!.id], [layers[1]!.id]]);
  });

  it('can unify a multi-selection and then make one artwork unique again', () => {
    useStore.getState().importSvgObject(svgObj('Johann', ['#000000']));
    useStore.getState().importSvgObject(svgObj('Box', ['#000000']));
    const firstOperationId = useStore.getState().project.scene.layers[0]!.id;
    useStore.getState().addLayerSubLayer(firstOperationId);
    useStore.setState({ selectedObjectId: 'Johann', additionalSelectedIds: new Set(['Box']) });
    useStore.getState().useOperationForSelection(firstOperationId);

    let state = useStore.getState();
    expect(
      state.project.scene.objects.map((object) =>
        operationIdsForObject(object, state.project.scene.layers),
      ),
    ).toEqual([[firstOperationId], [firstOperationId]]);
    expect(state.project.scene.layers).toHaveLength(1);

    useStore.setState({ selectedObjectId: 'Box', additionalSelectedIds: new Set() });
    useStore.getState().makeSelectedOperationUnique(firstOperationId);
    state = useStore.getState();
    const ids = state.project.scene.objects.map((object) =>
      operationIdsForObject(object, state.project.scene.layers),
    );
    expect(ids[0]).toEqual([firstOperationId]);
    expect(ids[1]).toHaveLength(1);
    expect(ids[1]).not.toEqual(ids[0]);
    const unique = state.project.scene.layers.find((layer) => layer.id === ids[1]?.[0]);
    expect(unique?.subLayers).toEqual(state.project.scene.layers[0]?.subLayers);
    expect(unique?.subLayers).not.toBe(state.project.scene.layers[0]?.subLayers);
  });

  it('sets one CNC depth across independent operations as one undoable mutation', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().importSvgObject(svgObj('Johann', ['#000000']));
    useStore.getState().importSvgObject(svgObj('Box', ['#000000']));
    const [firstId, secondId] = useStore
      .getState()
      .project.scene.layers.map((operation) => operation.id);
    if (firstId === undefined || secondId === undefined) throw new Error('operations missing');
    useStore.getState().setLayerParam(firstId, {
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'engrave',
        depthMm: 1,
        depthPerPassMm: 0.4,
        feedMmPerMin: 700,
      },
    });
    useStore.getState().setLayerParam(secondId, {
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'profile-inside',
        depthMm: 2,
        depthPerPassMm: 0.8,
        feedMmPerMin: 900,
      },
    });
    useStore.setState({ undoStack: [], redoStack: [], dirty: false });
    const bindingsBefore = useStore
      .getState()
      .project.scene.objects.map((object) =>
        operationIdsForObject(object, useStore.getState().project.scene.layers),
      );

    useStore.getState().setCncDepthForOperations([firstId, secondId, firstId], 3.25);

    let state = useStore.getState();
    expect(
      state.project.scene.layers.map((operation) => ({
        cutType: operation.cnc?.cutType,
        depthMm: operation.cnc?.depthMm,
        depthPerPassMm: operation.cnc?.depthPerPassMm,
        feedMmPerMin: operation.cnc?.feedMmPerMin,
      })),
    ).toEqual([
      { cutType: 'engrave', depthMm: 3.25, depthPerPassMm: 0.4, feedMmPerMin: 700 },
      { cutType: 'profile-inside', depthMm: 3.25, depthPerPassMm: 0.8, feedMmPerMin: 900 },
    ]);
    expect(
      state.project.scene.objects.map((object) =>
        operationIdsForObject(object, state.project.scene.layers),
      ),
    ).toEqual(bindingsBefore);
    expect(state.undoStack).toHaveLength(1);
    expect(state.redoStack).toHaveLength(0);
    expect(state.dirty).toBe(true);

    state.undo();
    state = useStore.getState();
    expect(state.project.scene.layers.map((operation) => operation.cnc?.depthMm)).toEqual([1, 2]);
    expect(state.redoStack).toHaveLength(1);

    state.redo();
    expect(
      useStore.getState().project.scene.layers.map((operation) => operation.cnc?.depthMm),
    ).toEqual([3.25, 3.25]);
  });

  it('does not partially bulk-edit incompatible fixed and V-carve depths', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().importSvgObject(svgObj('Fixed', ['#000000']));
    useStore.getState().importSvgObject(svgObj('Flowing', ['#000000']));
    const [fixedId, flowingId] = useStore
      .getState()
      .project.scene.layers.map((operation) => operation.id);
    if (fixedId === undefined || flowingId === undefined) throw new Error('operations missing');
    useStore.getState().setLayerParam(flowingId, {
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'v-carve',
        depthMm: 0.1,
        vCarveFlatDepthEnabled: false,
      },
    });
    useStore.setState({ undoStack: [], redoStack: [], dirty: false });
    const before = useStore.getState().project;

    useStore.getState().setCncDepthForOperations([fixedId, flowingId], 4);

    expect(useStore.getState().project).toBe(before);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });

  it('adds a second first-class operation to selected artwork', () => {
    useStore.getState().importSvgObject(svgObj('Johann', ['#000000']));
    const sourceId = useStore.getState().project.scene.layers[0]?.id;
    if (sourceId === undefined) throw new Error('source operation missing');
    useStore.getState().addLayerSubLayer(sourceId);
    useStore.getState().addOperationForSelection();
    const { objects, layers } = useStore.getState().project.scene;
    expect(layers).toHaveLength(2);
    expect(operationIdsForObject(objects[0]!, layers)).toHaveLength(2);
    expect(layers.every((layer) => layer.subLayers.length === 1)).toBe(true);
    expect(layers[1]?.subLayers).not.toBe(layers[0]?.subLayers);
  });

  it('keeps operation names unique when the operator renames them', () => {
    useStore.getState().importSvgObject(svgObj('Johann', ['#000000']));
    useStore.getState().importSvgObject(svgObj('Box', ['#000000']));
    const boxOperation = useStore.getState().project.scene.layers[1]!;

    useStore.getState().renameOperation(boxOperation.id, 'Johann');

    expect(useStore.getState().project.scene.layers.map((operation) => operation.name)).toEqual([
      'Johann',
      'Johann 2',
    ]);
  });
});
