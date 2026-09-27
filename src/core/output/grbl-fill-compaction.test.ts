import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import type { FillGroup, FillSegment, Job } from '../job';
import { grblStrategy } from './grbl-strategy';

const SERIAL_BYTES_PER_SECOND = 115_200 / 10;

function fillGroup(
  segments: ReadonlyArray<FillSegment>,
  patch: Partial<FillGroup> = {},
): FillGroup {
  return {
    kind: 'fill',
    layerId: 'dense-fill',
    color: '#000000',
    power: 30,
    speed: 1500,
    passes: 1,
    airAssist: false,
    overscanMm: 5,
    fillRunwayPolicy: 'feed-matched-every-sweep',
    segments,
    ...patch,
  };
}

function denseRows(angleDegrees = 0): ReadonlyArray<FillSegment> {
  const angle = (angleDegrees * Math.PI) / 180;
  const point = (along: number, across: number) => ({
    x: 10 + along * Math.cos(angle) - across * Math.sin(angle),
    y: 12 + along * Math.sin(angle) + across * Math.cos(angle),
  });
  return [false, true].flatMap((reverse, row) =>
    Array.from({ length: 500 }, (_, index): FillSegment => {
      const x = index * 0.08;
      const ends = [point(x, row * 0.1), point(x + 0.04, row * 0.1)];
      return { polyline: reverse ? ends.reverse() : ends, closed: false, reverse };
    }),
  );
}

function emit(job: Job, compact: boolean): string {
  return grblStrategy.emit(
    job,
    DEFAULT_DEVICE_PROFILE,
    compact ? {} : { compactMotionWords: false },
  );
}

type DecodedMove = {
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  readonly motion: number;
  readonly feed: number;
  readonly power: number;
  readonly laserMode: number;
  readonly source: string;
};

type DecoderState = {
  x: number;
  y: number;
  motion: number;
  feed: number;
  power: number;
  laserMode: number;
};

function readWord(state: DecoderState, letter: string, value: number): boolean {
  switch (letter) {
    case 'G':
      if ([0, 1].includes(value)) state.motion = value;
      break;
    case 'M':
      if ([3, 4, 5].includes(value)) state.laserMode = value;
      break;
    case 'F':
      state.feed = value;
      break;
    case 'S':
      state.power = value;
      break;
    case 'X':
      state.x = value;
      return true;
    case 'Y':
      state.y = value;
      return true;
  }
  return false;
}

// Deliberately independent of the production modal reader and motion writer.
// This oracle evaluates the absolute XY subset emitted by these fixtures.
function decode(gcode: string): ReadonlyArray<DecodedMove> {
  const state: DecoderState = { x: 0, y: 0, motion: 0, feed: 0, power: 0, laserMode: 5 };
  const moves: DecodedMove[] = [];
  for (const source of gcode.split('\n')) {
    const words = [...(source.split(';')[0] ?? '').matchAll(/([A-Z])([-+]?(?:\d*\.\d+|\d+))/g)];
    const from = [state.x, state.y] as const;
    let hasAxis = false;
    for (const word of words) {
      if (readWord(state, word[1] ?? '', Number(word[2]))) hasAxis = true;
    }
    if (hasAxis) {
      const { x, y, ...modes } = state;
      moves.push({ from, to: [x, y], ...modes, source });
    }
  }
  return moves;
}

function semantics(gcode: string) {
  return decode(gcode).map(({ source: _source, ...move }) => move);
}

function denseSweepMoves(gcode: string): ReadonlyArray<DecodedMove> {
  return decode(gcode).filter(
    (move) =>
      move.motion === 1 &&
      move.from[1] === move.to[1] &&
      Math.min(move.from[0], move.to[0]) >= 10 &&
      Math.max(move.from[0], move.to[0]) <= 49.96,
  );
}

function deliveryDensity(gcode: string): number {
  const moves = denseSweepMoves(gcode);
  const bytes = moves.reduce((total, move) => total + move.source.trim().length + 1, 0);
  const seconds = moves.reduce(
    (total, move) => total + (Math.abs(move.to[0] - move.from[0]) * 60) / move.feed,
    0,
  );
  expect(moves).toHaveLength(1998);
  return bytes / seconds;
}

