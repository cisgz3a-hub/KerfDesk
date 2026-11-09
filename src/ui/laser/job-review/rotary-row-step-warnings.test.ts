import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../../core/devices';
import type { Job, RasterGroup } from '../../../core/job';
import {
  detectRotaryRowStepWarnings,
  ROTARY_ROW_STEPS_UNKNOWN_WARNING,
} from './rotary-row-step-warnings';

// Rolling audit v12 X8-P2-3 (refuter's table, own step model): a solid 10 mm
// image at 10 lines/mm in the Creality chuck (40 mm per turn).

const chuck = (objectDiameterMm: number): RotarySetup => ({
  enabled: true,
  type: 'chuck',
  mmPerRotation: 40,
  objectDiameterMm,
});

function rasterJob(linesPerMm = 10): Job {
  const rows = 10 * linesPerMm;
  const raster = {
    kind: 'raster',
    layerId: 'L1',
    color: '#808080',
    power: 50,
    speed: 3000,
    passes: 1,
    airAssist: false,
    sValues: new Uint8Array(rows),
    pixelWidth: 1,
    pixelHeight: rows,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    overscanMm: 0,
    dotWidthCorrectionMm: 0,
  } as unknown as RasterGroup;
  return { groups: [raster] };
}

function project(rotary: RotarySetup | undefined) {
  return { device: { ...DEFAULT_DEVICE_PROFILE, ...(rotary === undefined ? {} : { rotary }) } };
}

describe('detectRotaryRowStepWarnings (ADR-315 Amd 1)', () => {
  it('names the banding gaps and the intervals that fit, Ø80 at 80 steps/mm', () => {
    expect(detectRotaryRowStepWarnings(project(chuck(80)), rasterJob(), 80)).toEqual([
      'Image layer L1 on this rotary: one Y step ($101 = 80 steps/mm) turns the part 0.079 mm, ' +
        'and the 0.100 mm line interval is 1.27 steps, so its rows land 0.079 or 0.157 mm apart ' +
        'and band. For even rows, set the line interval to 12.73 lines/mm (0.079 mm, 1 step) or ' +
        '6.37 lines/mm (0.157 mm, 2 steps).',
    ]);
  });

  it('says rows burn twice when the interval is under one step, Ø150 at 80 steps/mm', () => {
    const [warning] = detectRotaryRowStepWarnings(project(chuck(150)), rasterJob(), 80);
    expect(warning).toContain('the 0.100 mm line interval is 0.68 steps');
    expect(warning).toContain('so about 32 % of its rows land on the row before and burn twice');
    expect(warning).toContain('6.79 lines/mm (0.147 mm, 1 step)');
  });

  it.each([
    [100, 80, '1.59 steps', '0.063 or 0.126 mm apart', '15.92 lines/mm'],
    [160, 80, '2.55 steps', '0.079 or 0.118 mm apart', '12.73 lines/mm (0.079 mm, 2 steps)'],
    [100, 150, '0.85 steps', '15 % of its rows', '8.49 lines/mm'],
    [160, 150, '1.36 steps', '0.074 or 0.147 mm apart', '13.58 lines/mm'],
  ])('$101 = %i on Ø%i', (steps, diameter, ratio, effect, suggestion) => {
    const [warning] = detectRotaryRowStepWarnings(project(chuck(diameter)), rasterJob(), steps);
    expect(warning).toContain(ratio);
    expect(warning).toContain(effect);
    expect(warning).toContain(suggestion);
  });

  it('is silent when the interval is a whole number of steps', () => {
    // 12.73 lines/mm on Ø80 at 80 steps/mm is exactly one step per row.
    const fits = (40 / (Math.PI * 80)) * 80;
    const job = rasterJob(1);
    const exact = {
      ...job,
      groups: [{ ...(job.groups[0] as RasterGroup), pixelHeight: Math.round(10 * fits) }],
    };
    // 127 rows over 10 mm is 1.0002 steps per row.
    expect(detectRotaryRowStepWarnings(project(chuck(80)), exact, 80)).toEqual([]);
  });

  it('warns once when the controller reported no $101, and checks nothing without one', () => {
    expect(detectRotaryRowStepWarnings(project(chuck(80)), rasterJob(), null)).toEqual([
      ROTARY_ROW_STEPS_UNKNOWN_WARNING,
    ]);
    expect(detectRotaryRowStepWarnings(project(chuck(80)), rasterJob(), undefined)).toEqual([]);
  });

  it('is silent on a flat bed, with the rotary off, or without an image', () => {
    expect(detectRotaryRowStepWarnings(project(undefined), rasterJob(), 80)).toEqual([]);
    expect(
      detectRotaryRowStepWarnings(project({ ...chuck(80), enabled: false }), rasterJob(), 80),
    ).toEqual([]);
    expect(detectRotaryRowStepWarnings(project(chuck(80)), { groups: [] }, 80)).toEqual([]);
  });
});
