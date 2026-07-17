import { afterEach, describe, expect, it } from 'vitest';
import { operationIdsForObject } from '../../core/scene';
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
  });

  it('adds a second first-class operation to selected artwork', () => {
    useStore.getState().importSvgObject(svgObj('Johann', ['#000000']));
    useStore.getState().addOperationForSelection();
    const { objects, layers } = useStore.getState().project.scene;
    expect(layers).toHaveLength(2);
    expect(operationIdsForObject(objects[0]!, layers)).toHaveLength(2);
    expect(layers.every((layer) => layer.subLayers.length === 0)).toBe(true);
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
