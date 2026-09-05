import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { buildOffsetLadder } from '../geometry/offset-ladder';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Polyline,
  type Vec2,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';
import { pocketRingToolpaths } from './pocket-paths';

const TOOL = 3.175;
const RADIUS = TOOL / 2;
const SMALL = 8.175;
const CENTER = { x: SMALL / 2, y: SMALL / 2 };
const COLOR = '#ff0000';

function square(x: number, y: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

function dumbbell(neckWidth: number): Polyline {
  const lower = CENTER.y - neckWidth / 2;
  const upper = CENTER.y + neckWidth / 2;
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: SMALL, y: 0 },
      { x: SMALL, y: lower },
      { x: 30, y: lower },
      { x: 30, y: CENTER.y - 12.5 },
      { x: 55, y: CENTER.y - 12.5 },
      { x: 55, y: CENTER.y + 12.5 },
      { x: 30, y: CENTER.y + 12.5 },
      { x: 30, y: upper },
      { x: SMALL, y: upper },
      { x: SMALL, y: SMALL },
      { x: 0, y: SMALL },
    ],
  };
}

// Independent cutter-sweep distance, including closed-loop edges.
function nearestCut(point: Vec2, paths: ReadonlyArray<Polyline>): number {
  let nearest = Infinity;
  for (const path of paths) {
    const edgeCount = path.closed ? path.points.length : path.points.length - 1;
    for (let i = 0; i < edgeCount; i += 1) {
      const a = path.points[i]!;
      const b = path.points[(i + 1) % path.points.length]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lengthSq = dx * dx + dy * dy;
      const t =
        lengthSq === 0
          ? 0
          : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
      nearest = Math.min(nearest, Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy));
    }
  }
  return nearest;
}

function expectSmallCoreCleared(paths: ReadonlyArray<Polyline>, machine = false): void {
  for (let x = CENTER.x - 0.75; x <= CENTER.x + 0.75; x += 0.25) {
    for (let y = CENTER.y - 0.75; y <= CENTER.y + 0.75; y += 0.25) {
      expect(nearestCut({ x, y: machine ? 400 - y : y }, paths)).toBeLessThanOrEqual(RADIUS);
    }
  }
}

function sourceObject(id: string, polylines: ReadonlyArray<Polyline>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: 'pockets.svg',
    bounds: { minX: 0, minY: 0, maxX: 60, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: COLOR, polylines }],
  };
}

// Independently read the emitted absolute G0/G1 path at the pocket floor.
function emittedFloorPaths(program: string): ReadonlyArray<Polyline> {
  let head = { x: 0, y: 0, z: 0 };
  return program.split('\n').flatMap((line) => {
    if (!/^G[01]\b/.test(line)) return [];
    const from = head;
    head = { ...from };
    for (const word of line.matchAll(/\b([XYZ])(-?\d+(?:\.\d+)?)/g)) {
      head[word[1]?.toLowerCase() as 'x' | 'y' | 'z'] = Number(word[2]);
    }
    return line.startsWith('G1 ') && from.z === -1 && head.z === -1
      ? [{ closed: false, points: [from, head] }]
      : [];
  });
}

describe('pocket clearing across shrinking components', () => {
  it("retains each component's central cleanup at operator stepovers above one diameter", () => {
    const small = square(0, 0, 15);
    const center = { x: 7.5, y: 7.5 };
    const alone = pocketRingToolpaths([small], TOOL, 200);
    const together = pocketRingToolpaths([small, square(30, 0, 50)], TOOL, 200);
    expect(nearestCut(center, alone.toolpaths)).toBeLessThanOrEqual(RADIUS);
    expect(nearestCut(center, together.toolpaths)).toBeLessThanOrEqual(RADIUS);
  });

  it('keeps a smaller pocket cleared when a larger pocket is added', () => {
    const small = square(0, 0, SMALL);
    expectSmallCoreCleared(pocketRingToolpaths([small], TOOL, 85).toolpaths);
    const together = pocketRingToolpaths([small, square(30, 0, 25)], TOOL, 85);
    expect(together.offsetFailed).toBe(false);
    expect(together.passLimited).toBe(false);
    expectSmallCoreCleared(together.toolpaths);
  });

  it.each([2, 6, 6.36])('clears a lobe split across a %s mm neck', (width) => {
    const paths = pocketRingToolpaths([dumbbell(width)], TOOL, 85);
    expect(paths.offsetFailed).toBe(false);
    expectSmallCoreCleared(paths.toolpaths);
  });

  it('clears local material around an island without sweeping into it', () => {
    const contours = [square(0, 0, 16.35), square(7, 7, 2.35), square(30, 0, 35)];
    const paths = pocketRingToolpaths(contours, TOOL, 85).toolpaths;
    for (const point of [
      { x: 3.5, y: 8 },
      { x: 12.85, y: 8 },
      { x: 8, y: 3.5 },
      { x: 8, y: 12.85 },
    ]) {
      expect(nearestCut(point, paths)).toBeLessThanOrEqual(RADIUS);
    }
    for (let x = 7; x <= 9.35; x += 0.25) {
      for (let y = 7; y <= 9.35; y += 0.25) {
        expect(nearestCut({ x, y }, paths)).toBeGreaterThanOrEqual(RADIUS - 0.002);
      }
    }
  });

  it('preserves every regular stepover ring in its original order', () => {
    const contours = [square(0, 0, SMALL), square(30, 0, 25)];
    const ladder = buildOffsetLadder(contours, 4096, (k) => RADIUS + k * TOOL * 0.85);
    const regular = [...ladder.rings].reverse().flat();
    const result = pocketRingToolpaths(contours, TOOL, 85);
    expect(result.toolpaths.slice(-regular.length)).toEqual(regular);
  });

  it.each([false, true])('clears compiled/emitted cores with separate objects = %s', (separate) => {
    const contours = [square(0, 0, SMALL), square(30, 0, 25)];
    const job = compileCncJob(
      {
        layers: [
          {
            ...createLayer({ id: 'pocket', color: COLOR }),
            cnc: {
              ...DEFAULT_CNC_LAYER_SETTINGS,
              cutType: 'pocket',
              pocketStrategy: 'offset',
              depthMm: 1,
              depthPerPassMm: 1,
              stepoverPercent: 85,
            },
          },
        ],
        objects: separate
          ? contours.map((contour, i) => sourceObject(String(i), [contour]))
          : [sourceObject('both', contours)],
      },
      DEFAULT_DEVICE_PROFILE,
      DEFAULT_CNC_MACHINE_CONFIG,
    );
    const compiled = job.groups.flatMap((group) =>
      group.kind === 'cnc'
        ? group.passes.flatMap((pass) =>
            pass.kind === 'contour' ? [{ closed: pass.closed, points: pass.polyline }] : [],
          )
        : [],
    );
    expectSmallCoreCleared(compiled, true);
    expectSmallCoreCleared(
      emittedFloorPaths(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE)),
      true,
    );
  });
});
