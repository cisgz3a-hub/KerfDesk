import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile, type Origin } from '../devices';
import {
  createLayer,
  combinedBBox,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  transformedBBox,
  type AABB,
  type ImportedSvg,
  type Scene,
} from '../scene';
import { insertMaterialTest, nextMaterialTestPrefix } from './material-test-insertion';
import type { MaterialTestInsertOptions } from './material-test-insertion';

const OPTIONS: MaterialTestInsertOptions = {
  mode: 'fill',
  rowAxis: { parameter: 'speed', start: 3000, end: 1000, count: 3 },
  columnAxis: { parameter: 'power', start: 10, end: 40, count: 3 },
  base: {
    power: 30,
    speed: 1500,
    passes: 1,
    intervalMm: 0.1,
    airAssist: false,
    ditherAlgorithm: 'floyd-steinberg',
  },
  cellWidthMm: 5,
  cellHeightMm: 5,
};

const BED: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  bedWidth: 300,
  bedHeight: 200,
  origin: 'front-left',
  noGoZones: [],
};

function square(id: string, x: number, y: number, size: number, color = '#000000'): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: size, maxY: size },
    transform: { ...IDENTITY_TRANSFORM, x, y },
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: size, y: 0 },
              { x: size, y: size },
              { x: 0, y: size },
            ],
          },
        ],
      },
    ],
  };
}

function designScene(): Scene {
  return {
    ...EMPTY_SCENE,
    layers: [createLayer({ id: 'design', color: '#000000', name: 'Design' })],
    objects: [square('logo', 0, 150, 50)],
  };
}

function inserted(scene: Scene, device: DeviceProfile = BED) {
  const result = insertMaterialTest(scene, device, OPTIONS);
  if (result.kind !== 'inserted') throw new Error(result.reason);
  return result;
}

function testBox(result: ReturnType<typeof inserted>): AABB {
  const ids = new Set(result.objectIds);
  const box = combinedBBox(result.scene.objects.filter((object) => ids.has(object.id)));
  if (box === null) throw new Error('empty test');
  return box;
}

function overlaps(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

describe('insertMaterialTest', () => {
  it('keeps the open design and adds the test as one group beside it', () => {
    const scene = designScene();
    const result = inserted(scene);
    expect(result.scene.objects.slice(0, 1)).toEqual(scene.objects);
    expect(result.scene.layers[0]).toEqual(scene.layers[0]);
    expect(result.scene.groups).toEqual([
      { id: 'material-test-group', name: 'Material test', objectIds: result.objectIds },
    ]);
    expect(result.placement.reason).toBe('free-space');
    const logo = scene.objects[0];
    if (logo === undefined) throw new Error('logo missing');
    expect(overlaps(testBox(result), transformedBBox(logo))).toBe(false);
  });

  it('never reuses a project color, so legacy black artwork keeps its own operation', () => {
    const result = inserted(designScene());
    const colors = result.scene.layers.map((layer) => layer.color);
    expect(new Set(colors).size).toBe(colors.length);
    expect(result.grid.scene.layers.find((layer) => layer.id.endsWith('-labels'))?.color).toBe(
      '#000001',
    );
  });

  it('gives a second test its own prefix, name and colors', () => {
    const first = inserted(designScene());
    const second = inserted(first.scene);
    expect(nextMaterialTestPrefix(first.scene)).toEqual({ prefix: 'material-test-2', ordinal: 2 });
    expect(second.name).toBe('Material test 2');
    expect(second.objectIds.every((id) => id.startsWith('material-test-2-'))).toBe(true);
    const ids = second.scene.objects.map((object) => object.id);
    expect(new Set(ids).size).toBe(ids.length);
    const colors = second.scene.layers.map((layer) => layer.color);
    expect(new Set(colors).size).toBe(colors.length);
    expect(overlaps(testBox(first), testBox(second))).toBe(false);
  });

  it.each<[Origin, 'left' | 'right', 'top' | 'bottom']>([
    ['front-left', 'left', 'bottom'],
    ['front-right', 'right', 'bottom'],
    ['rear-left', 'left', 'top'],
    ['rear-right', 'right', 'top'],
  ])('lands an empty project test by the %s origin corner', (origin, side, edge) => {
    const result = inserted(EMPTY_SCENE, { ...BED, origin });
    const box = testBox(result);
    if (side === 'left') expect(box.minX).toBeCloseTo(5, 6);
    else expect(box.maxX).toBeCloseTo(295, 6);
    if (edge === 'top') expect(box.minY).toBeCloseTo(5, 6);
    else expect(box.maxY).toBeCloseTo(195, 6);
  });

  it('steers around an enabled no-go zone', () => {
    const device: DeviceProfile = {
      ...BED,
      noGoZones: [{ id: 'clamp', name: 'Clamp', enabled: true, x: 0, y: 0, width: 80, height: 80 }],
    };
    const box = testBox(inserted(EMPTY_SCENE, device));
    // Machine y is measured up from the front edge: the zone covers canvas y 120..200.
    expect(overlaps(box, { minX: 0, minY: 120, maxX: 80, maxY: 200 })).toBe(false);
  });

  it('falls back to the origin corner and says so when the bed is full', () => {
    const full = { ...EMPTY_SCENE, objects: [square('sheet', 0, 0, 300)] };
    const result = inserted(full);
    expect(result.placement.reason).toBe('no-free-space');
    expect(testBox(result).minX).toBeCloseTo(5, 6);
    expect(testBox(result).maxY).toBeCloseTo(195, 6);
    const tiny = inserted(EMPTY_SCENE, { ...BED, bedWidth: 20, bedHeight: 20 });
    expect(tiny.placement.reason).toBe('larger-than-bed');
  });

  it('refuses a test that would push the project past 256 operations', () => {
    // Three speed operations plus the label operation would make 258.
    const layers = Array.from({ length: 254 }, (_, index) =>
      createLayer({ id: `op-${index}`, color: `#${(0xa00000 + index).toString(16)}` }),
    );
    const result = insertMaterialTest({ ...EMPTY_SCENE, layers }, BED, OPTIONS);
    expect(result).toMatchObject({ kind: 'refused' });
    expect(result.kind === 'refused' ? result.reason : '').toMatch(/new project/);
  });
});
