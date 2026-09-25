// OR-1 (2026-09-25 controller audit): constant-power (M3) output never makes
// GRBL drain its planner while the beam is still lit mid-job. Adapted from the
// audit's reproduction (src/__audit_repro__/OR/m3-lit-planner-drain.test.ts).
//
// Upstream: gnea/grbl 1.1h gcode.c:917-923 / :940-947 / :951-957 and
// motion_control.c:67-76 (drains), stepper.c:392-398 (only an M4 block is
// switched off at an empty buffer); grblHAL gcode.c:4121-4128,
// coolant_control.c:45-67 (the `$673` air on-delay is taken inside the drain);
// GRBL wiki "Grbl v1.1 Laser Mode": "When using M3 constant laser power mode,
// try to avoid force-sync conditions during a job whenever possible."
// The oracle is src/__fixtures__/controllers/grbl-lit-drain-checker.ts.

import { describe, expect, it } from 'vitest';
import { findM3LitPlannerDrains } from '../../__fixtures__/controllers/grbl-lit-drain-checker';
import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  type DeviceProfile,
} from '../devices';
import type { CutGroup, FillGroup, RasterGroup } from '../job';
import { grblStrategy } from './grbl-strategy';

const AIR_M8: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8' };
const COMPATIBLE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  gcodeDialect: { dialectId: 'grbl-compatible' },
};

function square(id: string, passes: number, airAssist: boolean): CutGroup {
  return {
    kind: 'cut',
    layerId: id,
    color: '#ff0000',
    power: 80,
    speed: 1200,
    passes,
    airAssist,
    powerMode: 'constant',
    segments: [
      {
        polyline: [
          { x: 10, y: 10 },
          { x: 20, y: 10 },
          { x: 20, y: 20 },
          { x: 10, y: 10 },
        ],
        closed: true,
      },
    ],
  };
}

function image(overscanMm: number, sValues: ReadonlyArray<number>, width = 4): RasterGroup {
  return {
    kind: 'raster',
    layerId: 'R',
    color: '#000000',
    power: 50,
    speed: 3000,
    passes: 1,
    airAssist: false,
    sValues: new Uint16Array(sValues),
    pixelWidth: width,
    pixelHeight: sValues.length / width,
    bounds: { minX: 30, minY: 30, maxX: 30 + width, maxY: 30 + sValues.length / width },
    overscanMm,
    dotWidthCorrectionMm: 0,
  } as unknown as RasterGroup;
}

const TWO_ROW_IMAGE = [0, 500, 500, 0, 0, 300, 300, 300];

