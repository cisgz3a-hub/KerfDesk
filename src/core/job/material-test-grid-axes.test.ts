import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { SceneObject } from '../scene';
import { compileJob } from './compile-job';
import { computeJobMotionBounds } from './job-bounds';
import type { CutGroup, FillGroup, Job } from './job';
import { generateMaterialTestGrid, type MaterialTestGridOptions } from './material-test-grid';

const BASE: MaterialTestGridOptions = {
  rows: 3,
  columns: 3,
  speedMin: 1000,
  speedMax: 3000,
  powerMin: 10,
  powerMax: 40,
  cellWidthMm: 5,
  cellHeightMm: 5,
  gapMm: 1,
};

describe('material test grids that vary any two settings (ADR-497)', () => {
  it('burns power rows by passes columns, gentlest cell first', () => {
    const grid = generateMaterialTestGrid({
      ...BASE,
      rowParameter: 'power',
      columnParameter: 'passes',
      passesMin: 1,
      passesMax: 3,
      speed: 2000,
    });

    expect(grid.rowParameter).toBe('power');
    expect(grid.columnParameter).toBe('passes');
    const rows = grid.scene.layers.filter((layer) => layer.mode === 'fill');
    expect(rows.map((layer) => [layer.power, layer.speed, layer.passes])).toEqual([
      [10, 2000, 1],
      [25, 2000, 1],
      [40, 2000, 1],
    ]);
    expect(grid.cells.map((cell) => [cell.power, cell.passes])).toEqual([
      [10, 1],
      [10, 2],
      [10, 3],
      [25, 1],
      [25, 2],
      [25, 3],
      [40, 1],
      [40, 2],
      [40, 3],
    ]);
    expect(cellObject(grid.scene.objects, 'material-test-cell-r0-c2')).toMatchObject({
      operationOverride: { passes: 3 },
    });
    expect(cellObject(grid.scene.objects, 'material-test-cell-r0-c2')?.powerScale).toBeUndefined();

    const fills = fillGroups(compileJob(grid.scene, DEFAULT_DEVICE_PROFILE));
    expect(fills.map((group) => [group.power, group.passes])).toEqual(
      grid.cells.map((cell) => [cell.power, cell.passes]),
    );
    expect(labels(grid.scene.objects)).toEqual(['1', '2', '3', '10', '25', '40']);
  });

  it('burns speed rows by passes columns', () => {
    const grid = generateMaterialTestGrid({
      ...BASE,
      rows: 2,
      columnParameter: 'passes',
      passesMin: 2,
      passesMax: 4,
      power: 35,
    });

    const fills = fillGroups(compileJob(grid.scene, DEFAULT_DEVICE_PROFILE));
    expect(fills.map((group) => [group.speed, group.power, group.passes])).toEqual([
      [3000, 35, 2],
      [3000, 35, 3],
      [3000, 35, 4],
      [1000, 35, 2],
      [1000, 35, 3],
      [1000, 35, 4],
    ]);
  });

  it('keeps one column per whole number of passes', () => {
    const grid = generateMaterialTestGrid({
      ...BASE,
      columns: 10,
      columnParameter: 'passes',
      passesMin: 1,
      passesMax: 3,
    });
    expect(grid.cells.filter((cell) => cell.row === 0).map((cell) => cell.passes)).toEqual([
      1, 2, 3,
    ]);

    const spread = generateMaterialTestGrid({
      ...BASE,
      columns: 3,
      columnParameter: 'passes',
      passesMin: 1,
      passesMax: 4,
    });
    expect(spread.cells.filter((cell) => cell.row === 0).map((cell) => cell.passes)).toEqual([
      1, 3, 4,
    ]);
  });

  it('varies hatch spacing from widest to densest', () => {
    const grid = generateMaterialTestGrid({
      ...BASE,
      rowParameter: 'interval',
      intervalMinMm: 0.05,
      intervalMaxMm: 0.15,
      speed: 2500,
    });

    expect(
      grid.scene.layers.filter((layer) => layer.mode === 'fill').map((l) => l.hatchSpacingMm),
    ).toEqual([0.15, 0.1, 0.05]);
    expect(grid.cells.map((cell) => cell.intervalMm)).toEqual([
      0.15, 0.15, 0.15, 0.1, 0.1, 0.1, 0.05, 0.05, 0.05,
    ]);
    expect(labels(grid.scene.objects).slice(3)).toEqual(['0.15', '0.1', '0.05']);
    expect(grid.scene.layers[0]?.name).toBe('Material test 0.15 mm hatch spacing');
  });

  it('varies speed along columns and burns the feed the job runs', () => {
    const grid = generateMaterialTestGrid({
      ...BASE,
      rowParameter: 'power',
      columnParameter: 'speed',
      speedMin: 1000,
      speedMax: 4000,
      maxFeedMmPerMin: 3000,
    });

    expect(grid.cells.filter((cell) => cell.row === 0).map((cell) => cell.requestedSpeed)).toEqual([
      4000, 2500, 1000,
    ]);
    expect(labels(grid.scene.objects).slice(0, 3)).toEqual(['3000', '2500', '1000']);
    const fills = fillGroups(compileJob(grid.scene, { ...DEFAULT_DEVICE_PROFILE, maxFeed: 3000 }));
    expect(fills.slice(0, 3).map((group) => group.speed)).toEqual([3000, 2500, 1000]);
  });

  it('never varies one setting on both axes', () => {
    const grid = generateMaterialTestGrid({
      ...BASE,
      rowParameter: 'power',
      columnParameter: 'power',
    });
    expect([grid.rowParameter, grid.columnParameter]).toEqual(['power', 'speed']);

    const defaults = generateMaterialTestGrid({ ...BASE, rowParameter: 'passes' });
    expect([defaults.rowParameter, defaults.columnParameter]).toEqual(['passes', 'power']);
  });
});

