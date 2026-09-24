import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  IDENTITY_TRANSFORM,
  LAYER_DEFAULTS,
  nextOperationColor,
  primaryOperationForObject,
  type Layer,
  type RasterImage,
} from '../../core/scene';
import { persistLayerDefaults, restoreLayerDefaults } from '../layers/layer-default-settings';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

const RED = '#ff0000';

function operationFor(objectId: string): Layer {
  const { objects, layers } = useStore.getState().project.scene;
  const object = objects.find((candidate) => candidate.id === objectId);
  const operation = object === undefined ? null : primaryOperationForObject(object, layers);
  if (operation === null) throw new Error(`Missing operation for ${objectId}`);
  return operation;
}

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
    linesPerMm: 10,
  };
}

function importRedDefault(): Layer {
  useStore.getState().importSvgObject(svgObj('first', [RED]));
  const first = operationFor('first');
  useStore.getState().setLayerParam(first.id, { power: 37, speed: 2345 });
  useStore.getState().makeLayerDefault(first.id);
  return first;
}

beforeEach(() => resetStore());

afterEach(() => {
  localStorage.clear();
  resetStore();
});

describe('per-color defaults follow the artwork color', () => {
  it('applies Make Default from red artwork to the next red import', () => {
    const first = importRedDefault();
    // Per-artwork operations take a palette color, not the artwork's own.
    expect(first.color).not.toBe(RED);
    expect(Object.keys(useStore.getState().layerDefaults.byColor)).toEqual([RED]);

    useStore.getState().importSvgObject(svgObj('second', [RED]));

    const second = operationFor('second');
    expect(second.color).not.toBe(RED);
    expect(second.color).not.toBe(first.color);
    expect(second).toMatchObject({ power: 37, speed: 2345 });
  });

  it('resets an operation to the default saved for its artwork color', () => {
    importRedDefault();
    useStore.getState().importSvgObject(svgObj('second', [RED]));
    const second = operationFor('second');
    useStore.getState().setLayerParam(second.id, { power: 80, speed: 900 });

    useStore.getState().resetLayerToDefault(second.id);

    expect(operationFor('second')).toMatchObject({ power: 37, speed: 2345 });
  });

  it('keeps a black-artwork default away from red artwork whose operation got palette black', () => {
    useStore.getState().importSvgObject(svgObj('black', ['#000000']));
    const black = operationFor('black');
    useStore.getState().setLayerParam(black.id, { power: 66, speed: 4321 });
    useStore.getState().makeLayerDefault(black.id);
    // Saved defaults outlive the project, and a new project's palette starts at black again.
    useStore.getState().newProject();

    useStore.getState().importSvgObject(svgObj('red', [RED]));

    const red = operationFor('red');
    expect(Object.keys(useStore.getState().layerDefaults.byColor)).toEqual([red.color]);
    expect(red).toMatchObject({ power: LAYER_DEFAULTS.power, speed: LAYER_DEFAULTS.speed });
    useStore.getState().setLayerParam(red.id, { power: 80 });
    useStore.getState().resetLayerToDefault(red.id);
    expect(operationFor('red').power).toBe(80);
  });

  it('prefers the artwork color default over the operation color and all-colors defaults', () => {
    const paletteColor = nextOperationColor([]);
    useStore.getState().setLayerDefaults({
      byColor: { [RED]: { power: 41 }, [paletteColor]: { power: 12 } },
      allColors: { power: 5 },
    });

    useStore.getState().importSvgObject(svgObj('first', [RED]));

    expect(operationFor('first')).toMatchObject({ color: paletteColor, power: 41 });
  });

  it('saves a restorable lowercase key for artwork with an uppercase color', () => {
    useStore.getState().importSvgObject(svgObj('first', ['#FF0000']));
    useStore.getState().makeLayerDefault(operationFor('first').id);
    const profile = useStore.getState().project.device.name;

    persistLayerDefaults(localStorage, profile, useStore.getState().layerDefaults);

    // One invalid key would make restore discard every saved default.
    expect(Object.keys(restoreLayerDefaults(localStorage, profile)?.byColor ?? {})).toEqual([RED]);
  });

  it('gives a new image operation the CNC default saved for the same image color', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().importRasterImage(raster('first'));
    const first = operationFor('first');
    const cnc = { ...DEFAULT_CNC_LAYER_SETTINGS, depthMm: 7, feedMmPerMin: 432 };
    useStore.getState().setLayerParam(first.id, { cnc });
    useStore.getState().makeLayerDefault(first.id);

    useStore.getState().importRasterImage(raster('second'));

    expect(operationFor('second').color).not.toBe(first.color);
    expect(operationFor('second').cnc).toMatchObject({ depthMm: 7, feedMmPerMin: 432 });
  });
});
