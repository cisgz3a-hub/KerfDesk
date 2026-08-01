// End-to-end pin for part-major profile ordering (the Drive/Safe field
// incident, 2026-08-01): with two letter-like shapes on one layer, the
// compiled pass sequence must run the first letter's counter ladder, then its
// outer ladder, then move to the second letter — never all counters across
// the scene first.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type ImportedSvg,
  type Polyline,
  type Scene,
} from '../scene';
import type { CncContourPass, CncPass } from '../job';
import { compileCncJob } from './compile-cnc-job';

const dev = DEFAULT_DEVICE_PROFILE;
const config = DEFAULT_CNC_MACHINE_CONFIG;

function ring(atX: number, atY: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: atX, y: atY },
      { x: atX + size, y: atY },
      { x: atX + size, y: atY + size },
      { x: atX, y: atY + size },
    ],
  };
}

function contourPass(pass: CncPass): CncContourPass {
  if (pass.kind !== 'contour') throw new Error('expected a contour pass');
  return pass;
}

// Two "letters": outer 20 mm rings with 8 mm counters. The counters sit
// 6 mm inside their outers, far wider than the 3.175 mm bit, so ADR-218
// line-art pairing never fires on them.
const letterA = { outer: ring(0, 0, 20), hole: ring(6, 6, 8) };
const letterB = { outer: ring(40, 0, 20), hole: ring(46, 6, 8) };

const scene: Scene = {
  layers: [
    {
      ...createLayer({ id: 'L1', color: '#ff0000' }),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'profile-on-path',
        depthMm: 2,
        depthPerPassMm: 1,
        tabsEnabled: false,
      },
    },
  ],
  objects: [
    {
      kind: 'imported-svg',
      id: 'letters',
      source: 'letters.svg',
      bounds: { minX: 0, minY: 0, maxX: 60, maxY: 20 },
      transform: IDENTITY_TRANSFORM,
      paths: [
        {
          color: '#ff0000',
          polylines: [letterA.outer, letterA.hole, letterB.outer, letterB.hole],
        },
      ],
    } satisfies ImportedSvg,
  ],
};

describe('compileCncJob profile part order', () => {
  it('finishes one letter (counter, then outer, at every depth) before the next', () => {
    const job = compileCncJob(scene, dev, config);
    expect(job.groups).toHaveLength(1);
    const group = job.groups[0];
    if (group?.kind !== 'cnc') throw new Error('expected a cnc group');

    // Label each contour pass by the min X of its ring: counters start 6 mm
    // right of their outers, so minX identifies the contour unambiguously.
    const sequence = group.passes.map((pass) => {
      const polyline = contourPass(pass).polyline;
      const minX = Math.min(...polyline.map((point) => point.x));
      const zMm = contourPass(pass).zMm;
      return { minX, zMm };
    });

    expect(sequence).toEqual([
      { minX: 6, zMm: -1 },
      { minX: 6, zMm: -2 },
      { minX: 0, zMm: -1 },
      { minX: 0, zMm: -2 },
      { minX: 46, zMm: -1 },
      { minX: 46, zMm: -2 },
      { minX: 40, zMm: -1 },
      { minX: 40, zMm: -2 },
    ]);
  });
});