describe('OR-1: M3 output never drains the planner with the beam lit', () => {
  it('Neotronics 4040 two-pass cut: no re-arm, and the coincident pass-2 seek is dropped', () => {
    const { powerMode: _unused, ...dialectDefault } = square('A', 2, false);
    void _unused;
    const out = grblStrategy.emit(
      { groups: [dialectDefault] },
      NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
    );
    expect(findM3LitPlannerDrains(out)).toEqual([]);
    // Pass 1 closes the contour where pass 2 starts, so pass 2 burns straight on.
    expect(out).toContain('G1 X10.000 Y10.000 F1200 S800\n; pass 2 of 2\nG1 X20.000 Y10.000');
  });

  it('air on, then off, between two layers on the same contour', () => {
    const out = grblStrategy.emit(
      { groups: [square('A', 1, true), square('B', 1, false)] },
      AIR_M8,
    );
    expect(findM3LitPlannerDrains(out)).toEqual([]);
    // Layer B starts where A's last burn ended: a 1 mm laser-off move along B's
    // first edge darkens the beam before M9 drains, then returns to the start.
    expect(out).toContain(
      [
        '; pass 1 of 1',
        'G0 X11.000 Y10.000 S0',
        'M9',
        'G0 X10.000 Y10.000 S0',
        'G1 X20.000 Y10.000 F1200 S800',
      ].join('\n'),
    );
  });

  it('air off, then on, between two layers on the same contour', () => {
    // grblHAL takes its `$673` air on-delay (0.5-20 s) inside this drain.
    const out = grblStrategy.emit(
      { groups: [square('A', 1, false), square('B', 1, true)] },
      AIR_M8,
    );
    expect(findM3LitPlannerDrains(out)).toEqual([]);
    expect(out).toContain('G0 X11.000 Y10.000 S0\nM8\nG0 X10.000 Y10.000 S0\n');
  });

  it('writes an air change after the next layer’s first seek when that seek moves', () => {
    const moved: CutGroup = {
      ...square('B', 1, true),
      segments: [
        {
          polyline: [
            { x: 50, y: 50 },
            { x: 60, y: 50 },
          ],
          closed: false,
        },
      ],
    };
    const out = grblStrategy.emit({ groups: [square('A', 1, false), moved] }, AIR_M8);
    expect(findM3LitPlannerDrains(out)).toEqual([]);
    expect(out).toContain(
      '; layer B color #ff0000 power 80% speed 1200 mm/min passes 1\n; pass 1 of 1\nG0 X50.000 Y50.000 S0\nM8\nG1 X60.000',
    );
  });

  it('grbl-compatible raster with zero overscan writes no zero-length row close', () => {
    const out = grblStrategy.emit({ groups: [image(0, TWO_ROW_IMAGE)] }, COMPATIBLE);
    expect(findM3LitPlannerDrains(out)).toEqual([]);
    expect(out).not.toMatch(/^G1 X33\.000 S0$/m);
  });

  it('grbl-compatible raster: an internal island exit writes no zero-length close', () => {
    // Two islands 8 px apart (> 5 mm) split the row into two sweeps; the first
    // one exits at its burn edge (lead-out 0) even with overscan on.
    const row = [500, 0, 0, 0, 0, 0, 0, 0, 0, 500];
    const out = grblStrategy.emit({ groups: [image(2, row, row.length)] }, COMPATIBLE);
    expect(findM3LitPlannerDrains(out)).toEqual([]);
  });

  it('constant-power cut, then an image layer: the image opening follows its first travel', () => {
    const out = grblStrategy.emit(
      { groups: [square('A', 1, false), image(5, TWO_ROW_IMAGE)] },
      DEFAULT_DEVICE_PROFILE,
    );
    expect(findM3LitPlannerDrains(out)).toEqual([]);
    expect(out).toMatch(/; feed 3000 mm\/min[^\n]*\nG0X26Y30\.5S0\nM5\nM4 S0\nG1X31F3000\n/);
  });

  it('grbl-compatible raster ending on a burn, then a cut: the closing M5 waits for the seek', () => {
    const { powerMode: _dialectDefault, ...cut } = square('C', 1, false);
    void _dialectDefault;
    const out = grblStrategy.emit({ groups: [image(0, TWO_ROW_IMAGE), cut] }, COMPATIBLE);
    expect(findM3LitPlannerDrains(out)).toEqual([]);
    expect(out).toContain('G0 X10.000 Y10.000 S0\nM5\nM3 S0\nG1 X20.000 Y10.000 F1200 S800');
  });

  it('constant-power fill, then a dynamic cut: M5 and M4 S0 follow the cut’s first seek', () => {
    const fill: FillGroup = {
      kind: 'fill',
      layerId: 'F',
      color: '#00ff00',
      power: 40,
      speed: 2000,
      passes: 1,
      airAssist: false,
      overscanMm: 0,
      segments: [
        {
          polyline: [
            { x: 10, y: 5 },
            { x: 20, y: 5 },
          ],
          closed: false,
          reverse: false,
        },
      ],
    };
    const cut: CutGroup = { ...square('C', 1, false), powerMode: 'dynamic' };
    const out = grblStrategy.emit({ groups: [fill, cut] }, COMPATIBLE);
    expect(findM3LitPlannerDrains(out)).toEqual([]);
    expect(out).toContain('; pass 1 of 1\nG0 X10.000 Y10.000 S0\nM5\nM4 S0\nG1 X20.000 Y10.000');
  });
});

describe('OR-1 leaves dynamic-power (M4) placement unchanged', () => {
  it('keeps an air change between M4 layers ahead of the next layer', () => {
    const dynamic = (id: string, air: boolean): CutGroup => ({
      ...square(id, 1, air),
      powerMode: 'dynamic',
    });
    const out = grblStrategy.emit({ groups: [dynamic('A', true), dynamic('B', false)] }, AIR_M8);
    expect(out).toContain('G1 X10.000 Y10.000\nM9\n; layer B');
    // The coincident seek stays under M4: GRBL drops it without a sync.
    expect(out).toContain('; pass 1 of 1\nG0 X10.000 Y10.000 S0\nG1 X20.000 Y10.000 F1200 S800');
  });
});
