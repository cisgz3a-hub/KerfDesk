import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { buildGcodeRenderModel } from '../gcode-view';
import { grblStrategy } from '../output/grbl-strategy';
import type { FillGroup, RasterGroup } from './job';
import { computeFrameJobMotionBounds } from './job-bounds';
import { buildToolpath } from './toolpath';

const ROW = [500, 0, 0, 0, 0, 0, 0, 500];
const PIXEL_WIDTH = 0.837125;
const DEVICE = NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE;

function image(pixelWidth = PIXEL_WIDTH, offset = 0): RasterGroup {
  return {
    kind: 'raster',
    layerId: 'grid-image',
    color: '#000',
    power: 50,
    speed: 1500,
    passes: 1,
    airAssist: false,
    overscanMm: 5,
    dotWidthCorrectionMm: 0,
    bounds: { minX: 0, minY: 0, maxX: 8 * pixelWidth, maxY: 2 },
    pixelWidth: 8,
    pixelHeight: 2,
    sValues: new Uint16Array([...ROW, ...ROW]),
    bidirectional: true,
    bidirectionalScanOffsetMm: offset,
  };
}

function fill(angleDegrees: number, offset: number, pixelWidth = PIXEL_WIDTH): FillGroup {
  const angle = (angleDegrees * Math.PI) / 180;
  const point = (along: number, across: number) => ({
    x: along * Math.cos(angle) - across * Math.sin(angle),
    y: along * Math.sin(angle) + across * Math.cos(angle),
  });
  return {
    kind: 'fill',
    layerId: 'grid-fill',
    color: '#000',
    power: 50,
    speed: 1500,
    passes: 1,
    airAssist: false,
    overscanMm: 5,
    fillRunwayPolicy: 'feed-matched-entry',
    bidirectionalScanOffsetMm: offset,
    segments: [false, true].flatMap((reverse, row) =>
      [0, 7].map((first) => {
        const endpoints = [
          point(first * pixelWidth, row + 0.5),
          point((first + 1) * pixelWidth, row + 0.5),
        ];
        return { polyline: reverse ? endpoints.reverse() : endpoints, closed: false, reverse };
      }),
    ),
  };
}

function represented(value: number): number {
  const rounded = Number(value.toFixed(3));
  // Both signed zero spellings are the same controller position. Vitest's
  // deep equality distinguishes them even though no motion distinguishes them.
  return rounded === 0 ? 0 : rounded;
}

type EmittedMove = { readonly xy: ReadonlyArray<number>; readonly power: number | undefined };

function emittedMoves(group: FillGroup | RasterGroup) {
  const job = { groups: [group] };
  const output = grblStrategy.emit(job, DEVICE, { finishPosition: null });
  const result = buildGcodeRenderModel(output, { machineKind: 'laser' });
  if (result.kind !== 'ok') throw new Error(result.reason);
  const model = result.model;
  const moves = Array.from({ length: model.segmentCount }, (_, index) => {
    const p = index * 6;
    return {
      xy: [0, 1, 3, 4].map((axis) => represented(model.positions[p + axis] ?? 0)),
      power: model.segPower[index],
    };
  });
  return { output, moves };
}

function inspect(group: FillGroup | RasterGroup, angleDegrees = 0) {
  const { output, moves } = emittedMoves(group);
  // Every real motion in these fixtures is >= 0.8 mm. Separate floating-point
  // +/- runway expansions must not manufacture a 0.001 mm reposition at the
  // shared midpoint (3.3485 versus 3.3484999999999996 in the Image regression).
  expect(
    moves.filter(
      ({ xy: [x0 = 0, y0 = 0, x1 = 0, y1 = 0] }) => Math.hypot(x1 - x0, y1 - y0) < 0.002,
    ),
    output,
  ).toEqual([]);

  assertMonotonicRows(group, moves, angleDegrees);
  assertPreviewAndFrame(group, moves);
  return moves.filter(({ power }) => (power ?? 0) > 0).map(({ xy }) => xy);
}

