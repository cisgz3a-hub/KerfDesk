// ADR-381 keeps the ADR-044 speed x power Material Test byte-identical when the
// operator leaves the axes alone. The reference is a frozen copy of the
// original generator, so these tests fail if the generalised generator drifts
// by a single key, float or G-code word.

import { describe, expect, it } from 'vitest';
import {
  generateAdr044MaterialTestGrid,
  type Adr044MaterialTestGridOptions,
} from '../../__fixtures__/material-test/adr044-material-test-grid';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import type { Scene } from '../scene';
import { compileJob } from './compile-job';
import { generateMaterialTestAxesGrid } from './material-test-axes-grid';
import { generateMaterialTestGrid } from './material-test-grid';

const DIALOG_DEFAULT: Adr044MaterialTestGridOptions = {
  rows: 10,
  columns: 10,
  speedMin: 1000,
  speedMax: 3000,
  powerMin: 10,
  powerMax: 40,
  cellWidthMm: 5,
  cellHeightMm: 5,
  gapMm: 1,
};

const CASES: ReadonlyArray<readonly [string, Adr044MaterialTestGridOptions]> = [
  ['dialog default', DIALOG_DEFAULT],
  ['dialog default under a 2000 mm/min ceiling', { ...DIALOG_DEFAULT, maxFeedMmPerMin: 2000 }],
  [
    'small grid with an origin',
    {
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
    },
  ],
  [
    'reversed min and max with fractional steps',
    {
      rows: 7,
      columns: 6,
      speedMin: 2500,
      speedMax: 700,
      powerMin: 55,
      powerMax: 12.5,
      cellWidthMm: 3.3,
      cellHeightMm: 2.7,
      gapMm: 0.4,
    },
  ],
  [
    'zero power and a single row',
    {
      rows: 1,
      columns: 4,
      speedMin: 1200,
      speedMax: 1200,
      powerMin: 0,
      powerMax: 0,
      cellWidthMm: 6,
      cellHeightMm: 6,
    },
  ],
  [
    'out-of-range input clamped',
    {
      rows: 40,
      columns: 0,
      speedMin: Number.NaN,
      speedMax: -5,
      powerMin: -20,
      powerMax: 180,
      cellWidthMm: 0,
      cellHeightMm: Number.POSITIVE_INFINITY,
      gapMm: -3,
    },
  ],
];

describe('ADR-044 Material Test byte identity', () => {
  it.each(CASES)('keeps the %s scene and cells identical', (_name, options) => {
    const reference = generateAdr044MaterialTestGrid(options);
    const current = generateMaterialTestGrid(options);
    expect(JSON.stringify(current.scene)).toBe(JSON.stringify(reference.scene));
    expect(JSON.stringify(current.cells)).toBe(JSON.stringify(reference.cells));
  });

  it.each(CASES)('keeps the %s G-code identical', (_name, options) => {
    const device: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      ...(options.maxFeedMmPerMin === undefined ? {} : { maxFeed: options.maxFeedMmPerMin }),
    };
    expect(gcode(generateMaterialTestGrid(options).scene, device)).toBe(
      gcode(generateAdr044MaterialTestGrid(options).scene, device),
    );
  });

  it('matches when the axes path is given the default speed x power axes', () => {
    const grid = generateMaterialTestAxesGrid({
      mode: 'fill',
      rowAxis: { parameter: 'speed', start: 3000, end: 1000, count: 10 },
      columnAxis: { parameter: 'power', start: 10, end: 40, count: 10 },
      base: {
        power: 30,
        speed: 1500,
        passes: 1,
        intervalMm: 0.1,
        airAssist: false,
        ditherAlgorithm: 'floyd-steinberg',
      },
      maxFeedMmPerMin: DEFAULT_DEVICE_PROFILE.maxFeed,
      cellWidthMm: 5,
      cellHeightMm: 5,
      gapMm: 1,
      labels: true,
      border: false,
    });
    const reference = generateAdr044MaterialTestGrid({
      ...DIALOG_DEFAULT,
      maxFeedMmPerMin: DEFAULT_DEVICE_PROFILE.maxFeed,
    });
    expect(JSON.stringify(grid.scene)).toBe(JSON.stringify(reference.scene));
    expect(gcode(grid.scene, DEFAULT_DEVICE_PROFILE)).toBe(
      gcode(reference.scene, DEFAULT_DEVICE_PROFILE),
    );
  });
});

function gcode(scene: Scene, device: DeviceProfile): string {
  return grblStrategy.emit(compileJob(scene, device), device);
}
