import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type RotarySetup } from '../../../core/devices';
import type { Job, RasterGroup } from '../../../core/job';
import { pixelExtentForMm } from '../../../core/raster/luma-resample';
import { lineIntervalMmToLinesPerMm } from '../../../core/raster/raster-units';
import {
  detectRotaryRowStepWarnings,
  rotaryRowStepsUnknownWarning,
} from './rotary-row-step-warnings';

// Rolling audit v12 X8-P2-3 and v13 Y5-P1-3: an image in the Creality chuck
// (40 mm per turn). Rows are counted as the compiler counts them (height ×
// lines/mm, rounded) and checked as the emitter writes them (row centres, 3
// decimals) and the controller steps them.

const chuck = (objectDiameterMm: number): RotarySetup => ({
  enabled: true,
  type: 'chuck',
  mmPerRotation: 40,
  objectDiameterMm,
});

function rasterJob(heightMm: number, linesPerMm: number): Job {
  const rows = pixelExtentForMm(heightMm, linesPerMm);
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
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: heightMm },
    overscanMm: 0,
    dotWidthCorrectionMm: 0,
  } as unknown as RasterGroup;
  return { groups: [raster] };
}

function project(rotary: RotarySetup | undefined) {
  return { device: { ...DEFAULT_DEVICE_PROFILE, ...(rotary === undefined ? {} : { rotary }) } };
}

/** The intervals a warning names, as the operator would type them. */
function suggestedIntervals(warning: string | undefined): number[] {
  return [...(warning ?? '').matchAll(/(\d+\.\d{4}) mm \(\d/g)].map((match) => Number(match[1]));
}

describe('detectRotaryRowStepWarnings (ADR-315 Amd 1 and 2)', () => {
  it('names the banding gaps and an interval that lands evenly, Ø80 at 80 steps/mm', () => {
    expect(
      detectRotaryRowStepWarnings(project(chuck(80)), rasterJob(30, 10), { stepsPerMmY: 80 }),
    ).toEqual([
      'Image layer L1 on this rotary: one Y step ($101 = 80 steps/mm) turns the part 0.0785 mm, ' +
        'and the 0.1000 mm line interval is 1.27 steps, so its rows land 0.0785 or 0.1571 mm ' +
        'apart and band. For even rows, set the line interval to 0.1571 mm (6.37 lines/mm, ' +
        '2 steps).',
    ]);
  });

  it('warns on a one-step interval whose row centres sit on half steps (Y5-P1-3)', () => {
    // Exactly 12.7324 lines/mm on a 30 mm photo: 136 of 382 rows double.
    const [exact] = detectRotaryRowStepWarnings(project(chuck(80)), rasterJob(30, 12.7324), {
      stepsPerMmY: 80,
    });
    expect(exact).toContain('so 136 of its 382 rows land on the row before and burn twice');
    // The interval 1.0.31's advice printed, typed in mm: 4 of 380 double.
    const printed = lineIntervalMmToLinesPerMm(0.079);
    const [typed] = detectRotaryRowStepWarnings(project(chuck(80)), rasterJob(30, printed), {
      stepsPerMmY: 80,
    });
    expect(typed).toContain('so 4 of its 380 rows land on the row before and burn twice');
  });

  it.each([
    [80, 80, 30],
    [80, 80, 60],
    [80, 100, 60],
    [80, 160, 30],
    [70, 80, 30],
  ])('Ø%i at %i steps/mm, %i mm photo: each suggestion, typed as printed, is silent', (d, s, h) => {
    const [warning] = detectRotaryRowStepWarnings(project(chuck(d)), rasterJob(h, 10), {
      stepsPerMmY: s,
    });
    const intervals = suggestedIntervals(warning);
    expect(intervals.length).toBeGreaterThan(0);
    for (const interval of intervals) {
      const job = rasterJob(h, lineIntervalMmToLinesPerMm(interval));
      expect(detectRotaryRowStepWarnings(project(chuck(d)), job, { stepsPerMmY: s })).toEqual([]);
    }
  });

  it('says when no interval the layer accepts lands every row: Ø150 at 80 steps/mm', () => {
    const [warning] = detectRotaryRowStepWarnings(project(chuck(150)), rasterJob(30, 10), {
      stepsPerMmY: 80,
    });
    expect(warning).toContain('the 0.1000 mm line interval is 0.68 steps');
    expect(warning).toContain('so 96 of its 300 rows land on the row before and burn twice');
    expect(warning).toContain(
      'No line interval this layer accepts lands every row on its own step; 0.1473 mm ' +
        '(6.79 lines/mm, 1 step) comes closest, with 15 of 204 rows doubled.',
    );
  });

  it('checks a rotary on its own A axis against $103 (ADR-695)', () => {
    // The A1 Pro reports $103=8.900 steps per degree; 360° per turn of an Ø80 glass.
    const onA: RotarySetup = { ...chuck(80), axis: 'A', mmPerRotation: 360 };
    const [warning] = detectRotaryRowStepWarnings(project(onA), rasterJob(30, 10), {
      stepsPerMmY: 80,
      stepsPerUnitA: 8.9,
    });
    expect(warning).toContain('one A step ($103 = 8.9 steps/°) turns the part 0.0784 mm');
    expect(warning).toContain(
      'For even rows, set the line interval to 0.1569 mm (6.37 lines/mm, 2 steps).',
    );
    expect(warning).toContain('1.27 steps');
    expect(
      detectRotaryRowStepWarnings(project(onA), rasterJob(30, 10), { stepsPerMmY: 80 }),
    ).toEqual([rotaryRowStepsUnknownWarning('A')]);
  });

  it('warns once when the controller reported no $101, and checks nothing without one', () => {
    expect(detectRotaryRowStepWarnings(project(chuck(80)), rasterJob(30, 10), null)).toEqual([
      rotaryRowStepsUnknownWarning('Y'),
    ]);
    expect(detectRotaryRowStepWarnings(project(chuck(80)), rasterJob(30, 10), undefined)).toEqual(
      [],
    );
  });

  it('is silent on a flat bed, with the rotary off, or without an image', () => {
    expect(
      detectRotaryRowStepWarnings(project(undefined), rasterJob(30, 10), { stepsPerMmY: 80 }),
    ).toEqual([]);
    expect(
      detectRotaryRowStepWarnings(project({ ...chuck(80), enabled: false }), rasterJob(30, 10), {
        stepsPerMmY: 80,
      }),
    ).toEqual([]);
    expect(
      detectRotaryRowStepWarnings(project(chuck(80)), { groups: [] }, { stepsPerMmY: 80 }),
    ).toEqual([]);
  });
});
