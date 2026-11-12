// K40 (Lihuiyu) Fill, Image and rotary motion (ADR-703 Amendment 1, code
// quality audit C2 D6-P1-2 and D6-P1-3): Fill sweeps and Image rows come from
// the G-code planners, so they carry the bidirectional scan offset, the
// overscan runway and Dot width correction, and a Y-port rotary sets each
// stroke's speed for the part's surface. Read back with the simulator's decoder.

import { describe, expect, it } from 'vitest';
import {
  joinCollinear,
  LhyDecoder,
  type LhyDecodedMove,
} from '../../../__fixtures__/controllers/lihuiyu-decoder';
import { rotaryFeedMatchFor } from '../../output/rotary-surface-feed';
import type { CutGroup, FillGroup, Job, RasterGroup } from '../../job';
import { encodeLhyJob, lhyBoardSetting, type LhyEncodeOptions } from './lhy-encoder';
import { mmToLhySteps } from './lhy-motion-plan';

const M2: LhyEncodeOptions = { board: lhyBoardSetting('M2'), fullPowerPerMille: 1000 };

type Burn = readonly [number, number, number];

function encode(job: Job, options: Partial<LhyEncodeOptions> = {}) {
  const encoded = encodeLhyJob(job, { ...M2, ...options });
  if (!encoded.ok) throw new Error(encoded.error.kind);
  const decoder = new LhyDecoder();
  decoder.writeStream(encoded.stream);
  return { encoded, decoder };
}

/** Each burn as [from x, to x, y] in board steps. */
function burns(job: Job, options: Partial<LhyEncodeOptions> = {}): Burn[] {
  const moves: ReadonlyArray<LhyDecodedMove> = joinCollinear(encode(job, options).decoder.moves);
  return moves.filter((move) => move.laser).map((move) => [move.from.x, move.to.x, move.to.y]);
}

const s = mmToLhySteps;

// Two 20 mm hatch lines, 1 mm apart, the second burned right to left.
function fill(overrides: Partial<FillGroup> = {}): Job {
  const group: FillGroup = {
    kind: 'fill',
    layerId: 'F',
    color: '#00f',
    power: 40,
    speed: 3000,
    passes: 1,
    airAssist: false,
    overscanMm: 0,
    segments: [
      {
        polyline: [
          { x: 50, y: 10 },
          { x: 70, y: 10 },
        ],
        closed: false,
        reverse: false,
      },
      {
        polyline: [
          { x: 70, y: 11 },
          { x: 50, y: 11 },
        ],
        closed: false,
        reverse: true,
      },
    ],
    ...overrides,
  };
  return { groups: [group] };
}

// Two rows of 4 one-millimetre pixels at X 10..14 mm; pixels 1-2 are dark, so
// the art spans X 11..13 mm on both rows.
function raster(overrides: Partial<RasterGroup> = {}): Job {
  const group: RasterGroup = {
    kind: 'raster',
    layerId: 'R',
    color: '#000',
    power: 100,
    speed: 6000,
    passes: 1,
    airAssist: false,
    sValues: Uint16Array.from([0, 1000, 1000, 0, 0, 1000, 1000, 0]),
    pixelWidth: 4,
    pixelHeight: 2,
    bounds: { minX: 10, minY: 10, maxX: 14, maxY: 12 },
    overscanMm: 2,
    dotWidthCorrectionMm: 0,
    ...overrides,
  };
  return { groups: [group] };
}

describe('K40 Fill sweeps', () => {
  it('burns each hatch line where it is drawn without a scan offset', () => {
    expect(burns(fill())).toEqual([
      [s(50), s(70), s(10)],
      [s(70), s(50), s(11)],
    ]);
  });

  // planFillSweeps moves every sweep half the offset along its own travel
  // (ADR-052 Amendment 2), so the two directions meet.
  it('moves each sweep half the layer scan offset, else the machine table', () => {
    const fromLayer = burns(fill({ bidirectionalScanOffsetMm: 0.4 }));
    expect(fromLayer).toEqual([
      [s(50.2), s(70.2), s(10)],
      [s(69.8), s(49.8), s(11)],
    ]);
    const table = [{ speedMmPerMin: 3000, offsetMm: 0.4 }];
    expect(burns(fill(), { scanningOffsets: table })).toEqual(fromLayer);
  });
});

describe('K40 Image rows', () => {
  it('runs the overscan laser-off and burns only the dark pixels, both ways', () => {
    expect(burns(raster())).toEqual([
      [s(11), s(13), s(10.5)],
      [s(13), s(11), s(11.5)],
    ]);
    const { decoder } = encode(raster());
    const first = decoder.moves.find((move) => move.program);
    expect(first?.from.x).toBe(s(9));
  });

  it('shortens each burn by the Dot width correction', () => {
    for (const [from, to] of burns(raster({ dotWidthCorrectionMm: 0.2 }))) {
      expect(Math.min(from, to)).toBeGreaterThanOrEqual(s(11));
      expect(Math.max(from, to)).toBeLessThanOrEqual(s(13));
      expect(Math.abs(Math.abs(to - from) - s(1.6))).toBeLessThanOrEqual(1);
    }
  });

  it('moves each row half the layer scan offset, else the machine table', () => {
    const fromLayer = burns(raster({ bidirectionalScanOffsetMm: 0.3 }));
    expect(fromLayer).toEqual([
      [s(11.15), s(13.15), s(10.5)],
      [s(12.85), s(10.85), s(11.5)],
    ]);
    const table = [{ speedMmPerMin: 6000, offsetMm: 0.3 }];
    expect(burns(raster(), { scanningOffsets: table })).toEqual(fromLayer);
  });
});

describe('K40 Y-port rotary', () => {
  // A 20 x 10 mm surface rectangle round a part with k = 2: the X edges move
  // the surface at the machine speed, the Y edges move the head twice as far.
  function rotaryJob(k: number): Job {
    const rectangle: CutGroup = {
      kind: 'cut',
      layerId: 'L1',
      color: '#f00',
      power: 50,
      speed: 1500,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 10 },
            { x: 30, y: 10 },
            { x: 30, y: 10 + 10 * k },
            { x: 10, y: 10 + 10 * k },
            { x: 10, y: 10 },
          ],
          closed: true,
        },
      ],
    };
    return { groups: [rectangle], rotarySurfaceYScale: k };
  }

  it('sets each stroke speed for the surface and counts the stops', () => {
    const job = rotaryJob(2);
    const rotaryFeed = rotaryFeedMatchFor(job, 30000);
    expect(rotaryFeed).toBeDefined();
    const { encoded, decoder } = encode(job, rotaryFeed === undefined ? {} : { rotaryFeed });
    // 25 mm/s along X, 50 mm/s along Y: each corner between them changes speed.
    expect(new Set(decoder.speedCodes).size).toBe(2);
    expect(encoded.rotarySpeedChanges).toEqual([{ layerId: 'L1', count: 3 }]);
  });

  it('keeps one speed per layer without a rotary', () => {
    const { encoded, decoder } = encode(rotaryJob(1));
    expect(new Set(decoder.speedCodes).size).toBe(1);
    expect(encoded.rotarySpeedChanges).toEqual([]);
  });
});
