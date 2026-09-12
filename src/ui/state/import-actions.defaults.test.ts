import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createProject,
  layerCncTool,
  primaryOperationForObject,
  type CncLayerSettings,
  type CncMachineConfig,
  type Layer,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { persistLayerDefaults, restoreLayerDefaults } from '../layers/layer-default-settings';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

const savedCnc = {
  ...DEFAULT_CNC_LAYER_SETTINGS,
  depthMm: 9,
  feedMmPerMin: 321,
  plungeMmPerMin: 54,
  spindleRpm: 9876,
  materialKey: 'hardwood',
  toolId: 'em-1588',
  vClearToolId: 'em-6350',
  pocketRoughToolId: 'em-9525',
  reliefFinishToolId: 'bn-3175',
  feedSource: { kind: 'material-recipe' as const, materialKey: 'hardwood', fluteCount: 2 },
};

function raster(id: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: 17,
    operationOverride: { linesPerMm: 17 },
  };
}

function trace(id: string): TracedImage {
  return {
    kind: 'traced-image',
    id,
    source: `${id}.png`,
    traceMode: 'centerline',
    bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#010203', polylines: [] }],
  };
}

function operationFor(objectId: string): Layer {
  const { objects, layers } = useStore.getState().project.scene;
  const object = objects.find((candidate) => candidate.id === objectId);
  const operation = object === undefined ? null : primaryOperationForObject(object, layers);
  if (operation === null) throw new Error(`Missing operation for ${objectId}`);
  return operation;
}

function effectiveBindings(machine: CncMachineConfig, settings?: CncLayerSettings) {
  return {
    toolId: layerCncTool(machine, settings ?? DEFAULT_CNC_LAYER_SETTINGS).id,
    materialKey: settings?.materialKey ?? machine.stock.materialKey,
    vClearToolId: settings?.vClearToolId,
    pocketRoughToolId: settings?.pocketRoughToolId,
    reliefFinishToolId: settings?.reliefFinishToolId,
  };
}

function restoreLegacyDefaults(): void {
  const profile = useStore.getState().project.device.name;
  const defaults = {
    byColor: {},
    allColors: { mode: 'fill' as const, linesPerMm: 0.5, cnc: savedCnc },
  };
  persistLayerDefaults(localStorage, profile, defaults);
  const restored = restoreLayerDefaults(localStorage, profile);
  expect(restored).toEqual(defaults);
  if (restored === null) throw new Error('Valid legacy defaults should restore');
  useStore.getState().setLayerDefaults(restored);
}

type ImportKind =
  | 'raster'
  | 'trace'
  | 'bitmap'
  | 'rasterized trace'
  | 'camera trace'
  | 'camera raster';

function createOutput(kind: ImportKind): void {
  const state = useStore.getState();
  switch (kind) {
    case 'raster':
      state.importRasterImage(raster('output'));
      return;
    case 'trace':
      state.traceExistingImage('source', trace('output'));
      return;
    case 'bitmap':
      state.convertToBitmap(['source'], raster('output'));
      return;
    case 'rasterized trace':
      state.commitRasterizedTrace('missing-source', raster('output'));
      return;
    case 'camera trace':
      state.traceExistingImage('camera', trace('output'), { cameraSource: raster('camera') });
      return;
    case 'camera raster':
      state.commitRasterizedTrace('camera', raster('output'), { cameraSource: raster('camera') });
      return;
  }
}

beforeEach(() => {
  resetStore();
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      machine: {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        toolId: 'em-6350',
        stock: { ...DEFAULT_CNC_MACHINE_CONFIG.stock, materialKey: 'acrylic' },
      },
    },
  });
});

afterEach(() => {
  localStorage.clear();
  resetStore();
});

describe('image creation with legacy CNC defaults', () => {
  it.each<ImportKind>([
    'raster',
    'trace',
    'bitmap',
    'rasterized trace',
    'camera trace',
    'camera raster',
  ])('%s inherits current job bindings while copying only saved CNC artwork values', (kind) => {
    if (kind === 'trace') useStore.getState().importRasterImage(raster('source'));
    if (kind === 'bitmap') useStore.getState().importSvgObject(svgObj('source', ['#123456']));
    const machine = useStore.getState().project.machine;
    if (machine?.kind !== 'cnc') throw new Error('Expected CNC');
    // Establish the actual creation result with the current Startup choices
    // before introducing saved artwork defaults.
    createOutput(kind);
    const baseline = effectiveBindings(machine, operationFor('output').cnc);
    expect(baseline).toMatchObject({ toolId: 'em-6350', materialKey: 'acrylic' });
    useStore.getState().undo();
    restoreLegacyDefaults();
    const before = useStore.getState().project;
    useStore.setState({ undoStack: [] });

    createOutput(kind);

    const operation = operationFor('output');
    expect(operation.cnc).toMatchObject({
      depthMm: 9,
      feedMmPerMin: 321,
      plungeMmPerMin: 54,
      spindleRpm: 9876,
    });
    for (const key of [
      'toolId',
      'materialKey',
      'vClearToolId',
      'pocketRoughToolId',
      'reliefFinishToolId',
      'feedSource',
    ]) {
      expect(operation.cnc).not.toHaveProperty(key);
    }
    expect(effectiveBindings(machine, operation.cnc)).toEqual(baseline);
    const vector = kind === 'trace' || kind === 'camera trace';
    expect(operation.mode).toBe(vector ? 'line' : 'image');
    if (!vector) expect(operation.linesPerMm).toBe(17);
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project).toEqual(before);
  });

  it('keeps an existing Image operation and its Startup bindings during in-place rasterization', () => {
    useStore.getState().importRasterImage(raster('source'));
    const operation = operationFor('source');
    const cnc = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      toolId: 'em-6350',
      vClearToolId: 'em-3175',
      pocketRoughToolId: 'em-1000',
      reliefFinishToolId: 'bn-6350',
      materialKey: 'acrylic',
      feedMmPerMin: 876,
      feedSource: { kind: 'material-recipe' as const, materialKey: 'acrylic', fluteCount: 1 },
    };
    useStore.getState().setLayerParam(operation.id, { cnc });
    restoreLegacyDefaults();

    useStore.getState().commitRasterizedTrace('source', raster('output'));

    expect(operationFor('output')).toMatchObject({ id: operation.id, cnc, linesPerMm: 17 });
    expect(operationFor('source').cnc).toEqual(cnc);
  });
});
