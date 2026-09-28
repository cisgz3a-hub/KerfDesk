// CW-02: a 2D pass gets an air floor only when every segment of it lies on
// the path of an earlier pass of its group; the floor is that pass's highest Z.
import { describe, expect, it } from 'vitest';
import type { CncContourPass, CncPass, CncPath3dPass } from '../job';
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

  it('floors a ring that starts elsewhere on the same square', () => {
    // Re-started mid-side, as a stay-down link or a cut direction leaves it.
    const rotated: Vec2[] = [
      { x: 20, y: 7 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ];
    expect(floors([ring(-3), ring(-6, rotated)])).toEqual([undefined, -3]);
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
    expect(floors([tabbed, next])).toEqual([undefined, -7]);
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
    expect(floors([ring(-3), peck(5, -3), peck(25, -3)])).toEqual([undefined, -3, undefined]);
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
