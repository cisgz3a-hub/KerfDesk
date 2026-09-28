import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { scanGcodeWords } from '../gcode';
import { scanModalMotionLine, type GcodeMotionMode } from '../gcode/modal-motion-line';
import type { Vec3 } from '../geometry/vec3';
import { applyJobOriginOffset, type CncContourPass, type CncGroup, type CncPass } from '../job';
import { cncGrblStrategy } from '../output';
import type { Vec2 } from '../scene';
import { rampContourPass, rampEntryPlungesByLayer } from './contour-ramp-entry';
import { applyRampEntry } from './motion-polish';
import { rampTabbedPath } from './tabbed-ramp-entry';

const ANGLE = 5;
const TANGENT = Math.tan((ANGLE * Math.PI) / 180);
const OFFSETS: readonly Vec2[] = [
  { x: 0, y: 0 },
  { x: 0.0005, y: -0.0005 },
  { x: 20.000499999999, y: 380.0005 },
  { x: -300.1235, y: 133.4565 },
];

function circle(): CncContourPass {
  return {
    kind: 'contour',
    closed: true,
    zMm: -1,
    polyline: Array.from({ length: 64 }, (_, index) => {
      const angle = (index * 2 * Math.PI) / 64;
      return { x: 1.4 * Math.cos(angle), y: 1.4 * Math.sin(angle) };
    }),
  };
}

function line(lengthMm: number): CncContourPass {
  return {
    kind: 'contour',
    closed: false,
    zMm: -1,
    polyline: [
      { x: 0, y: 0 },
      { x: lengthMm, y: 0 },
    ],
  };
}

function group(passes: readonly CncPass[]): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'ramp',
    color: '#000000',
    cutType: 'engrave',
    toolDiameterMm: 1,
    rampEntryDeg: ANGLE,
    feedMmPerMin: 1000,
    plungeMmPerMin: 50,
    spindleRpm: 12000,
    spindleSpinupSec: 0,
    safeZMm: 3,
    passes,
  };
}

type Move = { readonly from: Vec3; readonly to: Vec3; readonly feed: number };

// Read the emitted modal program rather than planner coordinates. Compact
// continuation blocks must participate in both the angle and Z-rate checks.
function cuttingMoves(gcode: string): Move[] {
  const moves: Move[] = [];
  let at: Vec3 = { x: 0, y: 0, z: 0 };
  let mode: GcodeMotionMode | null = null;
  let feed = 0;
  for (const raw of gcode.split('\n')) {
    const code = raw.split(';')[0] ?? '';
    const words = scanGcodeWords(code);
    const value = (letter: string): number | undefined =>
      words.find((word) => word.letter === letter)?.value;
    const motion = scanModalMotionLine(code, mode);
    mode = motion.motion;
    feed = value('F') ?? feed;
    if (!motion.isMotion) continue;
    const to = { x: value('X') ?? at.x, y: value('Y') ?? at.y, z: value('Z') ?? at.z };
    if (mode === 1) moves.push({ from: at, to, feed });
    at = to;
  }
  return moves;
}

function assertEmittedRamp(
  passes: readonly CncPass[],
  allowTabWalls = false,
  maximumAngle = ANGLE,
): void {
  for (const offset of OFFSETS) {
    const placed = applyJobOriginOffset(
      { groups: [{ ...group(passes), rampEntryDeg: maximumAngle }] },
      offset,
    );
    const moves = cuttingMoves(cncGrblStrategy.emit(placed, DEFAULT_DEVICE_PROFILE));
    let diagonalDescents = 0;
    let levelCleanup = 0;
    for (const { from, to, feed } of moves) {
      const xy = Math.hypot(to.x - from.x, to.y - from.y);
      const drop = from.z - to.z;
      if (drop > 0 && to.z < 0) {
        expect((feed * drop) / Math.hypot(xy, drop)).toBeLessThanOrEqual(50 + 1e-8);
        if (xy > 0) {
          diagonalDescents += 1;
          expect((Math.atan(drop / xy) * 180) / Math.PI).toBeLessThanOrEqual(maximumAngle + 1e-9);
        } else if (!allowTabWalls) {
          throw new Error('An actual contour ramp emitted a straight descent below stock top.');
        }
      }
      if (xy > 0 && from.z === -1 && to.z === -1) {
        levelCleanup += 1;
        expect(feed).toBe(1000);
      }
    }
    expect(diagonalDescents).toBeGreaterThan(0);
    expect(levelCleanup).toBeGreaterThan(0);
  }
}

