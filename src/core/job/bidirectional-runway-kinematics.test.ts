import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../gcode-view';
import { buildProgramTime } from '../gcode-time/program-time';
import { grblStrategy } from '../output/grbl-strategy';
import type { FillGroup, RasterGroup } from './job';
import { computeFrameJobMotionBounds } from './job-bounds';
import { buildToolpath } from './toolpath';

const BURN_FEED = 1500;
const ACCELERATION = 100;
const BURN_VELOCITY = BURN_FEED / 60;
const REST_DISTANCE = BURN_VELOCITY ** 2 / (2 * ACCELERATION);
const DEVICE = {
  ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  accelMmPerSec2: ACCELERATION,
};

function fill(bidirectional: boolean): FillGroup {
  return {
    kind: 'fill',
    layerId: 'fill',
    color: '#000',
    power: 50,
    speed: BURN_FEED,
    passes: 1,
    airAssist: false,
    overscanMm: 5,
    fillRunwayPolicy: 'feed-matched-entry',
    scanDirection: {
      bidirectional,
      reason: bidirectional ? 'requested-bidirectional' : 'requested-one-way',
    },
    segments: [0, 1].flatMap((row) => {
      const reverse = bidirectional && row === 1;
      const intervals = reverse
        ? [
            [27, 26],
            [11, 10],
          ]
        : [
            [10, 11],
            [26, 27],
          ];
      return intervals.map(([from, to]) => ({
        polyline: [
          { x: from ?? 0, y: row + 0.5 },
          { x: to ?? 0, y: row + 0.5 },
        ],
        closed: false,
        reverse,
      }));
    }),
  };
}

function raster(bidirectional: boolean): RasterGroup {
  const row = new Uint16Array(17);
  row[0] = 500;
  row[16] = 500;
  return {
    kind: 'raster',
    layerId: 'image',
    color: '#000',
    power: 50,
    speed: BURN_FEED,
    passes: 1,
    airAssist: false,
    overscanMm: 5,
    dotWidthCorrectionMm: 0,
    bounds: { minX: 10, minY: 0, maxX: 27, maxY: 2 },
    pixelWidth: 17,
    pixelHeight: 2,
    sValues: new Uint16Array([...row, ...row]),
    bidirectional,
  };
}

function emittedModel(group: FillGroup | RasterGroup): GcodeRenderModel {
  const gcode = grblStrategy.emit({ groups: [group] }, DEVICE, {
    finishPosition: null,
    compactMotionWords: false,
  });
  const result = buildGcodeRenderModel(gcode, { machineKind: 'laser' });
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

function poweredSegments(model: GcodeRenderModel): number[] {
  return Array.from({ length: model.segmentCount }, (_, index) => index).filter(
    (index) => (model.segPower[index] ?? 0) > 0,
  );
}

// This fixture has two 1 mm strokes per row, separated by 15 mm of white.
// At 25 mm/s and 100 mm/s², a full stop needs 3.125 mm. A 5 mm dark runway
// therefore isolates every burn from both the F800 gap seek and row turns.
// No device timing claim is needed: these are declared test dynamics.
describe('split-sweep laser motion keeps acceleration outside the burn', () => {
  for (const [name, group] of [
    ['Fill', fill],
    ['Image', raster],
  ] as const) {
    it.each([true, false])(
      `${name} reaches and leaves each short burn at the calibrated feed, bidirectional=%s`,
      (bidirectional) => {
        const model = emittedModel(group(bidirectional));
        const timing = buildProgramTime(model, {
          accelMmPerSec2: ACCELERATION,
          junctionDeviationMm: DEVICE.junctionDeviationMm,
          maxFeedMmPerMin: DEVICE.maxFeed,
        });
        const burns = poweredSegments(model);
        expect(burns).toHaveLength(4);
        expect(
          burns.map((index) => [
            timing.segEntryVelocityMmPerSec[index],
            timing.segExitVelocityMmPerSec[index],
          ]),
        ).toEqual(Array.from({ length: 4 }, () => [BURN_VELOCITY, BURN_VELOCITY]));

        // Independent v²=2ad check against emitted geometry, rather than the
        // sweep planner's own claimed runway lengths.
        for (const burn of burns) {
          for (const dark of [burn - 1, burn + 1]) {
            expect(model.segPower[dark]).toBe(0);
            expect(model.segFeed[dark]).toBe(BURN_FEED);
            const p = dark * 6;
            const distance = Math.hypot(
              (model.positions[p + 3] ?? 0) - (model.positions[p] ?? 0),
              (model.positions[p + 4] ?? 0) - (model.positions[p + 1] ?? 0),
            );
            expect(distance).toBeGreaterThanOrEqual(REST_DISTANCE);
            expect(distance).toBeLessThanOrEqual(5);
          }
        }

        // The wide gap still contains controlled S0 travel at the profile's
        // configured feed; the fix must not accelerate that mechanical seek.
        const slowGapMoves = Array.from({ length: model.segmentCount }, (_, index) => index)
          .filter((index) => model.segPower[index] === 0 && model.segFeed[index] === 800)
          .filter((index) => model.positions[index * 6 + 1] === model.positions[index * 6 + 4]);
        expect(slowGapMoves).toHaveLength(2);
      },
    );

    it.each([-0.4, 0.4])(
      `${name} preserves signed reverse-row calibration and Frame/preview geometry at offset %s`,
      (offsetMm) => {
        const candidate = { ...group(true), bidirectionalScanOffsetMm: offsetMm };
        const job = { groups: [candidate] };
        const model = emittedModel(candidate);
        const represented = (value: number): number => Number(value.toFixed(3));
        const emitted = Array.from({ length: model.segmentCount }, (_, index) => {
          const base = index * 6;
          return [0, 1, 3, 4].map((axis) => represented(model.positions[base + axis] ?? 0));
        });
        expect(poweredSegments(model).map((index) => emitted[index])).toEqual([
          [10, 0.5, 11, 0.5],
          [26, 0.5, 27, 0.5],
          [27 - offsetMm, 1.5, 26 - offsetMm, 1.5],
          [11 - offsetMm, 1.5, 10 - offsetMm, 1.5],
        ]);

        const preview = buildToolpath(job, { startPoint: { x: 0, y: 0 } });
        const previewMoves = preview.steps.flatMap((step) => {
          if (step.kind === 'travel') {
            return [[step.from.x, step.from.y, step.to.x, step.to.y].map(represented)];
          }
          if (step.kind !== 'cut') return [];
          const from = step.polyline[0];
          const to = step.polyline[1];
          if (from === undefined || to === undefined) throw new Error('Missing burn endpoint');
          return [[from.x, from.y, to.x, to.y].map(represented)];
        });
        expect(previewMoves).toEqual(emitted);

        const bounds = computeFrameJobMotionBounds(job, DEVICE);
        if (bounds === null) throw new Error('Missing Frame motion bounds');
        // Splitting the internal gap differently must not grow the already
        // reviewed outer motion envelope. Image bounds include pixel height.
        expect(bounds).toMatchObject({
          minX: 5 - Math.max(offsetMm, 0),
          maxX: 32 - Math.min(offsetMm, 0),
        });
        for (const [, , x, y] of emitted) {
          expect(x).toBeGreaterThanOrEqual(bounds.minX);
          expect(x).toBeLessThanOrEqual(bounds.maxX);
          expect(y).toBeGreaterThanOrEqual(bounds.minY);
          expect(y).toBeLessThanOrEqual(bounds.maxY);
        }
      },
    );
  }
});
