import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { SceneObject } from '../scene';
import { compileJob } from './compile-job';
import { generateIntervalTestGrid } from './interval-test-grid';

describe('generateIntervalTestGrid', () => {
  it('creates fill layers and closed square objects for each interval swatch', () => {
    const grid = generateIntervalTestGrid({
      steps: 3,
      speed: 1800,
      power: 35,
      intervalMinMm: 0.1,
      intervalMaxMm: 0.2,
      swatchSizeMm: 8,
      gapMm: 2,
      origin: { x: 4, y: 5 },
    });

    expect(grid.scene.layers).toHaveLength(4);
    expect(
      grid.scene.objects.filter((object) => sourceOf(object) === 'interval-test-grid'),
    ).toHaveLength(3);
    expect(grid.scene.layers.map((layer) => layer.mode)).toEqual(['fill', 'fill', 'fill', 'line']);
    expect(grid.cells.map((cell) => [cell.step, cell.intervalMm])).toEqual([
      [0, 0.2],
      [1, 0.15],
      [2, 0.1],
    ]);

    const first = grid.scene.objects.find((object) => object.id === 'interval-test-cell-0');
    expect(first).toMatchObject({
      kind: 'imported-svg',
      id: 'interval-test-cell-0',
      bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 },
      transform: { x: 4, y: 5 },
    });
    expect(first?.kind === 'imported-svg' ? first.paths[0]?.polylines[0] : undefined).toEqual({
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 8, y: 0 },
        { x: 8, y: 8 },
        { x: 0, y: 8 },
        { x: 0, y: 0 },
      ],
    });
  });

  it('adds burned interval labels matching each swatch setting', () => {
    const grid = generateIntervalTestGrid({
      steps: 3,
      speed: 1800,
      power: 35,
      intervalMinMm: 0.1,
      intervalMaxMm: 0.2,
      swatchSizeMm: 8,
      gapMm: 2,
    });

    expect(grid.scene.layers.at(-1)).toMatchObject({
      id: 'interval-test-labels',
      mode: 'line',
    });
    const labels = grid.scene.objects
      .filter((object) => sourceOf(object).startsWith('calibration-label:'))
      .map((object) => sourceOf(object).replace('calibration-label:', ''));

    expect(labels).toEqual(['0.20', '0.15', '0.10']);
    expect(
      grid.scene.objects.find((object) => object.id === 'interval-test-label-1'),
    ).toMatchObject({
      source: 'calibration-label:0.15',
    });
  });

  it('keeps speed and power constant while varying hatch spacing by interval', () => {
    const grid = generateIntervalTestGrid({
      steps: 4,
      speed: 2400,
      power: 28,
      intervalMinMm: 0.08,
      intervalMaxMm: 0.2,
      swatchSizeMm: 6,
    });

    const fillLayers = grid.scene.layers.filter((layer) => layer.mode === 'fill');
    expect(fillLayers.map((layer) => layer.speed)).toEqual([2400, 2400, 2400, 2400]);
    expect(fillLayers.map((layer) => layer.power)).toEqual([28, 28, 28, 28]);
    expect(fillLayers.map((layer) => layer.hatchSpacingMm)).toEqual([0.2, 0.16, 0.12, 0.08]);
  });

  it('clamps invalid counts and intervals into a usable one-swatch scene', () => {
    const grid = generateIntervalTestGrid({
      steps: 0,
      speed: Number.NaN,
      power: 200,
      intervalMinMm: -1,
      intervalMaxMm: Number.NaN,
      swatchSizeMm: -5,
    });

    expect(grid.scene.layers.filter((layer) => layer.mode === 'fill')).toHaveLength(1);
    expect(
      grid.scene.objects.filter((object) => sourceOf(object) === 'interval-test-grid'),
    ).toHaveLength(1);
    expect(grid.cells[0]).toMatchObject({ intervalMm: 0.1, power: 100, speed: 1 });
    expect(grid.scene.layers[0]).toMatchObject({
      hatchSpacingMm: 0.1,
      power: 100,
      speed: 1,
    });
    expect(grid.scene.objects[0]?.bounds).toEqual({ minX: 0, minY: 0, maxX: 1, maxY: 1 });
  });

  it('compiles the largest interval swatch first as the lowest-risk output', () => {
    const grid = generateIntervalTestGrid({
      steps: 2,
      speed: 1800,
      power: 30,
      intervalMinMm: 0.1,
      intervalMaxMm: 0.5,
      swatchSizeMm: 5,
    });

    const job = compileJob(grid.scene, DEFAULT_DEVICE_PROFILE);

    expect(job.groups[0]).toMatchObject({ kind: 'fill', layerId: 'interval-test-step-0' });
    expect(grid.cells[0]?.intervalMm).toBe(0.5);
    expect(job.groups.at(-1)).toMatchObject({
      kind: 'cut',
      layerId: 'interval-test-labels',
    });
  });
});

function sourceOf(object: SceneObject): string {
  return 'source' in object ? object.source : '';
}
