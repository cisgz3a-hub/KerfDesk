import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createLayerSubLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  type Layer,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

const sourceCnc = {
  ...DEFAULT_CNC_LAYER_SETTINGS,
  depthMm: 9,
  feedMmPerMin: 777,
  materialKey: 'hardwood',
  toolId: 'source-primary',
  vClearToolId: 'source-clear',
  pocketRoughToolId: 'source-rough',
  reliefFinishToolId: 'source-finish',
  feedSource: { kind: 'material-recipe' as const, materialKey: 'hardwood', fluteCount: 2 },
};
const targetBindings = {
  materialKey: 'acrylic',
  toolId: 'target-primary',
  vClearToolId: 'target-clear',
  pocketRoughToolId: 'target-rough',
  reliefFinishToolId: 'target-finish',
};

function arrange(): { source: Layer; target: Layer } {
  const source = {
    ...createLayer({ id: 'source', color: '#ff0000', name: 'Source artwork' }),
    mode: 'fill' as const,
    power: 23,
    cnc: sourceCnc,
  };
  const target = {
    ...createLayer({ id: 'target', color: '#0000ff', name: 'Target artwork' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...targetBindings },
  };
  const project = useStore.getState().project;
  useStore.setState({
    project: { ...project, scene: { ...project.scene, layers: [source, target] } },
  });
  return { source, target };
}

function operation(id: string): Layer | undefined {
  return useStore.getState().project.scene.layers.find((layer) => layer.id === id);
}

describe('layer defaults preserve Startup-owned CNC assignments', () => {
  beforeEach(() => resetStore());

  it('copies artwork defaults in laser mode while preserving the target setup and undo', () => {
    const { source, target } = arrange();
    useStore.getState().setLayerParam(source.id, {
      subLayers: [createLayerSubLayer(source, { id: 'sub-1', label: 'Second cut' })],
    });
    useStore.setState({ dirty: false, undoStack: [] });
    useStore.getState().makeLayerDefaultForAll(source.id);
    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().layerDefaults.allColors?.cnc).toMatchObject({ depthMm: 9 });
    expect(useStore.getState().layerDefaults.allColors?.cnc).not.toHaveProperty('toolId');
    expect(useStore.getState().layerDefaults.allColors?.cnc).not.toHaveProperty('materialKey');

    useStore.getState().resetLayerToDefault(target.id);

    expect(operation(target.id)).toMatchObject({
      id: target.id,
      color: target.color,
      name: source.name,
      mode: 'fill',
      power: 23,
      cnc: { depthMm: 9, feedMmPerMin: 777, ...targetBindings },
      subLayers: [{ id: 'sub-1', label: 'Second cut' }],
    });
    expect(operation(target.id)?.cnc).not.toHaveProperty('feedSource');
    expect(operation(source.id)?.cnc).toEqual(sourceCnc);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(operation(target.id)).toEqual(target);
  });

  it('keeps the current setup when resetting a saved per-color default', () => {
    const { source } = arrange();
    useStore.getState().makeLayerDefault(source.id);
    useStore.getState().setLayerParam(source.id, {
      power: 81,
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...targetBindings },
    });

    useStore.getState().resetLayerToDefault(source.id);

    expect(operation(source.id)).toMatchObject({
      power: 23,
      cnc: { depthMm: 9, feedMmPerMin: 777, ...targetBindings },
    });
  });

  it('does not apply bindings carried by defaults saved before the ownership fix', () => {
    const { target } = arrange();
    useStore.getState().setLayerDefaults({ byColor: {}, allColors: { cnc: sourceCnc } });

    useStore.getState().resetLayerToDefault(target.id);

    expect(operation(target.id)?.cnc).toMatchObject({
      depthMm: 9,
      feedMmPerMin: 777,
      ...targetBindings,
    });
    expect(operation(target.id)?.cnc).not.toHaveProperty('feedSource');
  });

  it('lets newly created operations inherit job bindings instead of saved source bindings', () => {
    useStore.getState().setLayerDefaults({ byColor: {}, allColors: { cnc: sourceCnc } });
    useStore.getState().createManualLayer('#ff0000');
    useStore.getState().importSvgObject(svgObj('new-artwork', ['#0000ff']));

    expect(useStore.getState().project.scene.layers).toHaveLength(2);
    for (const layer of useStore.getState().project.scene.layers) {
      expect(layer.cnc).toMatchObject({ depthMm: 9, feedMmPerMin: 777 });
      for (const key of [...Object.keys(targetBindings), 'feedSource']) {
        expect(layer.cnc).not.toHaveProperty(key);
      }
    }
  });

  it('preserves all retained CNC settings when defaults contain only laser artwork values', () => {
    const { target } = arrange();
    useStore.getState().setLayerDefaults({ byColor: {}, allColors: { power: 41 } });

    useStore.getState().resetLayerToDefault(target.id);

    expect(operation(target.id)?.power).toBe(41);
    expect(operation(target.id)?.cnc).toBe(target.cnc);
  });
});
