import { beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createLayerSubLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  type Layer,
} from '../../core/scene';
import type { LayerDefaultSettings } from '../layers/layer-default-settings';
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

describe('laser Make Default never carries CNC settings', () => {
  beforeEach(() => resetStore());

  it('copies laser artwork settings and leaves the target CNC settings alone, with undo', () => {
    const { source, target } = arrange();
    useStore.getState().setLayerParam(source.id, {
      subLayers: [createLayerSubLayer(source, { id: 'sub-1', label: 'Second cut' })],
    });
    useStore.setState({ dirty: false, undoStack: [] });
    useStore.getState().makeLayerDefaultForAll(source.id);
    expect(useStore.getState().dirty).toBe(false);
    expect(useStore.getState().undoStack).toHaveLength(0);
    expect(useStore.getState().layerDefaults.allColors).not.toHaveProperty('cnc');

    useStore.getState().resetLayerToDefault(target.id);

    expect(operation(target.id)).toMatchObject({
      id: target.id,
      color: target.color,
      name: source.name,
      mode: 'fill',
      power: 23,
      subLayers: [{ id: 'sub-1', label: 'Second cut' }],
    });
    expect(operation(target.id)?.cnc).toBe(target.cnc);
    expect(operation(source.id)?.cnc).toEqual(sourceCnc);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(operation(target.id)).toEqual(target);
  });

  it('keeps the current CNC settings when resetting a saved per-color default', () => {
    const { source } = arrange();
    useStore.getState().makeLayerDefault(source.id);
    const edited = { ...DEFAULT_CNC_LAYER_SETTINGS, ...targetBindings, depthMm: 4 };
    useStore.getState().setLayerParam(source.id, { power: 81, cnc: edited });

    useStore.getState().resetLayerToDefault(source.id);

    expect(operation(source.id)?.power).toBe(23);
    expect(operation(source.id)?.cnc).toEqual(edited);
  });

  it('drops the CNC block from a default saved before laser and CNC were split', () => {
    const { target } = arrange();
    useStore.getState().setLayerDefaults({ byColor: {}, allColors: legacyDefault() });

    useStore.getState().resetLayerToDefault(target.id);

    expect(operation(target.id)?.power).toBe(23);
    expect(operation(target.id)?.cnc).toBe(target.cnc);
  });

  it('seeds new CNC operations from the machine setup, not from a saved default', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().setLayerDefaults({ byColor: {}, allColors: legacyDefault() });
    useStore.getState().createManualLayer('#ff0000');
    useStore.getState().importSvgObject(svgObj('new-artwork', ['#0000ff']));

    // The default machine has no starter or stock material, so the new
    // operations keep the built-in CNC settings, not the saved block.
    const layers = useStore.getState().project.scene.layers;
    expect(layers).toHaveLength(2);
    for (const layer of layers) {
      expect(layer.power).toBe(23);
      expect(layer.cnc).toBeUndefined();
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

// A default captured before the split held the whole operation, CNC block
// included. The type no longer admits one, so the old shape is built by hand.
function legacyDefault(): LayerDefaultSettings {
  return { power: 23, cnc: sourceCnc } as unknown as LayerDefaultSettings;
}
