// Audit 2026-10-21 rolling v2, finding 03-P1-1: the laser layer header
// comments wrote the layer id and colour raw. A shared `.lf2` whose layer id
// held "\nG1 X300 Y10 F100 S1000\n" loaded cleanly and emitted that G1 as its
// own executable line, unseen by Frame, preflight and Job Review. Here a
// crafted file goes through the real loader and emitter on every laser
// dialect, and its commands must match the same project with plain labels.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Layer,
  type Polyline,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { deserializeProject } from '../project/deserialize-project';
import { serializeProject } from '../project/serialize-project';
import { emitGcode } from './emit-gcode';

const DEVICES: ReadonlyArray<readonly [string, DeviceProfile]> = [
  ['GRBL', DEFAULT_DEVICE_PROFILE],
  ['GRBL with arcs', { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grbl-v1.1' }],
  [
    'Marlin inline',
    {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'marlin',
      maxPowerS: 255,
      gcodeDialect: { dialectId: 'marlin-inline' },
    },
  ],
  [
    'Marlin fan',
    {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'marlin',
      maxPowerS: 255,
      gcodeDialect: { dialectId: 'marlin-fan' },
    },
  ],
  ['Smoothieware', { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'smoothieware', maxPowerS: 1 }],
];

// Plain labels as the app writes them, and what an attacker swaps in. Ids and
// colours each carry LF, CR and CRLF payloads: GRBL ends a line at either byte.
const LAYERS = [
  {
    id: 'line-op',
    color: '#c0ffee',
    craftedId: 'line-op\nG1 X300 Y10 F100 S1000\n;',
    craftedColor: '#c0ffee\rG1 X300 Y11 F100 S1000\r;',
  },
  {
    id: 'fill-op',
    color: '#bada55',
    craftedId: 'fill-op\rG1 X300 Y12 F100 S1000\r;',
    craftedColor: '#bada55\nG1 X300 Y13 F100 S1000\n;',
  },
  {
    id: 'offset-op',
    color: '#facade',
    craftedId: 'offset-op\r\nG1 X300 Y14 F100 S1000\r\n;',
    craftedColor: '#facade\r\nG1 X300 Y15 F100 S1000\r\n;',
  },
  {
    id: 'image-op',
    color: '#decade',
    craftedId: 'image-op\nG1 X300 Y16 F100 S1000\r;',
    craftedColor: '#decade\rG1 X300 Y17 F100 S1000\n;',
  },
] as const;

function square(min: number, max: number): Polyline {
  return {
    closed: true,
    points: [
      { x: min, y: min },
      { x: max, y: min },
      { x: max, y: max },
      { x: min, y: max },
      { x: min, y: min },
    ],
  };
}

function vectorObject(id: string, color: string, polyline: Polyline): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines: [polyline] }],
  };
}

// 2x2 source pixels (black, white / white, black) on a 10 x 5 mm footprint.
function rasterObject(color: string): SceneObject {
  return {
    kind: 'raster-image',
    id: 'photo',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: 'AP//AA==',
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 60, minY: 60, maxX: 70, maxY: 65 },
    transform: IDENTITY_TRANSFORM,
    color,
    dither: 'threshold',
    linesPerMm: 10,
  };
}

function plainProject(device: DeviceProfile): Project {
  const [line, fill, offset, image] = LAYERS;
  const layers: Layer[] = [
    { ...createLayer({ id: line.id, color: line.color }), power: 40, speed: 1200 },
    {
      ...createLayer({ id: fill.id, color: fill.color, mode: 'fill' }),
      power: 30,
      speed: 3000,
      hatchSpacingMm: 2,
    },
    {
      ...createLayer({ id: offset.id, color: offset.color, mode: 'fill' }),
      power: 25,
      speed: 2000,
      fillStyle: 'offset',
      hatchSpacingMm: 2,
    },
    {
      ...createLayer({ id: image.id, color: image.color, mode: 'image' }),
      power: 45,
      speed: 2500,
      ditherAlgorithm: 'threshold',
      linesPerMm: 1,
    },
  ];
  return {
    ...createProject(device),
    scene: {
      ...EMPTY_SCENE,
      layers,
      objects: [
        vectorObject('cut', line.color, {
          closed: false,
          points: [
            { x: 10, y: 10 },
            { x: 30, y: 10 },
          ],
        }),
        vectorObject('hatch', fill.color, square(20, 40)),
        vectorObject('rings', offset.color, square(45, 55)),
        rasterObject(image.color),
      ],
    },
  };
}

function loaded(json: string): Project {
  const result = deserializeProject(json);
  if (result.kind !== 'ok') throw new Error(`project did not load: ${JSON.stringify(result)}`);
  return result.project;
}

// What an attacker does to a shared file: edit the labels in the saved JSON.
// Every reference (layer, path colour, binding) is swapped together, so the
// crafted file stays internally consistent and the loader accepts it.
function craftedFile(device: DeviceProfile): string {
  let json = serializeProject(plainProject(device));
  for (const layer of LAYERS) {
    json = json
      .replaceAll(JSON.stringify(layer.id), JSON.stringify(layer.craftedId))
      .replaceAll(JSON.stringify(layer.color), JSON.stringify(layer.craftedColor));
  }
  return json;
}

// GRBL ends a line at CR or LF, so split on both before classifying.
function controllerLines(gcode: string): string[] {
  return gcode
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

function executableLines(gcode: string): string[] {
  return controllerLines(gcode).filter((line) => !line.startsWith(';'));
}

describe('laser comments from a crafted project file (audit 03-P1-1)', () => {
  it('loads the crafted labels unchanged, so the emitter is what must hold', () => {
    const project = loaded(craftedFile(DEFAULT_DEVICE_PROFILE));
    expect(project.scene.layers.map((layer) => [layer.id, layer.color])).toEqual(
      LAYERS.map((layer) => [layer.craftedId, layer.craftedColor]),
    );
  });

  it.each(DEVICES)('emits only the commands of the plain project on %s', (_name, device) => {
    const plain = emitGcode(loaded(serializeProject(plainProject(device))));
    const crafted = emitGcode(loaded(craftedFile(device)));
    expect(plain.preflight.ok).toBe(true);
    expect(crafted.preflight.ok).toBe(true);

    const plainCommands = executableLines(plain.gcode);
    const craftedCommands = executableLines(crafted.gcode);
    // Every layer burns, so a dropped layer cannot pass this test vacuously.
    expect(plainCommands.filter((line) => line.startsWith('G1')).length).toBeGreaterThan(4);
    expect(craftedCommands).toEqual(plainCommands);
    expect(craftedCommands.filter((line) => line.includes('X300'))).toEqual([]);
    expect(crafted.gcode).not.toMatch(/\r/);
  });

  it.each(DEVICES)('keeps each label on its own header comment on %s', (_name, device) => {
    const lines = controllerLines(emitGcode(loaded(craftedFile(device))).gcode);
    const headers = lines.filter((line) =>
      /^; (?:image layer|offset fill layer|fill layer|layer) /.test(line),
    );
    expect(headers).toHaveLength(LAYERS.length);
    for (const [index, layer] of LAYERS.entries()) {
      const header = headers[index] ?? '';
      // The payload survives as inert text, so a reviewer can still see it.
      expect(header).toContain(`G1 X300 Y${10 + index * 2} F100 S1000`);
      expect(header).toContain(`G1 X300 Y${11 + index * 2} F100 S1000`);
      // Each control byte becomes one space, so CRLF leaves two.
      expect(header).toMatch(new RegExp(`color ${layer.color} +G1`));
    }
  });
});