describe('contour ramp guarantees in emitted, placed XYZ/F words', () => {
  it.each([
    ['64-vertex 2.8 mm circle', circle()],
    ['30 mm open line', line(30)],
    ['5 mm open line requiring repeated legs', line(5)],
  ] as const)('bounds angle and Z rate while preserving full-feed cleanup: %s', (_, source) => {
    const ramped = rampContourPass(source, 0, TANGENT, 1);
    expect(ramped).toMatchObject({ kind: 'path3d', entryRamp: true, lateralFeed: 'z-rate-capped' });
    if (ramped.kind !== 'path3d') throw new Error('Expected an actual ramp');
    // Every original vertex is still visited at the full intended depth.
    for (const point of source.polyline) {
      expect(ramped.points).toContainEqual({ ...point, z: -1 });
    }
    assertEmittedRamp([ramped]);
  });

  it('bounds a ramp ending at the original ring seam before a stay-down link', () => {
    const source = circle();
    const ramped = rampContourPass(source, 0, TANGENT, 1, true);
    if (ramped.kind !== 'path3d') throw new Error('Expected an actual ramp');
    expect(ramped.points.at(-1)).toEqual({ ...source.polyline[0], z: -1 });
    for (const point of source.polyline) expect(ramped.points).toContainEqual({ ...point, z: -1 });
    assertEmittedRamp([ramped]);
  });

  it('keeps bends and zero-capacity spans on an open path, then cuts every vertex at depth', () => {
    const source: CncContourPass = {
      ...line(5),
      polyline: [
        { x: 0, y: 0 },
        { x: 0.0001, y: 0 },
        { x: 2, y: 1 },
        { x: 5, y: 2 },
      ],
    };
    const ramped = rampContourPass(source, 0, TANGENT, 0);
    if (ramped.kind !== 'path3d') throw new Error('Expected an actual ramp');
    for (const point of source.polyline) expect(ramped.points).toContainEqual({ ...point, z: -1 });
    assertEmittedRamp([ramped]);
  });

  it('keeps a sub-quantum depth change without claiming an emitted ramp', () => {
    const source = { ...line(30), zMm: -0.0004 };
    expect(rampContourPass(source, 0, TANGENT, 0)).toBe(source);
  });

  it('honours a positive angle below the old half-degree minimum', () => {
    const passes = applyRampEntry([line(30)], 0.1, false, 1);
    expect(passes[0]).toMatchObject({
      kind: 'path3d',
      entryRamp: true,
      lateralFeed: 'z-rate-capped',
    });
    assertEmittedRamp(passes, false, 0.1);
  });

  it('discloses a precision fallback without removing any densely spaced source vertices', () => {
    const source: CncContourPass = {
      ...line(1),
      polyline: Array.from({ length: 201 }, (_, index) => ({ x: index * 0.0001, y: 0 })),
    };
    const result = rampContourPass(source, 0, TANGENT, 0);
    expect(result).toEqual({
      ...source,
      entryPlunge: true,
      entryPlungeReason: 'coordinate-precision',
    });
    expect(rampEntryPlungesByLayer({ groups: [group([result])] })).toEqual([
      { layerId: 'ramp', passes: 1, pocket: false, relief: false, coordinatePrecisionPasses: 1 },
    ]);
  });

  it('preserves raised tab walls and a complete final ring while capping entry motion', () => {
    const source = {
      kind: 'path3d' as const,
      closed: false,
      points: [
        { x: 0, y: 0, z: -0.3 },
        { x: 2, y: 0, z: -0.3 },
        { x: 2, y: 0, z: -1 },
        { x: 5, y: 0, z: -1 },
        { x: 5, y: 5, z: -1 },
        { x: 0, y: 5, z: -1 },
        { x: 0, y: 0, z: -1 },
        { x: 0, y: 0, z: -0.3 },
      ],
    };
    const ramped = rampTabbedPath(source, 0, TANGENT);
    expect(ramped).toMatchObject({ entryRamp: true, lateralFeed: 'z-rate-capped' });
    const cleanup = ramped.points.slice(ramped.points.findIndex((point) => point.z === -1));
    for (const point of source.points) expect(cleanup).toContainEqual(point);
    // Vertical tab walls are intentional; their feed remains the plunge feed.
    assertEmittedRamp([ramped], true);
  });
});
