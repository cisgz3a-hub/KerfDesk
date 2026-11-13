// ADR-580 Amendment 2 through the real compiler: a height-map relief is planned
// against the surface through its pixel centres, whatever the CAM cell size, so
// the finishing ball rides a slope where the slope is. Reading each cell at its
// highest pixel lifted it by about half a cell plus half a pixel times the slope.

import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { DEFAULT_DEVICE_PROFILE, toSceneCoords } from '../devices';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type ReliefObject,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';
import { withoutStepDown } from '../relief/relief-step-down.test-support';

const COLOR = '#a0522d';
const WIDTH_MM = 30;
const HEIGHT_MM = 20;
const DEPTH_MM = 6;
// Half-millimetre pixels: coarser than the finishing cells, so the old
// highest-pixel cells stood well off the slope.
const PIXEL_MM = 0.5;
// The ramp rises DEPTH_MM over WIDTH_MM along the relief's X.
const SLOPE = DEPTH_MM / WIDTH_MM;
// One 16-bit code step of the depth range.
const CODE_MM = DEPTH_MM / 0xffff;

function plane(x: number): number {
  return -DEPTH_MM + SLOPE * x;
}

function rampMap(mask?: ReadonlyArray<number>): ReliefObject {
  const width = WIDTH_MM / PIXEL_MM;
  const height = HEIGHT_MM / PIXEL_MM;
  const samples: number[] = [];
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      samples.push(Math.round(((plane((i + 0.5) * PIXEL_MM) + DEPTH_MM) / DEPTH_MM) * 0xffff));
    }
  }
  return {
    kind: 'relief',
    id: 'ramp',
    source: 'ramp.png',
    reliefSource: testReliefHeightfield({
      width,
      height,
      physicalWidthMm: WIDTH_MM,
      physicalHeightMm: HEIGHT_MM,
      maxDepthMm: DEPTH_MM,
      samplesU16: samples,
      ...(mask === undefined ? {} : { inclusionMask: mask }),
    }),
    targetWidthMm: WIDTH_MM,
    reliefDepthMm: DEPTH_MM,
    color: COLOR,
    bounds: { minX: 0, minY: 0, maxX: WIDTH_MM, maxY: HEIGHT_MM },
    transform: IDENTITY_TRANSFORM,
  };
}

function finishingPoints(relief: ReliefObject) {
  const scene: Scene = {
    objects: [relief],
    layers: [
      {
        ...createLayer({ id: 'L1', color: COLOR }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'engrave',
          toolId: 'em-6350',
          depthPerPassMm: 3,
          reliefFinishToolId: 'bn-3175',
          reliefFinishStrategy: 'raster',
        },
      },
    ],
  };
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
  const group = job.groups.find((g) => g.kind === 'cnc' && g.cutType === 'relief-finish');
  if (group?.kind !== 'cnc') throw new Error('no relief-finish group');
  // The finishing rows: step-down levels over roughed terraces (ADR-421
  // Amendment 5) ride above the surface on purpose.
  return withoutStepDown(group.passes).flatMap((pass) =>
    pass.kind === 'path3d' ? [pass.points] : [],
  );
}

// The ball tip's distance above the ball-on-plane height, read along every
// move away from the relief's edges, where only the plane can touch.
function offsetsFromPlane(paths: ReturnType<typeof finishingPoints>): number[] {
  const r = 3.175 / 2;
  const lift = r * (Math.sqrt(1 + SLOPE * SLOPE) - 1);
  // The edge pixels' half-pixel border is level, so stay a pixel past reach.
  const margin = r + PIXEL_MM;
  const inside = (point: { x: number; y: number }): boolean => {
    const local = toSceneCoords(point, DEFAULT_DEVICE_PROFILE);
    return (
      local.x >= margin &&
      local.x <= WIDTH_MM - margin &&
      local.y >= margin &&
      local.y <= HEIGHT_MM - margin
    );
  };
  const offsets: number[] = [];
  for (const points of paths) {
    points.forEach((from, index) => {
      const to = points[index + 1];
      if (to === undefined || !inside(from) || !inside(to)) return;
      for (let s = 0; s <= 8; s += 1) {
        const t = s / 8;
        const local = toSceneCoords(
          { x: from.x + t * (to.x - from.x), y: from.y + t * (to.y - from.y) },
          DEFAULT_DEVICE_PROFILE,
        );
        offsets.push(from.z + t * (to.z - from.z) - (plane(local.x) + lift));
      }
    });
  }
  return offsets;
}

describe('a height-map relief is finished on its pixel-centre surface (ADR-580 Amendment 2)', () => {
  it('the ball rides a sampled slope at the ball-on-plane height', () => {
    const offsets = offsetsFromPlane(finishingPoints(rampMap()));
    expect(offsets.length).toBeGreaterThan(100);
    // Within the samples' own rounding to a 16-bit code, plus the finishing
    // check's 0.002 mm.
    expect(Math.max(...offsets.map(Math.abs))).toBeLessThan(CODE_MM + 0.002);
  });

  it('a field with an excluded mask area keeps its highest-pixel cells', () => {
    const width = WIDTH_MM / PIXEL_MM;
    const height = HEIGHT_MM / PIXEL_MM;
    // Exclude one corner pixel; the rest of the ramp is machined.
    const mask = Array.from({ length: width * height }, (_, index) => (index === 0 ? 0 : 255));
    const offsets = offsetsFromPlane(finishingPoints(rampMap(mask)));
    expect(offsets.length).toBeGreaterThan(100);
    // Still conservative: never below the ball-on-plane height, and lifted.
    expect(Math.min(...offsets)).toBeGreaterThan(-(CODE_MM + 0.002));
    expect(Math.max(...offsets)).toBeGreaterThan(0.02);
  });
});
