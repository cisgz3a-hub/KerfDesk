import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import type { SceneObject } from '../scene';
import { compileJob } from './compile-job';
import {
  generateMaterialTestAxesGrid,
  type MaterialTestAxesGridOptions,
} from './material-test-axes-grid';

const BASE = {
  power: 30,
  speed: 1500,
  passes: 1,
  intervalMm: 0.1,
  airAssist: false,
  ditherAlgorithm: 'floyd-steinberg',
} as const;

function grid(overrides: Partial<MaterialTestAxesGridOptions>) {
  return generateMaterialTestAxesGrid({
    mode: 'fill',
    rowAxis: { parameter: 'speed', start: 3000, end: 1000, count: 2 },
    columnAxis: { parameter: 'power', start: 10, end: 40, count: 2 },
    base: BASE,
    cellWidthMm: 5,
    cellHeightMm: 5,
    ...overrides,
  });
}

function cellObjects(objects: ReadonlyArray<SceneObject>): ReadonlyArray<SceneObject> {
  return objects.filter((object) => 'source' in object && object.source === 'material-test-grid');
}

function labelTexts(objects: ReadonlyArray<SceneObject>, idPart: string): string[] {
  return objects
    .filter((object) => object.id.includes(idPart) && 'source' in object)
    .map((object) => ('source' in object ? object.source.replace('calibration-label:', '') : ''));
}

