import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { SceneObject } from '../scene';
import { compileJob } from './compile-job';
import { generateMaterialTestGrid } from './material-test-grid';

describe('generateMaterialTestGrid', () => {
  it('creates fill layers and closed square objects for each test cell', () => {
    const grid = generateMaterialTestGrid({
      rows: 2,
      columns: 3,
      speedMin: 1000,
      speedMax: 3000,
      powerMin: 10,
      powerMax: 40,
      cellWidthMm: 5,
      cellHeightMm: 4,
      gapMm: 1,
      origin: { x: 2, y: 3 },
    });

    expect(grid.scene.layers).toHaveLength(3);
    expect(
      grid.scene.objects.filter((object) => sourceOf(object) === 'material-test-grid'),
    ).toHaveLength(6);
    expect(grid.scene.layers.map((layer) => layer.mode)).toEqual(['fill', 'fill', 'line']);
    expect(grid.cells.map((cell) => [cell.row, cell.column])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ]);

    const first = grid.scene.objects.find((object) => object.id === 'material-test-cell-r0-c0');
    expect(first).toMatchObject({
      kind: 'imported-svg',
      id: 'material-test-cell-r0-c0',
      bounds: { minX: 0, minY: 0, maxX: 5, maxY: 4 },
    });
    expect(first?.transform.x).toBeGreaterThan(2);
    expect(first?.transform.y).toBeGreaterThan(3);
    expect(first?.kind === 'imported-svg' ? first.paths[0]?.polylines[0] : undefined).toEqual({
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 4 },
        { x: 0, y: 4 },
        { x: 0, y: 0 },
      ],
    });
  });

  it('adds burned speed and power labels matching the generated settings', () => {
    const grid = generateMaterialTestGrid({
      rows: 2,
      columns: 3,
      speedMin: 1000,
      speedMax: 3000,
      powerMin: 10,
      powerMax: 40,
      cellWidthMm: 5,
      cellHeightMm: 4,
    });

    expect(grid.scene.layers.at(-1)).toMatchObject({
      id: 'material-test-labels',
      mode: 'line',
    });
    const labels = grid.scene.objects
      .filter((object) => sourceOf(object).startsWith('calibration-label:'))
      .map((object) => sourceOf(object).replace('calibration-label:', ''));

    expect(labels).toEqual(['10', '25', '40', '3000', '1000']);
    expect(
      grid.scene.objects.find((object) => object.id === 'material-test-power-c1'),
    ).toMatchObject({
      source: 'calibration-label:25',
    });
    expect(
      grid.scene.objects.find((object) => object.id === 'material-test-speed-r0'),
    ).toMatchObject({
      source: 'calibration-label:3000',
    });
  });

  it('orders rows fastest-to-slowest and columns lowest-to-highest power', () => {
    const grid = generateMaterialTestGrid({
      rows: 2,
      columns: 3,
      speedMin: 1000,
      speedMax: 3000,
      powerMin: 10,
      powerMax: 40,
      cellWidthMm: 5,
      cellHeightMm: 4,
    });

    const fillLayers = grid.scene.layers.filter((layer) => layer.mode === 'fill');
    expect(fillLayers.map((layer) => layer.speed)).toEqual([3000, 1000]);
    expect(fillLayers.map((layer) => layer.power)).toEqual([40, 40]);
    expect(grid.cells.map((cell) => cell.power)).toEqual([10, 25, 40, 10, 25, 40]);
    expect(
      grid.scene.objects
        .filter((object) => sourceOf(object) === 'material-test-grid')
        .map((object) => object.powerScale),
    ).toEqual([25, 62.5, 100, 25, 62.5, 100]);
  });

  it('compiles the first emitted group as the lowest-risk cell', () => {
    const grid = generateMaterialTestGrid({
      rows: 2,
      columns: 2,
      speedMin: 1000,
      speedMax: 3000,
      powerMin: 10,
      powerMax: 40,
      cellWidthMm: 5,
      cellHeightMm: 4,
    });

    const job = compileJob(grid.scene, DEFAULT_DEVICE_PROFILE);

    expect(job.groups[0]).toMatchObject({ kind: 'fill', speed: 3000, power: 10 });
    expect(job.groups.filter((group) => group.kind === 'fill').map((group) => group.power)).toEqual(
      [10, 40, 10, 40],
    );
    expect(job.groups.at(-1)).toMatchObject({
      kind: 'cut',
      layerId: 'material-test-labels',
    });
  });
});

function sourceOf(object: SceneObject): string {
  return 'source' in object ? object.source : '';
}
