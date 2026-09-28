// CW-02: a 2D pass gets an air floor only when every segment of it lies on
// the path of an earlier pass of its group; the floor is that pass's highest Z.
import { describe, expect, it } from 'vitest';
import { sampleCircularArcPoints } from '../geometry/circular-arc';
import type { CncArcPass, CncContourPass, CncPass, CncPath3dPass } from '../job';
import type { Vec2 } from '../scene';
import { withPassAirFloors } from './cnc-pass-air-floors';

const SQUARE: Vec2[] = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 20 },
  { x: 0, y: 20 },
];

function ring(zMm: number, polyline: Vec2[] = SQUARE): CncContourPass {
  return { kind: 'contour', zMm, polyline, closed: true };
}

function floors(passes: ReadonlyArray<CncPass>): Array<number | undefined> {
  return withPassAirFloors(passes).map((pass) =>
    pass.kind === 'helical-contour' ? undefined : pass.airFloorZMm,
  );
}

describe('withPassAirFloors', () => {
  it('floors each depth of a path at the depth before it, and not the first', () => {
    expect(floors([ring(-3), ring(-6), ring(-9)])).toEqual([undefined, -3, -6]);
  });

  it('returns the same array when no pass retraces an earlier one', () => {
    const passes = [
      ring(-3),
      ring(
        -3,
        SQUARE.map((p) => ({ x: p.x + 30, y: p.y })),
      ),
    ];
    expect(withPassAirFloors(passes)).toBe(passes);
  });

  it('declines a restarted or subdivided ring until final represented coverage is known', () => {
    // Re-started mid-side, as a stay-down link or a cut direction leaves it.
    const rotated: Vec2[] = [
      { x: 20, y: 7 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ];
    expect(floors([ring(-3), ring(-6, rotated)])).toEqual([undefined, undefined]);
  });

  it('gives no floor to a pass that leaves the earlier path, even by a lead', () => {
    const led: CncContourPass = {
      kind: 'contour',
      zMm: -6,
      closed: false,
      polyline: [{ x: -2, y: -2 }, ...SQUARE, { x: 0, y: 0 }],
    };
    expect(floors([ring(-3), led])).toEqual([undefined, undefined]);
  });

  it('gives no floor to a pass longer than the earlier one on the same line', () => {
    const short: CncContourPass = {
      kind: 'contour',
      zMm: -2,
      closed: false,
      polyline: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    };
    const long: CncContourPass = {
      ...short,
      zMm: -4,
      polyline: [
        { x: 0, y: 0 },
        { x: 12, y: 0 },
      ],
    };
    expect(floors([short, long])).toEqual([undefined, undefined]);
  });

  it('floors under the highest point an earlier tabbed pass left', () => {
    const tabbed: CncPath3dPass = {
      kind: 'path3d',
      closed: false,
      points: [
        { x: 0, y: 0, z: -9 },
        { x: 8, y: 0, z: -9 },
        { x: 9, y: 0, z: -7 },
        { x: 11, y: 0, z: -7 },
        { x: 12, y: 0, z: -9 },
        { x: 20, y: 0, z: -9 },
      ],
    };
    const next: CncContourPass = {
      kind: 'contour',
      zMm: -12,
      closed: false,
      polyline: [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
      ],
    };
    expect(floors([tabbed, next])).toEqual([undefined, undefined]);
    const repeated: CncPath3dPass = {
      ...tabbed,
      points: tabbed.points.map((p) => ({ ...p, z: -12 })),
    };
    expect(floors([tabbed, repeated])).toEqual([undefined, -7]);
  });

  it('takes the lowest of several earlier passes that cover the path', () => {
    expect(floors([ring(-2), ring(-4), ring(-6)])[2]).toBe(-4);
  });

  it('floors a Z-only pass only where an earlier pass reached its point', () => {
    const peck = (x: number, z: number): CncPath3dPass => ({
      kind: 'path3d',
      closed: false,
      points: [
        { x, y: 0, z },
        { x, y: 0, z: z - 2 },
      ],
    });
    expect(floors([ring(-3), peck(5, -3), peck(25, -3)])).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(floors([peck(5, -3), peck(5, -5)])).toEqual([undefined, -3]);
  });

  it('floors identical arc commands but declines different sweeps', () => {
    const arc = (zMm: number, end: { x: number; y: number }): CncArcPass => ({
      kind: 'arc',
      start: { x: 10, y: 0 },
      end,
      center: { x: 0, y: 0 },
      clockwise: false,
      zMm,
      closed: false,
    });
    const half = arc(-3, { x: -10, y: 0 });
    expect(floors([half, arc(-6, { x: -10, y: 0 })])).toEqual([undefined, -3]);
    expect(floors([half, arc(-6, { x: 0, y: 10 })])).toEqual([undefined, undefined]);
    expect(floors([half, arc(-6, { x: 0, y: -10 })])).toEqual([undefined, undefined]);
  });

  it("gives no floor to straight moves along an earlier arc's chords", () => {
    // G2/G3 follows the circle; the chords between its samples were never cut.
    const arc: CncArcPass = {
      kind: 'arc',
      start: { x: 10, y: 0 },
      end: { x: -10, y: 0 },
      center: { x: 0, y: 0 },
      clockwise: false,
      zMm: -3,
      closed: false,
    };
    const chords: CncContourPass = {
      kind: 'contour',
      zMm: -6,
      closed: false,
      polyline: sampleCircularArcPoints(arc),
    };
    expect(floors([arc, chords])).toEqual([undefined, undefined]);
  });

  it('declines cross-primitive credit from arcs and helices', () => {
    const arc: CncArcPass = {
      kind: 'arc',
      start: { x: 10, y: 0 },
      end: { x: -10, y: 0 },
      center: { x: 0, y: 0 },
      clockwise: false,
      zMm: -3,
      closed: false,
    };
    const peck: CncPath3dPass = {
      kind: 'path3d',
      closed: false,
      points: [
        { x: 0, y: 10, z: -3 },
        { x: 0, y: 10, z: -5 },
      ],
    };
    expect(floors([arc, peck])).toEqual([undefined, undefined]);
    const helix: CncPass = {
      kind: 'helical-contour',
      start: { x: 12, y: 10 },
      center: { x: 10, y: 10 },
      clockwise: true,
      startZMm: 0,
      zMm: -3,
      revolutions: 2,
      polyline: SQUARE,
      closed: true,
    };
    expect(floors([helix, ring(-6)])).toEqual([undefined, undefined]);
  });

  it('leaves stay-down links, linked rings and existing floors alone', () => {
    const link: CncPath3dPass = {
      kind: 'path3d',
      closed: false,
      lateralFeed: 'plunge',
      stayDownLink: true,
      points: [
        { x: 0, y: 0, z: -6 },
        { x: 20, y: 0, z: -6 },
      ],
    };
    const linked: CncContourPass = { ...ring(-6), stayDownEntry: true };
    const floored: CncContourPass = { ...ring(-6), airFloorZMm: -1 };
    expect(floors([ring(-3), link, linked, floored])).toEqual([
      undefined,
      undefined,
      undefined,
      -1,
    ]);
  });
});
