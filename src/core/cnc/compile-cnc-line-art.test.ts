// ADR-218: a boundary trace of a stroked drawing arrives as nested contour
// PAIRS one stroke-width apart (the job111 field incident — the "second
// reversed job" was the outer edge's ladder). Edge-following cut types
// machine only the selected edge of a tight pair; band-based types and
// anything wider than the bit keep every contour. Split from
// compile-cnc-job.test.ts for the 400-line file cap.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
  type Polyline,
  type Scene,
} from '../scene';
import type { CncGroup, CncPass } from '../job';
import { compileCncJob } from './compile-cnc-job';

const dev = DEFAULT_DEVICE_PROFILE;
const config = DEFAULT_CNC_MACHINE_CONFIG; // 1/8 in bit (3.175 mm)

function ringSquare(at: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: at, y: at },
      { x: at + size, y: at },
      { x: at + size, y: at + size },
      { x: at, y: at + size },
    ],
  };
}

function objectWithPolylines(id: string, polylines: ReadonlyArray<Polyline>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color: '#ff0000', polylines: [...polylines] }],
  };
}

function cncLayer(cnc: Partial<CncLayerSettings>): Layer {
  return {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc },
  };
}

function onlyGroup(scene: Scene): CncGroup {
  const job = compileCncJob(scene, dev, config);
  expect(job.groups).toHaveLength(1);
  const group = job.groups[0];
  if (group?.kind !== 'cnc') throw new Error('expected a cnc group');
  return group;
}

function maxX(passes: ReadonlyArray<CncPass>): number {
  return Math.max(
    ...passes.flatMap((pass) => {
      if (pass.kind !== 'contour') throw new Error('expected a contour pass');
      return pass.polyline.map((point) => point.x);
    }),
  );
}

// The job111 field geometry: two nested outlines 0.72 mm apart.
const TRACED_PAIR = [ringSquare(0, 40), ringSquare(0.72, 40 - 2 * 0.72)];
const ON_PATH = { cutType: 'profile-on-path', depthMm: 2, depthPerPassMm: 1 } as const;

describe('compileCncJob line-art contour selection (ADR-218)', () => {
  it('cuts only the inner edge of a tight traced pair by default', () => {
    const scene: Scene = {
      layers: [cncLayer({ ...ON_PATH })],
      objects: [objectWithPolylines('O1', TRACED_PAIR)],
    };
    const group = onlyGroup(scene);
    expect(group.passes).toHaveLength(2); // one contour × two depths
    expect(maxX(group.passes)).toBeCloseTo(39.28, 3);
  });

  it("cuts both edges when the layer opts into 'both'", () => {
    const scene: Scene = {
      layers: [cncLayer({ ...ON_PATH, lineArtContours: 'both' })],
      objects: [objectWithPolylines('O1', TRACED_PAIR)],
    };
    const group = onlyGroup(scene);
    expect(group.passes).toHaveLength(4); // two contours × two depths
    expect(maxX(group.passes)).toBeCloseTo(40, 3);
  });

  it("cuts only the outer edge for 'outer'", () => {
    const scene: Scene = {
      layers: [cncLayer({ ...ON_PATH, lineArtContours: 'outer' })],
      objects: [objectWithPolylines('O1', TRACED_PAIR)],
    };
    const group = onlyGroup(scene);
    expect(group.passes).toHaveLength(2);
    expect(maxX(group.passes)).toBeCloseTo(40, 3);
  });

  it('leaves pocket geometry alone — a ring band needs both edges', () => {
    // Wide band so the bit fits the pocket; the selection must still not
    // apply (pocket is band-based even when a pair IS tight).
    const ring = (settings: Partial<CncLayerSettings>): CncGroup =>
      onlyGroup({
        layers: [cncLayer({ cutType: 'pocket', depthMm: 2, depthPerPassMm: 1, ...settings })],
        objects: [objectWithPolylines('O1', [ringSquare(0, 40), ringSquare(10, 20)])],
      });
    expect(ring({ lineArtContours: 'inner' }).passes).toEqual(
      ring({ lineArtContours: 'both' }).passes,
    );
  });

  it('keeps washer-style nesting intact under the default (wall wider than the bit)', () => {
    const scene: Scene = {
      layers: [cncLayer({ ...ON_PATH })],
      objects: [objectWithPolylines('W1', [ringSquare(0, 40), ringSquare(10, 20)])],
    };
    const group = onlyGroup(scene);
    expect(group.passes).toHaveLength(4); // both contours survive
  });
});
