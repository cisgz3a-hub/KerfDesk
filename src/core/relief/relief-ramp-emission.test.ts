import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { scanGcodeWords } from '../gcode';
import { scanModalMotionLine, type GcodeMotionMode } from '../gcode/modal-motion-line';
import { applyJobOriginOffset, type CncGroup, type CncPass } from '../job';
import { cncGrblStrategy } from '../output';
import type { Polyline, Vec2 } from '../scene';
import { reliefRoughingMotion, type ReliefRoughingLevelPaths } from './relief-roughing-motion';

const circle: Polyline = {
  closed: true,
  points: Array.from({ length: 64 }, (_, index) => ({
    x: 1.4 * Math.cos((index * 2 * Math.PI) / 64),
    y: 1.4 * Math.sin((index * 2 * Math.PI) / 64),
  })),
};
const square: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ],
};

function level(path: Polyline): ReliefRoughingLevelPaths {
  return {
    zMm: -1,
    sliceTopMm: 0,
    region: [path],
    linkRegion: [path],
    rings: [[path]],
    cleanup: [],
    cleanupStockInside: [],
  };
}

function emit(passes: ReadonlyArray<CncPass>, angle: number, place: (p: Vec2) => Vec2): string {
  const group: CncGroup = {
    kind: 'cnc',
    layerId: 'relief',
    color: '#ff0000',
    cutType: 'relief-rough',
    toolDiameterMm: 1,
    feedMmPerMin: 1000,
    plungeMmPerMin: 50,
    spindleRpm: 12000,
    spindleSpinupSec: 0,
    safeZMm: 3,
    rampEntryDeg: angle,
    passes: passes.map((pass) =>
      pass.kind === 'contour'
        ? { ...pass, polyline: pass.polyline.map(place) }
        : pass.kind === 'path3d'
          ? { ...pass, points: pass.points.map((p) => ({ ...place(p), z: p.z })) }
          : pass,
    ),
  };
  return cncGrblStrategy.emit(
    applyJobOriginOffset({ groups: [group] }, { x: 0.0005, y: -0.0005 }),
    DEFAULT_DEVICE_PROFILE,
  );
}

function assertEntry(output: string, angle: number): void {
  let mode: GcodeMotionMode | null = null;
  let at = { x: 0, y: 0, z: 0 };
  let feed = 0;
  let descents = 0;
  for (const raw of output.split('\n')) {
    const line = raw.split(';')[0] ?? '';
    const words = scanGcodeWords(line);
    const value = (letter: string): number | undefined =>
      words.find((word) => word.letter === letter)?.value;
    const motion = scanModalMotionLine(line, mode);
    mode = motion.motion;
    feed = value('F') ?? feed;
    if (!motion.isMotion) continue;
    const next = { x: value('X') ?? at.x, y: value('Y') ?? at.y, z: value('Z') ?? at.z };
    if (mode === 1 && next.z < at.z && next.z < 0) {
      const xy = Math.hypot(next.x - at.x, next.y - at.y);
      expect(xy).toBeGreaterThan(0);
      expect((Math.atan2(at.z - next.z, xy) * 180) / Math.PI).toBeLessThanOrEqual(angle + 1e-9);
      expect((feed * (at.z - next.z)) / Math.hypot(xy, at.z - next.z)).toBeLessThanOrEqual(
        50 + 1e-8,
      );
      descents += 1;
    }
    at = next;
  }
  expect(descents).toBeGreaterThan(0);
}

describe('relief ramp after machine-space placement and G-code formatting', () => {
  it.each([
    { name: 'dense circle', path: circle, angle: 5, rotation: 0 },
    { name: 'rotated dense circle', path: circle, angle: 5, rotation: 0.37 },
    { name: 'requested shallow entry', path: square, angle: 0.1, rotation: 0.37 },
  ])('honours $name without removing floor vertices', ({ path, angle, rotation }) => {
    const place = (p: Vec2): Vec2 => ({
      x: 20.0005 + Math.cos(rotation) * p.x - Math.sin(rotation) * p.y,
      y: 380.0005 + Math.sin(rotation) * p.x + Math.cos(rotation) * p.y,
    });
    const passes = reliefRoughingMotion([level(path)], {
      stockOnRight: true,
      cutWidthMm: 1,
      rampAngleDeg: angle,
      rampOutputPoint: place,
    });
    expect(passes).toHaveLength(1);
    const pass = passes[0];
    if (pass?.kind !== 'path3d') throw new Error('Expected ramped relief');
    expect(pass.entryRamp).toBe(true);
    for (const point of path.points) expect(pass.points).toContainEqual({ ...point, z: -1 });
    assertEntry(emit(passes, angle, place), angle);
  });

  it('discloses a precision fallback while retaining the complete relief contour', () => {
    const passes = reliefRoughingMotion([level(circle)], {
      stockOnRight: true,
      cutWidthMm: 1,
      rampAngleDeg: 0.0001,
    });
    expect(passes[0]).toMatchObject({
      kind: 'contour',
      entryPlunge: true,
      entryPlungeReason: 'coordinate-precision',
    });
    const output = emit(passes, 0.0001, (p) => p);
    expect(output).toContain('requested-max-angle-deg: 0.0001');
    expect(output).toContain('ramp angle cannot descend at coordinate precision');
  });
});
