// ADR-486 amendment 1 (weakness audit E-4): a hole or slot narrower than twice
// the kerf offset closes up under the offset and leaves nothing to cut. The
// engine succeeds, so before this nothing was reported and the slot silently
// went missing from the job.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  createLayer,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ImportedSvg,
  type Layer,
  type Polyline,
} from '../scene';
import { compileJob } from './compile-job';
import type { Job } from './job';

const COLOR = '#000000';
const LAYER_NAME = 'Cut';
const KERF_MM = 0.15;

function rect(minX: number, minY: number, width: number, height: number): Polyline {
  return {
    points: [
      { x: minX, y: minY },
      { x: minX + width, y: minY },
      { x: minX + width, y: minY + height },
      { x: minX, y: minY + height },
    ],
    closed: true,
  };
}

function path(...polylines: Polyline[]): ColoredPath {
  return { color: COLOR, polylines };
}

function object(id: string, ...paths: ColoredPath[]): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 60, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    paths,
  };
}

function kerfLayer(kerfOffsetMm = KERF_MM): Layer {
  return {
    ...createLayer({ id: 'cut', name: LAYER_NAME, color: COLOR }),
    mode: 'line',
    kerfOffsetMm,
  };
}

function compile(objects: ReadonlyArray<ImportedSvg>, layer: Layer = kerfLayer()): Job {
  return compileJob({ objects, layers: [layer] }, DEFAULT_DEVICE_PROFILE);
}

function cutCount(job: Job): number {
  return job.groups.reduce(
    (total, group) => total + (group.kind === 'cut' ? group.segments.length : 0),
    0,
  );
}

function closedUp(count: number, kerfOffsetMm = KERF_MM): Job['diagnostics'] {
  return [{ kind: 'kerf-offset-closed-up', layerName: LAYER_NAME, count, kerfOffsetMm }];
}

const PLATE = rect(0, 0, 60, 40);
// 0.25 mm wide: narrower than the 0.3 mm kerf, so shrinking each side by
// 0.15 mm leaves nothing.
const NARROW_SLOT = rect(20, 20, 20, 0.25);

describe('compileJob reports holes the kerf offset closes up', () => {
  it('counts a narrow slot drawn as its own object inside a plate', () => {
    const job = compile([object('plate', path(PLATE)), object('slot', path(NARROW_SLOT))]);

    expect(cutCount(job)).toBe(1);
    expect(job.diagnostics).toEqual(closedUp(1));
  });

  it('counts a narrow slot that is a hole of the plate path itself', () => {
    const job = compile([object('plate', path(PLATE, NARROW_SLOT))]);

    expect(cutCount(job)).toBe(1);
    expect(job.diagnostics).toEqual(closedUp(1));
  });

  it('reports nothing for a slot wider than the kerf', () => {
    const job = compile([object('plate', path(PLATE)), object('slot', path(rect(20, 20, 20, 1)))]);

    expect(cutCount(job)).toBe(2);
    expect(job.diagnostics).toBeUndefined();
  });

  it('counts a hole whose channel around an island closes up', () => {
    // 0.1 mm of channel on each side of the island: the island grows and the
    // hole shrinks until they meet, so neither edge is cut.
    const hole = rect(20, 10, 20, 20);
    const island = rect(20.1, 10.1, 19.8, 19.8);
    const job = compile([object('plate', path(PLATE)), object('ring', path(hole, island))]);

    expect(cutCount(job)).toBe(1);
    expect(job.diagnostics).toEqual(closedUp(1));
  });

  it('counts a thin part that a negative offset shrinks to nothing', () => {
    const job = compile(
      [object('plate', path(PLATE)), object('sliver', path(rect(0, 50, 20, 0.2)))],
      kerfLayer(-KERF_MM),
    );

    expect(cutCount(job)).toBe(1);
    expect(job.diagnostics).toEqual(closedUp(1, -KERF_MM));
  });

  it('counts a narrow slot of a path that straddles another object', () => {
    // One path with a slot inside the plate and a square outside it, so each of
    // its contours is offset on its own.
    const job = compile([
      object('plate', path(PLATE)),
      object('mixed', path(NARROW_SLOT, rect(70, 0, 10, 10))),
    ]);

    expect(cutCount(job)).toBe(2);
    expect(job.diagnostics).toEqual(closedUp(1));
  });

  it('reports nothing for islands, holes and parts that all survive', () => {
    const job = compile([
      object('plate', path(PLATE)),
      object('ring', path(rect(10, 10, 20, 20), rect(15, 15, 10, 10))),
      object('part', path(rect(70, 0, 10, 10))),
    ]);

    expect(cutCount(job)).toBe(4);
    expect(job.diagnostics).toBeUndefined();
  });
});
