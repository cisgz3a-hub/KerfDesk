import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  primaryOperationForObject,
  type Layer,
  type MachineKind,
} from '../../core/scene';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

const COLOR = '#ff0000';

beforeEach(() => {
  resetStore();
  useStore.setState((state) => ({
    project: { ...state.project, device: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE },
  }));
});

describe('proposed 4040 laser defaults', () => {
  it.each(['manual', 'import'] as const)('seeds a fresh %s Line operation', (route) => {
    if (route === 'manual') useStore.getState().createManualLayer(COLOR);
    else useStore.getState().importSvgObject(svgObj('one', [COLOR]));

    expect(useStore.getState().project.scene.layers[0]).toMatchObject({
      mode: 'line',
      speed: 800,
      power: 90,
      fillBidirectional: false,
    });
  });

  it.each(['byColor', 'allColors'] as const)(
    'keeps saved %s values above fresh fallbacks',
    (scope) => {
      const saved = {
        mode: 'fill' as const,
        speed: 975,
        power: 63,
        fillBidirectional: true,
        passes: 3,
      };
      useStore
        .getState()
        .setLayerDefaults(
          scope === 'byColor'
            ? { byColor: { [COLOR]: saved }, allColors: null }
            : { byColor: {}, allColors: saved },
        );
      useStore.getState().importSvgObject(svgObj('one', [COLOR]));

      expect(operationFor('one')).toMatchObject(saved);
    },
  );

  it('leaves a saved Image-mode operation outside the fallback', () => {
    useStore.getState().setLayerDefaults({ byColor: {}, allColors: { mode: 'image' } });
    useStore.getState().createManualLayer(COLOR);

    expect(useStore.getState().project.scene.layers[0]).toEqual({
      ...createLayer({ id: COLOR, color: COLOR }),
      mode: 'image',
    });
  });

  it('applies Fill mode defaults, then honors explicit fields in that patch', () => {
    useStore.getState().importSvgObject(svgObj('one', [COLOR]));
    const id = operationFor('one').id;
    useStore.getState().setLayerParam(id, { mode: 'fill' });
    expect(operationFor('one')).toMatchObject({
      mode: 'fill',
      speed: 800,
      power: 80,
      fillBidirectional: false,
    });

    useStore
      .getState()
      .setLayerParam(id, { mode: 'line', speed: 975, power: 63, fillBidirectional: true });
    expect(operationFor('one')).toMatchObject({
      mode: 'line',
      speed: 975,
      power: 63,
      fillBidirectional: true,
    });
  });

  it('limits saved mode-change overrides to the three proposed fields', () => {
    loadSharedScene('laser', true);
    const before = operationFor('one');
    useStore.getState().setLayerDefaults({
      byColor: {
        [COLOR]: { speed: 975, fillBidirectional: true, passes: 99, visible: false, mode: 'image' },
      },
      allColors: null,
    });
    useStore.getState().setLayerParam(before.id, { mode: 'fill', power: 63 });

    expect(operationFor('one')).toEqual({
      ...before,
      mode: 'fill',
      speed: 975,
      power: 63,
      fillBidirectional: true,
    });
  });

  it('leaves existing settings alone for same-mode edits and Image-mode switches', () => {
    loadSharedScene('laser', true);
    const before = operationFor('one');
    useStore.getState().setLayerParam(before.id, { mode: 'line', passes: 8 });
    expect(operationFor('one')).toEqual({ ...before, passes: 8 });
    useStore.getState().setLayerParam(before.id, { mode: 'image' });
    expect(operationFor('one')).toEqual({ ...before, passes: 8, mode: 'image' });
  });

  it('reuses an unshared Fill operation without replaying unrelated saved settings', () => {
    loadSharedScene('laser', true);
    const before = operationFor('one');
    useStore
      .getState()
      .setLayerDefaults({ byColor: {}, allColors: { speed: 925, passes: 99, visible: false } });
    useStore.getState().fillSelectionSeparately();

    expect(operationFor('one')).toEqual({
      ...before,
      mode: 'fill',
      speed: 925,
      power: 80,
      fillBidirectional: false,
    });
    expect(useStore.getState().project.scene.layers).toHaveLength(1);
  });

  it('isolates selected Fill artwork while preserving an unselected operation', () => {
    loadSharedScene('laser', false);
    const original = operationFor('other');
    useStore.getState().fillSelectionSeparately();

    expect(operationFor('one')).toMatchObject({
      mode: 'fill',
      speed: 800,
      power: 80,
      fillBidirectional: false,
    });
    expect(operationFor('one').id).not.toBe(original.id);
    expect(operationFor('other')).toEqual(original);
    expect(useStore.getState().selectedObjectId).toBe('one');
  });

  it.each(['generic laser', '4040 CNC'] as const)('keeps mode-only edits in %s', (scope) => {
    loadSharedScene(scope === '4040 CNC' ? 'cnc' : 'laser', true);
    if (scope === 'generic laser') {
      useStore.setState((state) => ({
        project: { ...state.project, device: DEFAULT_DEVICE_PROFILE },
      }));
    }
    useStore.getState().setLayerDefaults({
      byColor: {},
      allColors: {
        speed: 5,
        power: 4,
        passes: 99,
        visible: false,
        cnc: DEFAULT_CNC_LAYER_SETTINGS,
      },
    });
    const before = operationFor('one');
    useStore.getState().fillSelectionSeparately();
    expect(operationFor('one')).toEqual({ ...before, mode: 'fill' });
    useStore.getState().setLayerParam(before.id, { mode: 'line' });
    expect(operationFor('one')).toEqual(before);
  });

  it('preserves current CNC starter seeding and laser-number defaults on fresh operations', () => {
    useStore.setState((state) => ({
      project: { ...state.project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    }));
    useStore.getState().importSvgObject(svgObj('one', [COLOR]));
    const layer = operationFor('one');
    const baseline = createLayer({ id: layer.id, color: layer.color });

    expect(layer).toMatchObject({
      speed: baseline.speed,
      power: baseline.power,
      fillBidirectional: baseline.fillBidirectional,
    });
    expect(layer.cnc).toMatchObject({
      feedMmPerMin: 300,
      plungeMmPerMin: 250,
      feedSource: { kind: 'machine-starter' },
    });
  });
});

function loadSharedScene(machine: MachineKind, unshared: boolean): void {
  const objects = unshared
    ? [svgObj('one', [COLOR])]
    : [svgObj('one', [COLOR]), svgObj('other', [COLOR])];
  useStore.setState({
    project: {
      ...createProject(),
      device: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      ...(machine === 'cnc' ? { machine: DEFAULT_CNC_MACHINE_CONFIG } : {}),
      scene: {
        objects,
        layers: [
          {
            ...createLayer({ id: COLOR, color: COLOR }),
            speed: 432,
            power: 27,
            fillBidirectional: true,
            passes: 7,
          },
        ],
        groups: [],
      },
    },
    selectedObjectId: 'one',
  });
}

function operationFor(id: string): Layer {
  const { scene } = useStore.getState().project;
  const object = scene.objects.find((candidate) => candidate.id === id);
  if (object === undefined) throw new Error(`missing object ${id}`);
  const operation = primaryOperationForObject(object, scene.layers);
  if (operation === null) throw new Error(`missing operation ${id}`);
  return operation;
}
