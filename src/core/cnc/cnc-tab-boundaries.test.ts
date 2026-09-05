import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Polyline,
  type Scene,
} from '../scene';
import { tabRampedPoints } from './cnc-tab-ramp';
import { compileCncJob } from './compile-cnc-job';

const COLOR = '#ff0000';
const TAB_TOP = -4;

function square(size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: 0, y: 0 },
      { x: size, y: 0 },
      { x: size, y: size },
      { x: 0, y: size },
    ],
  };
}

function tabbedJob(size: number, tabWidthMm: number, pathT?: number) {
  const scene: Scene = {
    layers: [
      {
        ...createLayer({ id: 'layer', color: COLOR }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'profile-on-path',
          depthMm: 6,
          depthPerPassMm: 2,
          tabsEnabled: true,
          tabHeightMm: 2,
          tabWidthMm,
          tabsPerShape: 1,
        },
      },
    ],
    objects: [
      {
        kind: 'imported-svg',
        id: 'part',
        source: 'square.svg',
        bounds: { minX: 0, minY: 0, maxX: size, maxY: size },
        transform: IDENTITY_TRANSFORM,
        paths: [{ color: COLOR, polylines: [square(size)] }],
        ...(pathT === undefined
          ? {}
          : {
              cncTabAnchors: [{ layerColor: COLOR, pathIndex: 0, polylineIndex: 0, pathT }],
            }),
      },
    ],
  };
  return compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
}

// Inspect emitted absolute G0/G1 coordinates independently of the tab planner.
function emittedMoves(program: string) {
  let head = { x: 0, y: 0, z: 0 };
  return program.split('\n').flatMap((line) => {
    if (!/^G[01]\b/.test(line)) return [];
    const from = head;
    head = { ...from };
    for (const word of line.matchAll(/\b([XYZ])(-?\d+(?:\.\d+)?)/g)) {
      const axis = word[1]?.toLowerCase() as 'x' | 'y' | 'z';
      head[axis] = Number(word[2]);
    }
    return [{ from, to: head }];
  });
}

describe('tab window boundaries through emitted CNC output', () => {
  it.each([28.825, 30, 60])('keeps a %s mm whole-perimeter tab at the tab top', (tabWidthMm) => {
    for (const centers of [undefined, [0.25]]) {
      const points = tabRampedPoints(
        square(8),
        -6,
        TAB_TOP,
        {
          tabWidthMm,
          toolDiameterMm: 3.175,
          tabsPerShape: 1,
        },
        centers,
      );
      expect(points?.length).toBeGreaterThanOrEqual(5);
      expect(points?.every((point) => point.z === TAB_TOP)).toBe(true);
    }
    const job = tabbedJob(8, tabWidthMm);
    const moves = emittedMoves(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE));
    expect(moves.some((move) => move.to.z === TAB_TOP)).toBe(true);
    expect(moves.every((move) => move.to.z >= TAB_TOP)).toBe(true);
  });

  it('does not invent a fully covering tab when manual centers are empty', () => {
    expect(
      tabRampedPoints(
        square(8),
        -6,
        TAB_TOP,
        {
          tabWidthMm: 60,
          toolDiameterMm: 3.175,
          tabsPerShape: 1,
        },
        [],
      ),
    ).toBeNull();
  });

  it.each([0.95, 0.05, 0])('keeps every seam tab wall vertical at anchor %s', (pathT) => {
    // Total window is 4 mm: .95 ends at the seam, .05 begins there, 0 wraps.
    const job = tabbedJob(10, 0.825, pathT);
    const paths = job.groups.flatMap((group) =>
      group.kind === 'cnc'
        ? group.passes.flatMap((pass) => (pass.kind === 'path3d' ? [pass.points] : []))
        : [],
    );
    expect(paths).toHaveLength(1);
    for (const points of paths) {
      expect(points.at(-1)).toEqual(points[0]);
      expect(points.some((point) => point.z === -6)).toBe(true);
      expect(points.some((point) => point.z === TAB_TOP)).toBe(true);
    }
    const moves = emittedMoves(cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE));
    const diagonalDepthChanges = moves.filter(
      ({ from, to }) =>
        from.z < 0 && to.z < 0 && from.z !== to.z && (from.x !== to.x || from.y !== to.y),
    );
    expect(diagonalDepthChanges).toEqual([]);
  });
});