describe('generateMaterialTestAxesGrid', () => {
  it('turns a passes axis into operations that burn each cell that many times', () => {
    const test = grid({
      mode: 'line',
      rowAxis: { parameter: 'passes', start: 1, end: 3, count: 3 },
      columnAxis: { parameter: 'power', start: 10, end: 30, count: 2 },
      labels: false,
    });
    expect(test.scene.layers.map((layer) => [layer.mode, layer.passes])).toEqual([
      ['line', 1],
      ['line', 2],
      ['line', 3],
    ]);
    expect(test.scene.layers.map((layer) => layer.name)).toEqual([
      'Material test 1 pass',
      'Material test 2 passes',
      'Material test 3 passes',
    ]);
    const out = gcode(test.scene, DEFAULT_DEVICE_PROFILE);
    expect(out.match(/; pass \d of 3/g)).toHaveLength(6);
    expect(out.match(/; pass \d of 2/g)).toHaveLength(4);
    expect(compileJob(test.scene, DEFAULT_DEVICE_PROFILE).groups.map((g) => g.passes)).toEqual([
      1, 1, 2, 2, 3, 3,
    ]);
  });

  it('puts speed on column operations when rows vary power, fastest column first', () => {
    const test = grid({
      rowAxis: { parameter: 'power', start: 20, end: 60, count: 3 },
      columnAxis: { parameter: 'speed', start: 1000, end: 4000, count: 2 },
    });
    const operations = test.scene.layers.filter((layer) => layer.mode === 'fill');
    expect(operations.map((layer) => [layer.id, layer.speed, layer.power])).toEqual([
      ['material-test-column-0', 1000, 60],
      ['material-test-column-1', 4000, 60],
    ]);
    expect(test.cells.map((cell) => [cell.column, cell.row])).toEqual([
      [1, 0],
      [1, 1],
      [1, 2],
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
    const job = compileJob(test.scene, DEFAULT_DEVICE_PROFILE);
    const fills = job.groups.filter((g) => g.kind === 'fill');
    expect(fills.map((g) => [g.speed, Number(g.power.toFixed(6))])).toEqual([
      [4000, 20],
      [4000, 40],
      [4000, 60],
      [1000, 20],
      [1000, 40],
      [1000, 60],
    ]);
    expect(labelTexts(test.scene.objects, '-speed-c')).toEqual(['1000', '4000']);
    expect(labelTexts(test.scene.objects, '-power-r')).toEqual(['20', '40', '60']);
  });

  it('varies fill interval by operation and passes by cell, widest interval first', () => {
    const test = grid({
      rowAxis: { parameter: 'interval', start: 0.05, end: 0.2, count: 2 },
      columnAxis: { parameter: 'passes', start: 1, end: 2, count: 2 },
    });
    const operations = test.scene.layers.filter((layer) => layer.mode === 'fill');
    expect(operations.map((layer) => layer.hatchSpacingMm)).toEqual([0.05, 0.2]);
    const cell = test.scene.objects.find((object) => object.id === 'material-test-cell-r0-c1');
    expect(cell?.operationOverride).toEqual({
      byOperation: { 'material-test-row-0': { passes: 2 } },
    });
    const job = compileJob(test.scene, DEFAULT_DEVICE_PROFILE);
    expect(job.groups.filter((g) => g.kind === 'fill').map((g) => g.passes)).toEqual([1, 2, 1, 2]);
    expect(test.cells.map((c) => c.intervalMm)).toEqual([0.2, 0.2, 0.05, 0.05]);
    expect(labelTexts(test.scene.objects, '-interval-r')).toEqual(['0.05', '0.2']);
  });

  it('burns a tone ramp per Image cell with the chosen dither and scan interval', () => {
    const test = grid({
      mode: 'image',
      base: { ...BASE, ditherAlgorithm: 'grayscale' },
      rowAxis: { parameter: 'interval', start: 0.2, end: 0.1, count: 2 },
      columnAxis: { parameter: 'power', start: 20, end: 40, count: 2 },
    });
    const operations = test.scene.layers.filter((layer) => layer.mode === 'image');
    expect(operations.map((layer) => [layer.ditherAlgorithm, layer.linesPerMm])).toEqual([
      ['grayscale', 5],
      ['grayscale', 10],
    ]);
    const cells = cellObjects(test.scene.objects);
    expect(cells).toHaveLength(4);
    expect(cells.every((object) => object.kind === 'raster-image')).toBe(true);
    const job = compileJob(test.scene, DEFAULT_DEVICE_PROFILE);
    const rasters = job.groups.filter((group) => group.kind === 'raster');
    expect(rasters).toHaveLength(4);
    expect(job.diagnostics ?? []).toEqual([]);
  });

  it('labels the real values, and adds a border only when asked', () => {
    const plain = grid({ labels: false });
    expect(plain.scene.layers.map((layer) => layer.id)).toEqual([
      'material-test-row-0',
      'material-test-row-1',
    ]);
    expect(plain.scene.objects).toHaveLength(4);
    expect(plain.cells[0]?.bounds).toMatchObject({ minX: 0, minY: 0 });

    const framed = grid({ border: true, origin: { x: 10, y: 20 } });
    expect(framed.scene.layers.at(-1)).toMatchObject({
      id: 'material-test-border',
      mode: 'line',
      name: 'Material test border',
    });
    const border = framed.scene.objects.at(-1);
    expect(border?.id).toBe('material-test-border-frame');
    expect(border?.transform).toMatchObject({ x: 10, y: 20 });
    for (const cell of framed.cells) {
      expect(cell.bounds.minX).toBeGreaterThan(10);
      expect(cell.bounds.maxX).toBeLessThan(10 + (border?.bounds.maxX ?? 0));
      expect(cell.bounds.maxY).toBeLessThan(20 + (border?.bounds.maxY ?? 0));
    }
  });

  it('keeps every burned power inside the machine range for out-of-range input', () => {
    const device: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, maxPowerS: 255 };
    for (const mode of ['line', 'fill', 'image'] as const) {
      const test = grid({
        mode,
        base: { ...BASE, power: 400, ditherAlgorithm: 'grayscale' },
        rowAxis: { parameter: 'power', start: -50, end: 250, count: 4 },
        columnAxis: { parameter: 'passes', start: 1, end: 2, count: 2 },
        border: true,
      });
      const job = compileJob(test.scene, device);
      const powers = job.groups.map((group) => (group.kind === 'cnc' ? Number.NaN : group.power));
      expect(powers.every((power) => power >= 0 && power <= 100)).toBe(true);
      const sWords = [...gcode(test.scene, device).matchAll(/\bS(\d+(?:\.\d+)?)/g)].map((m) =>
        Number(m[1]),
      );
      expect(sWords.length).toBeGreaterThan(0);
      expect(Math.max(...sWords)).toBeLessThanOrEqual(255);
    }
  });

  it('avoids reserved colors and prefixes every id for a second test', () => {
    const test = grid({
      idPrefix: 'material-test-2',
      reservedColors: new Set(['#000000', '#100000']),
      border: true,
    });
    expect(test.scene.layers.map((layer) => [layer.id, layer.color])).toEqual([
      ['material-test-2-row-0', '#100001'],
      ['material-test-2-row-1', '#100002'],
      ['material-test-2-labels', '#000001'],
      ['material-test-2-border', '#300000'],
    ]);
    const labels = test.scene.objects.filter((object) => object.id.includes('-power-c'));
    expect(
      labels.every((object) => 'paths' in object && object.paths[0]?.color === '#000001'),
    ).toBe(true);
    expect(test.scene.objects.every((object) => object.id.startsWith('material-test-2-'))).toBe(
      true,
    );
  });

  it('refuses the same setting on both axes', () => {
    expect(() =>
      grid({
        rowAxis: { parameter: 'speed', start: 1, end: 2, count: 2 },
        columnAxis: { parameter: 'speed', start: 1, end: 2, count: 2 },
      }),
    ).toThrow(/different setting/);
  });
});

function gcode(scene: Parameters<typeof compileJob>[0], device: DeviceProfile): string {
  return grblStrategy.emit(compileJob(scene, device), device);
}
