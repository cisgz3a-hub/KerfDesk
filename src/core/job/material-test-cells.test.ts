import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { EMPTY_SCENE, type Scene } from '../scene';
import { generateMaterialTestAxesGrid } from './material-test-axes-grid';
import {
  findMaterialTests,
  materialTestBurnedSettings,
  materialTestCellPatch,
  materialTestRelativeEnergy,
  materialTestSettingValue,
} from './material-test-cells';
import { generateMaterialTestGrid } from './material-test-grid';
import { insertMaterialTest } from './material-test-insertion';

const BASE = {
  power: 30,
  speed: 1500,
  passes: 1,
  intervalMm: 0.1,
  airAssist: true,
  ditherAlgorithm: 'floyd-steinberg',
} as const;

describe('findMaterialTests', () => {
  it('reads an ADR-044 speed x power grid back cell by cell', () => {
    const grid = generateMaterialTestGrid({
      rows: 3,
      columns: 4,
      speedMin: 1000,
      speedMax: 3000,
      powerMin: 10,
      powerMax: 40,
      cellWidthMm: 5,
      cellHeightMm: 5,
    });
    const [test] = findMaterialTests(grid.scene);
    expect(test).toMatchObject({
      prefix: 'material-test',
      name: 'Material test',
      rows: 3,
      columns: 4,
      rowParameter: 'speed',
      columnParameter: 'power',
    });
    const cell = test?.cells.find((candidate) => candidate.row === 1 && candidate.column === 2);
    expect(cell?.settings).toMatchObject({ mode: 'fill', speed: 2000, power: 30, passes: 1 });
    expect(test?.cells.map((c) => [c.row, c.column]).slice(0, 5)).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
      [1, 0],
    ]);
  });

  it('resolves per-cell overrides and infers interval and passes axes', () => {
    const grid = generateMaterialTestAxesGrid({
      mode: 'fill',
      rowAxis: { parameter: 'interval', start: 0.2, end: 0.05, count: 2 },
      columnAxis: { parameter: 'passes', start: 1, end: 3, count: 3 },
      base: BASE,
      cellWidthMm: 5,
      cellHeightMm: 5,
    });
    const [test] = findMaterialTests(grid.scene);
    expect(test).toMatchObject({ rowParameter: 'interval', columnParameter: 'passes' });
    const cell = test?.cells.find((candidate) => candidate.row === 1 && candidate.column === 2);
    expect(cell?.settings).toMatchObject({
      hatchSpacingMm: 0.05,
      passes: 3,
      power: 30,
      airAssist: true,
    });
  });

  it('reports image scan intervals in mm', () => {
    const grid = generateMaterialTestAxesGrid({
      mode: 'image',
      rowAxis: { parameter: 'power', start: 20, end: 60, count: 2 },
      columnAxis: { parameter: 'interval', start: 0.2, end: 0.1, count: 2 },
      base: { ...BASE, ditherAlgorithm: 'grayscale' },
      cellWidthMm: 5,
      cellHeightMm: 5,
    });
    const [test] = findMaterialTests(grid.scene);
    expect(test).toMatchObject({ rowParameter: 'power', columnParameter: 'interval' });
    const values = test?.cells.map((cell) => materialTestSettingValue(cell.settings, 'interval'));
    expect(values).toEqual([0.2, 0.1, 0.2, 0.1]);
    expect(test?.cells[0]?.settings.ditherAlgorithm).toBe('grayscale');
  });

  it('keeps two inserted tests apart and ignores other artwork', () => {
    const options = {
      mode: 'line' as const,
      rowAxis: { parameter: 'speed' as const, start: 2000, end: 1000, count: 2 },
      columnAxis: { parameter: 'power' as const, start: 10, end: 20, count: 2 },
      base: BASE,
      cellWidthMm: 5,
      cellHeightMm: 5,
    };
    let scene: Scene = EMPTY_SCENE;
    for (let index = 0; index < 2; index += 1) {
      const result = insertMaterialTest(scene, DEFAULT_DEVICE_PROFILE, options);
      if (result.kind !== 'inserted') throw new Error(result.reason);
      scene = result.scene;
    }
    const tests = findMaterialTests(scene);
    expect(tests.map((test) => [test.prefix, test.name, test.cells.length])).toEqual([
      ['material-test', 'Material test', 4],
      ['material-test-2', 'Material test 2', 4],
    ]);
  });
});

describe('reusing a burned cell', () => {
  const grid = generateMaterialTestAxesGrid({
    mode: 'fill',
    rowAxis: { parameter: 'speed', start: 6000, end: 2000, count: 3 },
    columnAxis: { parameter: 'power', start: 10, end: 40, count: 4 },
    base: BASE,
    cellWidthMm: 5,
    cellHeightMm: 5,
    maxFeedMmPerMin: 5000,
  });
  const [test] = findMaterialTests(grid.scene);
  const cellAt = (row: number, column: number) => {
    const found = test?.cells.find((cell) => cell.row === row && cell.column === column);
    if (found === undefined) throw new Error(`cell ${row},${column} missing`);
    return found;
  };

  it('reports the feed the profile ceiling let the cell burn at', () => {
    const cell = cellAt(0, 1);
    expect(cell.settings.speed).toBe(6000);
    expect(materialTestBurnedSettings(cell, 5000)).toMatchObject({ speed: 5000, power: 20 });
    expect(materialTestBurnedSettings(cell, undefined).speed).toBe(6000);
  });

  it('applies power, speed, passes, air and the fill interval to a Fill operation', () => {
    const burned = materialTestBurnedSettings(cellAt(0, 1), 5000);
    expect(materialTestCellPatch(burned, { mode: 'fill' })).toEqual({
      patch: { power: 20, speed: 5000, passes: 1, airAssist: true, hatchSpacingMm: 0.1 },
      intervalSkipped: false,
    });
  });

  it('keeps the target mode and skips an interval it cannot use', () => {
    const burned = materialTestBurnedSettings(cellAt(0, 1), 5000);
    expect(materialTestCellPatch(burned, { mode: 'line' })).toEqual({
      patch: { power: 20, speed: 5000, passes: 1, airAssist: true },
      intervalSkipped: true,
    });
    const line = { ...burned, mode: 'line' as const };
    expect(materialTestCellPatch(line, { mode: 'fill' }).intervalSkipped).toBe(false);
  });

  it('carries image density and dither between Image operations', () => {
    const image = { ...cellAt(0, 1).settings, mode: 'image' as const, linesPerMm: 12.5 };
    expect(materialTestCellPatch(image, { mode: 'image' }).patch).toMatchObject({
      linesPerMm: 12.5,
      ditherAlgorithm: 'floyd-steinberg',
    });
  });

  it('ranks cells by energy: slower, stronger and denser burns more', () => {
    const energy = (row: number, column: number): number =>
      materialTestRelativeEnergy(materialTestBurnedSettings(cellAt(row, column), 5000));
    expect(energy(0, 3)).toBeGreaterThan(energy(0, 0));
    expect(energy(2, 0)).toBeGreaterThan(energy(0, 0));
    const settings = cellAt(0, 0).settings;
    const dense = materialTestRelativeEnergy({ ...settings, hatchSpacingMm: 0.05 });
    expect(dense).toBeGreaterThan(materialTestRelativeEnergy(settings));
  });
});