describe('compact Fill sweep delivery', () => {
  it('brings a dense 0.04 mm Fill sweep below the 115200-baud delivery budget', () => {
    const job: Job = { groups: [fillGroup(denseRows())] };
    const verboseDensity = deliveryDensity(emit(job, false));
    const compactDensity = deliveryDensity(emit(job, true));

    expect(verboseDensity).toBeGreaterThan(SERIAL_BYTES_PER_SECOND);
    expect(
      compactDensity,
      `compact ${compactDensity}; verbose ${verboseDensity} bytes/s`,
    ).toBeLessThan(SERIAL_BYTES_PER_SECOND);
    expect(compactDensity / verboseDensity).toBeLessThan(0.55);
  });

  it.each([0, 37, 90])('preserves every decoded move at %s degrees in both directions', (angle) => {
    const group = fillGroup(denseRows(angle), { bidirectionalScanOffsetMm: -0.23, passes: 2 });
    const job: Job = { groups: [group] };
    const compact = emit(job, true);
    const verbose = emit(job, false);

    expect(semantics(compact)).toEqual(semantics(verbose));
    const powered = decode(compact).filter((move) => move.power > 0 && move.motion === 1);
    expect(powered).toHaveLength(2000);
    expect(powered.every((move) => move.feed === 1500 && move.laserMode === 4)).toBe(true);
    expect(
      powered.every((move) => move.from[0] !== move.to[0] || move.from[1] !== move.to[1]),
    ).toBe(true);
  });

  it('re-establishes each sweep after mixed laser modes, axes and controlled travel feeds', () => {
    const job: Job = {
      groups: [
        {
          kind: 'cut',
          layerId: 'cut',
          color: '#ff0000',
          power: 60,
          powerMode: 'constant',
          speed: 800,
          passes: 1,
          airAssist: false,
          segments: [
            {
              polyline: [
                { x: 3, y: 2 },
                { x: 4, y: 3 },
              ],
              closed: false,
            },
          ],
        },
        fillGroup(denseRows(37), { speed: 1432.5 }),
        {
          kind: 'raster',
          layerId: 'image',
          color: '#00ff00',
          power: 20,
          speed: 2200,
          passes: 1,
          airAssist: false,
          pixelWidth: 2,
          pixelHeight: 1,
          sValues: new Uint16Array([0, 200]),
          bounds: { minX: 80, minY: 30, maxX: 82, maxY: 31 },
          overscanMm: 5,
          dotWidthCorrectionMm: 0,
        },
        fillGroup(denseRows(90), { speed: 987, power: 42 }),
      ],
    };
    const device = { ...DEFAULT_DEVICE_PROFILE, controlledLaserOffTravelFeedMmPerMin: 800 };
    expect(semantics(grblStrategy.emit(job, device))).toEqual(
      semantics(grblStrategy.emit(job, device, { compactMotionWords: false })),
    );
  });

  it('keeps the existing verbose legacy GRBL dialect unchanged', () => {
    const job: Job = { groups: [fillGroup(denseRows())] };
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      gcodeDialect: { dialectId: 'grbl-compatible' as const },
    };
    const gcode = grblStrategy.emit(job, device);
    expect(gcode).toBe(grblStrategy.emit(job, device, { compactMotionWords: false }));
    expect(gcode).toContain('G1 X10.040 Y12.000 F1500 S300');
    expect(gcode).toContain('G1 X10.080 Y12.000');
  });

  it.each(['fill', 'image'] as const)(
    'reduces 4040 %s wire demand while preserving explicit feed and power',
    (kind) => {
      const group =
        kind === 'fill'
          ? fillGroup(denseRows())
          : {
              kind: 'raster' as const,
              layerId: 'dense-image',
              color: '#000000',
              power: 30,
              speed: 1500,
              passes: 1,
              airAssist: false,
              pixelWidth: 1000,
              pixelHeight: 2,
              sValues: Uint16Array.from({ length: 2000 }, (_, index) =>
                index % 2 === 0 ? 300 : 0,
              ),
              bounds: { minX: 10, minY: 12, maxX: 50, maxY: 12.2 },
              overscanMm: 5,
              dotWidthCorrectionMm: 0,
            };
      const job: Job = { groups: [group] };
      const compact = grblStrategy.emit(job, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
      const verbose = grblStrategy.emit(job, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, {
        compactMotionWords: false,
      });

      expect(semantics(compact)).toEqual(semantics(verbose));
      const compactDensity = deliveryDensity(compact);
      const verboseDensity = deliveryDensity(verbose);
      expect(verboseDensity).toBeGreaterThan(SERIAL_BYTES_PER_SECOND);
      expect(compactDensity).toBeLessThan(SERIAL_BYTES_PER_SECOND);
      expect(compactDensity / verboseDensity).toBeLessThan(0.72);
      for (const move of denseSweepMoves(compact)) {
        expect(move.source).toMatch(/F1500(?:\D|$)/);
        expect(move.source).toMatch(/S(?:300|0)(?:\D|$)/);
      }
    },
  );
});