describe('cut test grids (ADR-497)', () => {
  it('cuts each cell outline with power rows by passes columns', () => {
    const grid = generateMaterialTestGrid({
      ...BASE,
      mode: 'line',
      rowParameter: 'power',
      columnParameter: 'passes',
      passesMin: 1,
      passesMax: 3,
      speed: 300,
    });

    expect(grid.mode).toBe('line');
    expect(grid.scene.layers.map((layer) => layer.mode)).toEqual(['line', 'line', 'line', 'line']);
    expect(grid.cells[0]?.intervalMm).toBeUndefined();
    const cuts = compileJob(grid.scene, DEFAULT_DEVICE_PROFILE).groups.filter(
      (group): group is CutGroup =>
        group.kind === 'cut' && group.layerId !== 'material-test-labels',
    );
    expect(cuts.map((group) => [group.power, group.passes])).toEqual(
      grid.cells.map((cell) => [cell.power, cell.passes]),
    );
    expect(cuts.every((group) => group.speed === 300)).toBe(true);
  });

  it('has no hatch spacing to vary', () => {
    const grid = generateMaterialTestGrid({
      ...BASE,
      mode: 'line',
      rowParameter: 'interval',
      columnParameter: 'passes',
    });
    expect([grid.rowParameter, grid.columnParameter]).toEqual(['speed', 'passes']);
  });
});

describe('material test runways (ADR-497)', () => {
  it('keeps the stored 5 mm where it is long enough', () => {
    const grid = generateMaterialTestGrid({ ...BASE, accelMmPerSec2: 500 });
    expect(grid.scene.layers.filter((l) => l.mode === 'fill').map((l) => l.fillOverscanMm)).toEqual(
      [5, 5, 5],
    );
  });

  it('sizes each row for its fastest cell and keeps the runway right of the origin', () => {
    const grid = generateMaterialTestGrid({
      ...BASE,
      rowParameter: 'power',
      columnParameter: 'speed',
      speedMin: 1000,
      speedMax: 6000,
      accelMmPerSec2: 500,
      origin: { x: 0, y: 0 },
    });

    // 6000 mm/min at 500 mm/s² needs 10 mm, plus 10%.
    expect(grid.scene.layers.filter((l) => l.mode === 'fill').map((l) => l.fillOverscanMm)).toEqual(
      [11, 11, 11],
    );
    expect(Math.min(...grid.cells.map((cell) => cell.bounds.minX))).toBeGreaterThanOrEqual(11);

    const fills = fillGroups(compileJob(grid.scene, DEFAULT_DEVICE_PROFILE));
    expect(fills.every((group) => group.overscanMm === 11)).toBe(true);
    const job = compileJob(grid.scene, DEFAULT_DEVICE_PROFILE);
    expect(computeJobMotionBounds(job, DEFAULT_DEVICE_PROFILE)?.minX).toBeGreaterThanOrEqual(0);
  });

  it('sizes speed rows one by one', () => {
    const grid = generateMaterialTestGrid({
      ...BASE,
      speedMin: 3000,
      speedMax: 9000,
      accelMmPerSec2: 500,
    });
    // 9000 → 24.8 mm, 6000 → 11 mm, 3000 → 2.8 mm (stays 5).
    expect(grid.scene.layers.filter((l) => l.mode === 'fill').map((l) => l.fillOverscanMm)).toEqual(
      [24.8, 11, 5],
    );
  });
});

function fillGroups(job: Job): ReadonlyArray<FillGroup> {
  return job.groups.filter((group): group is FillGroup => group.kind === 'fill');
}

function cellObject(objects: ReadonlyArray<SceneObject>, id: string): SceneObject | undefined {
  return objects.find((object) => object.id === id);
}

function labels(objects: ReadonlyArray<SceneObject>): ReadonlyArray<string> {
  return objects
    .map((object) => ('source' in object ? object.source : ''))
    .filter((source) => source.startsWith('calibration-label:'))
    .map((source) => source.replace('calibration-label:', ''));
}