function assertMonotonicRows(
  group: FillGroup | RasterGroup,
  moves: ReadonlyArray<EmittedMove>,
  angleDegrees: number,
): void {
  const angle = (angleDegrees * Math.PI) / 180;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  for (const {
    xy: [x0 = 0, y0 = 0, x1 = 0, y1 = 0],
  } of moves) {
    const across0 = -x0 * uy + y0 * ux;
    const across1 = -x1 * uy + y1 * ux;
    for (const row of [0, 1]) {
      const across = row + 0.5 + (group.kind === 'raster' ? group.bounds.minY : 0);
      if (Math.abs(across0 - across) > 0.001 || Math.abs(across1 - across) > 0.001) continue;
      expect(((x1 - x0) * ux + (y1 - y0) * uy) * (row === 0 ? 1 : -1)).toBeGreaterThanOrEqual(0);
    }
  }
}

function assertPreviewAndFrame(
  group: FillGroup | RasterGroup,
  moves: ReadonlyArray<EmittedMove>,
): void {
  const job = { groups: [group] };
  const preview = buildToolpath(job, { startPoint: { x: 0, y: 0 } });
  expect(
    preview.steps.map((step) => {
      if (step.kind === 'travel') {
        return [step.from.x, step.from.y, step.to.x, step.to.y].map(represented);
      }
      if (step.kind !== 'cut') throw new Error('Unexpected vertical step');
      const [from, to] = step.polyline;
      if (from === undefined || to === undefined) throw new Error('Missing burn endpoints');
      return [from.x, from.y, to.x, to.y].map(represented);
    }),
  ).toEqual(moves.map(({ xy }) => xy));

  const bounds = computeFrameJobMotionBounds(job, DEVICE);
  if (bounds === null) throw new Error('Missing Frame bounds');
  for (const {
    xy: [, , x = 0, y = 0],
  } of moves) {
    expect(x).toBeGreaterThanOrEqual(represented(bounds.minX));
    expect(x).toBeLessThanOrEqual(represented(bounds.maxX));
    expect(y).toBeGreaterThanOrEqual(represented(bounds.minY));
    expect(y).toBeLessThanOrEqual(represented(bounds.maxY));
  }
}

describe('shared split runway endpoints on the controller grid', () => {
  it.each([-0.4, 0, 0.4])(
    'keeps both Image rows monotonic at a half-grid tie, offset=%s',
    (offset) => {
      expect(inspect(image(PIXEL_WIDTH, offset))).toEqual([
        [0, 0.5, 0.837, 0.5],
        [5.86, 0.5, 6.697, 0.5],
        [represented(6.697 - offset), 1.5, represented(7 * PIXEL_WIDTH - offset), 1.5],
        [represented(PIXEL_WIDTH - offset), 1.5, represented(-offset), 1.5],
      ]);
    },
  );

  it.each([0, 37, 90, 137])(
    'keeps reversed Fill and signed offsets monotonic at %s degrees',
    (angle) => {
      for (const offset of [-0.4, 0, 0.4])
        expect(inspect(fill(angle, offset), angle)).toHaveLength(4);
    },
  );

  it('keeps translated Image joints shared with signed offset and dot-width correction', () => {
    const candidate: RasterGroup = {
      ...image(PIXEL_WIDTH, -0.4),
      bounds: { minX: 13.4565, minY: 8.75, maxX: 13.4565 + 8 * PIXEL_WIDTH, maxY: 10.75 },
      dotWidthCorrectionMm: 0.06,
    };
    expect(inspect(candidate)).toHaveLength(4);
  });

  it('keeps the transition to separate runways monotonic at neighbouring 10 mm gaps', () => {
    // A positive remainder may legitimately become a short forward seek. It
    // must never become a backwards move as joins switch to separate runways.
    for (const neighbour of [-1, 0, 1]) {
      const pixelWidth = (10 + neighbour * Number.EPSILON * 8) / 6;
      for (const offset of [-0.4, 0, 0.4]) {
        for (const origin of [0, 13.4565]) {
          const candidate: RasterGroup = {
            ...image(pixelWidth, offset),
            bounds: { minX: origin, minY: 8.75, maxX: origin + 8 * pixelWidth, maxY: 10.75 },
          };
          assertMonotonicRows(candidate, emittedMoves(candidate).moves, 0);
        }
        for (const angle of [0, 37, 90, 137]) {
          const candidate = fill(angle, offset, pixelWidth);
          assertMonotonicRows(candidate, emittedMoves(candidate).moves, angle);
        }
      }
    }
  });

  it('keeps Image split joints coincident across half-thousandth boundary cases', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        (index, offset) => {
          inspect(image(0.834125 + index * 0.00025, offset / 1000));
        },
      ),
      { numRuns: 100, examples: [[2, 835]] },
    );
  });
});
