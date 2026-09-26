import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  primaryOperationForObject,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import type { LayerDefaultSettings } from '../layers/layer-default-settings';
import { useStore } from './store';
import { resetStore, svgObj } from './test-helpers';

function select4040Cnc(): void {
  useStore.getState().replaceDeviceProfile(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
  useStore.getState().setMachineKind('cnc');
}

function expect4040Starter(color: string): void {
  const settings = useStore
    .getState()
    .project.scene.layers.find((layer) => layer.color === color)?.cnc;
  expect(settings).toMatchObject({
    toolId: 'em-3175',
    feedMmPerMin: 300,
    plungeMmPerMin: 250,
    spindleRpm: 12_000,
    depthPerPassMm: 0.75,
    feedSource: {
      kind: 'machine-starter',
      starterId: 'neotronics-4040-shallow-wood-mdf',
      revision: 2,
    },
  });
}

function rasterImage(id: string, color: string): RasterImage {
  return {
    kind: 'raster-image',
    id,
    source: `${id}.png`,
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: 4,
    pixelHeight: 4,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color,
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

function tracedImage(id: string, color: string): TracedImage {
  return {
    kind: 'traced-image',
    id,
    source: `${id}.png`,
    traceMode: 'centerline',
    bounds: { minX: 0, minY: 0, maxX: 4, maxY: 4 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines: [] }],
  };
}

beforeEach(resetStore);
afterEach(resetStore);

describe('4040 machine-aware CNC starters', () => {
  it('initializes a newly added operation with the conservative 4040 starter', () => {
    select4040Cnc();

    useStore.getState().createManualLayer('#00aa00');

    expect4040Starter('#00aa00');
  });

  it('initializes a freshly imported operation through the same resolver', () => {
    select4040Cnc();

    useStore.getState().importSvgObject(svgObj('logo', ['#123456']));

    const scene = useStore.getState().project.scene;
    const logo = scene.objects.find((object) => object.id === 'logo');
    const settings =
      logo === undefined ? undefined : primaryOperationForObject(logo, scene.layers)?.cnc;
    expect(settings?.feedMmPerMin).toBe(300);
    expect(settings?.plungeMmPerMin).toBe(250);
    expect(settings?.feedSource?.kind).toBe('machine-starter');
  });

  it('lets current controller limits lower only subsequently created automatic settings', () => {
    select4040Cnc();
    useStore.getState().createManualLayer('#111111');
    useStore.getState().setCncLiveCaps({
      xMaxFeedMmPerMin: 500,
      yMaxFeedMmPerMin: 250,
      zMaxFeedMmPerMin: 80,
      spindleMaxRpm: 10_000,
    });

    useStore.getState().createManualLayer('#222222');

    const layers = useStore.getState().project.scene.layers;
    expect(layers.find((layer) => layer.color === '#111111')?.cnc).toMatchObject({
      feedMmPerMin: 300,
      plungeMmPerMin: 250,
      spindleRpm: 12_000,
    });
    expect(layers.find((layer) => layer.color === '#222222')?.cnc).toMatchObject({
      feedMmPerMin: 250,
      plungeMmPerMin: 80,
      spindleRpm: 10_000,
    });
  });

  it('does not seed an absent CNC block merely because a project is loaded', () => {
    const base = createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    const loaded = {
      ...base,
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: {
        ...base.scene,
        layers: [{ ...createLayer({ id: 'legacy', color: '#abcdef' }) }],
      },
    };

    useStore.getState().setProject(loaded);

    expect(useStore.getState().project.scene.layers[0]?.cnc).toBeUndefined();
  });

  // Laser Make Default no longer carries a CNC block (laser/CNC split). A slot
  // saved before the split still holds one; it must not replace the starter.
  it('seeds the machine starter even when a default saved before the split holds CNC settings', () => {
    const savedCnc = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      feedMmPerMin: 321,
      plungeMmPerMin: 54,
      spindleRpm: 9_876,
      depthPerPassMm: 0.4,
    };
    const legacy = { cnc: savedCnc } as unknown as LayerDefaultSettings;
    const rasterColor = '#818181';
    const traceColor = '#010203';
    const convertedColor = '#828282';
    select4040Cnc();
    useStore.getState().setLayerDefaults({
      byColor: { [rasterColor]: legacy, [traceColor]: legacy, [convertedColor]: legacy },
      allColors: legacy,
    });

    useStore.getState().createManualLayer('#112233');
    expect4040Starter('#112233');
    useStore.getState().importRasterImage(rasterImage('source-raster', rasterColor));
    useStore
      .getState()
      .traceExistingImage('source-raster', tracedImage('source-trace', traceColor));
    useStore.getState().importSvgObject(svgObj('convert-source', ['#abcdef']));
    useStore
      .getState()
      .convertToBitmap(['convert-source'], rasterImage('converted-raster', convertedColor));
    useStore.getState().importSvgObject(svgObj('svg-import', ['#445566']));

    const scene = useStore.getState().project.scene;
    const cases = [
      { id: 'source-raster', mode: 'image' },
      { id: 'source-trace', mode: 'line' },
      { id: 'converted-raster', mode: 'image' },
      { id: 'svg-import', mode: 'line' },
    ] as const;
    for (const item of cases) {
      const object = scene.objects.find((candidate) => candidate.id === item.id);
      const operation =
        object === undefined ? undefined : primaryOperationForObject(object, scene.layers);
      expect(operation?.mode).toBe(item.mode);
      expect(operation?.cnc?.feedMmPerMin).toBe(300);
      expect(operation?.cnc?.feedSource).toMatchObject({ kind: 'machine-starter' });
    }
  });
});
